// Library panel: YouTube links and local files are added once, then loaded into any deck
// with the deck buttons, drag and drop, keys 1-4 or the controller's browse knob and LOAD buttons.
import { formatTime } from './core.mjs';
const $ = selector => document.querySelector(selector);
export function splitLinks(text) { return [...new Set(String(text).split(/\s+/).map(link => link.trim()).filter(Boolean))]; }
export function mountLibrary({ load, deckCount, deckState, status }) {
  const api = window.desktop?.library;
  let entries = [], selectedId = null, filter = '';
  const queue = []; let importing = false;
  const visible = () => entries.filter(entry => entry.title.toLowerCase().includes(filter));
  function render() {
    const list = $('#library-list'), rows = visible();
    list.replaceChildren(...rows.map(entry => {
      const row = $('#track-row-template').content.firstElementChild.cloneNode(true);
      row.dataset.id = entry.id; row.setAttribute('aria-selected', String(entry.id === selectedId));
      row.querySelector('.row-title').textContent = entry.title;
      row.querySelector('.row-source').textContent = entry.source === 'youtube' ? 'YouTube' : 'Archivo';
      row.querySelector('.row-duration').textContent = entry.duration ? formatTime(entry.duration) : '—';
      const decks = deckState().map((deck, index) => deck.trackId === entry.id ? index + 1 : null).filter(Boolean);
      row.querySelector('.row-decks').textContent = decks.length ? `En deck ${decks.join(', ')}` : '';
      row.querySelectorAll('[data-load]').forEach(button => {
        const index = Number(button.dataset.load);
        button.hidden = index >= deckCount(); button.setAttribute('aria-label', `Cargar «${entry.title}» en el deck ${index + 1}`);
        button.onclick = event => { event.stopPropagation(); select(entry.id); loadInto(index); };
      });
      row.querySelector('.row-export').onclick = event => { event.stopPropagation(); exportEntry(entry); };
      row.querySelector('.row-remove').onclick = event => { event.stopPropagation(); removeEntry(entry); };
      row.onclick = () => select(entry.id);
      row.ondragstart = event => { event.dataTransfer.setData('application/x-pulso-track', entry.id); event.dataTransfer.effectAllowed = 'copy'; };
      return row;
    }));
    $('#library-empty').hidden = entries.length > 0;
    $('#library-empty').textContent = api ? 'Pega enlaces de YouTube o añade archivos. Después carga cada pista en un deck.' : 'La biblioteca necesita la aplicación de escritorio de Pulso DJ.';
    $('#library-count').textContent = entries.length === 1 ? '1 pista' : `${entries.length} pistas`;
  }
  function renderQueue() {
    $('#import-queue').replaceChildren(...queue.map(item => {
      const row = document.createElement('div'); row.className = `queue-item ${item.state}`;
      const text = document.createElement('span'); text.textContent = item.message; row.append(text);
      if (item.state === 'active') {
        const bar = document.createElement('progress'); bar.max = 100; if (Number.isFinite(item.percent)) bar.value = item.percent; row.append(bar);
        const cancel = document.createElement('button'); cancel.className = 'subtle'; cancel.textContent = 'Cancelar';
        cancel.onclick = () => window.desktop.cancelYouTube(); row.append(cancel);
      } else if (item.state !== 'pending') {
        const dismiss = document.createElement('button'); dismiss.className = 'subtle'; dismiss.textContent = 'Quitar';
        dismiss.onclick = () => { queue.splice(queue.indexOf(item), 1); renderQueue(); }; row.append(dismiss);
      }
      return row;
    }));
  }
  function select(id, scroll = false) {
    selectedId = id;
    for (const row of document.querySelectorAll('#library-list [data-id]')) {
      const on = row.dataset.id === id; row.setAttribute('aria-selected', String(on));
      if (on && scroll) row.scrollIntoView({ block: 'nearest' });
    }
  }
  function moveSelection(delta) {
    const rows = visible(); if (!rows.length) return;
    const index = rows.findIndex(entry => entry.id === selectedId);
    select(rows[Math.min(rows.length - 1, Math.max(0, (index < 0 ? -1 : index) + delta))].id, true);
  }
  async function loadInto(deck, id = selectedId) {
    const entry = entries.find(item => item.id === id);
    if (!entry) { status('Selecciona primero una pista de la biblioteca.'); return false; }
    if (deckState()[deck].playing) { status(`El deck ${deck + 1} está sonando. Páusalo antes de cargar otra pista.`); return false; }
    try {
      const file = await api.read(entry.id);
      const duration = await load(deck, file, entry.id);
      if (!entry.duration && duration) { entry.duration = duration; api.setDuration(entry.id, duration).catch(() => {}); }
      render(); return true;
    } catch (error) { status(error.message); return false; }
  }
  async function processQueue() {
    if (importing) return;
    const item = queue.find(candidate => candidate.state === 'pending'); if (!item) return;
    importing = true; item.state = 'active'; item.message = `Importando ${item.url}`; renderQueue();
    const unsubscribe = window.desktop.onYouTubeProgress(update => {
      item.message = update.message; item.percent = update.percent; renderQueue();
    });
    try {
      const entry = await api.importYouTube(item.url);
      entries.unshift(entry); select(entry.id); render();
      queue.splice(queue.indexOf(item), 1);
      status(`«${entry.title}» añadida a la biblioteca.`);
    } catch (error) {
      item.state = 'failed'; item.message = `${item.url}: ${error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')}`;
    } finally { unsubscribe(); importing = false; renderQueue(); processQueue(); }
  }
  async function exportEntry(entry) {
    try { if (await api.export(entry.id)) status(`Copia de «${entry.title}» guardada.`); } catch (error) { status(error.message); }
  }
  async function removeEntry(entry) {
    try {
      await api.remove(entry.id); entries = entries.filter(item => item !== entry);
      if (selectedId === entry.id) selectedId = null;
      render(); status(`«${entry.title}» quitada de la biblioteca.${entry.source === 'file' ? ' El archivo original sigue en su carpeta.' : ''}`);
    } catch (error) { status(error.message); }
  }
  async function addFiles(multiple = true) {
    const { added, errors } = await api.addFiles(multiple);
    for (const entry of added) if (!entries.some(item => item.id === entry.id)) entries.unshift(entry);
    if (added.length) select(added[0].id);
    render(); if (errors.length) status(errors.join(' '));
    return added;
  }
  $('#youtube-form').onsubmit = event => {
    event.preventDefault();
    if (!api) { status('Para importar de YouTube, abre la aplicación de escritorio de Pulso DJ.'); return; }
    const links = splitLinks($('#youtube-links').value);
    if (!links.length) { status('Pega al menos un enlace de YouTube.'); return; }
    for (const url of links) queue.push({ url, state: 'pending', message: `En cola: ${url}` });
    $('#youtube-links').value = ''; renderQueue(); processQueue();
  };
  $('#add-files').onclick = () => { if (api) addFiles().catch(error => status(error.message)); else status('Para añadir archivos a la biblioteca, abre la aplicación de escritorio de Pulso DJ.'); };
  $('#library-search').oninput = event => { filter = event.target.value.trim().toLowerCase(); render(); };
  $('#library-list').addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); moveSelection(event.key === 'ArrowDown' ? 1 : -1); }
    const deck = Number(event.key) - 1;
    if (deck >= 0 && deck < deckCount()) { event.preventDefault(); event.stopPropagation(); loadInto(deck); }
  });
  if (api) api.list().then(list => { entries = list; render(); }).catch(error => status(error.message)); else render();
  return {
    moveSelection, loadInto, addFiles, render,
    hasSelection: () => entries.some(entry => entry.id === selectedId),
    // The selected track's audio, for the sampler; null without a selection.
    async readSelection() {
      const entry = entries.find(item => item.id === selectedId);
      return entry ? { name: entry.title, bytes: (await api.read(entry.id)).bytes } : null;
    },
    dropTarget(element, deck) {
      element.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('application/x-pulso-track')) { event.preventDefault(); element.classList.add('drop'); } });
      element.addEventListener('dragleave', () => element.classList.remove('drop'));
      element.addEventListener('drop', event => {
        element.classList.remove('drop');
        const id = event.dataTransfer.getData('application/x-pulso-track');
        if (id) { event.preventDefault(); select(id); loadInto(deck, id); }
      });
    }
  };
}

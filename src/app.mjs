import { Mixer } from './audio.mjs';
import { mountAssistant } from './assistant.mjs';
import { midiEvent, mappingKey, formatTime } from './core.mjs';
const $ = selector => document.querySelector(selector);
const mixer = new Mixer();
const status = message => { $('#status').textContent = message; };
const safe = action => Promise.resolve().then(action).catch(error => status(error.message));
async function chooseAudio() {
  if (window.desktop) return window.desktop.chooseAudio();
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'audio/*';
  return new Promise(resolve => {
    input.oncancel = () => resolve(null);
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) { resolve(null); return; }
      if (file.size > 128 * 1024 * 1024) { status('El archivo supera 128 MB.'); resolve(null); return; }
      resolve({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    };
    input.click();
  });
}
const targets = new Map();
const views = [];
let youtubeBusy = false;
let mappings = {};
try { mappings = JSON.parse(localStorage.getItem('pulso.midi.v1') || '{}') || {}; } catch { mappings = {}; }
if (typeof mappings !== 'object' || Array.isArray(mappings)) mappings = {};
let access, learning = false;
function addTarget(id, label, kind, run) { targets.set(id, { label, kind, run }); }
function bindRange(element, callback) { element.addEventListener('input', () => callback(Number(element.value))); }
function setRange(element, value) { element.value = value; element.dispatchEvent(new Event('input')); }
function waveform(view, deck) {
  const canvas = view.querySelector('canvas'), ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#273447'; ctx.beginPath(); ctx.moveTo(0, 55); ctx.lineTo(800, 55); ctx.stroke();
  if (!deck.buffer) return;
  if (view.cachedBuffer !== deck.buffer) {
    const samples = deck.buffer.getChannelData(0), peaks = new Float32Array(400);
    for (let i = 0; i < peaks.length; i++) {
      const start = Math.floor(i * samples.length / peaks.length), end = Math.floor((i + 1) * samples.length / peaks.length);
      for (let s = start; s < end; s += Math.max(1, Math.floor((end - start) / 100))) peaks[i] = Math.max(peaks[i], Math.abs(samples[s]));
    }
    view.cachedBuffer = deck.buffer; view.peaks = peaks;
  }
  if (deck.loop) { ctx.fillStyle = '#ffffff18'; ctx.fillRect(deck.loop.start / deck.duration * 800, 0, (deck.loop.end - deck.loop.start) / deck.duration * 800, 110); }
  const peaks = view.peaks;
  ctx.fillStyle = view.dataset.index === '0' ? '#66e2bb' : '#a995ff';
  for (let i = 0; i < peaks.length; i++) {
    const peak = peaks[i];
    ctx.fillRect(i * 2, 55 - peak * 49, 1.5, Math.max(1, peak * 98));
  }
  ctx.fillStyle = '#ffffff'; ctx.fillRect(deck.position / deck.duration * 800, 0, 2, 110);
}
mixer.decks.forEach((deck, index) => {
  const view = $('#deck-template').content.firstElementChild.cloneNode(true);
  view.dataset.index = String(index); views.push(view); $('#decks').append(view);
  const letter = index === 0 ? 'A' : 'B';
  let importedFile = null;
  const find = selector => view.querySelector(selector);
  find('.deck-id').textContent = `DECK ${letter}`;
  const toggle = () => safe(async () => { if (deck.playing) deck.pause(); else await deck.play(); });
  find('.play').onclick = toggle;
  const recallCue = () => safe(async () => { deck.pause(); await deck.seek(deck.cue); });
  find('.cue').onclick = recallCue;
  find('.set-cue').onclick = () => { deck.cue = deck.position; status(`Cue ${letter} marcado en ${formatTime(deck.cue)}.`); };
  const loadTrack = async file => {
    status(`Cargando ${file.name}…`);
    const bytes = new Uint8Array(file.bytes); await deck.load(bytes.buffer);
    importedFile = file.format ? file : null; find('.youtube-save').hidden = !importedFile;
    find('.track').textContent = file.name;
    find('.track-info').textContent = `${formatTime(deck.duration)} · ${deck.buffer.sampleRate / 1000} kHz · ${deck.buffer.numberOfChannels} canales`;
    for (const element of view.querySelectorAll('.play,.cue,.set-cue,.seek,[data-hotcue],[data-loop],.loop-off')) element.disabled = false;
    find('.seek').max = deck.duration; status(`Pista lista en deck ${letter}.`);
  };
  find('.load').onclick = () => safe(async () => {
    find('.load').disabled = true;
    try {
      const file = await chooseAudio();
      if (!file) return;
      await loadTrack(file);
    } finally { find('.load').disabled = false; }
  });
  find('.youtube-import').onclick = () => safe(async () => {
    if (!window.desktop?.importYouTube) { find('.youtube-message').textContent = 'Para importar YouTube, abre la aplicación instalada de Pulso DJ.'; return; }
    if (youtubeBusy) return;
    const url = find('.youtube-url').value.trim();
    if (!url) { find('.youtube-message').textContent = 'Pega primero la URL de un vídeo.'; return; }
    youtubeBusy = true;
    for (const button of document.querySelectorAll('.youtube-import')) button.disabled = true;
    find('.load').disabled = true; find('.youtube-url').disabled = true;
    find('.youtube-cancel').hidden = false; find('.youtube-cancel').disabled = false;
    const progress = find('.youtube-progress'); progress.hidden = false; progress.removeAttribute('value');
    find('.youtube-message').textContent = 'Iniciando importación…';
    const unsubscribe = window.desktop.onYouTubeProgress(update => {
      find('.youtube-message').textContent = update.message + (Number.isFinite(update.percent) ? ` ${update.percent.toFixed(0)}%` : '');
      if (Number.isFinite(update.percent)) progress.value = update.percent;
      if (update.stage === 'decoding') find('.youtube-cancel').disabled = true;
    });
    try {
      const file = await window.desktop.importYouTube(url);
      await loadTrack(file); find('.youtube-message').textContent = 'Audio importado. Ya puedes usar loops, cues y efectos.';
    } catch (error) {
      const message = error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
      find('.youtube-message').textContent = message; status(message);
    } finally {
      unsubscribe(); youtubeBusy = false;
      for (const button of document.querySelectorAll('.youtube-import')) button.disabled = false;
      find('.load').disabled = false; find('.youtube-url').disabled = false;
      find('.youtube-cancel').hidden = true; progress.hidden = true;
    }
  });
  find('.youtube-cancel').onclick = () => safe(async () => { find('.youtube-cancel').disabled = true; await window.desktop.cancelYouTube(); });
  find('.youtube-save').onclick = () => safe(async () => {
    if (!importedFile) return;
    find('.youtube-save').disabled = true;
    try { if (await window.desktop.saveImportedAudio(importedFile)) status('Audio original guardado. Los efectos se aplican durante la reproducción.'); }
    finally { find('.youtube-save').disabled = false; }
  });
  bindRange(find('.seek'), seconds => safe(() => deck.seek(seconds)));
  bindRange(find('.volume'), value => deck.setVolume(value));
  bindRange(find('.pitch'), value => { deck.setRate(1 + value / 100); find('.pitch-value').textContent = `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`; });
  for (const element of view.querySelectorAll('[data-eq]')) bindRange(element, value => deck.setEQ(Number(element.dataset.eq), value));
  addTarget(`${letter}.play`, `Deck ${letter} · Play / pausa`, 'button', toggle);
  addTarget(`${letter}.cue`, `Deck ${letter} · Cue`, 'button', recallCue);
  addTarget(`${letter}.volume`, `Deck ${letter} · Volumen`, 'range', value => setRange(find('.volume'), value));
  addTarget(`${letter}.pitch`, `Deck ${letter} · Velocidad`, 'range', value => setRange(find('.pitch'), value * 32 - 16));
  ['Graves', 'Medios', 'Agudos'].forEach((label, i) => addTarget(`${letter}.eq${i}`, `Deck ${letter} · ${label}`, 'range', value => setRange(find(`[data-eq="${i}"]`), value * 36 - 24)));
  const startLoop = beats => {
    if (!deck.enableLoop(beats)) status(`La pista no tiene duración suficiente para ${beats} beats.`);
  };
  for (const button of view.querySelectorAll('[data-loop]')) {
    const beats = Number(button.dataset.loop);
    button.onclick = () => startLoop(beats);
    addTarget(`${letter}.loop${beats}`, `Deck ${letter} · Loop ${beats} beats`, 'button', () => startLoop(beats));
  }
  find('.loop-off').onclick = () => deck.disableLoop();
  addTarget(`${letter}.loopOff`, `Deck ${letter} · Salir del loop`, 'button', () => deck.disableLoop());
  for (const button of view.querySelectorAll('[data-hotcue]')) {
    const i = Number(button.dataset.hotcue);
    button.onclick = event => safe(() => deck.triggerHotCue(i, event.shiftKey));
    addTarget(`${letter}.hotcue${i}`, `Deck ${letter} · Hot cue ${i + 1}`, 'button', () => safe(() => deck.triggerHotCue(i)));
  }
  find('.bpm').onchange = () => {
    const value = Number(find('.bpm').value);
    if (!Number.isFinite(value)) return;
    deck.setBpm(value); find('.bpm').value = deck.bpm;
  };
  let taps = [];
  find('.tap').onclick = () => {
    const now = performance.now();
    if (taps.length && now - taps.at(-1) > 2000) taps = [];
    taps.push(now); taps = taps.slice(-5);
    if (taps.length > 1) { deck.setBpm(60000 * (taps.length - 1) / (now - taps[0])); find('.bpm').value = deck.bpm.toFixed(1); }
    else status(`Deck ${letter}: pulsa Tap varias veces siguiendo el ritmo.`);
  };
  for (const input of view.querySelectorAll('[data-fx]')) {
    bindRange(input, value => deck.setFX(input.dataset.fx, value));
    addTarget(`${letter}.fx.${input.dataset.fx}`, `Deck ${letter} · FX ${input.dataset.fx}`, 'range', value => setRange(input, value));
  }
  const resetFX = () => { for (const input of view.querySelectorAll('[data-fx]')) setRange(input, 0); };
  find('.fx-reset').onclick = resetFX;
  addTarget(`${letter}.fxReset`, `Deck ${letter} · Restablecer FX`, 'button', resetFX);
});
bindRange($('#crossfade'), value => mixer.setCrossfade(value));
bindRange($('#master'), value => mixer.setMaster(value));
addTarget('crossfade', 'Mezclador · Crossfader', 'range', value => setRange($('#crossfade'), value));
addTarget('master', 'Mezclador · Master', 'range', value => setRange($('#master'), value));
for (const [id, target] of targets) $('#target').add(new Option(target.label, id));
function showMappings() {
  $('#mappings').replaceChildren();
  for (const [key, id] of Object.entries(mappings)) {
    if (!targets.has(id)) continue;
    const tag = document.createElement('span'); tag.textContent = `${targets.get(id).label} ← ${key.split(':').slice(-3).join(' / ')}`;
    $('#mappings').append(tag);
  }
}
function saveMappings() {
  try { localStorage.setItem('pulso.midi.v1', JSON.stringify(mappings)); }
  catch { status('No se pudieron guardar las asignaciones MIDI.'); }
  showMappings();
}
function cancelLearning() { learning = false; $('#learn').textContent = 'Aprender MIDI'; }
function receive(message, device) {
  const event = midiEvent(message.data); if (!event) return;
  const key = mappingKey(event, device.id);
  if (learning) {
    const target = targets.get($('#target').value);
    if (target.kind === 'range' && event.type !== 'cc') { $('#midi-status').textContent = 'Mueve un fader o potenciómetro que envíe CC.'; return; }
    if (event.type === 'note' && !event.pressed) return;
    if (target.kind === 'button' && event.type === 'cc') { $('#midi-status').textContent = 'Pulsa un botón que envíe una nota MIDI.'; return; }
    mappings[key] = $('#target').value; saveMappings(); cancelLearning();
    $('#midi-status').textContent = `Asignado: ${target.label}`; return;
  }
  const target = targets.get(mappings[key]); if (!target) return;
  if (target.kind === 'button') { if (event.pressed) target.run(); }
  else if (event.type === 'cc') target.run(event.value / 127);
}
function selectDevice() {
  if (!access) return;
  cancelLearning();
  for (const device of access.inputs.values()) device.onmidimessage = device.id === $('#device').value ? message => receive(message, device) : null;
}
function refreshDevices() {
  const previous = $('#device').value;
  $('#device').replaceChildren(new Option('Seleccionar dispositivo', ''));
  for (const device of access.inputs.values()) if (device.state === 'connected') $('#device').add(new Option(device.name || 'MIDI', device.id));
  if ([...$('#device').options].some(option => option.value === previous)) $('#device').value = previous;
  selectDevice();
  $('#midi-status').textContent = $('#device').options.length > 1 ? 'Selecciona tu dispositivo y usa Aprender MIDI.' : 'No se encontraron entradas MIDI. Comprueba conexión y controlador del fabricante.';
}
$('#connect').onclick = () => safe(async () => {
  if (!navigator.requestMIDIAccess) throw new Error('MIDI no está disponible en este entorno.');
  access ??= await navigator.requestMIDIAccess({ sysex: false });
  access.onstatechange = refreshDevices; refreshDevices();
});
$('#device').onchange = selectDevice;
$('#learn').onclick = () => {
  if (!$('#device').value) { status('Selecciona primero una entrada MIDI.'); return; }
  learning = !learning; $('#learn').textContent = learning ? 'Cancelar aprendizaje' : 'Aprender MIDI';
  $('#midi-status').textContent = learning ? 'Pulsa o mueve el control que quieres asignar.' : 'Aprendizaje cancelado.';
};
$('#clear').onclick = () => { mappings = {}; cancelLearning(); saveMappings(); $('#midi-status').textContent = 'Asignaciones borradas.'; };
showMappings();
document.addEventListener('keydown', event => {
  if (event.repeat || ['INPUT', 'SELECT', 'BUTTON'].includes(event.target.tagName)) return;
  const action = { Space: 'A.play', Enter: 'B.play', KeyC: 'A.cue', KeyN: 'B.cue' }[event.code];
  if (action) { event.preventDefault(); targets.get(action).run(); }
});
const samples = new Float32Array(mixer.analyser.fftSize);
setInterval(() => {
  mixer.decks.forEach((deck, i) => {
    const view = views[i]; view.querySelector('.elapsed').textContent = formatTime(deck.position);
    view.querySelector('.remaining').textContent = `−${formatTime(deck.duration - deck.position)}`;
    if (document.activeElement !== view.querySelector('.seek')) view.querySelector('.seek').value = deck.position;
    view.querySelector('.play').textContent = deck.playing ? 'Ⅱ Pausar' : '▶ Reproducir'; waveform(view, deck);
    view.classList.toggle('is-playing', deck.playing);
    view.querySelector('.playing-label').textContent = deck.playing ? 'EN SESIÓN' : deck.buffer ? 'PISTA LISTA' : 'EN ESPERA';
    view.querySelector('.loop-status').textContent = deck.loop ? `${deck.loopBeats} BEATS ACTIVO` : 'DESACTIVADO';
    for (const button of view.querySelectorAll('[data-loop]')) button.classList.toggle('active', Boolean(deck.loop) && Number(button.dataset.loop) === deck.loopBeats);
    for (const button of view.querySelectorAll('[data-hotcue]')) {
      const cue = deck.hotCues[Number(button.dataset.hotcue)];
      button.classList.toggle('saved', cue !== null); button.querySelector('small').textContent = cue === null ? 'GUARDAR' : formatTime(cue);
    }
  });
  mixer.analyser.getFloatTimeDomainData(samples);
  let peak = 0; for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  $('#meter').value = peak; $('#level').textContent = peak > 0.0001 ? `${(20 * Math.log10(peak)).toFixed(1)} dBFS` : '−∞ dBFS';
  $('#audio-status').textContent = `${mixer.context.state === 'running' ? 'Audio activo' : 'Audio en espera'} · ${mixer.context.sampleRate / 1000} kHz`;
}, 100);
const frequency = new Uint8Array(mixer.analyser.frequencyBinCount);
function animateSpectrum() {
  const canvas = $('#spectrum'), ctx = canvas.getContext('2d');
  mixer.analyser.getByteFrequencyData(frequency); ctx.clearRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0); gradient.addColorStop(0, '#66e2bb'); gradient.addColorStop(1, '#a995ff'); ctx.fillStyle = gradient;
  for (let i = 0; i < 40; i++) { const height = frequency[i * 3] / 255 * 40; ctx.fillRect(i * 6, 40 - height, 4, Math.max(1, height)); }
  requestAnimationFrame(animateSpectrum);
}
requestAnimationFrame(animateSpectrum);
mountAssistant(mixer, status);

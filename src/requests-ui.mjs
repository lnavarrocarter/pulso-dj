// Guest requests panel: opens the request page on the local network, shows its QR code and lets the DJ accept or
// reject each request. Accepted songs are downloaded into the library with the guest's favourite part marked.
import { formatTime } from './core.mjs';
import { drawQR } from './qr.mjs';
const $ = selector => document.querySelector(selector);
const STATUS = { pending: 'En espera', approved: 'En cola de descarga', downloading: 'Descargando', ready: 'En la biblioteca', rejected: 'Rechazado', failed: 'Error' };
export function mountRequests({ status, library }) {
  const api = window.desktop?.requests;
  let info = null, list = [];
  function render() {
    $('#requests-toggle').textContent = info ? 'Cerrar pedidos' : 'Abrir pedidos';
    $('#requests-toggle').setAttribute('aria-pressed', String(Boolean(info)));
    $('#requests-access').hidden = !info;
    if (info) {
      $('#requests-url').textContent = info.url ?? `Puerto ${info.port}: este ordenador no tiene una dirección de red local.`;
      $('#requests-code').textContent = info.code;
      if (info.url) drawQR($('#requests-qr'), info.url);
      $('#requests-qr').hidden = !info.url;
    }
    const waiting = list.filter(item => item.status === 'pending').length;
    $('#requests-count').textContent = waiting ? `${waiting} en espera` : '';
    $('#requests-clear').hidden = !list.some(item => ['ready', 'rejected', 'failed'].includes(item.status));
    $('#requests-empty').hidden = list.length > 0;
    $('#requests-empty').textContent = api
      ? (info ? 'Todavía no hay pedidos. Los invitados escanean el QR con el móvil, en el mismo wifi.' : 'Abre los pedidos para que los invitados te manden canciones desde el móvil.')
      : 'Los pedidos necesitan la aplicación de escritorio de Pulso DJ.';
    $('#requests-list').replaceChildren(...list.slice().reverse().map(item => {
      const row = document.createElement('li'); row.className = `request ${item.status}`;
      const text = document.createElement('div'), title = document.createElement('strong'), detail = document.createElement('span');
      title.textContent = item.title;
      detail.textContent = `${item.name} · parte ${formatTime(item.start)}–${formatTime(item.end)} · ${item.message || STATUS[item.status]}`;
      text.append(title, detail); row.append(text);
      const button = (label, action, subtle = false) => {
        const element = document.createElement('button'); element.textContent = label; if (subtle) element.className = 'subtle';
        element.onclick = () => action().catch(error => status(error.message)); row.append(element);
      };
      if (item.status === 'pending' || item.status === 'failed') {
        button(item.status === 'failed' ? 'Reintentar' : 'Aceptar', () => api.approve(item.id));
        button('Rechazar', () => api.reject(item.id), true);
      }
      if (item.status === 'ready' && item.entryId) button('Ver en la biblioteca', async () => library.reveal(item.entryId), true);
      return row;
    }));
  }
  $('#requests-toggle').onclick = async () => {
    if (!api) { status('Los pedidos necesitan la aplicación de escritorio de Pulso DJ.'); return; }
    try {
      if (info) { await api.close(); info = null; status('Pedidos cerrados: la página de los invitados ya no responde.'); }
      else {
        info = await api.open();
        status(info.url ? `Pedidos abiertos en ${info.url.replace(/\?.*/, '')} con el código ${info.code}. Si Windows pregunta, permite el acceso solo en redes privadas.`
          : 'Pedidos abiertos, pero este ordenador no está conectado a una red local.');
      }
    } catch (error) { status(error.message); }
    render();
  };
  $('#requests-clear').onclick = () => api.clear().catch(error => status(error.message));
  if (api) {
    api.onChanged(next => {
      const before = new Map(list.map(item => [item.id, item.status]));
      list = next; render();
      for (const item of next) {
        if (!before.has(item.id)) status(`Nuevo pedido de ${item.name}: «${item.title}».`);
        else if (before.get(item.id) !== item.status && item.status === 'failed') status(`No se pudo descargar «${item.title}»: ${item.message}`);
      }
    });
    api.state().then(state => { info = state.info; list = state.list; render(); }).catch(error => status(error.message));
  } else render();
}

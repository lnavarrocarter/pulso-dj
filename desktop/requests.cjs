// Song requests from guests on the local network. While open, a small web server shows a phone page where a guest
// writes their name, pastes a YouTube link and marks their favourite part (up to 3 minutes). Requests wait for the
// DJ's approval; nothing is downloaded and nothing on the DJ's computer can be reached from the page.
const http = require('node:http');
const os = require('node:os');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizeYouTubeURL } = require('./youtube.cjs');
const MAX_PART = 180, MIN_PART = 10, MAX_POSITION = 1200; // seconds; the importer accepts videos up to 20 minutes
const OPEN_PER_GUEST = 3; // requests waiting or downloading per guest
const COOLDOWN_MS = 20000;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L to misread
const FINAL = new Set(['ready', 'rejected', 'failed']);
const STATIC = { '/': ['index.html', 'text/html; charset=utf-8'], '/guest.js': ['guest.js', 'text/javascript; charset=utf-8'], '/guest.css': ['guest.css', 'text/css; charset=utf-8'] };
// The YouTube player (IFrame API) lets the guest hear the video and mark the part; it needs the page's referrer.
const PAGE_POLICY = "default-src 'self'; script-src 'self' https://www.youtube.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; img-src 'self' https://i.ytimg.com; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
// Private IPv4 addresses of this computer, Wi-Fi/Ethernet first.
function lanAddresses() {
  const result = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const address of list ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address)) continue;
      result.push({ name, address: address.address, virtual: /vethernet|virtual|vmware|vbox|hyper-v|wsl|docker/i.test(name) });
    }
  }
  return result.sort((a, b) => a.virtual - b.virtual).map(item => item.address);
}
const newCode = () => Array.from(crypto.randomBytes(4), byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
function sameCode(given, expected) {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given.trim().toUpperCase()), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function cleanName(value) {
  const name = String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
  if (!name || name.length > 30) throw Object.assign(new Error('Escribe tu nombre (máximo 30 caracteres).'), { status: 400 });
  return name;
}
function cleanPart(start, end) {
  if (![start, end].every(Number.isFinite) || start < 0 || end > MAX_POSITION || end <= start) throw Object.assign(new Error('Marca el inicio y el final de tu parte.'), { status: 400 });
  if (end - start > MAX_PART) throw Object.assign(new Error('Tu parte puede durar como mucho 3 minutos.'), { status: 400 });
  if (end - start < MIN_PART) throw Object.assign(new Error('Tu parte tiene que durar al menos 10 segundos.'), { status: 400 });
  return { start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10 };
}
// guestFolder: the phone page files. onChange(list) runs after every change, for the DJ's window.
function createRequestService({ guestFolder, onChange = () => {}, now = () => Date.now() }) {
  let server = null, info = null, requests = [];
  const failures = new Map(), lastSubmit = new Map();
  const changed = () => onChange(list());
  const list = () => requests.map(({ id, name, title, url, videoId, start, end, status, message, entryId, createdAt }) => ({ id, name, title, url, videoId, start, end, status, message, entryId, createdAt }));
  const send = (response, status, body, type = 'application/json; charset=utf-8') => {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      ...(type.startsWith('text/html') ? { 'Content-Security-Policy': PAGE_POLICY } : {}) });
    response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
  };
  const readJSON = request => new Promise((resolve, reject) => {
    if (!/^application\/json\b/.test(request.headers['content-type'] ?? '')) { reject(Object.assign(new Error('Formato no válido.'), { status: 415 })); return; }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; if (body.length > 2048) { reject(Object.assign(new Error('Pedido demasiado grande.'), { status: 413 })); request.destroy(); } });
    request.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(Object.assign(new Error('Formato no válido.'), { status: 400 })); } });
    request.on('error', reject);
  });
  // A wrong code counts against the address: 10 tries every 10 minutes, so the code cannot be guessed.
  function checkCode(ip, code) {
    const record = failures.get(ip);
    if (record && now() - record.since > 600000) failures.delete(ip);
    if ((failures.get(ip)?.count ?? 0) >= 10) throw Object.assign(new Error('Demasiados intentos. Espera unos minutos.'), { status: 429 });
    if (!sameCode(code, info.code)) {
      const entry = failures.get(ip) ?? { count: 0, since: now() }; entry.count++; failures.set(ip, entry);
      throw Object.assign(new Error('El código no es correcto. Escanea de nuevo el QR de la pantalla del DJ.'), { status: 403 });
    }
  }
  const validClient = client => typeof client === 'string' && /^[a-z0-9]{16,40}$/.test(client);
  function submit(ip, body) {
    checkCode(ip, body.code);
    if (!validClient(body.client)) throw Object.assign(new Error('Recarga la página y prueba de nuevo.'), { status: 400 });
    const name = cleanName(body.name);
    let url; try { url = normalizeYouTubeURL(body.url); } catch (error) { throw Object.assign(error, { status: 400 }); }
    const { start, end } = cleanPart(Number(body.start), Number(body.end));
    const mine = requests.filter(item => (item.client === body.client || item.ip === ip) && !FINAL.has(item.status));
    if (mine.length >= OPEN_PER_GUEST) throw Object.assign(new Error('Ya tienes 3 pedidos en espera. Pide otra cuando suene alguno.'), { status: 429 });
    if (now() - (lastSubmit.get(ip) ?? -Infinity) < COOLDOWN_MS) throw Object.assign(new Error('Espera unos segundos antes de pedir otra.'), { status: 429 });
    const videoId = new URL(url).searchParams.get('v');
    if (requests.some(item => item.videoId === videoId && !FINAL.has(item.status))) throw Object.assign(new Error('Esa canción ya está pedida.'), { status: 409 });
    if (requests.filter(item => item.status === 'pending').length >= 100) throw Object.assign(new Error('El DJ tiene demasiados pedidos. Prueba más tarde.'), { status: 503 });
    const title = String(body.title ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || 'Vídeo de YouTube';
    const item = { id: crypto.randomBytes(6).toString('hex'), name, title, url, videoId, start, end, status: 'pending', message: '', entryId: null, client: body.client, ip, createdAt: now() };
    requests.push(item); lastSubmit.set(ip, now()); changed();
    return item;
  }
  const guestView = item => ({ id: item.id, title: item.title, start: item.start, end: item.end, status: item.status, message: item.status === 'failed' ? 'No se pudo descargar.' : '' });
  async function handle(request, response) {
    const ip = request.socket.remoteAddress ?? '';
    // Only addresses typed by guests (this computer's IP and port) are served; this blocks DNS rebinding from other sites.
    if (!info.hosts.includes(String(request.headers.host ?? '').toLowerCase())) { send(response, 421, { error: 'Dirección no válida.' }); return; }
    const url = new URL(request.url, 'http://local');
    try {
      if (request.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        send(response, 200, await fs.readFile(path.join(guestFolder, file)), type); return;
      }
      if (url.pathname === '/api/check' && request.method === 'POST') {
        const body = await readJSON(request); checkCode(ip, body.code);
        send(response, 200, { ok: true, maxPart: MAX_PART, minPart: MIN_PART }); return;
      }
      if (url.pathname === '/api/requests' && request.method === 'POST') {
        send(response, 201, guestView(submit(ip, await readJSON(request)))); return;
      }
      if (url.pathname === '/api/mine' && request.method === 'POST') {
        const body = await readJSON(request); checkCode(ip, body.code);
        if (!validClient(body.client)) throw Object.assign(new Error('Recarga la página.'), { status: 400 });
        send(response, 200, requests.filter(item => item.client === body.client).map(guestView)); return;
      }
      send(response, 404, { error: 'No encontrado.' });
    } catch (error) {
      send(response, error.status ?? 500, { error: error.status ? error.message : 'Error del servidor del DJ.' });
    }
  }
  async function open({ port = 8730, host = '0.0.0.0' } = {}) {
    if (server) return info;
    const addresses = lanAddresses();
    for (let candidate = port; candidate < port + 10; candidate++) {
      const attempt = http.createServer((request, response) => { handle(request, response); });
      attempt.requestTimeout = 10000; attempt.headersTimeout = 5000; attempt.maxRequestsPerSocket = 50;
      const listening = await new Promise(resolve => {
        attempt.once('error', () => resolve(false));
        attempt.listen(candidate, host, () => resolve(true));
      });
      if (!listening) continue;
      const actual = attempt.address().port;
      server = attempt;
      const hosts = [...addresses, 'localhost', '127.0.0.1'].map(address => `${address}:${actual}`);
      info = { code: newCode(), port: actual, addresses, hosts, url: addresses[0] ? `http://${addresses[0]}:${actual}/?c=` : null };
      if (info.url) info.url += info.code;
      return info;
    }
    throw new Error('No se pudo abrir el servidor de pedidos: los puertos 8730-8739 están ocupados.');
  }
  async function close() {
    if (!server) return;
    const closing = server; server = null; info = null; failures.clear();
    closing.closeAllConnections?.(); await new Promise(resolve => closing.close(() => resolve()));
  }
  function update(id, changes) {
    const item = requests.find(entry => entry.id === id);
    if (!item) throw new Error('Ese pedido ya no existe.');
    Object.assign(item, changes); changed(); return item;
  }
  // Removes finished requests (ready, rejected or failed) from the DJ's list.
  function clearFinished() { requests = requests.filter(item => !FINAL.has(item.status)); changed(); }
  return { open, close, list, update, clearFinished, get: id => requests.find(entry => entry.id === id), info: () => info };
}
module.exports = { createRequestService, lanAddresses, cleanPart, MAX_PART };

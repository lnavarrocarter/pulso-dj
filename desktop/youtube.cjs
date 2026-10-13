const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
function normalizeYouTubeURL(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Pega una URL válida de YouTube.');
  let url; try { url = new URL(input.trim()); } catch { throw new Error('Pega una URL válida de YouTube.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) throw new Error('URL de YouTube no permitida.');
  const host = url.hostname.toLowerCase();
  let id;
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = /^\/(?:shorts|embed|live)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  }
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id || '')) throw new Error('Se necesita el enlace de un vídeo individual de YouTube.');
  return `https://www.youtube.com/watch?v=${id}`;
}
function downloadArgs(url, folder, runtime) {
  return ['--ignore-config', '--no-plugin-dirs', '--no-cache-dir', '--no-playlist', '--no-warnings',
    '--socket-timeout', '20', '--retries', '2', '--fragment-retries', '2', '--max-filesize', '128M',
    '--match-filter', '!is_live & !is_upcoming & duration <= 1200',
    '--js-runtimes', `node:${runtime}`, '--format', 'bestaudio[ext=m4a]/bestaudio[ext=webm]',
    '--newline', '--progress', '--progress-template', 'download:PULSO_PROGRESS:%(progress._percent_str)s',
    '--print', 'before_dl:PULSO_TITLE:%(title)s', '--no-simulate', '--output', path.join(folder, 'track.%(ext)s'), '--', url];
}
function createImporter({ executable, runtime, tempRoot, spawnProcess = spawn, timeoutMs = 360000 }) {
  let active = null;
  function cancel() { if (active) { active.cancelled = true; active.child?.kill(); } }
  async function importAudio(input, progress = () => {}) {
    const url = normalizeYouTubeURL(input);
    if (active) throw new Error('Ya hay una importación en curso.');
    const job = { child: null, cancelled: false }; active = job;
    let folder;
    try {
      await fs.access(executable);
      folder = await fs.mkdtemp(path.join(tempRoot, 'pulso-youtube-'));
      progress({ stage: 'preparing', message: 'Buscando audio del vídeo…' });
      let title = 'Audio de YouTube';
      await new Promise((resolve, reject) => {
        const pending = { out: '', err: '' };
        let stderr = '', timedOut = false;
        const child = spawnProcess(executable, downloadArgs(url, folder, runtime), {
          shell: false, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'pipe']
        });
        job.child = child;
        if (job.cancelled) child.kill();
        const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
        const consume = (stream, bytes) => {
          pending[stream] += bytes.toString(); const lines = pending[stream].split(/\r?\n/); pending[stream] = lines.pop().slice(-4096);
          for (const line of lines) {
            if (line.startsWith('PULSO_TITLE:')) title = line.slice(12).trim().slice(0, 200) || title;
            if (line.startsWith('PULSO_PROGRESS:')) {
              const percent = parseFloat(line.slice(15));
              if (Number.isFinite(percent)) progress({ stage: 'downloading', percent: Math.min(100, Math.max(0, percent)), message: 'Descargando audio…' });
            }
          }
        };
        child.stdout.on('data', bytes => consume('out', bytes));
        child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-4096); consume('err', bytes); });
        child.once('error', () => { clearTimeout(timer); reject(new Error('No se pudo iniciar el importador. Vuelve a instalar Pulso DJ.')); });
        child.once('close', code => {
          clearTimeout(timer);
          if (job.cancelled) reject(new Error('Importación cancelada.'));
          else if (timedOut) reject(new Error('La importación superó 6 minutos. Prueba de nuevo más tarde.'));
          else if (code !== 0) {
            const restriction = /private|sign in|confirm|unavailable|restricted|403|drm/i.test(stderr);
            reject(new Error(restriction ? 'YouTube restringió este vídeo. Usa un archivo local o un vídeo público accesible.' : 'No se pudo importar el audio. Comprueba la conexión y prueba otro vídeo.'));
          } else resolve();
        });
      });
      if (job.cancelled) throw new Error('Importación cancelada.');
      const filename = (await fs.readdir(folder)).find(name => /^track\.(m4a|webm)$/.test(name));
      if (!filename) throw new Error('No se descargó audio: el vídeo puede ser directo, superar 20 minutos o no ofrecer un formato compatible.');
      const file = path.join(folder, filename);
      if ((await fs.stat(file)).size > 128 * 1024 * 1024) throw new Error('El audio supera 128 MB.');
      progress({ stage: 'decoding', message: 'Preparando la pista…' });
      const bytes = new Uint8Array(await fs.readFile(file));
      if (job.cancelled) throw new Error('Importación cancelada.');
      return { name: title, format: path.extname(filename).slice(1), bytes };
    } finally {
      active = null;
      if (folder) {
        const target = path.resolve(folder), relative = path.relative(path.resolve(tempRoot), target);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(target).startsWith('pulso-youtube-')) throw new Error('Ruta temporal no permitida.');
        await fs.rm(target, { recursive: true, force: true });
      }
    }
  }
  return { importAudio, cancel };
}
module.exports = { normalizeYouTubeURL, downloadArgs, createImporter };

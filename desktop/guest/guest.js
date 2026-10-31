// Guest page: name, YouTube link and favourite part (up to 3 minutes), sent to the DJ's computer on the same Wi-Fi.
(() => {
  const $ = id => document.getElementById(id);
  const store = {
    get(key) { try { return localStorage.getItem(`pulso.${key}`) || ''; } catch { return ''; } },
    set(key, value) { try { localStorage.setItem(`pulso.${key}`, value); } catch {} }
  };
  let maxPart = 180, minPart = 10;
  const params = new URLSearchParams(location.search);
  let code = (params.get('c') || store.get('code')).toUpperCase();
  let client = store.get('client');
  if (!/^[a-z0-9]{16,40}$/.test(client)) {
    client = Array.from(crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, '0')).join('');
    store.set('client', client);
  }
  let player = null, videoUrl = '', duration = 0, previewTimer = 0;
  const say = (text, kind = '') => { $('message').textContent = text; $('message').className = `message ${kind}`; };
  const format = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  // Accepts "1:05", "65" or "1.05" and returns seconds, or NaN.
  const parse = text => {
    const match = /^\s*(?:(\d{1,2})[:.,])?(\d{1,2})\s*$/.exec(text);
    if (!match) return NaN;
    return match[1] === undefined ? Number(match[2]) : Number(match[1]) * 60 + Number(match[2]);
  };
  const videoId = text => {
    try {
      const url = new URL(text.trim()), host = url.hostname.replace(/^(www|m|music)\./, '');
      const id = host === 'youtu.be' ? url.pathname.slice(1) : host === 'youtube.com'
        ? (url.pathname === '/watch' ? url.searchParams.get('v') : (/^\/(?:shorts|embed|live)\/([^/]+)/.exec(url.pathname) || [])[1]) : '';
      return /^[\w-]{11}$/.test(id || '') ? id : '';
    } catch { return ''; }
  };
  async function api(path, body) {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, client, ...body }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'No se pudo hablar con el DJ.'), { status: response.status });
    return data;
  }
  async function enter() {
    try {
      const limits = await api('/api/check', {});
      maxPart = limits.maxPart; minPart = limits.minPart; store.set('code', code);
      $('code-form').hidden = true; $('request-form').hidden = false;
      $('name').value = store.get('name');
      refreshMine(); setInterval(() => { if (!document.hidden) refreshMine(); }, 5000);
    } catch (error) {
      $('code-form').hidden = false; $('request-form').hidden = true;
      $('code').value = code;
      if (code) say(error.message, 'error');
    }
  }
  $('code-form').onsubmit = event => {
    event.preventDefault(); code = $('code').value.trim().toUpperCase(); say(''); enter();
  };
  // The YouTube player lets the guest listen and mark the part. Loaded only when a link is pasted.
  let playerApi = null;
  function loadPlayerApi() {
    playerApi ??= new Promise((resolve, reject) => {
      window.onYouTubeIframeAPIReady = () => resolve(window.YT);
      const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => reject(new Error('No se pudo cargar YouTube. Comprueba que el móvil tiene internet.'));
      document.head.append(script);
    });
    return playerApi;
  }
  function showPart() {
    const start = parse($('start').value), end = parse($('end').value), total = duration || Math.max(end || 0, 1);
    const bar = $('part-bar');
    bar.style.setProperty('--from', `${Math.min(100, (start || 0) / total * 100)}%`);
    bar.style.setProperty('--to', `${Math.min(100, (end || 0) / total * 100)}%`);
  }
  $('find').onclick = async () => {
    const id = videoId($('link').value);
    if (!id) { say('Pega el enlace de un vídeo de YouTube (no de una lista).', 'error'); return; }
    say('Cargando el vídeo…'); $('video').hidden = false; videoUrl = `https://www.youtube.com/watch?v=${id}`; duration = 0;
    try {
      const YT = await loadPlayerApi();
      // The duration arrives with the video metadata, shortly after the video is cued.
      const ready = async () => {
        for (let i = 0; i < 25 && !player.getDuration(); i++) await new Promise(resolve => setTimeout(resolve, 200));
        duration = Math.floor(player.getDuration() || 0);
        $('video-title').textContent = player.getVideoData?.().title || '';
        if (!$('end').value) { $('start').value = '0:00'; $('end').value = format(Math.min(maxPart, duration || maxPart)); }
        showPart(); say(duration > 1200 ? 'Este vídeo dura más de 20 minutos y el DJ no podrá descargarlo.' : '', duration > 1200 ? 'error' : '');
      };
      if (player) { $('start').value = ''; $('end').value = ''; player.cueVideoById(id); ready(); }
      else player = new YT.Player('player', { videoId: id, playerVars: { playsinline: 1, rel: 0, origin: location.origin },
        events: { onReady: ready, onError: () => say('Este vídeo no se puede ver aquí, pero puedes pedirlo igual escribiendo el inicio y el final de tu parte.') } });
    } catch (error) { say(error.message, 'error'); }
  };
  const mark = field => () => {
    if (!player?.getCurrentTime) { say('Reproduce el vídeo primero.', 'error'); return; }
    $(field).value = format(player.getCurrentTime()); showPart();
  };
  $('mark-start').onclick = mark('start'); $('mark-end').onclick = mark('end');
  $('start').oninput = $('end').oninput = showPart;
  $('preview').onclick = () => {
    const start = parse($('start').value), end = parse($('end').value);
    if (!player?.seekTo || !(end > start)) { say('Marca el inicio y el final primero.', 'error'); return; }
    player.seekTo(start, true); player.playVideo(); clearInterval(previewTimer);
    previewTimer = setInterval(() => { if (player.getCurrentTime() >= end) { player.pauseVideo(); clearInterval(previewTimer); } }, 250);
  };
  $('request-form').onsubmit = async event => {
    event.preventDefault();
    const start = parse($('start').value), end = parse($('end').value), name = $('name').value.trim();
    if (!videoUrl) { say('Pega el enlace y pulsa «Ver».', 'error'); return; }
    if (!(end > start)) { say('El final tiene que ir después del inicio (m:ss).', 'error'); return; }
    if (end - start > maxPart) { say(`Tu parte dura ${format(end - start)}: el máximo son ${format(maxPart)}.`, 'error'); return; }
    if (end - start < minPart) { say(`Tu parte tiene que durar al menos ${minPart} segundos.`, 'error'); return; }
    if (duration && end > duration + 1) { say(`El vídeo dura ${format(duration)}.`, 'error'); return; }
    store.set('name', name); $('send').disabled = true;
    try {
      await api('/api/requests', { name, url: videoUrl, start, end, title: $('video-title').textContent });
      say('¡Enviada! El DJ la verá en su lista.', 'ok');
      player?.pauseVideo?.(); $('link').value = ''; $('start').value = ''; $('end').value = ''; videoUrl = ''; $('video').hidden = true;
      refreshMine();
    } catch (error) { say(error.message, 'error'); } finally { $('send').disabled = false; }
  };
  const STATUS = { pending: 'En espera del DJ', approved: 'Aceptada, descargando…', downloading: 'Aceptada, descargando…', ready: 'Aceptada: está en la lista del DJ', rejected: 'El DJ no la ha aceptado', failed: 'No se pudo descargar' };
  async function refreshMine() {
    try {
      const mine = await api('/api/mine', {});
      $('mine').hidden = mine.length === 0;
      $('mine-list').replaceChildren(...mine.slice().reverse().map(item => {
        const li = document.createElement('li'), title = document.createElement('strong'), state = document.createElement('span');
        li.className = item.status; title.textContent = `${item.title} · ${format(item.start)}–${format(item.end)}`;
        state.textContent = STATUS[item.status] || item.status; li.append(title, state); return li;
      }));
    } catch (error) { if (error.status === 403) { $('request-form').hidden = true; $('code-form').hidden = false; say(error.message, 'error'); } }
  }
  if (code) enter(); else { $('code-form').hidden = false; }
})();

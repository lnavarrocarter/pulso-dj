import { Mixer } from './audio.mjs';
import { mountAssistant } from './assistant.mjs';
import { midiEvent, mappingKey, formatTime, clamp, fromKnob } from './core.mjs';
import { profileFor, nextLoopSize, JOG_SECONDS_PER_TICK } from './controllers.mjs';
import { knob, platter, setMeter } from './console-ui.mjs';
import { mountLibrary } from './library-ui.mjs';
const $ = selector => document.querySelector(selector);
const mixer = new Mixer();
const status = message => { $('#status').textContent = message; };
const safe = action => Promise.resolve().then(action).catch(error => status(error.message));
// Browser fallback; the desktop app adds files through the library instead.
async function chooseAudio() {
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
const deckActions = [];
let library = null;
let mappings = {};
try { mappings = JSON.parse(localStorage.getItem('pulso.midi.v1') || '{}') || {}; } catch { mappings = {}; }
if (typeof mappings !== 'object' || Array.isArray(mappings)) mappings = {};
let access, learning = false;
let profile = null, output = null;
const leds = new Map();
const jogs = mixer.decks.map(() => ({ resume: false, timer: 0 }));
function addTarget(id, label, kind, run) { targets.set(id, { label, kind, run }); }
function bindRange(element, callback) { element.addEventListener('input', () => callback(Number(element.value))); }
function setRange(element, value) { element.value = value; element.dispatchEvent(new Event('input')); }
// Writes to the page only when a value changes, so the 60 fps loop costs little while nothing moves.
function setText(element, text) { if (element.textContent !== text) element.textContent = text; }
function setAttr(element, name, value) { if (element.getAttribute(name) !== value) element.setAttribute(name, value); }
function waveform(view, deck) {
  // Redraw only when another track is loaded, the playhead moves a pixel or the loop changes.
  const key = deck.buffer ? `${Math.round(deck.position / deck.duration * 800)}:${deck.loop?.start}:${deck.loop?.end}` : '';
  if (view.drawnBuffer === deck.buffer && view.drawnKey === key) return;
  view.drawnBuffer = deck.buffer; view.drawnKey = key;
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
  ctx.fillStyle = view.ledColor ||= getComputedStyle(view).getPropertyValue('--led').trim();
  for (let i = 0; i < peaks.length; i++) {
    const peak = peaks[i];
    ctx.fillRect(i * 2, 55 - peak * 49, 1.5, Math.max(1, peak * 98));
  }
  ctx.fillStyle = '#ffffff'; ctx.fillRect(deck.position / deck.duration * 800, 0, 2, 110);
}
mixer.decks.forEach((deck, index) => {
  const view = $('#deck-template').content.firstElementChild.cloneNode(true);
  const strip = $('#strip-template').content.firstElementChild.cloneNode(true);
  // Mixer controls live in the centre strip, like the hardware; both parts share one deck colour.
  const letter = 'ABCD'[index], number = index + 1;
  for (const part of [view, strip]) { part.dataset.index = String(index); part.classList.add(`deck-${number}`); }
  views.push(view); $(index % 2 ? '#decks-right' : '#decks-left').append(view); $('#strips').append(strip);
  let trackId = null;
  const find = selector => view.querySelector(selector) ?? strip.querySelector(selector);
  const findAll = selector => [...view.querySelectorAll(selector), ...strip.querySelectorAll(selector)];
  find('.deck-num').textContent = number; find('.platter-label').textContent = number; find('.strip-num').textContent = number;
  find('.platter').setAttribute('aria-label', `Plato del deck ${number}`);
  const toggle = () => safe(async () => { if (deck.playing) deck.pause(); else await deck.play(); });
  find('.play').onclick = toggle;
  const recallCue = () => safe(async () => { deck.pause(); await deck.seek(deck.cue); });
  find('.cue').onclick = recallCue;
  const setCue = () => { deck.cue = deck.position; status(`Cue del deck ${number} marcado en ${formatTime(deck.cue)}.`); };
  find('.set-cue').onclick = setCue;
  // Decodes a track into this deck and returns its duration so the library can remember it.
  const loadTrack = async (file, id = null) => {
    status(`Cargando ${file.name}…`);
    const bytes = new Uint8Array(file.bytes); await deck.load(bytes.buffer);
    trackId = id; find('.track').textContent = file.name;
    find('.track-info').textContent = `${formatTime(deck.duration)} · ${deck.buffer.sampleRate / 1000} kHz · ${deck.buffer.numberOfChannels === 1 ? "mono" : "estéreo"}`;
    for (const element of view.querySelectorAll('.play,.cue,.set-cue,.sync,[data-hotcue],[data-loop],[data-pad-loop],.loop-off')) element.disabled = false;
    status(`Pista lista en el deck ${number}.`);
    return deck.duration;
  };
  find('.load').onclick = () => safe(async () => {
    if (deck.playing) { status(`El deck ${number} está sonando. Páusalo antes de cargar otra pista.`); return; }
    find('.load').disabled = true;
    try {
      if (window.desktop?.library) { const [entry] = await library.addFiles(false); if (entry) await library.loadInto(index, entry.id); return; }
      const file = await chooseAudio();
      if (file) await loadTrack(file);
    } finally { find('.load').disabled = false; }
  });
  find('.waveform').onclick = event => {
    if (!deck.buffer) return;
    const box = event.currentTarget.getBoundingClientRect();
    safe(() => deck.seek((event.clientX - box.left) / box.width * deck.duration));
  };
  bindRange(find('.volume'), value => deck.setVolume(value));
  bindRange(find('.pitch'), value => { deck.setRate(1 + value / 100); find('.pitch-value').textContent = `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`; });
  for (const element of findAll('[data-eq]')) bindRange(element, value => deck.setEQ(Number(element.dataset.eq), value));
  addTarget(`${letter}.play`, `Deck ${number} · Play / pausa`, 'button', toggle);
  addTarget(`${letter}.cue`, `Deck ${number} · Cue`, 'button', recallCue);
  addTarget(`${letter}.volume`, `Deck ${number} · Volumen`, 'range', value => setRange(find('.volume'), value));
  addTarget(`${letter}.pitch`, `Deck ${number} · Velocidad`, 'range', value => setRange(find('.pitch'), value * 32 - 16));
  ['Graves', 'Medios', 'Agudos'].forEach((label, i) => addTarget(`${letter}.eq${i}`, `Deck ${number} · ${label}`, 'range', value => setRange(find(`[data-eq="${i}"]`), fromKnob(value, -24, 0, 12))));
  const startLoop = beats => {
    if (!deck.enableLoop(beats)) status(`La pista no tiene duración suficiente para ${beats} beats.`);
  };
  for (const button of view.querySelectorAll('[data-loop]')) {
    const beats = Number(button.dataset.loop);
    button.onclick = () => startLoop(beats);
    addTarget(`${letter}.loop${beats}`, `Deck ${number} · Loop ${beats} beats`, 'button', () => startLoop(beats));
  }
  find('.loop-off').onclick = () => deck.disableLoop();
  addTarget(`${letter}.loopOff`, `Deck ${number} · Salir del loop`, 'button', () => deck.disableLoop());
  for (const button of view.querySelectorAll('[data-hotcue]')) {
    const i = Number(button.dataset.hotcue);
    button.onclick = event => safe(() => deck.triggerHotCue(i, event.shiftKey));
    addTarget(`${letter}.hotcue${i}`, `Deck ${number} · Hot cue ${i + 1}`, 'button', () => safe(() => deck.triggerHotCue(i)));
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
    else status(`Deck ${number}: pulsa Tap varias veces siguiendo el ritmo.`);
  };
  for (const input of findAll('[data-fx]')) {
    bindRange(input, value => deck.setFX(input.dataset.fx, value));
    addTarget(`${letter}.fx.${input.dataset.fx}`, `Deck ${number} · FX ${input.dataset.fx}`, 'range', value => setRange(input, value));
  }
  const resetFX = () => { for (const input of findAll('[data-fx]')) setRange(input, 0); };
  find('.fx-reset').onclick = resetFX;
  addTarget(`${letter}.fxReset`, `Deck ${number} · Restablecer FX`, 'button', resetFX);
  for (const button of view.querySelectorAll('[data-pad-loop]')) {
    const beats = Number(button.dataset.padLoop);
    button.onclick = () => { if (deck.loop && deck.loopBeats === beats) deck.disableLoop(); else startLoop(beats); };
  }
  find('.sync').onclick = () => syncTempo(index);
  for (const button of strip.querySelectorAll('[data-assign]')) button.onclick = () => mixer.setAssign(index, button.dataset.assign);
  for (const input of findAll('.knob-slot input')) knob(input);
  platter(find('.platter'), {
    touch: on => runAction({ deck: index, action: 'touch', on }),
    turn: ticks => jog(index, ticks)
  });
  deckActions.push({ letter, number, view, strip, find, toggle, recallCue, setCue, startLoop, loadTrack, trackId: () => trackId, fxDepth: 0.5 });
});
knob($('#master'));
library = mountLibrary({
  load: (deck, file, id) => deckActions[deck].loadTrack(file, id),
  deckCount: () => document.body.classList.contains('decks-2') ? 2 : 4,
  deckState: () => mixer.decks.map((deck, i) => ({ playing: deck.playing, trackId: deckActions[i].trackId() })),
  status
});
deckActions.forEach((controls, index) => library.dropTarget(controls.view, index));
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
  // Learned assignments override the built-in profile.
  const target = targets.get(mappings[key]);
  if (!target) { if (profile) for (const action of profile.receive(message.data)) runAction(action); return; }
  if (target.kind === 'button') { if (event.pressed) target.run(); }
  else if (event.type === 'cc') target.run(event.value / 127);
}
function syncTempo(index) {
  const deck = mixer.decks[index], controls = deckActions[index];
  // Reference: a playing deck on the other crossfader side, else any other playing or loaded deck.
  const rank = ({ item, i }) => (item.playing ? 2 : 0) + (item.buffer ? 1 : 0) + (mixer.assign[i] !== mixer.assign[index] ? 0.5 : 0);
  const reference = mixer.decks.map((item, i) => ({ item, i })).filter(({ i }) => i !== index).sort((a, b) => rank(b) - rank(a))[0];
  if (!reference.item.buffer) { status(`Deck ${controls.number}: carga otra pista para sincronizar.`); return; }
  const percent = (reference.item.bpm * reference.item.rate / deck.bpm - 1) * 100;
  if (Math.abs(percent) > 16) { status(`Deck ${controls.number}: el tempo del deck ${reference.i + 1} queda fuera del rango ±16 %.`); return; }
  status(`Deck ${controls.number} sincronizado con el deck ${reference.i + 1}.`);
  setRange(controls.find('.pitch'), percent);
}
function jog(index, delta) {
  const deck = mixer.decks[index], state = jogs[index], wheel = deckActions[index].find('.platter');
  // Show on screen that the wheel is being turned, whether by mouse or by the hardware jog.
  wheel.classList.add('turning'); clearTimeout(state.turning); state.turning = setTimeout(() => wheel.classList.remove('turning'), 150);
  if (!deck.playing) { deck.scrub(delta * JOG_SECONDS_PER_TICK); return; }
  deck.bend(clamp(delta * 0.03, -0.3, 0.3)); clearTimeout(state.timer);
  state.timer = setTimeout(() => deck.bend(0), 80);
}
// Hardware FX: buttons switch echo/reverb/drive on, the FX knob sets the depth of those that are on.
// An effect counts as on when its knob on screen is above zero, so screen and hardware LEDs agree.
const fxOn = index => ['echo', 'reverb', 'drive'].filter(name => Number(deckActions[index].find(`[data-fx="${name}"]`).value) > 0);
function runAction({ deck: index, action, ...detail }) {
  const deck = mixer.decks[index], controls = deckActions[index], run = id => targets.get(`${controls.letter}.${id}`).run;
  switch (action) {
    case 'play': controls.toggle(); break;
    case 'cue': controls.recallCue(); break;
    case 'setCue': controls.setCue(); break;
    case 'sync': syncTempo(index); break;
    case 'autoLoop': if (deck.loop) deck.disableLoop(); else controls.startLoop(deck.loopBeats); break;
    case 'loopOff': deck.disableLoop(); break;
    case 'loopHalve': case 'loopDouble': {
      const beats = nextLoopSize(deck.loopBeats, action === 'loopHalve' ? -1 : 1);
      if (deck.loop) controls.startLoop(beats); else deck.loopBeats = beats;
      status(`Deck ${controls.number}: loop de ${beats} beats.`); break;
    }
    case 'loop': if (deck.loop && deck.loopBeats === detail.beats) deck.disableLoop(); else controls.startLoop(detail.beats); break;
    case 'hotcue': run(`hotcue${detail.index}`)(); break;
    case 'clearHotcue': safe(() => deck.triggerHotCue(detail.index, true)); break;
    case 'range': run(detail.target)(detail.value); break;
    case 'filter': run('fx.filter')(detail.value); break;
    case 'toggleFX': {
      const on = !fxOn(index).includes(detail.fx);
      run(`fx.${detail.fx}`)(on ? Math.max(controls.fxDepth, 0.05) : 0);
      status(`Deck ${controls.number}: ${detail.fx} ${on ? 'activado' : 'desactivado'}.`); break;
    }
    case 'fxDepth': controls.fxDepth = detail.value; for (const name of fxOn(index)) run(`fx.${name}`)(Math.max(detail.value, 0.01)); break;
    case 'fxReset': run('fxReset')(); break;
    case 'load': if (library.hasSelection()) library.loadInto(index); else controls.find('.load').click(); break;
    case 'browse': library.moveSelection(detail.delta); break;
    case 'touch':
      controls.find('.platter').classList.toggle('held', detail.on);
      if (detail.on && deck.playing) { jogs[index].resume = true; deck.pause(); }
      else if (!detail.on && jogs[index].resume) { jogs[index].resume = false; safe(() => deck.play()); }
      break;
    case 'jog': jog(index, detail.delta); break;
    case 'search': if (deck.playing) safe(() => deck.seek(deck.position + detail.delta * 0.25)); else deck.scrub(detail.delta * 0.25); break;
    case 'crossfade': targets.get('crossfade').run(detail.value); break;
  }
}
function sendLed(message) { try { output?.send(message); } catch { output = null; } }
function updateLeds() {
  if (!profile || !output) return;
  const state = mixer.decks.map((deck, i) => ({ loaded: Boolean(deck.buffer), playing: deck.playing, loop: deck.loop ? deck.loopBeats : null,
    hotCues: deck.hotCues.map(cue => cue !== null), fxOn: fxOn(i),
    level: Number(deckActions[i].strip.querySelector('.vu').style.getPropertyValue('--level')) || 0 }));
  for (const message of profile.leds(state)) {
    const key = `${message[0]}:${message[1]}`;
    if (leds.get(key) !== message[2]) { leds.set(key, message[2]); sendLed(message); }
  }
}
function ledsOff() {
  for (const [key, value] of leds) if (value) sendLed([...key.split(':').map(Number), 0]);
  leds.clear();
}
function selectDevice() {
  if (!access) return;
  cancelLearning(); ledsOff();
  const selected = access.inputs.get($('#device').value);
  profile = selected ? profileFor(selected.name) : null;
  output = profile ? [...access.outputs.values()].find(port => port.name === selected.name && port.state === 'connected') ?? null : null;
  for (const device of access.inputs.values()) device.onmidimessage = device === selected ? message => receive(message, device) : null;
  if (profile) $('#midi-status').textContent = `${profile.name} · perfil integrado${output ? ' y LEDs' : ''}`;
  // Ask the controller for the position of every knob and fader so the screen matches the hardware.
  if (profile?.stateRequest && output && access.sysexEnabled) {
    profile.beginSync(); sendLed(profile.stateRequest);
    const synced = profile;
    setTimeout(() => { synced.endSync(); if (profile === synced) status(`${synced.name}: la pantalla muestra la posición actual de faders y potenciómetros.`); }, 1200);
  }
}
function refreshDevices() {
  const previous = $('#device').value;
  $('#device').replaceChildren(new Option('Sin controladora', ''));
  for (const device of access.inputs.values()) if (device.state === 'connected') $('#device').add(new Option(device.name || 'MIDI', device.id));
  const options = [...$('#device').options];
  if (previous && options.some(option => option.value === previous)) $('#device').value = previous;
  else $('#device').value = options.find(option => option.value && profileFor(option.text))?.value ?? '';
  $('#midi-status').textContent = options.length > 1 ? 'Elige tu controladora' : 'No hay controladoras MIDI conectadas';
  selectDevice();
}
$('#connect').onclick = () => safe(async () => {
  if (!navigator.requestMIDIAccess) throw new Error('MIDI no está disponible en este entorno.');
  // SysEx is only used to send a profile's state request; fall back to plain MIDI if it is refused.
  access ??= await navigator.requestMIDIAccess({ sysex: true }).catch(() => navigator.requestMIDIAccess({ sysex: false }));
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
  if (event.repeat || ['INPUT', 'SELECT', 'BUTTON'].includes(event.target.tagName) || event.target.closest?.('#library-list')) return;
  const action = { Space: 'A.play', Enter: 'B.play', KeyC: 'A.cue', KeyN: 'B.cue' }[event.code];
  if (action) { event.preventDefault(); targets.get(action).run(); }
});
const samples = new Float32Array(mixer.analyser.fftSize);
const frequency = new Uint8Array(mixer.analyser.frequencyBinCount);
function meters() {
  mixer.decks.forEach((deck, i) => setMeter(deckActions[i].strip.querySelector('.vu'), deck.level));
}
// Every frame (60 fps): time, waveform, platters, pads, meters and controller LEDs follow the audio.
function animate() {
  mixer.decks.forEach((deck, i) => {
    const { view, strip } = deckActions[i];
    setText(view.querySelector('.elapsed'), formatTime(deck.position));
    setText(view.querySelector('.remaining'), `−${formatTime(deck.duration - deck.position)}`);
    waveform(view, deck);
    view.classList.toggle('is-playing', deck.playing); view.classList.toggle('is-loaded', Boolean(deck.buffer));
    setText(view.querySelector('.loop-status'), deck.loop ? `Loop de ${deck.loopBeats} beats activo` : '');
    for (const button of view.querySelectorAll('[data-loop]')) button.classList.toggle('active', Boolean(deck.loop) && Number(button.dataset.loop) === deck.loopBeats);
    for (const button of view.querySelectorAll('[data-pad-loop]')) button.classList.toggle('active', Boolean(deck.loop) && Number(button.dataset.padLoop) === deck.loopBeats);
    for (const button of view.querySelectorAll('[data-hotcue]')) {
      const cue = deck.hotCues[Number(button.dataset.hotcue)];
      button.classList.toggle('saved', cue !== null); setText(button.querySelector('small'), cue === null ? 'Hot cue' : formatTime(cue));
    }
    for (const button of strip.querySelectorAll('[data-assign]')) setAttr(button, 'aria-pressed', String(mixer.assign[i] === button.dataset.assign));
    // Platters turn at 33⅓ rpm with the track position.
    const disc = view.querySelector('.platter-disc'), spin = `${(deck.position / 1.8 * 360) % 360}deg`;
    if (disc.style.getPropertyValue('--spin') !== spin) disc.style.setProperty('--spin', spin);
    setAttr(view.querySelector('.platter'), 'aria-valuenow', String(deck.duration ? Math.round(deck.position / deck.duration * 100) : 0));
  });
  meters();
  mixer.analyser.getFloatTimeDomainData(samples);
  let peak = 0; for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  setMeter($('#meter'), peak); setText($('#level'), peak > 0.0001 ? `${(20 * Math.log10(peak)).toFixed(1)} dBFS` : '−∞ dBFS');
  const canvas = $('#spectrum'), ctx = canvas.getContext('2d');
  mixer.analyser.getByteFrequencyData(frequency); ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#c9ced6';
  for (let i = 0; i < 40; i++) { const height = frequency[i * 3] / 255 * 40; ctx.fillRect(i * 6, 40 - height, 4, Math.max(1, height)); }
  updateLeds(); // sends only the LEDs whose value changed
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
// Animation frames stop while the window is minimised; the controller's LEDs and meters keep following the audio.
setInterval(() => {
  setText($('#audio-status'), `${mixer.context.state === 'running' ? 'Audio activo' : 'Audio en espera'} · ${mixer.context.sampleRate / 1000} kHz`);
  if (document.hidden) { meters(); updateLeds(); }
}, 250);
window.addEventListener('beforeunload', ledsOff);
function showDecks(count) {
  document.body.classList.toggle('decks-4', count === 4); document.body.classList.toggle('decks-2', count === 2);
  for (const button of document.querySelectorAll('[data-decks]')) button.setAttribute('aria-pressed', String(Number(button.dataset.decks) === count));
  try { localStorage.setItem('pulso.decks', String(count)); } catch {}
  library?.render();
}
for (const button of document.querySelectorAll('[data-decks]')) button.onclick = () => showDecks(Number(button.dataset.decks));
try { showDecks(localStorage.getItem('pulso.decks') === '2' ? 2 : 4); } catch { showDecks(4); }
mountAssistant(mixer, status);

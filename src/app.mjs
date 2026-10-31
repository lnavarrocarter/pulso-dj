import { Mixer, HOT_CUES } from './audio.mjs';
import { mountAssistant } from './assistant.mjs';
import { midiEvent, mappingKey, formatTime, clamp, fromKnob, toKnob } from './core.mjs';
import { profileFor, nextLoopSize, JOG_SECONDS_PER_TICK } from './controllers.mjs';
import { knob, platter, setMeter } from './console-ui.mjs';
import { mountLibrary } from './library-ui.mjs';
import { createPads } from './pads.mjs';
import { mountRequests } from './requests-ui.mjs';
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
const jogs = mixer.decks.map(() => ({ timer: 0, turning: 0 }));
// Beats of the running auto loop; null when there is no loop or it was set by hand with LOOP IN / OUT.
const loopBeats = deck => deck.loop && !deck.loop.manual ? deck.loopBeats : null;
const visibleDecks = () => document.body.classList.contains('decks-2') ? 2 : 4;
function addTarget(id, label, kind, run) { targets.set(id, { label, kind, run }); }
// Range targets take a 0-1 control position; knobs with a centre detent (EQ, trim, filter) keep 0 dB / open at 0.5.
function toPosition(input) {
  const min = Number(input.min), max = Number(input.max), value = Number(input.value);
  return input.dataset.center === undefined ? (value - min) / (max - min) : toKnob(value, min, Number(input.dataset.center), max);
}
function rangeTarget(id, label, input) {
  // min and max are read on each call: the tempo fader range changes with SHIFT + KEYLOCK.
  addTarget(id, label, 'range', value => {
    const min = Number(input.min), max = Number(input.max), center = input.dataset.center;
    setRange(input, center === undefined ? min + value * (max - min) : fromKnob(value, min, Number(center), max));
  });
  targets.get(id).input = input;
}
const TEMPO_RANGES = [0.06, 0.1, 0.16, 0.5];
// Soft takeover: once the screen has moved a control (mouse, SYNC, Auto DJ), the hardware only takes it back
// when it reaches the screen value, so the sound never jumps. Faders on the SB3 have no motors.
const hardware = new Map();
function takeover(id, position) {
  const input = targets.get(id)?.input, last = hardware.get(id);
  hardware.set(id, position);
  if (!input || last === undefined) return true;
  const current = toPosition(input), near = value => Math.abs(value - current) < 0.02;
  return near(last) || near(position) || (last - current) * (position - current) < 0;
}
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
  if (deck.loop) { ctx.fillStyle = '#ffffff18'; ctx.fillRect(deck.loop.start / deck.duration * 800, 0, (deck.loop.end - deck.loop.start) / deck.duration * 800, 110); }
  const peaks = deck.peaks;
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
  // entry: the library entry, when the track comes from it; a guest request starts at the guest's favourite part,
  // with hot cues 1 and 2 on its start and end.
  const loadTrack = async (file, id = null, entry = null) => {
    status(`Cargando ${file.name}…`);
    const bytes = new Uint8Array(file.bytes); await deck.load(bytes.buffer);
    trackId = id; find('.track').textContent = file.name;
    find('.track-info').textContent = `${formatTime(deck.duration)} · ${deck.buffer.sampleRate / 1000} kHz · ${deck.buffer.numberOfChannels === 1 ? "mono" : "estéreo"}`;
    for (const element of view.querySelectorAll('.play,.cue,.set-cue,.sync,[data-loop],.loop-off')) element.disabled = false;
    const part = entry?.request;
    if (part && part.start < deck.duration) {
      const end = Math.min(part.end, deck.duration);
      deck.cue = part.start; deck.hotCues[0] = part.start; deck.hotCues[1] = end; await deck.seek(part.start);
      status(`Pista lista en el deck ${number}, en la parte que eligió ${part.by} (${formatTime(part.start)}–${formatTime(end)}).`);
    } else status(`Pista lista en el deck ${number}.`);
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
  // SHIFT + KEYLOCK: ±6, ±10, ±16 or ±50 %. The current tempo is kept when it fits the new range.
  const cycleTempoRange = () => {
    const range = TEMPO_RANGES[(TEMPO_RANGES.indexOf(deck.range) + 1) % TEMPO_RANGES.length], pitch = find('.pitch');
    const percent = (deck.rate - 1) * 100;
    deck.setRange(range); pitch.min = String(-range * 100); pitch.max = String(range * 100); pitch.step = range > 0.2 ? '0.5' : '0.1';
    setRange(pitch, clamp(percent, -range * 100, range * 100));
    find('.pitch-range').textContent = `±${range * 100} %`; status(`Deck ${number}: rango de tempo ±${range * 100} %.`);
  };
  const setHeadphones = on => {
    if (on && !mixer.cueAvailable) { status('Para escuchar por cascos elige como salida de audio una tarjeta de 4 canales, como la DDJ-SB3.'); return; }
    deck.setHeadphones(on); find('.headphones').setAttribute('aria-pressed', String(on));
  };
  find('.headphones').onclick = () => setHeadphones(!deck.headphones);
  let slip = false;
  for (const element of findAll('[data-eq]')) bindRange(element, value => deck.setEQ(Number(element.dataset.eq), value));
  bindRange(find('.trim'), value => deck.setTrim(value));
  const setKeylock = on => { deck.setKeylock(on); find('.keylock').setAttribute('aria-pressed', String(on)); };
  find('.keylock').onclick = () => setKeylock(!deck.keylock);
  // VINYL on: touching the platter scratches. Off: the whole platter nudges like the outer ring.
  const vinyl = () => find('.vinyl').getAttribute('aria-pressed') === 'true';
  const setVinyl = on => find('.vinyl').setAttribute('aria-pressed', String(on));
  find('.vinyl').onclick = () => setVinyl(!vinyl());
  addTarget(`${letter}.play`, `Deck ${number} · Play / pausa`, 'button', toggle);
  addTarget(`${letter}.cue`, `Deck ${number} · Cue`, 'button', recallCue);
  addTarget(`${letter}.keylock`, `Deck ${number} · Key lock`, 'button', () => setKeylock(!deck.keylock));
  rangeTarget(`${letter}.volume`, `Deck ${number} · Volumen`, find('.volume'));
  rangeTarget(`${letter}.pitch`, `Deck ${number} · Velocidad`, find('.pitch'));
  rangeTarget(`${letter}.trim`, `Deck ${number} · Trim`, find('.trim'));
  ['Graves', 'Medios', 'Agudos'].forEach((label, i) => rangeTarget(`${letter}.eq${i}`, `Deck ${number} · ${label}`, find(`[data-eq="${i}"]`)));
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
  for (let i = 0; i < HOT_CUES; i++) addTarget(`${letter}.hotcue${i}`, `Deck ${number} · Hot cue ${i + 1}`, 'button', () => safe(() => deck.triggerHotCue(i)));
  const pads = createPads({ deck, sampler: mixer.sampler, number, status, loadSample: slot => loadSample(slot) });
  find('.pad-mode').onchange = event => pads.setMode(event.target.value);
  // Pads on screen act while pressed, like the hardware; Shift + click is SHIFT + pad.
  for (const button of view.querySelectorAll('[data-pad]')) {
    const pad = Number(button.dataset.pad);
    button.onpointerdown = event => { button.setPointerCapture(event.pointerId); pads.press(pad, event.shiftKey); };
    button.onpointerup = button.onpointercancel = event => pads.release(pad, event.shiftKey);
    button.onkeydown = event => { if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); pads.press(pad, event.shiftKey); } };
    button.onkeyup = event => { if (event.key === 'Enter' || event.key === ' ') pads.release(pad, event.shiftKey); };
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
    rangeTarget(`${letter}.fx.${input.dataset.fx}`, `Deck ${number} · FX ${input.dataset.fx}`, input);
  }
  const resetFX = () => { for (const input of findAll('[data-fx]')) setRange(input, 0); };
  find('.fx-reset').onclick = resetFX;
  addTarget(`${letter}.fxReset`, `Deck ${number} · Restablecer FX`, 'button', resetFX);
  find('.sync').onclick = () => syncTempo(index);
  for (const button of strip.querySelectorAll('[data-assign]')) button.onclick = () => mixer.setAssign(index, button.dataset.assign);
  for (const input of findAll('.knob-slot input')) knob(input);
  platter(find('.platter'), {
    touch: on => runAction({ deck: index, action: 'touch', on }),
    turn: ticks => jog(index, ticks)
  });
  deckActions.push({ letter, number, view, strip, find, toggle, recallCue, setCue, startLoop, loadTrack, setKeylock, vinyl, setVinyl, pads, cycleTempoRange, setHeadphones,
    slip: () => slip, setSlip: on => { slip = on; status(`Deck ${number}: slip ${on ? 'activado' : 'desactivado'}.`); }, trackId: () => trackId, fxDepth: 0.5 });
});
knob($('#master'));
// Sampler pads 5-8 load the track selected in the library into slots 1-4.
async function loadSample(slot) {
  const selected = await library.readSelection();
  if (!selected) { status('Elige primero una pista en la biblioteca para cargarla en el sampler.'); return; }
  await mixer.sampler.load(slot, new Uint8Array(selected.bytes).buffer, selected.name);
  status(`Sampler ${slot + 1}: ${selected.name}.`);
}
const setMasterCue = on => {
  if (on && !mixer.cueAvailable) { status('Para escuchar por cascos elige como salida de audio una tarjeta de 4 canales, como la DDJ-SB3.'); return; }
  mixer.setMasterCue(on); $('#master-cue').setAttribute('aria-pressed', String(on));
};
const masterCue = () => $('#master-cue').getAttribute('aria-pressed') === 'true';
$('#master-cue').onclick = () => setMasterCue(!masterCue());
library = mountLibrary({
  load: (deck, file, id, entry) => deckActions[deck].loadTrack(file, id, entry),
  deckCount: visibleDecks,
  deckState: () => mixer.decks.map((deck, i) => ({ playing: deck.playing, trackId: deckActions[i].trackId() })),
  status
});
deckActions.forEach((controls, index) => library.dropTarget(controls.view, index));
bindRange($('#crossfade'), value => mixer.setCrossfade(value));
bindRange($('#master'), value => mixer.setMaster(value));
rangeTarget('crossfade', 'Mezclador · Crossfader', $('#crossfade'));
rangeTarget('master', 'Mezclador · Master', $('#master'));
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
  if (Math.abs(percent) > deck.range * 100) { status(`Deck ${controls.number}: el tempo del deck ${reference.i + 1} queda fuera del rango ±${deck.range * 100} %.`); return; }
  status(`Deck ${controls.number} sincronizado con el deck ${reference.i + 1}.`);
  setRange(controls.find('.pitch'), percent);
}
function jog(index, delta) {
  const deck = mixer.decks[index], state = jogs[index], wheel = deckActions[index].find('.platter');
  // Show on screen that the wheel is being turned, whether by mouse or by the hardware jog.
  wheel.classList.add('turning'); clearTimeout(state.turning); state.turning = setTimeout(() => wheel.classList.remove('turning'), 150);
  if (deck.scratching) { deck.scratchMove(delta * JOG_SECONDS_PER_TICK); return; }
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
    case 'loopHalve': case 'loopDouble': {
      const beats = nextLoopSize(deck.loopBeats, action === 'loopHalve' ? -1 : 1);
      if (deck.loop) controls.startLoop(beats); else deck.loopBeats = beats;
      status(`Deck ${controls.number}: loop de ${beats} beats.`); break;
    }
    case 'reloop': safe(async () => { if (!await deck.reloop()) status(`Deck ${controls.number}: todavía no hay un loop al que volver.`); }); break;
    case 'syncOff': setRange(controls.find('.pitch'), 0); status(`Deck ${controls.number}: tempo a 0 %.`); break;
    case 'tempoRange': controls.cycleTempoRange(); break;
    case 'slip': controls.setSlip(!controls.slip()); break;
    case 'headphones': controls.setHeadphones(!deck.headphones); break;
    case 'padMode': controls.pads.setMode(detail.mode); break;
    case 'pad': if (detail.on) controls.pads.press(detail.pad, detail.shift, detail.mode); else controls.pads.release(detail.pad, detail.shift, detail.mode); break;
    case 'echoBeats': deck.setEchoBeats(deck.echoBeats * detail.factor); status(`Deck ${controls.number}: echo de ${deck.echoBeats < 1 ? `1/${1 / deck.echoBeats}` : deck.echoBeats} beat.`); break;
    case 'range': { const id = `${controls.letter}.${detail.target}`; if (takeover(id, detail.value)) run(detail.target)(detail.value); break; }
    case 'filter': { const position = (detail.value + 1) / 2; if (takeover(`${controls.letter}.fx.filter`, position)) run('fx.filter')(position); break; }
    case 'stutter': safe(async () => { await deck.seek(deck.cue); await deck.play(); }); break;
    case 'loopIn': deck.markLoopIn(); status(`Deck ${controls.number}: inicio de loop marcado.`); break;
    case 'loopOut': if (!deck.markLoopOut()) status(`Deck ${controls.number}: marca antes el inicio del loop con SHIFT + 1/2X.`); break;
    case 'keylock': controls.setKeylock(!deck.keylock); break;
    case 'vinyl': controls.setVinyl(!controls.vinyl()); break;
    case 'toggleFX': {
      const on = !fxOn(index).includes(detail.fx);
      run(`fx.${detail.fx}`)(on ? Math.max(controls.fxDepth, 0.05) : 0);
      status(`Deck ${controls.number}: ${detail.fx} ${on ? 'activado' : 'desactivado'}.`); break;
    }
    case 'fxDepth': controls.fxDepth = detail.value; for (const name of fxOn(index)) run(`fx.${name}`)(Math.max(detail.value, 0.01)); break;
    case 'fxReset': run('fxReset')(); break;
    case 'load': if (library.hasSelection()) library.loadInto(index); else controls.find('.load').click(); break;
    case 'browse': library.moveSelection(detail.delta); break;
    case 'browseBack': library.moveSelection(-Infinity); break;
    case 'layer': {
      // The physical faders and knobs stay where they were: hand their last position to the new deck so soft
      // takeover keeps them from jumping its volume, EQ or tempo until they reach its values.
      const from = deckActions[detail.deck ^ 2].letter, to = deckActions[detail.deck].letter;
      for (const [id, value] of [...hardware]) if (id.startsWith(`${from}.`)) hardware.set(to + id.slice(1), value);
      if (detail.deck >= 2 && visibleDecks() === 2) showDecks(4);
      status(`Mesa: el lado ${detail.side ? 'derecho' : 'izquierdo'} controla el deck ${detail.deck + 1}.`); break;
    }
    case 'masterCue': setMasterCue(!masterCue()); break;
    case 'browsePress': {
      // Pressing the browse knob loads the selection into the first visible deck that is not playing.
      const free = mixer.decks.findIndex((item, i) => i < visibleDecks() && !item.playing);
      if (!library.hasSelection()) status('Gira el navegador para elegir una pista de la biblioteca.');
      else if (free < 0) status('Todos los decks están sonando. Pausa uno para cargar la pista.');
      else library.loadInto(free);
      break;
    }
    case 'touch': {
      const scratching = detail.on && controls.vinyl(), state = jogs[index];
      controls.find('.platter').classList.toggle('held', scratching);
      // SLIP: after a scratch the track continues where it would have been.
      if (scratching && controls.slip() && deck.playing) state.slip = { position: deck.position, time: mixer.context.currentTime, speed: deck.speed };
      deck.scratch(scratching);
      if (!detail.on && state.slip) { const saved = state.slip; state.slip = null; safe(() => deck.seek(saved.position + (mixer.context.currentTime - saved.time) * saved.speed)); }
      break;
    }
    case 'jog': jog(index, detail.delta); break;
    case 'search': if (deck.playing) safe(() => deck.seek(deck.position + detail.delta * 0.25)); else deck.scrub(detail.delta * 0.25); break;
    case 'crossfade': if (takeover('crossfade', detail.value)) targets.get('crossfade').run(detail.value); break;
  }
}
function sendLed(message) { try { output?.send(message); } catch { output = null; } }
function updateLeds() {
  if (!profile || !output) return;
  const state = mixer.decks.map((deck, i) => {
    const controls = deckActions[i];
    return { loaded: Boolean(deck.buffer), playing: deck.playing, loop: deck.loop ? loopBeats(deck) ?? 0 : null,
      padMode: controls.pads.mode, pads: [0, 1, 2, 3, 4, 5, 6, 7].map(controls.pads.lit), fxOn: fxOn(i), keylock: deck.keylock,
      vinyl: controls.vinyl(), slip: controls.slip(), headphones: deck.headphones,
      level: Number(controls.strip.querySelector('.vu').style.getPropertyValue('--level')) || 0 };
  });
  for (const message of profile.leds(state, { masterCue: masterCue() })) {
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
  cancelLearning(); ledsOff(); hardware.clear();
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
  const layers = profile?.layers?.() ?? [];
  mixer.decks.forEach((deck, i) => {
    const { view, strip } = deckActions[i];
    // Decks the hardware controls right now (DECK 3/4 switch them).
    view.classList.toggle('hw', layers.includes(i)); strip.classList.toggle('hw', layers.includes(i));
    setText(view.querySelector('.elapsed'), formatTime(deck.position));
    setText(view.querySelector('.remaining'), `−${formatTime(deck.duration - deck.position)}`);
    waveform(view, deck);
    view.classList.toggle('is-playing', deck.playing); view.classList.toggle('is-loaded', Boolean(deck.buffer));
    setText(view.querySelector('.loop-status'), deck.loop ? (deck.loop.manual ? 'Loop manual activo' : `Loop de ${deck.loopBeats} beats activo`) : '');
    for (const button of view.querySelectorAll('[data-loop]')) button.classList.toggle('active', Number(button.dataset.loop) === loopBeats(deck));
    const { pads } = deckActions[i], select = view.querySelector('.pad-mode');
    if (select.value !== pads.mode) select.value = pads.mode;
    for (const button of view.querySelectorAll('[data-pad]')) {
      const pad = Number(button.dataset.pad), [title, detail] = pads.label(pad);
      setText(button.querySelector('b'), title); setText(button.querySelector('small'), detail); button.classList.toggle('saved', pads.lit(pad));
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
// Audio output. The DDJ-SB3 sound card has 4 outputs (master on 1-2, headphones on 3-4), so choosing it enables CUE.
async function listOutputs() {
  let saved = ''; try { saved = localStorage.getItem('pulso.output') || ''; } catch {}
  const devices = (await navigator.mediaDevices?.enumerateDevices?.() ?? [])
    .filter(device => device.kind === 'audiooutput' && !['default', 'communications'].includes(device.deviceId));
  const select = $('#output'), current = select.value;
  select.replaceChildren(new Option('Predeterminada de Windows', ''), ...devices.map(device => new Option(device.label || 'Salida de audio', device.deviceId)));
  const wanted = devices.find(device => device.label === saved)?.deviceId ?? (devices.some(device => device.deviceId === current) ? current : '');
  if (wanted !== mixer.outputId) { select.value = wanted; await chooseOutput(false); } else select.value = wanted;
}
async function chooseOutput(remember = true) {
  const select = $('#output'), label = select.selectedOptions[0]?.text ?? '';
  await mixer.setOutput(select.value);
  if (remember) try { localStorage.setItem('pulso.output', select.value ? label : ''); } catch {}
  if (!mixer.cueAvailable) { for (const controls of deckActions) controls.setHeadphones(false); setMasterCue(false); }
  status(`Salida de audio: ${label}. ${mixer.cueAvailable ? 'Master por las salidas 1-2 y cascos (CUE) por 3-4.' : 'Tiene 2 canales: los cascos (CUE) necesitan una salida de 4 canales como la DDJ-SB3.'}`);
}
$('#output').onchange = () => safe(chooseOutput);
if (navigator.mediaDevices) navigator.mediaDevices.ondevicechange = () => safe(listOutputs);
safe(listOutputs);
mountRequests({ status, library });
mountAssistant(mixer, status);

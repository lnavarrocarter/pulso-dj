// What the eight performance pads do in each mode, for the DDJ-SB3 and for the pads on screen.
// Modes that act while a pad is held (roll, slicer, censor, pad scratch) use slip: on release the track
// continues where it would have been had it kept playing.
import { formatTime } from './core.mjs';
export const PAD_MODE_NAMES = { hotcue: 'Hot cue', fxfade: 'FX fade', scratch: 'Pad scratch', sampler: 'Sampler',
  beatjump: 'Beat jump', roll: 'Roll', slicer: 'Slicer', trans: 'Trans' };
const ROLLS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8];
const GATES = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1 / 12, 1 / 6, 1 / 3, 2 / 3];
const JUMPS = [4, 8, 16, 32];
const fraction = beats => beats >= 1 ? String(beats) : `1/${Math.round(1 / beats)}`;
// Pad scratch patterns: a cycle of `beats`; offset(p) is the record position in beats at phase p (0-1), level(p) the cut.
const tri = p => p < 0.5 ? p * 2 : 2 - p * 2;
const PATTERNS = [
  { name: 'Baby', beats: 1 / 2, offset: p => tri(p) / 4, level: () => 1 },
  { name: 'Baby ×2', beats: 1 / 4, offset: p => tri(p) / 8, level: () => 1 },
  { name: 'Forward', beats: 1 / 2, offset: p => tri(p) / 4, level: p => p < 0.5 ? 1 : 0 },
  { name: 'Backward', beats: 1 / 2, offset: p => tri(p) / 4, level: p => p < 0.5 ? 0 : 1 },
  { name: 'Chirp', beats: 1 / 2, offset: p => tri(p) / 4, level: p => p < 0.4 || p > 0.9 ? 1 : 0 },
  { name: 'Transformer', beats: 1, offset: p => tri(p) / 2, level: p => Math.floor(p * 8) % 2 ? 0 : 1 },
  { name: 'Tear', beats: 1 / 2, offset: p => p < 0.3 ? p / 0.3 / 4 : p < 0.5 ? 0.25 - (p - 0.3) / 0.2 / 8 : p < 0.6 ? 0.125 : Math.max(0, 0.125 - (p - 0.6) / 0.3 / 8), level: () => 1 },
  { name: 'Stab', beats: 1 / 4, offset: p => p < 0.25 ? p / 0.25 / 16 : Math.max(0, 1 / 16 - (p - 0.25) / 0.5 / 16), level: p => p < 0.25 ? 1 : 0 }
];
// env: { deck, sampler, number, status, loadSample(slot) }
export function createPads({ deck, sampler, number, status, loadSample }) {
  let mode = 'hotcue', jump = 4, slices = null, slip = null, held = new Set(), timer = 0;
  const beat = () => 60 / deck.bpm; // one beat in track seconds
  const now = () => deck.context.currentTime;
  const startSlip = () => { slip ??= { position: deck.position, time: now(), playing: deck.playing, speed: deck.speed }; };
  const endSlip = async () => {
    const saved = slip; slip = null; if (!saved) return;
    deck.disableLoop();
    await deck.seek(saved.playing ? saved.position + (now() - saved.time) * saved.speed : saved.position);
  };
  // Moves the record by hand from a timer: pad scratch patterns and censor (reverse at normal speed).
  // step(elapsed seconds) returns where the record should be, in track seconds from where it was grabbed.
  const drive = step => {
    clearInterval(timer); deck.scratch(true);
    const started = performance.now(); let moved = 0;
    timer = setInterval(() => {
      const target = step((performance.now() - started) / 1000);
      deck.scratchMove(target - moved); moved = target;
    }, 8);
  };
  const stopDrive = () => { clearInterval(timer); timer = 0; deck.scratch(false); deck.setPadLevel(1); };
  const releaseAll = () => { if (held.size) { held.clear(); stopDrive(); deck.padFade(null); deck.padGate(null); endSlip(); } };
  const actions = {
    hotcue: {
      press: (pad, shift) => deck.triggerHotCue(pad, shift),
      label: pad => [String(pad + 1), deck.hotCues[pad] === null ? 'Cue' : formatTime(deck.hotCues[pad])],
      lit: pad => deck.hotCues[pad] !== null
    },
    fxfade: {
      press: pad => deck.padFade(pad < 4 ? 'highpass' : 'lowpass', 2 ** (pad % 4) * beat() / deck.speed),
      release: () => deck.padFade(null),
      label: pad => [`${2 ** (pad % 4)} b`, pad < 4 ? 'Fade agudos' : 'Fade graves']
    },
    scratch: {
      press: pad => {
        if (!deck.buffer) return;
        const pattern = PATTERNS[pad]; startSlip();
        drive(elapsed => {
          const cycle = pattern.beats * beat() / deck.speed, phase = (elapsed % cycle) / cycle;
          deck.setPadLevel(pattern.level(phase));
          return pattern.offset(phase) * beat();
        });
      },
      release: () => { stopDrive(); endSlip(); },
      label: pad => [PATTERNS[pad].name, `${fraction(PATTERNS[pad].beats)} b`]
    },
    sampler: {
      press: (pad, shift) => {
        const slot = pad % 4;
        if (pad < 4) { if (shift) sampler.stop(slot); else if (!sampler.play(slot)) status(`Sampler ${slot + 1} vacío: carga una pista con el pad ${slot + 5}.`); }
        else if (shift) sampler.eject(slot);
        else return loadSample(slot);
      },
      label: pad => pad < 4 ? [`S${pad + 1}`, sampler.slots[pad]?.name ?? 'Vacío'] : [`Cargar S${pad - 3}`, 'Selección'],
      lit: pad => pad < 4 ? sampler.playing(pad) : sampler.slots[pad - 4] !== null
    },
    beatjump: {
      press: (pad, shift) => {
        if (!deck.buffer) return;
        if (shift) return deck.seek(deck.position + (pad < 4 ? -1 : 1) * JUMPS[pad % 4] * beat());
        if (pad === 0) jump = Math.max(1 / 4, jump / 2);
        else if (pad === 1) jump = Math.min(64, jump * 2);
        else if (pad === 2 || pad === 3) return deck.seek(deck.position + (pad === 2 ? -jump : jump) * beat());
        else if (pad === 4) return deck.seek(0);
        else if (pad === 5 || pad === 6) {
          const direction = pad === 5 ? -1 : 1;
          clearInterval(timer); timer = setInterval(() => { if (!deck.scratching) deck.seek(deck.position + direction * 0.4); }, 50);
        } else { startSlip(); drive(elapsed => -elapsed * deck.speed); } // CENSOR: plays backwards while held
      },
      release: pad => { if (pad === 5 || pad === 6) { clearInterval(timer); timer = 0; } if (pad === 7) { stopDrive(); endSlip(); } },
      label: pad => [['½', '×2', '◄', '►', '|◄', '◄◄', '►►', 'Censor'][pad], ['Salto', 'Salto', `${fraction(jump)} b`, `${fraction(jump)} b`, 'Inicio', 'Atrás', 'Adelante', 'Reversa'][pad]],
      lit: pad => pad < 4 || held.has(pad)
    },
    roll: {
      press: pad => {
        if (!deck.buffer) return;
        startSlip(); const start = deck.position;
        deck.setLoop({ start, end: Math.min(deck.duration, start + ROLLS[pad] * beat()), manual: true, roll: true });
      },
      release: () => endSlip(),
      label: pad => [fraction(ROLLS[pad]), 'Roll']
    },
    slicer: {
      press: async pad => {
        if (!deck.buffer) return;
        // The eight slices cover the eight beats from where the slicer started; they follow the track in blocks of 8 beats.
        if (slices === null || deck.position < slices || deck.position >= slices + 8 * beat()) slices = deck.position;
        startSlip(); const start = slices + pad * beat();
        await deck.seek(start); deck.setLoop({ start, end: Math.min(deck.duration, start + beat()), manual: true, roll: true });
      },
      release: () => endSlip(),
      label: pad => [`${pad + 1}`, 'Slice'],
      lit: pad => slices !== null && Math.floor((deck.position - slices) / beat()) === pad
    },
    trans: {
      press: pad => deck.padGate(GATES[pad] * beat() / deck.speed),
      release: () => deck.padGate(null),
      label: pad => [fraction(GATES[pad]), 'Trans']
    }
  };
  return {
    get mode() { return mode; },
    setMode(next) {
      if (!actions[next] || next === mode) return;
      releaseAll(); mode = next; slices = null;
      status(`Deck ${number}: pads en modo ${PAD_MODE_NAMES[mode]}.`);
    },
    // A pad press may come in a different mode from the one shown (the hardware switches by itself).
    press(pad, shift = false, padMode = mode) {
      if (padMode !== mode) this.setMode(padMode);
      held.add(pad);
      return Promise.resolve(actions[mode].press(pad, shift)).catch(error => status(error.message));
    },
    release(pad, _shift = false, padMode = mode) {
      if (padMode !== mode || !held.delete(pad)) return;
      actions[mode].release?.(pad);
    },
    label: pad => actions[mode].label(pad),
    lit: pad => actions[mode].lit ? actions[mode].lit(pad) : held.has(pad)
  };
}

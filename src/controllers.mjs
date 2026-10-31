// Built-in controller profiles. A profile turns raw MIDI into app actions and app state into LED messages.
// DDJ-SB3 numbers: docs/controllers/DDJ-SB3.md (Mixxx mapping, checked against a physical capture).
export const JOG_SECONDS_PER_TICK = 1.8 / 720; // 720 ticks per turn at 33⅓ rpm
const LOOP_SIZES = [1, 2, 4, 8, 16];
const FX = ['echo', 'reverb', 'drive'];
export function nextLoopSize(beats, direction) {
  const index = LOOP_SIZES.indexOf(beats);
  return LOOP_SIZES[Math.min(LOOP_SIZES.length - 1, Math.max(0, (index < 0 ? 2 : index) + direction))];
}
// The FX buttons switch an effect on or off; the FX knob sets the depth of the effects that are on.
// The SB3 filter knob is bipolar: −1 closes the low-pass, 1 the high-pass; a small dead zone keeps the centre detent open.
export function filterAmount(value) {
  const side = value * 2 - 1;
  return Math.abs(side) < 0.04 ? 0 : Math.sign(side) * Math.min(1, (Math.abs(side) - 0.04) / 0.96);
}
const deckButtons = { 11: 'play', 12: 'cue', 72: 'setCue', 71: 'stutter', 88: 'sync', 92: 'syncOff', 20: 'autoLoop', 80: 'reloop',
  18: 'loopHalve', 19: 'loopDouble', 97: 'loopIn', 98: 'loopOut', 26: 'keylock', 96: 'tempoRange', 23: 'vinyl', 64: 'slip', 84: 'headphones', 104: 'headphones' };
// Pad modes in the order of their note ranges: each mode uses 16 notes on the pad channel, 8 pads and then the same
// 8 with SHIFT. The mode buttons (SHIFT selects the second mode printed under each) send these notes on the deck channel.
export const PAD_MODES = ['hotcue', 'fxfade', 'scratch', 'sampler', 'beatjump', 'roll', 'slicer', 'trans'];
const padModeButtons = { 27: 0, 30: 1, 32: 2, 34: 3, 105: 4, 107: 5, 109: 6, 110: 7 };
const padModeLeds = [27, 30, 32, 34];
const deckRanges = { 0: 'pitch', 4: 'trim', 7: 'eq2', 11: 'eq1', 15: 'eq0', 19: 'volume' };
// Channels 1-4 carry decks 1-4: the DECK 3/4 buttons switch which channel each side of the hardware sends on.
export function createDDJSB3() {
  const msb = new Map();
  const active = [0, 1]; // deck shown on the left and right side of the hardware
  let syncing = false;
  // Faders send MSB (CC n) then LSB (CC n + 32); a value is emitted once the pair is complete.
  const fine = (channel, number, value) => {
    if (number < 32) { msb.set(`${channel}:${number}`, value); return null; }
    const high = msb.get(`${channel}:${number - 32}`);
    return high === undefined ? null : ((high << 7) | value) / 16383;
  };
  return {
    name: 'Pioneer DDJ-SB3',
    // Same request Mixxx sends at start-up: the SB3 answers with the position of every knob and fader,
    // and with note 114 on the channel of the deck active on each side.
    stateRequest: [0xf0, 0x00, 0x20, 0x7f, 0x03, 0x01, 0xf7],
    // While syncing, values reported for the hidden deck layer are stale and ignored.
    beginSync() { syncing = true; },
    endSync() { syncing = false; },
    receive(data) {
      if (!data || data.length < 3) return [];
      const kind = data[0] & 0xf0, channel = data[0] & 15, number = data[1], value = data[2];
      const pressed = kind === 0x90 && value > 0;
      if (channel <= 3) {
        if (!syncing) active[channel % 2] = channel;
        else if (number === 114 && pressed) { active[channel % 2] = channel; return []; }
        else if (channel !== active[channel % 2]) return [];
      }
      if (kind === 0x90 || kind === 0x80) {
        if (channel <= 3) {
          if (number === 53 || number === 54 || number === 103) return [{ deck: channel, action: 'touch', on: pressed }];
          if (pressed && padModeButtons[number] !== undefined) return [{ deck: channel, action: 'padMode', mode: PAD_MODES[padModeButtons[number]] }];
          return pressed && deckButtons[number] ? [{ deck: channel, action: deckButtons[number] }] : [];
        }
        // Pads report release too: rolls, censor, FX FADE and TRANS last while the pad is held.
        if (channel >= 7 && channel <= 10) {
          return [{ deck: channel - 7, action: 'pad', mode: PAD_MODES[number >> 4], pad: number & 7, shift: Boolean(number & 8), on: pressed }];
        }
        if (!pressed) return [];
        if (channel === 4 || channel === 5) {
          if (number >= 71 && number <= 73) return [{ deck: active[channel - 4], action: 'toggleFX', fx: FX[number - 71] }];
          // SHIFT + FX 1 / 2 / 3: SELECT (all effects off), BEAT ◄ and BEAT ► (echo time).
          if (number === 99) return [{ deck: active[channel - 4], action: 'fxReset' }];
          if (number === 100 || number === 101) return [{ deck: active[channel - 4], action: 'echoBeats', factor: number === 100 ? 0.5 : 2 }];
          return [];
        }
        if (channel === 6 && number >= 70 && number <= 73) return [{ deck: number - 70, action: 'load' }];
        if (channel === 6 && number === 65) return [{ action: 'browsePress' }];
        if (channel === 6 && number === 66) return [{ action: 'browseBack' }];
        if (channel === 6 && (number === 91 || number === 120)) return [{ action: 'masterCue' }];
        return [];
      }
      if (kind !== 0xb0) return [];
      if (channel <= 3) {
        const delta = value - 64;
        if (number >= 33 && number <= 35) return [{ deck: channel, action: 'jog', delta }]; // ring, vinyl surface, plain surface
        if (number === 31 || number === 38) return [{ deck: channel, action: 'search', delta }];
        const amount = fine(channel, number, value); const target = deckRanges[number < 32 ? -1 : number - 32];
        if (amount === null || !target) return [];
        return [{ deck: channel, action: 'range', target, value: target === 'pitch' ? 1 - amount : amount }];
      }
      if (channel === 4 || channel === 5) {
        const amount = fine(channel, number, value);
        return amount !== null && number === 38 ? [{ deck: active[channel - 4], action: 'fxDepth', value: amount }] : [];
      }
      if (channel === 6) {
        // Browse knob: two's-complement steps (1 = next track, 127 = previous); with SHIFT it jumps 10 at a time.
        if (number === 64 || number === 100) { const step = value < 64 ? value : value - 128; return [{ action: 'browse', delta: number === 100 ? step * 10 : step }]; }
        const amount = fine(channel, number, value); if (amount === null) return [];
        if (number === 63) return [{ action: 'crossfade', value: amount }];
        if (number >= 55 && number <= 58) return [{ deck: number - 55, action: 'filter', value: filterAmount(amount) }];
      }
      return [];
    },
    // decks: [{ loaded, playing, loop: beats|null, padMode, pads: [bool×8], fxOn: [names], keylock, vinyl, slip, headphones, level: 0-1 }];
    // mixer: { masterCue }. Returns the note-on messages for every LED and the CC 2 value for each channel level meter.
    leds(decks, mixer = {}) {
      const messages = [], on = flag => flag ? 127 : 0;
      decks.forEach((deck, index) => {
        const mode = Math.max(0, PAD_MODES.indexOf(deck.padMode));
        messages.push([0x90 + index, 11, on(deck.playing)], [0x90 + index, 12, on(deck.loaded && !deck.playing)],
          [0x90 + index, 20, on(deck.loop !== null)], [0x90 + index, 26, on(deck.keylock)], [0x90 + index, 23, on(deck.vinyl)],
          [0x90 + index, 64, on(deck.slip)], [0x90 + index, 84, on(deck.headphones)]);
        padModeLeds.forEach((note, button) => messages.push([0x90 + index, note, on(button === mode % 4)]));
        (deck.pads ?? []).forEach((lit, pad) => messages.push([0x97 + index, mode * 16 + pad, on(lit)]));
        messages.push([0xb0 + index, 2, Math.floor((deck.level ?? 0) * 117)]); // 117 keeps the top LED for clipping, as in Mixxx
      });
      messages.push([0x96, 91, on(mixer.masterCue)]);
      // The FX buttons belong to a side of the hardware, so they show the effect of the deck active there.
      active.forEach((index, side) => FX.forEach((name, button) => messages.push([0x94 + side, 71 + button, decks[index]?.fxOn?.includes(name) ? 127 : 0])));
      return messages;
    }
  };
}
export const controllerProfiles = [{ match: name => /DDJ-SB3/i.test(name || ''), create: createDDJSB3 }];
export function profileFor(name) { return controllerProfiles.find(profile => profile.match(name))?.create() ?? null; }

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
// The SB3 filter knob is bipolar: left of centre closes the low-pass, right of centre would be a high-pass Pulso lacks.
export function filterAmount(value) { return value < 0.48 ? Math.min(1, (0.48 - value) / 0.48) : 0; }
const deckButtons = { 11: 'play', 12: 'cue', 72: 'setCue', 88: 'sync', 20: 'autoLoop', 80: 'loopOff', 18: 'loopHalve', 19: 'loopDouble' };
const deckRanges = { 0: 'pitch', 7: 'eq2', 11: 'eq1', 15: 'eq0', 19: 'volume' };
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
          if (number === 53 || number === 54) return [{ deck: channel, action: 'touch', on: pressed }];
          return pressed && deckButtons[number] ? [{ deck: channel, action: deckButtons[number] }] : [];
        }
        if (!pressed) return [];
        if (channel >= 7 && channel <= 10) {
          const deck = channel - 7;
          if (number <= 3) return [{ deck, action: 'hotcue', index: number }];
          if (number <= 7) return [{ deck, action: 'loop', beats: LOOP_SIZES[number - 4] }];
          if (number >= 8 && number <= 11) return [{ deck, action: 'clearHotcue', index: number - 8 }];
          return [];
        }
        if (channel === 4 || channel === 5) {
          if (number >= 71 && number <= 73) return [{ deck: active[channel - 4], action: 'toggleFX', fx: FX[number - 71] }];
          if (number >= 99 && number <= 101) return [{ deck: active[channel - 4], action: 'fxReset' }];
          return [];
        }
        if (channel === 6 && number >= 70 && number <= 73) return [{ deck: number - 70, action: 'load' }];
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
        const amount = fine(channel, number, value); if (amount === null) return [];
        if (number === 63) return [{ action: 'crossfade', value: amount }];
        if (number >= 55 && number <= 58) return [{ deck: number - 55, action: 'filter', value: filterAmount(amount) }];
      }
      return [];
    },
    // decks: [{ loaded, playing, loop: beats|null, hotCues: [bool×4], fxOn: [names], level: 0-1 }].
    // Returns the note-on messages for every LED and the CC 2 value for each channel level meter.
    leds(decks) {
      const messages = [];
      decks.forEach((deck, index) => {
        const on = flag => flag ? 127 : 0;
        messages.push([0x90 + index, 11, on(deck.playing)], [0x90 + index, 12, on(deck.loaded && !deck.playing)],
          [0x90 + index, 20, on(deck.loop !== null)], [0x90 + index, 27, 127]);
        deck.hotCues.forEach((saved, pad) => messages.push([0x97 + index, pad, on(saved)]));
        LOOP_SIZES.slice(0, 4).forEach((beats, pad) => messages.push([0x97 + index, pad + 4, on(deck.loop === beats)]));
        messages.push([0xb0 + index, 2, Math.floor((deck.level ?? 0) * 117)]); // 117 keeps the top LED for clipping, as in Mixxx
      });
      // The FX buttons belong to a side of the hardware, so they show the effect of the deck active there.
      active.forEach((index, side) => FX.forEach((name, button) => messages.push([0x94 + side, 71 + button, decks[index]?.fxOn?.includes(name) ? 127 : 0])));
      return messages;
    }
  };
}
export const controllerProfiles = [{ match: name => /DDJ-SB3/i.test(name || ''), create: createDDJSB3 }];
export function profileFor(name) { return controllerProfiles.find(profile => profile.match(name))?.create() ?? null; }

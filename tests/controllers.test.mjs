import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDDJSB3, profileFor, nextLoopSize, filterAmount } from '../src/controllers.mjs';
const fader = (sb3, status, msb, high, low) => [...sb3.receive([status, msb, high]), ...sb3.receive([status, msb + 32, low])];
test('detecta la DDJ-SB3 por el nombre del puerto', () => {
  assert.equal(profileFor('DDJ-SB3').name, 'Pioneer DDJ-SB3');
  assert.equal(profileFor('2- DDJ-SB3 MIDI').name, 'Pioneer DDJ-SB3');
  assert.equal(profileFor('Launchpad'), null);
});
test('botones de deck: play, cue, sync y loops en el canal de cada deck', () => {
  const sb3 = createDDJSB3();
  assert.deepEqual(sb3.receive([0x90, 11, 127]), [{ deck: 0, action: 'play' }]);
  assert.deepEqual(sb3.receive([0x91, 12, 127]), [{ deck: 1, action: 'cue' }]);
  assert.deepEqual(sb3.receive([0x90, 11, 0]), []);
  assert.deepEqual(sb3.receive([0x91, 88, 127]), [{ deck: 1, action: 'sync' }]);
  assert.deepEqual(sb3.receive([0x90, 80, 127]), [{ deck: 0, action: 'loopOff' }]);
});
test('faders de 14 bits: el valor sale al llegar el LSB y el tempo va invertido', () => {
  const sb3 = createDDJSB3();
  assert.deepEqual(sb3.receive([0xb0, 19, 127]), []);
  assert.deepEqual(sb3.receive([0xb0, 51, 127]), [{ deck: 0, action: 'range', target: 'volume', value: 1 }]);
  assert.equal(fader(sb3, 0xb1, 7, 64, 0)[0].value, 8192 / 16383);
  assert.equal(fader(sb3, 0xb1, 7, 64, 0)[0].target, 'eq2');
  assert.deepEqual(fader(sb3, 0xb0, 0, 0, 0), [{ deck: 0, action: 'range', target: 'pitch', value: 1 }]);
  assert.deepEqual(fader(sb3, 0xb6, 31, 127, 127), [{ action: 'crossfade', value: 1 }]);
  assert.deepEqual(fader(sb3, 0xb0, 4, 100, 0), [], 'TRIM no tiene función en Pulso');
});
test('jogs relativos, búsqueda con SHIFT y toque de la superficie', () => {
  const sb3 = createDDJSB3();
  assert.deepEqual(sb3.receive([0xb0, 33, 66]), [{ deck: 0, action: 'jog', delta: 2 }]);
  assert.deepEqual(sb3.receive([0xb1, 35, 63]), [{ deck: 1, action: 'jog', delta: -1 }]);
  assert.deepEqual(sb3.receive([0xb0, 31, 65]), [{ deck: 0, action: 'search', delta: 1 }]);
  assert.deepEqual(sb3.receive([0x91, 54, 127]), [{ deck: 1, action: 'touch', on: true }]);
  assert.deepEqual(sb3.receive([0x91, 54, 0]), [{ deck: 1, action: 'touch', on: false }]);
});
test('pads, FX, filtro y LOAD', () => {
  const sb3 = createDDJSB3();
  assert.deepEqual(sb3.receive([0x97, 2, 127]), [{ deck: 0, action: 'hotcue', index: 2 }]);
  assert.deepEqual(sb3.receive([0x98, 9, 127]), [{ deck: 1, action: 'clearHotcue', index: 1 }]);
  assert.deepEqual(sb3.receive([0x98, 6, 127]), [{ deck: 1, action: 'loop', beats: 4 }]);
  assert.deepEqual(sb3.receive([0x95, 72, 127]), [{ deck: 1, action: 'toggleFX', fx: 'reverb' }]);
  assert.deepEqual(fader(sb3, 0xb4, 6, 127, 127), [{ deck: 0, action: 'fxDepth', value: 1 }]);
  assert.deepEqual(fader(sb3, 0xb4, 2, 127, 127), [], 'mensajes duplicados del potenciómetro FX');
  assert.deepEqual(fader(sb3, 0xb6, 24, 0, 0), [{ deck: 1, action: 'filter', value: 1 }]);
  assert.deepEqual(sb3.receive([0x96, 71, 127]), [{ deck: 1, action: 'load' }]);
});
test('filtro bipolar y tamaños de loop', () => {
  assert.equal(filterAmount(0.5), 0); assert.equal(filterAmount(1), 0); assert.equal(filterAmount(0), 1);
  assert.equal(nextLoopSize(4, -1), 2); assert.equal(nextLoopSize(16, 1), 16); assert.equal(nextLoopSize(1, -1), 1);
});
test('LEDs reflejan reproducción, loop, hot cues y efecto seleccionado', () => {
  const decks = [{ loaded: true, playing: true, loop: 4, hotCues: [true, false, false, false], fxOn: ['drive'], level: 1 },
    { loaded: false, playing: false, loop: null, hotCues: [false, false, false, false], fxOn: [], level: 0 }];
  const leds = new Map(createDDJSB3().leds(decks).map(([status, note, value]) => [`${status}:${note}`, value]));
  assert.equal(leds.get('144:11'), 127); assert.equal(leds.get('144:12'), 0); assert.equal(leds.get('144:20'), 127);
  assert.equal(leds.get('151:0'), 127); assert.equal(leds.get('151:1'), 0); assert.equal(leds.get('151:6'), 127);
  assert.equal(leds.get('148:73'), 127); assert.equal(leds.get('149:71'), 0); assert.equal(leds.get('145:11'), 0);
  assert.equal(leds.get('176:2'), 117); assert.equal(leds.get('177:2'), 0);
});
test('decks 3 y 4: canales 3/4, pads en canales 10/11 y FX del deck activo en cada lado', () => {
  const sb3 = createDDJSB3();
  assert.deepEqual(sb3.receive([0x92, 11, 127]), [{ deck: 2, action: 'play' }]);
  assert.deepEqual(sb3.receive([0x9a, 1, 127]), [{ deck: 3, action: 'hotcue', index: 1 }]);
  assert.deepEqual(sb3.receive([0x94, 73, 127]), [{ deck: 2, action: 'toggleFX', fx: 'drive' }], 'el lado izquierdo muestra el deck 3');
  assert.deepEqual(sb3.receive([0x95, 71, 127]), [{ deck: 1, action: 'toggleFX', fx: 'echo' }]);
  assert.deepEqual(fader(sb3, 0xb6, 26, 0, 0), [{ deck: 3, action: 'filter', value: 1 }]);
  assert.deepEqual(sb3.receive([0x96, 72, 127]), [{ deck: 2, action: 'load' }]);
  const deck = fx => ({ loaded: false, playing: false, loop: null, hotCues: [false, false, false, false], fxOn: [fx] });
  const leds = new Map(sb3.leds([deck('echo'), deck('reverb'), deck('drive'), deck('echo')]).map(([status, note, value]) => [`${status}:${note}`, value]));
  assert.equal(leds.get('148:73'), 127); assert.equal(leds.get('149:72'), 127); assert.equal(leds.get('146:27'), 127);
});
test('sincronización: la SB3 informa del deck activo y se ignoran los valores de la capa oculta', () => {
  const sb3 = createDDJSB3();
  assert.equal(sb3.stateRequest[0], 0xf0); assert.equal(sb3.stateRequest.at(-1), 0xf7);
  sb3.beginSync();
  assert.deepEqual(sb3.receive([0x92, 114, 127]), [], 'el deck 3 está activo a la izquierda');
  assert.deepEqual(fader(sb3, 0xb0, 19, 0, 0), [], 'capa oculta del deck 1');
  assert.deepEqual(fader(sb3, 0xb2, 19, 127, 127), [{ deck: 2, action: 'range', target: 'volume', value: 1 }]);
  sb3.endSync();
  assert.deepEqual(sb3.receive([0x90, 11, 127]), [{ deck: 0, action: 'play' }]);
});

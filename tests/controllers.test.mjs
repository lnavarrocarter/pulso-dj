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
  assert.deepEqual(sb3.receive([0x90, 80, 127]), [{ deck: 0, action: 'reloop' }]);
});
test('faders de 14 bits: el valor sale al llegar el LSB y el tempo va invertido', () => {
  const sb3 = createDDJSB3();
  assert.deepEqual(sb3.receive([0xb0, 19, 127]), []);
  assert.deepEqual(sb3.receive([0xb0, 51, 127]), [{ deck: 0, action: 'range', target: 'volume', value: 1 }]);
  assert.equal(fader(sb3, 0xb1, 7, 64, 0)[0].value, 8192 / 16383);
  assert.equal(fader(sb3, 0xb1, 7, 64, 0)[0].target, 'eq2');
  assert.deepEqual(fader(sb3, 0xb0, 0, 0, 0), [{ deck: 0, action: 'range', target: 'pitch', value: 1 }]);
  assert.deepEqual(fader(sb3, 0xb6, 31, 127, 127), [{ action: 'crossfade', value: 1 }]);
  assert.deepEqual(fader(sb3, 0xb0, 4, 64, 0), [{ deck: 0, action: 'range', target: 'trim', value: 8192 / 16383 }]);
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
  assert.deepEqual(sb3.receive([0x97, 2, 127]), [{ deck: 0, action: 'pad', mode: 'hotcue', pad: 2, shift: false, on: true }]);
  assert.deepEqual(sb3.receive([0x98, 9, 127]), [{ deck: 1, action: 'pad', mode: 'hotcue', pad: 1, shift: true, on: true }]);
  assert.deepEqual(sb3.receive([0x98, 6, 0]), [{ deck: 1, action: 'pad', mode: 'hotcue', pad: 6, shift: false, on: false }], 'los pads avisan al soltar');
  assert.deepEqual(sb3.receive([0x95, 72, 127]), [{ deck: 1, action: 'toggleFX', fx: 'reverb' }]);
  assert.deepEqual(fader(sb3, 0xb4, 6, 127, 127), [{ deck: 0, action: 'fxDepth', value: 1 }]);
  assert.deepEqual(fader(sb3, 0xb4, 2, 127, 127), [], 'mensajes duplicados del potenciómetro FX');
  assert.deepEqual(fader(sb3, 0xb6, 24, 0, 0), [{ deck: 1, action: 'filter', value: -1 }]);
  assert.deepEqual(sb3.receive([0x96, 71, 127]), [{ deck: 1, action: 'load' }]);
});
test('filtro bipolar y tamaños de loop', () => {
  assert.equal(filterAmount(0.5), 0); assert.equal(filterAmount(0.51), 0, 'zona muerta en el centro');
  assert.equal(filterAmount(0), -1); assert.equal(filterAmount(1), 1); assert.ok(filterAmount(0.75) > 0.4 && filterAmount(0.75) < 0.5);
  assert.equal(nextLoopSize(4, -1), 2); assert.equal(nextLoopSize(16, 1), 16); assert.equal(nextLoopSize(1, -1), 1);
});
test('LEDs reflejan reproducción, loop, pads y efecto seleccionado', () => {
  const decks = [{ loaded: true, playing: true, loop: 4, padMode: 'hotcue', pads: [true, false, false, false, false, false, true, false], fxOn: ['drive'], level: 1 },
    { loaded: false, playing: false, loop: null, padMode: 'roll', pads: [false, false, false, false, false, false, false, false], fxOn: [], level: 0 }];
  const leds = new Map(createDDJSB3().leds(decks).map(([status, note, value]) => [`${status}:${note}`, value]));
  assert.equal(leds.get('144:11'), 127); assert.equal(leds.get('144:12'), 0); assert.equal(leds.get('144:20'), 127);
  assert.equal(leds.get('151:0'), 127); assert.equal(leds.get('151:1'), 0); assert.equal(leds.get('151:6'), 127);
  assert.equal(leds.get('144:27'), 127, 'botón HOT CUE'); assert.equal(leds.get('145:30'), 127, 'ROLL enciende el botón FX FADE');
  assert.equal(leds.get('145:27'), 0); assert.equal(leds.get('152:80'), 0, 'pads del modo ROLL');
  assert.equal(leds.get('148:73'), 127); assert.equal(leds.get('149:71'), 0); assert.equal(leds.get('145:11'), 0);
  assert.equal(leds.get('176:2'), 117); assert.equal(leds.get('177:2'), 0);
});
test('decks 3 y 4: canales 3/4, pads en canales 10/11 y FX del deck activo en cada lado', () => {
  const sb3 = createDDJSB3();
  assert.deepEqual(sb3.receive([0x92, 11, 127]), [{ deck: 2, action: 'play' }]);
  assert.deepEqual(sb3.receive([0x9a, 1, 127]), [{ deck: 3, action: 'pad', mode: 'hotcue', pad: 1, shift: false, on: true }]);
  assert.deepEqual(sb3.receive([0x94, 73, 127]), [{ deck: 2, action: 'toggleFX', fx: 'drive' }], 'el lado izquierdo muestra el deck 3');
  assert.deepEqual(sb3.receive([0x95, 71, 127]), [{ deck: 3, action: 'toggleFX', fx: 'echo' }], 'los pads del deck 4 activan el deck 4 a la derecha');
  assert.deepEqual(fader(sb3, 0xb6, 26, 127, 127), [{ deck: 3, action: 'filter', value: 1 }]);
  assert.deepEqual(sb3.receive([0x96, 72, 127]), [{ deck: 2, action: 'load' }]);
  const deck = fx => ({ loaded: false, playing: false, loop: null, padMode: 'hotcue', pads: [false, false, false, false, false, false, false, false], fxOn: [fx] });
  const leds = new Map(sb3.leds([deck('echo'), deck('reverb'), deck('drive'), deck('echo')]).map(([status, note, value]) => [`${status}:${note}`, value]));
  assert.equal(leds.get('148:73'), 127); assert.equal(leds.get('149:71'), 127); assert.equal(leds.get('146:27'), 127);
});
test('sincronización: la SB3 informa del deck activo y se ignoran los valores de la capa oculta', () => {
  const sb3 = createDDJSB3();
  assert.equal(sb3.stateRequest[0], 0xf0); assert.equal(sb3.stateRequest.at(-1), 0xf7);
  sb3.beginSync();
  assert.deepEqual(sb3.receive([0x92, 114, 127]), [{ action: 'layer', side: 0, deck: 2 }], 'el deck 3 está activo a la izquierda');
  assert.deepEqual(fader(sb3, 0xb0, 19, 0, 0), [], 'capa oculta del deck 1');
  assert.deepEqual(fader(sb3, 0xb6, 23, 0, 0), [], 'filtro de la capa oculta');
  assert.deepEqual(fader(sb3, 0xb6, 25, 0, 0), [{ deck: 2, action: 'filter', value: -1 }]);
  assert.deepEqual(fader(sb3, 0xb2, 19, 127, 127), [{ deck: 2, action: 'range', target: 'volume', value: 1 }]);
  sb3.endSync();
  assert.deepEqual(sb3.receive([0x90, 114, 127]), [{ action: 'layer', side: 0, deck: 0 }]);
  assert.deepEqual(sb3.receive([0x90, 11, 127]), [{ deck: 0, action: 'play' }]);
});
test('navegador de la biblioteca: girar mueve la selección y LOAD carga en cada deck', () => {
  const sb3 = createDDJSB3();
  assert.deepEqual(sb3.receive([0xb6, 64, 1]), [{ action: 'browse', delta: 1 }]);
  assert.deepEqual(sb3.receive([0xb6, 64, 127]), [{ action: 'browse', delta: -1 }]);
  assert.deepEqual(sb3.receive([0xb6, 100, 1]), [{ action: 'browse', delta: 10 }]);
  assert.deepEqual(sb3.receive([0x96, 73, 127]), [{ deck: 3, action: 'load' }]);
});
test('KEYLOCK, VINYL, LOOP IN/OUT, SHIFT + PLAY, toque con SHIFT y pulsar el navegador', () => {
  const sb3 = createDDJSB3();
  assert.deepEqual(sb3.receive([0x90, 26, 127]), [{ deck: 0, action: 'keylock' }]);
  assert.deepEqual(sb3.receive([0x91, 23, 127]), [{ deck: 1, action: 'vinyl' }]);
  assert.deepEqual(sb3.receive([0x90, 97, 127]), [{ deck: 0, action: 'loopIn' }]);
  assert.deepEqual(sb3.receive([0x90, 98, 127]), [{ deck: 0, action: 'loopOut' }]);
  assert.deepEqual(sb3.receive([0x91, 71, 127]), [{ deck: 1, action: 'stutter' }]);
  assert.deepEqual(sb3.receive([0x90, 103, 127]), [{ deck: 0, action: 'touch', on: true }]);
  assert.deepEqual(sb3.receive([0x96, 65, 127]), [{ action: 'browsePress' }]);
  const leds = new Map(sb3.leds([{ loaded: true, playing: false, loop: 0, padMode: 'hotcue', pads: [false, false, false, false, false, false, false, false], fxOn: [], keylock: true, vinyl: false }])
    .map(([status, note, value]) => [`${status}:${note}`, value]));
  assert.equal(leds.get('144:26'), 127); assert.equal(leds.get('144:23'), 0);
  assert.equal(leds.get('144:20'), 127, 'un loop manual enciende AUTO LOOP'); assert.equal(leds.get('151:4'), 0);
});test('los ocho modos de pad: cada modo usa 16 notas y los botones de modo lo seleccionan', () => {
  const sb3 = createDDJSB3();
  const pad = (status, note, velocity = 127) => sb3.receive([status, note, velocity])[0];
  assert.deepEqual(pad(0x97, 16), { deck: 0, action: 'pad', mode: 'fxfade', pad: 0, shift: false, on: true });
  assert.equal(pad(0x97, 39).mode, 'scratch'); assert.equal(pad(0x97, 39).pad, 7);
  assert.deepEqual(pad(0x98, 50), { deck: 1, action: 'pad', mode: 'sampler', pad: 2, shift: false, on: true });
  assert.equal(pad(0x98, 58).shift, true, 'SHIFT + pad de sampler');
  assert.equal(pad(0x97, 71).mode, 'beatjump'); assert.equal(pad(0x97, 80).mode, 'roll');
  assert.equal(pad(0x97, 96).mode, 'slicer'); assert.equal(pad(0x97, 112).mode, 'trans');
  assert.deepEqual(pad(0x90, 30), { deck: 0, action: 'padMode', mode: 'fxfade' });
  assert.deepEqual(pad(0x91, 105), { deck: 1, action: 'padMode', mode: 'beatjump' });
  assert.deepEqual(pad(0x91, 110), { deck: 1, action: 'padMode', mode: 'trans' });
});
test('funciones con SHIFT, CUE de cascos y MASTER', () => {
  const sb3 = createDDJSB3();
  const one = data => sb3.receive(data)[0];
  assert.deepEqual(one([0x90, 80, 127]), { deck: 0, action: 'reloop' });
  assert.deepEqual(one([0x91, 92, 127]), { deck: 1, action: 'syncOff' });
  assert.deepEqual(one([0x90, 96, 127]), { deck: 0, action: 'tempoRange' });
  assert.deepEqual(one([0x90, 64, 127]), { deck: 0, action: 'slip' });
  assert.deepEqual(one([0x91, 84, 127]), { deck: 1, action: 'headphones' });
  assert.deepEqual(one([0x96, 91, 127]), { action: 'masterCue' });
  assert.deepEqual(one([0x96, 66, 127]), { action: 'browseBack' });
  assert.deepEqual(one([0x94, 99, 127]), { deck: 0, action: 'fxReset' });
  assert.deepEqual(one([0x95, 101, 127]), { deck: 1, action: 'echoBeats', factor: 2 });
  const leds = new Map(sb3.leds([{ loaded: false, playing: false, loop: null, padMode: 'hotcue', pads: [false, false, false, false, false, false, false, false], fxOn: [], headphones: true, slip: true }], { masterCue: true })
    .map(([status, note, value]) => [`${status}:${note}`, value]));
  assert.equal(leds.get('144:84'), 127); assert.equal(leds.get('144:64'), 127); assert.equal(leds.get('150:91'), 127);
});
test('DECK 3/4 avisado por el canal del deck 1/2: los controles de ese lado pasan al deck 3/4', () => {
  const sb3 = createDDJSB3();
  assert.deepEqual(sb3.receive([0x90, 114, 0]), [{ action: 'layer', side: 0, deck: 2 }], 'DECK 3 apaga la capa 1');
  assert.deepEqual(sb3.receive([0x90, 11, 127]), [{ deck: 2, action: 'play' }]);
  assert.deepEqual(fader(sb3, 0xb0, 19, 127, 127), [{ deck: 2, action: 'range', target: 'volume', value: 1 }]);
  assert.deepEqual(sb3.receive([0x97, 0, 127]), [{ deck: 2, action: 'pad', mode: 'hotcue', pad: 0, shift: false, on: true }]);
  assert.deepEqual(fader(sb3, 0xb6, 23, 0, 0), [{ deck: 2, action: 'filter', value: -1 }], 'FILTER izquierdo');
  assert.deepEqual(sb3.receive([0x96, 70, 127]), [{ deck: 2, action: 'load' }], 'LOAD izquierdo');
  assert.deepEqual(sb3.receive([0x91, 11, 127]), [{ deck: 1, action: 'play' }], 'el lado derecho sigue en el deck 2');
  assert.deepEqual(sb3.layers(), [2, 1]);
  const deck = playing => ({ loaded: true, playing, loop: null, padMode: 'hotcue', pads: [false, false, false, false, false, false, false, false], fxOn: [] });
  const leds = new Map(sb3.leds([deck(false), deck(false), deck(true), deck(false)]).map(([status, note, value]) => [`${status}:${note}`, value]));
  assert.equal(leds.get('144:11'), 127, 'el PLAY izquierdo muestra el deck 3'); assert.equal(leds.get('146:11'), 127); assert.equal(leds.get('145:11'), 0);
  assert.deepEqual(sb3.receive([0x90, 114, 127]), [{ action: 'layer', side: 0, deck: 0 }], 'DECK 3 otra vez vuelve al deck 1');
  assert.deepEqual(sb3.receive([0x90, 11, 127]), [{ deck: 0, action: 'play' }]);
});

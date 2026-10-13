import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossfade, midiEvent, mappingKey, formatTime, loopRegion, loopPosition } from '../src/core.mjs';
test('loops calculados por beats, ajustados al final y rechazados si la pista es corta', () => {
  assert.deepEqual(loopRegion(10, 4, 120, 60), { start: 10, end: 12 });
  assert.deepEqual(loopRegion(59, 4, 120, 60), { start: 58, end: 60 });
  assert.equal(loopRegion(0, 16, 120, 2), null);
});
test('posición tras varias vueltas del loop', () => {
  assert.equal(loopPosition(9, { start: 10, end: 12 }), 9);
  assert.equal(loopPosition(12, { start: 10, end: 12 }), 10);
  assert.equal(loopPosition(16.5, { start: 10, end: 12 }), 10.5);
});
test('el crossfader mantiene potencia y respeta los extremos', () => {
  for (const position of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
    const [a, b] = crossfade(position); assert.ok(Math.abs(a * a + b * b - 1) < 1e-12);
  }
  assert.equal(crossfade(-2)[0], 1); assert.equal(crossfade(2)[1], 1);
});
test('MIDI distingue pulsación y liberación, incluso note-on con velocidad cero', () => {
  assert.equal(midiEvent([0x91, 60, 127]).pressed, true);
  assert.equal(midiEvent([0x91, 60, 0]).pressed, false);
  assert.equal(midiEvent([0x81, 60, 100]).value, 0);
  assert.equal(midiEvent([0xb3, 7, 64]).channel, 3);
  assert.equal(midiEvent([0xf8]), null); assert.equal(midiEvent([0xe0, 0, 1]), null);
});
test('los controles se identifican por dispositivo, tipo y canal', () => {
  const event = midiEvent([0xb0, 7, 64]);
  assert.notEqual(mappingKey(event, 'uno'), mappingKey(event, 'dos'));
  assert.notEqual(mappingKey(event, 'uno'), mappingKey({ ...event, channel: 1 }, 'uno'));
});
test('tiempos negativos y largos', () => {
  assert.equal(formatTime(-1), '00:00'); assert.equal(formatTime(125.8), '02:05'); assert.equal(formatTime(3600), '60:00');
});

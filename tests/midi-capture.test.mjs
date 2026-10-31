import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseMessage, createCapture } = require('../desktop/midi-capture.cjs');
const kinds = capture => Object.fromEntries(capture.summary().controls.map(control => [`${control.type}:${control.number}`, control.kind]));
test('interpreta notas, CC y pitch bend con canal desde 1', () => {
  assert.deepEqual(parseMessage([0x96, 0x0b, 0x7f]), { type: 'note', channel: 7, number: 11, value: 127 });
  assert.equal(parseMessage([0x80, 0x0b, 0x40]).value, 0);
  assert.deepEqual(parseMessage([0xe1, 0x00, 0x40]), { type: 'pitch', channel: 2, number: null, value: 8192 });
  assert.equal(parseMessage([0xf8]), null);
});
test('detecta pares de 14 bits, encoders relativos y botones', () => {
  const capture = createCapture();
  for (const value of [0, 40, 90, 127]) { capture.add('DDJ', [0xb0, 0x13, value]); capture.add('DDJ', [0xb0, 0x33, value]); }
  for (const value of [65, 66, 65, 63, 62, 63]) capture.add('DDJ', [0xb0, 0x22, value]);
  for (const value of [1, 1, 127, 127, 2, 126]) capture.add('DDJ', [0xb0, 0x40, value]);
  capture.add('DDJ', [0x90, 0x0b, 0x7f]); capture.add('DDJ', [0x90, 0x0b, 0x00]);
  for (const value of [0, 30, 100]) capture.add('DDJ', [0xb0, 0x05, value]);
  const result = kinds(capture);
  assert.match(result['cc:19'], /14 bits \(MSB/); assert.match(result['cc:51'], /LSB/);
  assert.equal(result['cc:34'], 'relativo (centro 64)');
  assert.equal(result['cc:64'], 'relativo (complemento a dos)');
  assert.equal(result['note:11'], 'botón');
  assert.equal(result['cc:5'], 'absoluto 7 bits');
});
test('etiqueta los controles con el paso guiado activo', () => {
  const capture = createCapture();
  capture.setLabel('Crossfader'); capture.add('DDJ', [0xb6, 0x1f, 10]);
  capture.setLabel(null); capture.add('DDJ', [0xb6, 0x1f, 20]);
  assert.deepEqual(capture.summary().controls[0].labels, ['Crossfader']);
  assert.equal(capture.summary().events.length, 2);
});
test('limita los eventos guardados por control sin perder los demás', () => {
  const capture = createCapture({ maxEventsPerControl: 3 });
  for (let index = 0; index < 10; index++) capture.add('DDJ', [0xb0, 0x21, 65]);
  capture.add('DDJ', [0x90, 0x0b, 0x7f]);
  const { controls, events } = capture.summary();
  assert.equal(events.length, 4); assert.equal(controls.find(control => control.type === 'cc').count, 10);
});

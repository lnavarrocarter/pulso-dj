import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { motionScore, energyTarget, interpretInstruction, generateSegment } from '../src/assistant-core.mjs';
const { checkPermission, requestPermission } = createRequire(import.meta.url)('../desktop/permissions.cjs');
test('movimiento: escena inmóvil y cambio de iluminación global no alteran la medida', () => {
  const frame = Uint8Array.from([50, 70, 80, 100]);
  assert.equal(motionScore(null, frame), 0); assert.equal(motionScore(frame, frame), 0);
  assert.equal(motionScore(frame, Uint8Array.from([70, 90, 100, 120])), 0);
  assert.ok(motionScore(frame, Uint8Array.from([100, 20, 30, 150])) > 0.9);
});
test('la indicación manual domina y la cámara tiene contribución acotada', () => {
  assert.equal(energyTarget(50), 50); assert.ok(energyTarget(50, 1) <= 65);
  assert.ok(energyTarget(50, 0) >= 42); assert.equal(energyTarget(100, 1), 100);
  assert.equal(interpretInstruction('SUBE energía', 95).energy, 100);
  assert.equal(interpretInstruction('algo suave', 10).energy, 0);
  assert.equal(interpretInstruction('mantener', 42).energy, 42);
  assert.equal(interpretInstruction('escribe cualquier canción', 50), null);
});
test('segmentos PCM WAV de duración exacta y muestras finitas dentro del rango', () => {
  for (const style of ['house', 'techno', 'ambient']) {
    const segment = generateSegment({ bpm: 120, bars: 1, sampleRate: 8000, style });
    assert.equal(segment.duration, 2); assert.equal(segment.samples.length, 16000);
    assert.equal(Buffer.from(segment.bytes.subarray(0, 4)).toString(), 'RIFF');
    assert.equal(new DataView(segment.bytes.buffer).getUint32(40, true), 32000);
    let peak = 0; for (const sample of segment.samples) { assert.ok(Number.isFinite(sample)); peak = Math.max(peak, Math.abs(sample)); }
    assert.ok(peak > 0.01 && peak <= 0.75);
  }
});
test('reproducibilidad, parámetros inválidos y variaciones del patrón', () => {
  const a = generateSegment({ bars: 1, sampleRate: 8000, seed: 10 });
  assert.deepEqual(a.bytes, generateSegment({ bars: 1, sampleRate: 8000, seed: 10 }).bytes);
  assert.notDeepEqual(a.bytes, generateSegment({ bars: 1, sampleRate: 8000, seed: 20 }).bytes);
  assert.throws(() => generateSegment({ style: 'unknown' })); assert.throws(() => generateSegment({ root: 1 }));
});
test('cámara solo habilitada explícitamente; micrófono y permisos desconocidos rechazados', () => {
  assert.equal(checkPermission('media', { mediaType: 'video' }, false), false);
  assert.equal(checkPermission('media', { mediaType: 'video' }, true), true);
  assert.equal(checkPermission('media', { mediaType: 'audio' }, true), false);
  assert.equal(requestPermission('media', { mediaTypes: ['video'] }, true), true);
  assert.equal(requestPermission('media', { mediaTypes: ['video', 'audio'] }, true), false);
  assert.equal(requestPermission('media', {}, true), false); assert.equal(checkPermission('geolocation', {}, true), false);
});
test('MIDI permitido aunque Chromium lo solicite como midiSysex', () => {
  for (const permission of ['midi', 'midiSysex']) {
    assert.equal(checkPermission(permission, {}, false), true); assert.equal(requestPermission(permission, {}, false), true);
  }
});

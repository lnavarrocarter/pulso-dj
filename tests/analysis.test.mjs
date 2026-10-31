import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTempo } from '../src/analysis.mjs';
const RATE = 44100;
// Kick on every beat, hi-hat on the off-beats, a little noise: a minimal dance pattern.
function pattern(bpm, seconds, offset = 0, seed = 7) {
  const samples = new Float32Array(Math.floor(seconds * RATE)), period = 60 / bpm;
  let random = seed;
  for (let i = 0; i < samples.length; i++) { random = (random * 16807) % 2147483647; samples[i] = (random / 2147483647 - 0.5) * 0.01; }
  for (let beat = offset; beat < seconds; beat += period / 2) {
    const kick = Math.round((beat - offset) / period * 2) % 2 === 0, start = Math.floor(beat * RATE);
    for (let i = 0; i < 0.12 * RATE && start + i < samples.length; i++) {
      const t = i / RATE;
      samples[start + i] += kick ? Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-t * 30)) * t) * Math.exp(-t * 18) * 0.8 : (Math.random() - 0.5) * Math.exp(-t * 60) * 0.25;
    }
  }
  return samples;
}
const beatError = (offset, expected, bpm) => { const period = 60 / bpm, d = Math.abs(offset - expected) % period; return Math.min(d, period - d); };
for (const bpm of [92, 124, 128, 140]) {
  test(`detecta ${bpm} BPM y la posición de los beats`, () => {
    const result = detectTempo(pattern(bpm, 90, 0.31), RATE);
    assert.ok(Math.abs(result.bpm - bpm) < 0.3, `bpm ${result.bpm}`);
    assert.ok(beatError(result.offset, 0.31, bpm) < 0.025, `offset ${result.offset}`);
    assert.ok(result.confidence > 0.2, `confianza ${result.confidence}`);
  });
}
test('una pista sin ritmo da poca confianza', () => {
  const samples = new Float32Array(30 * RATE); let random = 3;
  for (let i = 0; i < samples.length; i++) { random = (random * 16807) % 2147483647; samples[i] = (random / 2147483647 - 0.5) * 0.2; }
  assert.ok(detectTempo(samples, RATE).confidence < 0.2);
});
test('una pista demasiado corta no da tempo', () => {
  assert.equal(detectTempo(new Float32Array(RATE), RATE).bpm, null);
});

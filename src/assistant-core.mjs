import { clamp } from './core.mjs';
export function motionScore(previous, current) {
  if (!previous || previous.length !== current.length || !current.length) return 0;
  let drift = 0;
  for (let i = 0; i < current.length; i++) drift += current[i] - previous[i];
  drift /= current.length;
  let changed = 0;
  for (let i = 0; i < current.length; i++) if (Math.abs(current[i] - previous[i] - drift) > 18) changed++;
  return changed / current.length;
}
export function energyTarget(manual, motion = null) {
  const adjustment = motion === null ? 0 : clamp((motion - 0.15) * 30, -8, 15);
  return clamp(manual + adjustment, 0, 100);
}
export function interpretInstruction(text, current) {
  const value = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/\b(sube|subir|aumenta|mas energia)\b/.test(value)) return { energy: clamp(current + 15, 0, 100), message: 'Subir energía en 15 puntos.' };
  if (/\b(baja|bajar|relaja|suave|menos energia)\b/.test(value)) return { energy: clamp(current - 15, 0, 100), message: 'Bajar energía en 15 puntos.' };
  if (/\b(mantener|mantiene|mantener energia)\b/.test(value)) return { energy: current, message: 'Mantener la energía indicada.' };
  return null;
}
export function generateSegment({ bpm = 120, energy = 50, style = 'house', root = 0, bars = 4, seed = 17, sampleRate = 44100 } = {}) {
  bpm = clamp(Number.isFinite(bpm) ? bpm : 120, 60, 180);
  energy = clamp(energy, 0, 100) / 100; bars = clamp(Math.round(bars), 1, 8);
  if (!['house', 'techno', 'ambient'].includes(style)) throw new Error('Estilo no válido');
  if (![0, 2, 5, 7, 9].includes(root)) throw new Error('Tonalidad no válida');
  const beat = 60 / bpm, duration = bars * 4 * beat;
  const frames = Math.round(duration * sampleRate), samples = new Float32Array(frames);
  let random = Math.abs(Math.floor(seed)) % 2147483647 || 17;
  const noise = () => { random = random * 16807 % 2147483647; return random / 2147483647 * 2 - 1; };
  const add = (start, length, render) => {
    const offset = Math.round(start * sampleRate), count = Math.round(length * sampleRate);
    for (let i = 0; i < count; i++) samples[(offset + i) % frames] += render(i / sampleRate, i / count);
  };
  const frequency = semitone => 65.4064 * 2 ** ((root + semitone) / 12);
  for (let step = 0; step < bars * 16; step++) {
    const time = step * beat / 4;
    if (style !== 'ambient' && step % 4 === 0) add(time, 0.24, t => Math.sin(2 * Math.PI * (48 * t + 18 * (1 - Math.exp(-t * 35)) / 35)) * Math.exp(-t * 20) * (0.35 + energy * 0.12));
    if (style !== 'ambient' && (step % 4 === 2 || energy > 0.7)) add(time, 0.045, t => noise() * Math.exp(-t * 100) * (0.04 + energy * 0.045));
    if (style !== 'ambient' && step % 8 === 4) add(time, 0.1, t => noise() * Math.exp(-t * 45) * 0.065);
    if (style !== 'ambient' && step % (style === 'techno' ? 2 : 4) === (style === 'techno' ? 1 : 2)) {
      const note = [0, 0, 7, 10][Math.floor(step / 4) % 4], f = frequency(note);
      add(time, beat * 0.42, (t, fraction) => Math.sin(2 * Math.PI * f * t) * Math.sin(Math.PI * fraction) ** 2 * (0.12 + energy * 0.09));
    }
  }
  // Periodic harmonics avoid discontinuities at the loop boundary.
  const harmonics = [0, 3, 7].map(note => Math.round(frequency(note + 12) * duration));
  for (let i = 0; i < frames; i++) {
    const phase = i / frames;
    const pad = harmonics.reduce((sum, harmonic) => sum + Math.sin(2 * Math.PI * harmonic * phase), 0) / 3;
    samples[i] = Math.tanh((samples[i] + pad * (style === 'ambient' ? 0.23 : 0.045)) * 1.2) * 0.75;
  }
  const bytes = new Uint8Array(44 + frames * 2), view = new DataView(bytes.buffer);
  const text = (offset, string) => [...string].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 2, true);
  for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, Math.round(samples[i] * 32767), true);
  return { name: `Pulso ${style} ${bpm.toFixed(1)} BPM`, format: 'wav', bytes, samples, sampleRate, bpm, duration, bars };
}

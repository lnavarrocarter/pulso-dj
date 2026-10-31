// Tempo and beat grid of a track, for SYNC and the Auto DJ. Works on one minute from the body of the track:
// an onset envelope (rises in energy every ~11 ms) is matched against beat combs from 70 to 180 BPM.
const HOP = 512;
const MIN_BPM = 70, MAX_BPM = 180;
// Dance music sits around 100-130 BPM; the prior settles half/double tempo ambiguity toward that range.
const prior = bpm => Math.exp(-0.5 * (Math.log2(bpm / 115) / 0.6) ** 2);
function onsets(samples, from, to) {
  const frames = Math.floor((to - from) / HOP), envelope = new Float32Array(frames);
  let previous = 0;
  for (let f = 0; f < frames; f++) {
    let energy = 0;
    for (let i = from + f * HOP, end = i + HOP; i < end; i++) energy += samples[i] * samples[i];
    const level = Math.log1p(energy * 100);
    envelope[f] = Math.max(0, level - previous); previous = level;
  }
  let mean = 0; for (const value of envelope) mean += value; mean /= frames || 1;
  for (let f = 0; f < frames; f++) envelope[f] = Math.max(0, envelope[f] - mean);
  return envelope;
}
// Best phase (in frames) of a beat comb with the given period, and its mean onset strength.
function comb(envelope, period) {
  let best = 0, bestPhase = 0;
  for (let phase = 0; phase < period; phase++) {
    let sum = 0, count = 0;
    for (let position = phase; position < envelope.length - 1; position += period) {
      const i = Math.floor(position), fraction = position - i;
      sum += envelope[i] * (1 - fraction) + envelope[i + 1] * fraction; count++;
    }
    if (count && sum / count > best) { best = sum / count; bestPhase = phase; }
  }
  return { score: best, phase: bestPhase };
}
// samples: one channel; returns { bpm, offset: time of a beat in seconds, from the start of the track, confidence 0-1 }.
export function detectTempo(samples, sampleRate) {
  const length = samples.length, window = Math.min(length, 60 * sampleRate);
  const from = length > window ? Math.floor(Math.min(length * 0.25, length - window)) : 0;
  const envelope = onsets(samples, from, from + window);
  const framesPerSecond = sampleRate / HOP;
  if (envelope.length < framesPerSecond * 4) return { bpm: null, offset: 0, confidence: 0 };
  const score = bpm => comb(envelope, 60 / bpm * framesPerSecond);
  let best = { bpm: 120, value: -Infinity, phase: 0, raw: 0 };
  const raws = [];
  const consider = bpm => { const { score: raw, phase } = score(bpm), value = raw * prior(bpm); raws.push(raw); if (value > best.value) best = { bpm, value, phase, raw }; };
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) consider(bpm);
  // Confidence: how far the chosen tempo stands above a typical tempo (the median of the coarse search).
  const median = raws.slice().sort((a, b) => a - b)[raws.length >> 1];
  const coarse = best.bpm;
  for (let bpm = coarse - 0.5; bpm <= coarse + 0.5; bpm += 0.02) consider(bpm);
  const period = 60 / best.bpm, beat = from / sampleRate + best.phase / framesPerSecond;
  return {
    bpm: Math.round(best.bpm * 100) / 100,
    offset: ((beat % period) + period) % period,
    confidence: median > 0 ? Math.max(0, Math.min(1, (best.raw / median - 1) / 2)) : 0
  };
}

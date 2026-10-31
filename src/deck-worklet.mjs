// Deck playback engine, run on the audio thread. It plays the decoded track at any speed, backwards too
// while scratching, and with key lock it changes the tempo without changing the pitch (WSOLA time stretch).
const FRAME = 2048, HOP = FRAME / 2; // stretch frame and hop: 43 ms / 21 ms at 48 kHz
const SEARCH = 384, STRIDE = 4; // how far a frame may shift to line up with the previous one, and correlation stride
const hann = Float32Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FRAME)); // sums to 1 at 50 % overlap
const SMOOTH = 1 - Math.exp(-1 / (0.008 * sampleRate)); // speed changes glide over ~8 ms, like a platter, instead of clicking
const SCRATCH_LAG = 0.02 * sampleRate; // the record follows the hand with 20 ms of inertia
class DeckPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = null; this.length = 0; this.position = 0; this.speed = 0; this.rate = 1;
    this.playing = false; this.keylock = false; this.loop = null; this.scratch = null; this.sequence = 0; this.blocks = 0;
    this.ready = [new Float32Array(HOP), new Float32Array(HOP)]; this.tail = [new Float32Array(HOP), new Float32Array(HOP)];
    this.resetStretch();
    this.port.onmessage = ({ data }) => this.command(data);
  }
  // Position-changing commands carry a sequence number; reports echo it so the page drops stale ones.
  command(message) {
    if (message.sequence !== undefined) this.sequence = message.sequence;
    switch (message.type) {
      case 'load': this.channels = message.channels; this.length = message.channels[0].length; this.playing = false; this.loop = null; this.seek(0); break;
      case 'play': this.playing = message.on; this.seek(message.position); if (message.on) this.speed = this.rate; break;
      case 'seek': this.seek(message.position); break;
      case 'rate': this.rate = message.value; break;
      case 'keylock': this.keylock = message.on; this.resetStretch(); break;
      case 'loop': this.loop = message.loop && { start: message.loop.start * sampleRate, end: message.loop.end * sampleRate }; break;
      case 'scratch':
        if (message.on) this.scratch = { target: this.position };
        else { this.scratch = null; this.resetStretch(); this.report(); }
        break;
      case 'move': if (this.scratch) this.scratch.target = Math.max(0, Math.min(this.length, this.scratch.target + message.seconds * sampleRate)); break;
    }
  }
  seek(seconds) { this.position = Math.max(0, Math.min(this.length, seconds * sampleRate)); this.resetStretch(); }
  resetStretch() { this.previous = null; this.readIndex = HOP; for (const tail of this.tail) tail.fill(0); }
  wrap(position) {
    const loop = this.loop;
    return loop && position >= loop.end ? loop.start + (position - loop.start) % (loop.end - loop.start) : position;
  }
  sample(channel, index) {
    const data = this.channels[Math.min(channel, this.channels.length - 1)];
    const i = this.loop && index >= this.loop.end ? Math.floor(this.wrap(index)) : index;
    return i >= 0 && i < this.length ? data[i] : 0;
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    if (this.channels && (this.playing || this.scratch)) {
      if (this.keylock && !this.scratch && this.rate > 0) this.stretch(out); else this.resample(out);
      if (this.position >= this.length && !this.loop) { this.playing = false; this.scratch = null; this.position = this.length; this.port.postMessage({ type: 'ended', sequence: this.sequence }); }
      else if (++this.blocks % 4 === 0) this.report();
    }
    return true;
  }
  report() {
    // What is heard lags the read position by the stretch output still queued.
    const queued = this.keylock && !this.scratch ? (HOP - this.readIndex) * this.rate : 0;
    this.port.postMessage({ type: 'position', position: Math.max(0, this.position - queued) / sampleRate, time: currentTime + 128 / sampleRate, sequence: this.sequence });
  }
  // Varispeed: reads between samples at the current speed. Scratching steers the speed toward the hand position.
  resample(out) {
    const frames = out[0].length;
    for (let n = 0; n < frames; n++) {
      const goal = this.scratch ? Math.max(-4, Math.min(4, (this.scratch.target - this.position) / SCRATCH_LAG)) : this.rate;
      this.speed += (goal - this.speed) * SMOOTH;
      const i = Math.floor(this.position), fraction = this.position - i;
      for (let c = 0; c < out.length; c++) { const a = this.sample(c, i); out[c][n] = a + (this.sample(c, i + 1) - a) * fraction; }
      this.position = Math.max(0, this.wrap(this.position + this.speed));
    }
  }
  stretch(out) {
    const frames = out[0].length;
    for (let n = 0; n < frames; n++) {
      if (this.readIndex >= HOP) this.synthesize();
      for (let c = 0; c < out.length; c++) out[c][n] = this.ready[c][this.readIndex];
      this.readIndex++;
    }
    this.speed = this.rate;
  }
  // WSOLA: each new frame is taken from near the read position, shifted to the offset that best continues the
  // previous frame, then overlap-added with a Hann window. The read position advances by HOP × tempo.
  synthesize() {
    let start = Math.round(this.position);
    if (this.previous !== null) {
      const natural = this.previous + HOP;
      let best = 0, bestScore = -Infinity;
      const score = offset => {
        let dot = 0, energy = 1e-9;
        for (let i = 0; i < HOP; i += STRIDE) { const x = this.sample(0, start + offset + i); dot += x * this.sample(0, natural + i); energy += x * x; }
        return dot / Math.sqrt(energy);
      };
      for (let offset = -SEARCH; offset <= SEARCH; offset += STRIDE) { const value = score(offset); if (value > bestScore) { bestScore = value; best = offset; } }
      for (let offset = best - STRIDE + 1; offset < best + STRIDE; offset++) { const value = score(offset); if (value > bestScore) { bestScore = value; best = offset; } }
      start += best;
    }
    for (let c = 0; c < 2; c++) {
      const ready = this.ready[c], tail = this.tail[c];
      for (let i = 0; i < HOP; i++) {
        ready[i] = tail[i] + this.sample(c, start + i) * hann[i];
        tail[i] = this.sample(c, start + HOP + i) * hann[HOP + i];
      }
    }
    this.previous = start; this.readIndex = 0;
    this.position = this.wrap(this.position + HOP * this.rate);
  }
}
registerProcessor('deck-player', DeckPlayer);

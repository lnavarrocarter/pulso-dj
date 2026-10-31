import { clamp, crossfade, loopRegion, loopPosition } from './core.mjs';
export class Deck {
  constructor(context, destination) {
    this.context = context;
    this.buffer = null;
    this.source = null;
    this.offset = 0;
    this.startedAt = 0;
    this.rate = 1;
    this.bendAmount = 0;
    this.cue = 0;
    this.hotCues = [null, null, null, null];
    this.bpm = 120;
    this.loop = null;
    this.loopBeats = 4;
    this.gain = context.createGain();
    this.mix = context.createGain();
    this.filters = ['lowshelf', 'peaking', 'highshelf'].map((type, i) => {
      const filter = context.createBiquadFilter();
      filter.type = type; filter.frequency.value = [200, 1000, 5000][i]; filter.Q.value = 0.7;
      return filter;
    });
    this.filters[0].connect(this.filters[1]); this.filters[1].connect(this.filters[2]);
    this.fxFilter = context.createBiquadFilter(); this.fxFilter.type = 'lowpass'; this.fxFilter.frequency.value = 20000;
    this.shaper = context.createWaveShaper(); this.shaper.oversample = '2x';
    this.dry = context.createGain(); this.echoWet = context.createGain(); this.reverbWet = context.createGain();
    this.delay = context.createDelay(2); this.feedback = context.createGain(); this.feedback.gain.value = 0.32;
    this.delay.delayTime.value = 0.25; this.echoWet.gain.value = 0; this.reverbWet.gain.value = 0;
    this.reverb = context.createConvolver();
    const impulse = context.createBuffer(2, Math.floor(context.sampleRate * 1.5), context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const samples = impulse.getChannelData(channel);
      let seed = 17 + channel;
      for (let i = 0; i < samples.length; i++) {
        seed = (seed * 16807) % 2147483647;
        samples[i] = (seed / 2147483647 * 2 - 1) * Math.pow(1 - i / samples.length, 3);
      }
    }
    this.reverb.buffer = impulse;
    this.filters[2].connect(this.fxFilter); this.fxFilter.connect(this.shaper);
    this.shaper.connect(this.dry); this.dry.connect(this.gain);
    this.shaper.connect(this.delay); this.delay.connect(this.feedback); this.feedback.connect(this.delay);
    this.delay.connect(this.echoWet); this.echoWet.connect(this.gain);
    this.shaper.connect(this.reverb); this.reverb.connect(this.reverbWet); this.reverbWet.connect(this.gain);
    this.gain.connect(this.mix); this.mix.connect(destination);
    this.meter = context.createAnalyser(); this.meter.fftSize = 256; this.gain.connect(this.meter);
    this.meterSamples = new Float32Array(this.meter.fftSize);
  }
  get playing() { return this.source !== null; }
  get duration() { return this.buffer?.duration || 0; }
  get speed() { return this.rate * (1 + this.bendAmount); }
  get position() {
    return clamp(loopPosition(this.offset + (this.playing ? (this.context.currentTime - this.startedAt) * this.speed : 0), this.loop), 0, this.duration);
  }
  // Post-fader peak level of this channel, 0-1, for the mixer meters.
  get level() {
    this.meter.getFloatTimeDomainData(this.meterSamples);
    let peak = 0; for (const sample of this.meterSamples) peak = Math.max(peak, Math.abs(sample));
    return peak;
  }
  async load(bytes) {
    const decoded = await this.context.decodeAudioData(bytes.slice(0));
    if (decoded.duration > 20 * 60) throw new Error('Máximo 20 minutos por pista en esta versión');
    this.pause(); this.disableLoop(); this.buffer = decoded; this.offset = 0; this.cue = 0;
    this.hotCues = [null, null, null, null];
  }
  async play() {
    if (!this.buffer) return;
    await this.context.resume();
    if (this.playing) return;
    if (this.offset >= this.duration) this.offset = 0;
    const source = this.context.createBufferSource();
    source.buffer = this.buffer; source.playbackRate.value = this.speed;
    if (this.loop) { source.loop = true; source.loopStart = this.loop.start; source.loopEnd = this.loop.end; }
    source.connect(this.filters[0]); this.startedAt = this.context.currentTime; this.source = source;
    source.onended = () => {
      if (this.source === source) { this.source = null; this.offset = this.duration; }
      source.disconnect();
    };
    source.start(0, this.offset);
  }
  pause() {
    this.offset = this.position;
    const source = this.source; this.source = null;
    if (source) { source.onended = null; source.stop(); source.disconnect(); }
  }
  async seek(seconds) {
    const resume = this.playing; this.pause(); this.disableLoop(); this.offset = clamp(seconds, 0, this.duration);
    if (resume && this.offset < this.duration) await this.play();
  }
  setRate(value) {
    this.offset = this.position; this.startedAt = this.context.currentTime;
    this.rate = clamp(value, 0.84, 1.16);
    if (this.source) this.source.playbackRate.setValueAtTime(this.speed, this.context.currentTime);
  }
  // Temporary speed offset for jog nudges; the tempo fader rate is kept underneath.
  bend(amount) {
    this.offset = this.position; this.startedAt = this.context.currentTime;
    this.bendAmount = clamp(amount, -0.5, 0.5);
    if (this.source) this.source.playbackRate.setValueAtTime(this.speed, this.context.currentTime);
  }
  // Moves a paused deck without touching its loop, unlike seek().
  scrub(seconds) { if (this.buffer && !this.playing) this.offset = clamp(this.position + seconds, 0, this.duration); }
  setVolume(value) { this.gain.gain.setTargetAtTime(clamp(value, 0, 1), this.context.currentTime, 0.01); }
  setEQ(index, value) { this.filters[index].gain.setTargetAtTime(clamp(value, -24, 12), this.context.currentTime, 0.01); }
  setBpm(value) {
    this.bpm = clamp(value, 40, 240);
    this.delay.delayTime.setTargetAtTime(30 / this.bpm, this.context.currentTime, 0.02);
  }
  enableLoop(beats = this.loopBeats) {
    if (!this.buffer) return false;
    const position = this.position;
    const region = loopRegion(position, beats, this.bpm, this.duration);
    if (!region) return false;
    this.offset = position; this.startedAt = this.context.currentTime;
    this.loop = region; this.loopBeats = beats;
    if (this.source) { this.source.loopStart = region.start; this.source.loopEnd = region.end; this.source.loop = true; }
    return true;
  }
  disableLoop() {
    this.offset = this.position; this.startedAt = this.context.currentTime;
    this.loop = null;
    if (this.source) this.source.loop = false;
  }
  async triggerHotCue(index, clear = false) {
    if (!this.buffer) return;
    if (clear) { this.hotCues[index] = null; return; }
    if (this.hotCues[index] === null) { this.hotCues[index] = this.position; return; }
    await this.seek(this.hotCues[index]); await this.play();
  }
  setFX(name, value) {
    const amount = clamp(value, 0, 1), time = this.context.currentTime;
    if (name === 'echo') this.echoWet.gain.setTargetAtTime(amount * 0.55, time, 0.02);
    if (name === 'reverb') this.reverbWet.gain.setTargetAtTime(amount * 0.5, time, 0.02);
    if (name === 'filter') this.fxFilter.frequency.setTargetAtTime(20000 * Math.pow(0.01, amount), time, 0.02);
    if (name === 'drive') {
      if (amount === 0) { this.shaper.curve = null; return; }
      const curve = new Float32Array(2048), strength = 1 + amount * 10;
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i * 2 / (curve.length - 1) - 1) * strength) / Math.tanh(strength);
      this.shaper.curve = curve;
    }
  }
}
export class Mixer {
  constructor() {
    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.context.createGain(); this.master.gain.value = 0.7;
    this.limiter = this.context.createDynamicsCompressor();
    this.limiter.threshold.value = -3; this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20; this.limiter.attack.value = 0.003; this.limiter.release.value = 0.15;
    this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 512;
    this.master.connect(this.limiter); this.limiter.connect(this.analyser); this.analyser.connect(this.context.destination);
    this.decks = [0, 1, 2, 3].map(() => new Deck(this.context, this.master));
    // Crossfader side per channel, as on the hardware: decks 1 and 3 on A, 2 and 4 on B.
    this.assign = ['A', 'B', 'A', 'B'];
    this.setCrossfade(0.5);
  }
  setCrossfade(value) {
    this.crossfade = value;
    const [a, b] = crossfade(value);
    this.decks.forEach((deck, i) => deck.mix.gain.setTargetAtTime({ A: a, B: b }[this.assign[i]] ?? 1, this.context.currentTime, 0.01));
  }
  setAssign(index, side) { this.assign[index] = side; this.setCrossfade(this.crossfade); }
  setMaster(value) { this.master.gain.setTargetAtTime(clamp(value, 0, 1), this.context.currentTime, 0.01); }
}

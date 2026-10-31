import { clamp, crossfade, loopRegion, loopPosition } from './core.mjs';
import { detectTempo } from './analysis.mjs';
const PEAKS = 400; // waveform overview resolution
export const HOT_CUES = 8;
function overview(samples) {
  const peaks = new Float32Array(PEAKS);
  for (let i = 0; i < PEAKS; i++) {
    const start = Math.floor(i * samples.length / PEAKS), end = Math.floor((i + 1) * samples.length / PEAKS);
    for (let s = start; s < end; s += Math.max(1, Math.floor((end - start) / 100))) peaks[i] = Math.max(peaks[i], Math.abs(samples[s]));
  }
  return peaks;
}
// A deck plays through the 'deck-player' worklet (deck-worklet.mjs); this class keeps the transport state on the page.
// `ready` is the worklet module promise; without it (offline effect tests) the deck only builds its effect chain.
export class Deck {
  constructor(context, destination, ready = null) {
    this.context = context;
    this.buffer = null; // { duration, sampleRate, numberOfChannels } of the loaded track
    this.peaks = null;
    this.node = null;
    this.isPlaying = false;
    this.scratching = false;
    this.keylock = false;
    this.sequence = 0;
    this.clock = { position: 0, time: 0 }; // last known position and the audio time it was true
    this.rate = 1;
    this.bendAmount = 0;
    this.cue = 0;
    this.hotCues = Array(HOT_CUES).fill(null);
    this.bpm = 120;
    this.beatOffset = 0; // time of a beat, in seconds; with bpm it gives the beat grid
    this.tempoConfidence = 0; // 0-1, from the tempo analysis
    this.range = 0.16; // tempo fader range, ±16 %
    this.loop = null;
    this.lastLoop = null;
    this.loopBeats = 4;
    this.loopIn = null;
    this.echoBeats = 0.5;
    this.headphones = false;
    this.trim = context.createGain();
    this.gain = context.createGain();
    this.mix = context.createGain();
    this.filters = ['lowshelf', 'peaking', 'highshelf'].map((type, i) => {
      const filter = context.createBiquadFilter();
      filter.type = type; filter.frequency.value = [200, 1000, 5000][i]; filter.Q.value = 0.7;
      return filter;
    });
    this.trim.connect(this.filters[0]); this.filters[0].connect(this.filters[1]); this.filters[1].connect(this.filters[2]);
    // FILTER knob: left of centre closes the low-pass, right of centre opens the high-pass.
    this.fxFilter = context.createBiquadFilter(); this.fxFilter.type = 'lowpass'; this.fxFilter.frequency.value = 20000;
    this.highPass = context.createBiquadFilter(); this.highPass.type = 'highpass'; this.highPass.frequency.value = 10;
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
    // Pad effects (FX FADE, TRANS, pad scratch cuts) get their own filter and level so they never move the knobs.
    this.padFilter = context.createBiquadFilter(); this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 22000;
    this.padGain = context.createGain();
    this.filters[2].connect(this.fxFilter); this.fxFilter.connect(this.highPass); this.highPass.connect(this.padFilter);
    this.padFilter.connect(this.padGain); this.padGain.connect(this.shaper);
    // post: the channel before its fader. It feeds the fader and, when CUE is on, the headphones.
    this.post = context.createGain(); this.cueSend = context.createGain(); this.cueSend.gain.value = 0;
    this.shaper.connect(this.dry); this.dry.connect(this.post);
    this.shaper.connect(this.delay); this.delay.connect(this.feedback); this.feedback.connect(this.delay);
    this.delay.connect(this.echoWet); this.echoWet.connect(this.post);
    this.shaper.connect(this.reverb); this.reverb.connect(this.reverbWet); this.reverbWet.connect(this.post);
    this.post.connect(this.gain); this.post.connect(this.cueSend);
    this.gain.connect(this.mix); this.mix.connect(destination);
    this.meter = context.createAnalyser(); this.meter.fftSize = 256; this.gain.connect(this.meter);
    this.meterSamples = new Float32Array(this.meter.fftSize);
    this.ready = ready ? ready.then(() => this.attach()) : Promise.resolve();
  }
  attach() {
    this.node = new AudioWorkletNode(this.context, 'deck-player', { numberOfInputs: 0, outputChannelCount: [2] });
    this.node.connect(this.trim);
    this.node.port.onmessage = ({ data }) => {
      if (data.sequence !== this.sequence) return; // sent before the latest seek, play or pause
      if (data.type === 'ended') { this.isPlaying = false; this.clock = { position: this.duration, time: this.context.currentTime }; }
      else this.clock = { position: data.position, time: data.time };
    };
    this.send({ type: 'rate', value: this.speed }); this.send({ type: 'keylock', on: this.keylock });
  }
  send(message, transfer = []) { this.node?.port.postMessage(message, transfer); }
  // Commands that move the playhead start a new sequence and set the clock here, so the page never waits for the audio thread.
  move(type, position, extra = {}) {
    this.sequence++; this.clock = { position, time: this.context.currentTime };
    this.send({ type, position, sequence: this.sequence, ...extra });
  }
  get playing() { return this.isPlaying; }
  get duration() { return this.buffer?.duration || 0; }
  get speed() { return this.rate * (1 + this.bendAmount); }
  get position() {
    const moving = this.isPlaying && !this.scratching;
    const position = this.clock.position + (moving ? Math.max(0, this.context.currentTime - this.clock.time) * this.speed : 0);
    return clamp(loopPosition(position, this.loop), 0, this.duration);
  }
  // Post-fader peak level of this channel, 0-1, for the mixer meters.
  get level() {
    this.meter.getFloatTimeDomainData(this.meterSamples);
    let peak = 0; for (const sample of this.meterSamples) peak = Math.max(peak, Math.abs(sample));
    return peak;
  }
  async load(bytes) {
    await this.ready;
    const decoded = await this.context.decodeAudioData(bytes.slice(0));
    if (decoded.duration > 20 * 60) throw new Error('Máximo 20 minutos por pista en esta versión');
    this.pause(); this.disableLoop(); this.loopIn = null; this.cue = 0;
    this.hotCues = Array(HOT_CUES).fill(null); this.lastLoop = null;
    this.buffer = { duration: decoded.duration, sampleRate: decoded.sampleRate, numberOfChannels: decoded.numberOfChannels };
    this.peaks = overview(decoded.getChannelData(0));
    const tempo = detectTempo(decoded.getChannelData(0), decoded.sampleRate);
    this.tempoConfidence = tempo.confidence; this.beatOffset = tempo.offset;
    if (tempo.bpm) this.setBpm(tempo.bpm);
    // The samples move to the audio thread; the decoded buffer is then released.
    const channels = Array.from({ length: Math.min(2, decoded.numberOfChannels) }, (_, c) => decoded.getChannelData(c).slice());
    this.sequence++; this.clock = { position: 0, time: this.context.currentTime };
    this.send({ type: 'load', channels, sequence: this.sequence }, channels.map(channel => channel.buffer));
  }
  async play() {
    if (!this.buffer) return;
    if (!(this.context instanceof OfflineAudioContext)) await this.context.resume();
    if (this.playing) return;
    const position = this.position >= this.duration ? 0 : this.position;
    this.isPlaying = true; this.move('play', position, { on: true });
  }
  pause() {
    if (!this.isPlaying) return;
    const position = this.position; this.isPlaying = false;
    this.move('play', position, { on: false });
  }
  async seek(seconds) {
    this.disableLoop(); this.move('seek', clamp(seconds, 0, this.duration));
    if (this.playing && this.position >= this.duration) this.pause();
  }
  setRate(value) {
    this.clock = { position: this.position, time: this.context.currentTime };
    this.rate = clamp(value, 1 - this.range, 1 + this.range); this.send({ type: 'rate', value: this.speed });
  }
  // SHIFT + KEYLOCK cycles the tempo fader range, as on the hardware.
  setRange(range) { this.range = range; this.setRate(this.rate); }
  // Temporary speed offset for jog nudges; the tempo fader rate is kept underneath.
  bend(amount) {
    this.clock = { position: this.position, time: this.context.currentTime };
    this.bendAmount = clamp(amount, -0.5, 0.5); this.send({ type: 'rate', value: this.speed });
  }
  // Key lock: tempo changes keep the original pitch.
  setKeylock(on) { this.keylock = Boolean(on); this.send({ type: 'keylock', on: this.keylock }); }
  // Moves a paused deck silently without touching its loop, unlike seek().
  scrub(seconds) { if (this.buffer && !this.playing) this.move('seek', clamp(this.position + seconds, 0, this.duration)); }
  // Scratch: while the hand is on the platter the record follows it, forwards or backwards, and is heard.
  scratch(on) {
    if (!this.buffer || this.scratching === on) return;
    this.clock = { position: this.position, time: this.context.currentTime };
    this.scratching = on; this.send({ type: 'scratch', on });
  }
  scratchMove(seconds) { if (this.scratching) this.send({ type: 'move', seconds }); }
  setTrim(value) { this.trim.gain.setTargetAtTime(Math.pow(10, clamp(value, -24, 12) / 20), this.context.currentTime, 0.01); }
  setVolume(value) { this.gain.gain.setTargetAtTime(clamp(value, 0, 1), this.context.currentTime, 0.01); }
  setEQ(index, value) { this.filters[index].gain.setTargetAtTime(clamp(value, -24, 12), this.context.currentTime, 0.01); }
  setBpm(value) { this.bpm = clamp(value, 40, 240); this.setEchoBeats(this.echoBeats); }
  // Where the playhead is in the beat: 0 on a beat, rising to 1 just before the next one.
  get beatPhase() { const period = 60 / this.bpm; return ((((this.position - this.beatOffset) / period) % 1) + 1) % 1; }
  // First beat at or after `seconds`.
  nextBeat(seconds) { const period = 60 / this.bpm; return this.beatOffset + Math.ceil((seconds - this.beatOffset - 1e-6) / period) * period; }
  // Echo time in beats (FX BEAT ◄ / ►): 1/8 to 2 beats.
  setEchoBeats(beats) {
    this.echoBeats = clamp(beats, 0.125, 2);
    this.delay.delayTime.setTargetAtTime(Math.min(2, this.echoBeats * 60 / this.bpm), this.context.currentTime, 0.02);
  }
  setHeadphones(on) { this.headphones = Boolean(on); this.cueSend.gain.setTargetAtTime(this.headphones ? 1 : 0, this.context.currentTime, 0.01); }
  // FX FADE: over `seconds` the high-pass (or low-pass) closes and the level falls; null returns to normal at once.
  padFade(type, seconds) {
    const time = this.context.currentTime, frequency = this.padFilter.frequency, level = this.padGain.gain;
    frequency.cancelScheduledValues(time); level.cancelScheduledValues(time);
    if (!type) { this.padFilter.type = 'lowpass'; frequency.setValueAtTime(22000, time); level.setTargetAtTime(1, time, 0.01); return; }
    this.padFilter.type = type;
    frequency.setValueAtTime(type === 'highpass' ? 10 : 22000, time);
    frequency.exponentialRampToValueAtTime(type === 'highpass' ? 3000 : 250, time + seconds);
    level.setValueAtTime(level.value, time); level.linearRampToValueAtTime(0, time + seconds);
  }
  // TRANS: chops the level on and off every `period` seconds while held; null stops.
  padGate(period) {
    const time = this.context.currentTime, level = this.padGain.gain;
    level.cancelScheduledValues(time); level.setTargetAtTime(1, time, 0.003);
    if (!period) return;
    for (let at = time; at < time + 30; at += period) { level.setTargetAtTime(1, at, 0.002); level.setTargetAtTime(0, at + period / 2, 0.002); }
  }
  // Pad scratch cuts the sound like a crossfader during part of each stroke.
  setPadLevel(value) { this.padGain.gain.setTargetAtTime(value, this.context.currentTime, 0.003); }
  enableLoop(beats = this.loopBeats) {
    if (!this.buffer) return false;
    const position = this.position;
    const region = loopRegion(position, beats, this.bpm, this.duration);
    if (!region) return false;
    this.loopBeats = beats; this.setLoop(region);
    return true;
  }
  disableLoop() { this.setLoop(null); }
  setLoop(region) {
    this.clock = { position: this.position, time: this.context.currentTime };
    this.loop = region; this.send({ type: 'loop', loop: region });
    if (region && !region.roll) this.lastLoop = region;
  }
  // RELOOP / EXIT: leaves the loop, or jumps back into the last one.
  async reloop() {
    if (this.loop) { this.disableLoop(); return true; }
    if (!this.lastLoop) return false;
    const region = this.lastLoop; await this.seek(region.start); this.setLoop(region);
    return true;
  }
  // LOOP IN marks the start; LOOP OUT closes a loop of any length from there to the current position.
  markLoopIn() { if (this.buffer) this.loopIn = this.position; }
  markLoopOut() {
    const end = this.position;
    if (this.loopIn === null || end - this.loopIn < 0.05) return false;
    this.setLoop({ start: this.loopIn, end, manual: true });
    return true;
  }
  async triggerHotCue(index, clear = false) {
    if (!this.buffer) return;
    if (clear) { this.hotCues[index] = null; return; }
    if (this.hotCues[index] === null) { this.hotCues[index] = this.position; return; }
    await this.seek(this.hotCues[index]); await this.play();
  }
  // Effects take 0-1, except the filter: −1 (low-pass closed) … 0 (open) … 1 (high-pass closed).
  setFX(name, value) {
    const amount = clamp(value, 0, 1), time = this.context.currentTime;
    if (name === 'echo') this.echoWet.gain.setTargetAtTime(amount * 0.55, time, 0.02);
    if (name === 'reverb') this.reverbWet.gain.setTargetAtTime(amount * 0.5, time, 0.02);
    if (name === 'filter') {
      const side = clamp(value, -1, 1);
      this.fxFilter.frequency.setTargetAtTime(20000 * Math.pow(0.01, Math.max(0, -side)), time, 0.02);
      this.highPass.frequency.setTargetAtTime(10 * Math.pow(600, Math.max(0, side)), time, 0.02);
    }
    if (name === 'drive') {
      if (amount === 0) { this.shaper.curve = null; return; }
      const curve = new Float32Array(2048), strength = 1 + amount * 10;
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i * 2 / (curve.length - 1) - 1) * strength) / Math.tanh(strength);
      this.shaper.curve = curve;
    }
  }
}
// Four shared sample slots, as in Serato's sampler; they play into the master.
export class Sampler {
  constructor(context, destination) {
    this.context = context; this.slots = [null, null, null, null];
    this.output = context.createGain(); this.output.gain.value = 0.8; this.output.connect(destination);
  }
  async load(slot, bytes, name) {
    const buffer = await this.context.decodeAudioData(bytes.slice(0));
    this.eject(slot); this.slots[slot] = { name, buffer, source: null };
  }
  play(slot) {
    const sample = this.slots[slot]; if (!sample) return false;
    this.stop(slot);
    const source = this.context.createBufferSource(); source.buffer = sample.buffer; source.connect(this.output);
    source.onended = () => { if (sample.source === source) sample.source = null; };
    sample.source = source; source.start(); return true;
  }
  stop(slot) { const sample = this.slots[slot]; if (sample?.source) { sample.source.onended = null; sample.source.stop(); sample.source = null; } }
  eject(slot) { this.stop(slot); this.slots[slot] = null; }
  playing(slot) { return Boolean(this.slots[slot]?.source); }
}
export class Mixer {
  constructor() {
    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.context.createGain(); this.master.gain.value = 0.7;
    this.limiter = this.context.createDynamicsCompressor();
    this.limiter.threshold.value = -3; this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20; this.limiter.attack.value = 0.003; this.limiter.release.value = 0.15;
    this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 512;
    this.master.connect(this.limiter); this.limiter.connect(this.analyser);
    // Headphone cue bus: decks with CUE on, plus the master when MASTER is on.
    this.cueBus = this.context.createGain(); this.masterCue = this.context.createGain(); this.masterCue.gain.value = 0;
    this.analyser.connect(this.masterCue); this.masterCue.connect(this.cueBus);
    this.ready = this.context.audioWorklet.addModule(new URL('./deck-worklet.mjs', import.meta.url));
    this.decks = [0, 1, 2, 3].map(() => new Deck(this.context, this.master, this.ready));
    for (const deck of this.decks) deck.cueSend.connect(this.cueBus);
    this.sampler = new Sampler(this.context, this.master);
    this.merger = null; this.outputId = ''; this.route();
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
  setMasterCue(on) { this.masterCue.gain.setTargetAtTime(on ? 1 : 0, this.context.currentTime, 0.01); }
  // Headphones need a sound card with 4 outputs, like the DDJ-SB3: master on outputs 1-2, cue on 3-4.
  get cueAvailable() { return this.merger !== null; }
  async setOutput(deviceId) {
    if (!this.context.setSinkId) throw new Error('Este entorno no permite elegir la salida de audio.');
    await this.context.setSinkId(deviceId); this.outputId = deviceId; this.route();
  }
  route() {
    const destination = this.context.destination;
    this.analyser.disconnect(); this.analyser.connect(this.masterCue); this.cueBus.disconnect(); this.merger?.disconnect(); this.merger = null;
    if (destination.maxChannelCount < 4) { destination.channelCount = 2; this.analyser.connect(destination); return; }
    destination.channelCount = 4; destination.channelCountMode = 'explicit'; destination.channelInterpretation = 'discrete';
    this.merger = this.context.createChannelMerger(4);
    const master = this.context.createChannelSplitter(2), cue = this.context.createChannelSplitter(2);
    this.analyser.connect(master); this.cueBus.connect(cue);
    master.connect(this.merger, 0, 0); master.connect(this.merger, 1, 1); cue.connect(this.merger, 0, 2); cue.connect(this.merger, 1, 3);
    this.merger.connect(destination);
  }
}

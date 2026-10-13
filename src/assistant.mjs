import { generateSegment, motionScore, energyTarget, interpretInstruction } from './assistant-core.mjs';
export class SegmentLayer {
  constructor(context, destination) {
    this.context = context; this.source = null; this.segment = null; this.level = 0.16;
    this.filter = context.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 14000;
    this.gain = context.createGain(); this.gain.gain.value = 0;
    this.filter.connect(this.gain); this.gain.connect(destination);
  }
  get playing() { return Boolean(this.source); }
  async start(segment, reference = null) {
    await this.context.resume(); this.stop(); this.segment = segment;
    const buffer = this.context.createBuffer(1, segment.samples.length, segment.sampleRate);
    buffer.copyToChannel(segment.samples, 0);
    const source = this.context.createBufferSource(); source.buffer = buffer; source.loop = true; source.connect(this.filter);
    let delay = 0;
    if (reference?.playing) {
      const phase = (reference.position * reference.bpm / 60) % 1;
      delay = ((1 - phase) % 1) * 60 / (reference.bpm * reference.rate);
    }
    const at = this.context.currentTime + delay;
    this.gain.gain.cancelScheduledValues(this.context.currentTime); this.gain.gain.setValueAtTime(0, this.context.currentTime);
    this.gain.gain.setTargetAtTime(this.level, at, 0.08); source.start(at); this.source = source;
    source.onended = () => source.disconnect();
  }
  stop() {
    const time = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(time); this.gain.gain.setTargetAtTime(0, time, 0.01);
    if (this.source) { this.source.stop(time + 0.04); this.source = null; }
  }
  setLevel(value) { this.level = Math.max(0, Math.min(0.35, value)); if (this.playing) this.gain.gain.setTargetAtTime(this.level, this.context.currentTime, 0.15); }
  adapt(energy) { this.filter.frequency.setTargetAtTime(700 + energy / 100 * 13300, this.context.currentTime, 0.7); }
}
export function mountAssistant(mixer, setStatus) {
  const $ = selector => document.querySelector(selector), layer = new SegmentLayer(mixer.context, mixer.master);
  let stream = null, previous = null, movement = null, smoothed = 0, automatic = false, cameraEpoch = 0, generating = false, segment = null;
  let applied = null, lastDecision = 0;
  const video = $('#party-camera'), canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const inform = message => { $('#assistant-decision').textContent = message; };
  function stopCamera() {
    cameraEpoch++; stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null;
    previous = null; movement = null; smoothed = 0; $('#motion-level').value = 0;
    $('#camera-status').textContent = 'Cámara apagada · Control manual'; $('#camera-stop').disabled = true; $('#camera-start').disabled = false;
    window.desktop?.setCameraEnabled(false).catch(() => {});
  }
  $('#camera-start').onclick = async () => {
    const epoch = ++cameraEpoch; $('#camera-start').disabled = true;
    try {
      await window.desktop?.setCameraEnabled(true);
      const result = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 8 } }, audio: false });
      if (epoch !== cameraEpoch) { result.getTracks().forEach(track => track.stop()); return; }
      stream = result; video.srcObject = stream; await video.play(); $('#camera-stop').disabled = false;
      stream.getVideoTracks()[0].onended = () => { stopCamera(); inform('La cámara se desconectó. Se mantienen tus indicaciones manuales.'); };
    } catch { stopCamera(); inform('No se pudo abrir la cámara. Comprueba permisos y disponibilidad; puedes usar el control manual.'); }
  };
  $('#camera-stop').onclick = stopCamera;
  $('#assistant-energy').oninput = () => { $('#energy-value').textContent = `${$('#assistant-energy').value}%`; };
  $('#assistant-apply').onclick = () => {
    const result = interpretInstruction($('#assistant-instruction').value, Number($('#assistant-energy').value));
    if (!result) { inform('Entiendo: «sube energía», «baja energía», «suave» o «mantener». Género y BPM se eligen en los controles.'); return; }
    $('#assistant-energy').value = result.energy; $('#assistant-energy').dispatchEvent(new Event('input')); inform(result.message);
  };
  $('#assistant-auto').onclick = () => {
    automatic = !automatic; $('#assistant-auto').textContent = automatic ? 'Detener asistencia' : 'Adaptar segmento al ambiente';
    $('#assistant-auto').classList.toggle('active', automatic); applied = null; lastDecision = 0;
    inform(automatic ? 'Asistencia activa: ajustará el filtro y el volumen de la capa creada. Tus pistas quedan bajo tu control.' : 'Asistencia detenida. Puedes seguir mezclando manualmente.');
  };
  $('#segment-level').oninput = () => {
    automatic = false; $('#assistant-auto').classList.remove('active'); $('#assistant-auto').textContent = 'Adaptar segmento al ambiente';
    layer.setLevel(Number($('#segment-level').value));
  };
  $('#segment-create').onclick = async () => {
    if (generating) return; generating = true; $('#segment-create').disabled = true;
    try {
      const selected = $('#segment-reference').value, reference = selected === 'none' ? null : mixer.decks[Number(selected)];
      if (reference && !reference.buffer) throw new Error('Carga primero una pista en el deck de referencia o elige BPM propio.');
      const bpm = reference ? reference.bpm * reference.rate : Number($('#segment-bpm').value);
      if (!Number.isFinite(bpm) || bpm < 60 || bpm > 180) throw new Error('El tempo del segmento debe estar entre 60 y 180 BPM.');
      segment = generateSegment({ bpm, energy: Number($('#assistant-energy').value), style: $('#segment-style').value, root: Number($('#segment-root').value), seed: Date.now() % 2147483647 });
      layer.setLevel(Number($('#segment-level').value)); await layer.start(segment, reference);
      $('#segment-stop').disabled = false; $('#segment-save').disabled = !window.desktop;
      $('#segment-info').textContent = `${segment.name} · ${segment.duration.toFixed(1)} s · 4 compases · reproducción en loop`;
      inform(reference ? 'Segmento en mezcla. Se usa el BPM manual del deck y un pulso estimado; ajusta la tonalidad de oído.' : 'Segmento creado y reproduciéndose como una capa sobre tus decks.');
    } catch (error) { inform(error.message); } finally { generating = false; $('#segment-create').disabled = false; }
  };
  $('#segment-stop').onclick = () => { layer.stop(); $('#segment-stop').disabled = true; inform('Capa musical detenida.'); };
  $('#segment-save').onclick = async () => {
    if (!segment || !window.desktop) return;
    try { if (await window.desktop.saveImportedAudio({ name: segment.name, format: 'wav', bytes: segment.bytes })) setStatus('Segmento guardado como WAV. Puedes cargarlo en cualquier deck.'); }
    catch (error) { inform(error.message); }
  };
  const timer = setInterval(() => {
    if (stream && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, 64, 48); const rgba = ctx.getImageData(0, 0, 64, 48).data, gray = new Uint8Array(64 * 48);
      for (let i = 0; i < gray.length; i++) gray[i] = (rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 3;
      smoothed = smoothed * 0.85 + motionScore(previous, gray) * 0.15; previous = gray; movement = smoothed;
      $('#motion-level').value = smoothed;
      $('#camera-status').textContent = `Cámara activa · Movimiento visual ${(smoothed * 100).toFixed(0)}%`;
    }
    const energy = energyTarget(Number($('#assistant-energy').value), movement); $('#assistant-target').textContent = `${energy.toFixed(0)}%`;
    if (automatic && layer.playing && Date.now() - lastDecision > 8000 && (applied === null || Math.abs(energy - applied) >= 5)) {
      lastDecision = Date.now(); applied = energy;
      const level = 0.04 + energy / 100 * 0.2; layer.setLevel(level); layer.adapt(energy); $('#segment-level').value = level;
      inform(`Energía objetivo ${energy.toFixed(0)}%: filtro y volumen de la capa ajustados ${movement === null ? 'según tu indicación' : 'según tu indicación y movimiento visual'}.`);
    }
  }, 250);
  window.addEventListener('beforeunload', () => { clearInterval(timer); stopCamera(); layer.stop(); });
}

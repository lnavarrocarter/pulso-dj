// Auto DJ: plays the library on decks 1 and 2 and mixes from one to the other on the beat.
// Order: guest requests first, in the order they were accepted, then the library from the top. Each track plays from
// its first beat (a request, from the guest's part) and the mix starts 32 beats before its end (16 for a request):
// the next track starts on a beat with its tempo matched, the crossfader moves across and the bass is swapped halfway.
const SILENT_EQ = -24;
// ui: { setCrossfade(0-1), setLow(deck, dB), setVolume(deck, 0-1), setPitch(deck, percent), setKeylock(deck, on), setAssign(deck, side) }
// library: { entries(), loadInto(deck, id) }; trackId(deck): library id loaded in a deck.
export function createAutoDJ({ mixer, ui, library, trackId, status }) {
  let running = false, current = 0, timer = 0, mix = null, loading = null, waitingStart = 0;
  const played = new Set();
  const decks = mixer.decks;
  const other = index => 1 - index;
  const entryOf = index => library.entries().find(entry => entry.id === trackId(index)) ?? null;
  const synced = (a, b) => decks[a].tempoConfidence > 0.15 && decks[b].tempoConfidence > 0.15;
  // Where a track starts and where its mix must be finished, in track seconds.
  function region(index) {
    const deck = decks[index], part = entryOf(index)?.request;
    const start = part ? Math.max(0, part.start) : 0, end = part ? Math.min(part.end, deck.duration) : deck.duration - 0.5;
    const first = deck.tempoConfidence > 0.15 ? deck.nextBeat(Math.max(0, start - 30 / deck.bpm)) : start;
    return { start: Math.min(first, end), end, beats: part ? 16 : 32 };
  }
  function nextEntry() {
    const busy = new Set([trackId(0), trackId(1)]);
    const candidates = library.entries().filter(entry => !played.has(entry.id) && !busy.has(entry.id));
    const requests = candidates.filter(entry => entry.request).sort((a, b) => a.addedAt - b.addedAt);
    return requests[0] ?? candidates[0] ?? null;
  }
  // Loads the next track into the idle deck while the current one plays.
  async function prepare(index) {
    if (loading || decks[index].playing) return;
    const entry = nextEntry();
    if (!entry) return;
    loading = entry.id;
    try {
      ui.setPitch(index, 0); ui.setKeylock(index, false); ui.setLow(index, 0);
      if (!await library.loadInto(index, entry.id)) played.add(entry.id);
    } finally { loading = null; }
  }
  async function startOn(index) {
    const deck = decks[index], { start } = region(index);
    played.add(trackId(index));
    await deck.seek(start); await deck.play();
    ui.setLow(index, 0); ui.setCrossfade(index === 0 ? 0 : 1);
    current = index;
  }
  // The incoming deck starts on the outgoing deck's next beat, at its own first beat, with the tempo matched.
  function beginMix() {
    const out = decks[current], incoming = other(current), deck = decks[incoming];
    const mixSeconds = Math.min(region(current).beats * 60 / out.bpm, Math.max(4, (region(current).end - out.position) - 0.2));
    const sync = synced(current, incoming);
    if (sync) {
      const percent = (out.bpm * out.rate / deck.bpm - 1) * 100;
      if (Math.abs(percent) <= deck.range * 100) { ui.setKeylock(incoming, true); ui.setPitch(incoming, percent); }
    }
    const wait = sync ? (1 - out.beatPhase) * 60 / out.bpm / out.speed : 0;
    mix = { from: current, to: incoming, seconds: mixSeconds / out.speed, started: 0, sync, swapped: false };
    ui.setLow(incoming, SILENT_EQ);
    const go = async () => {
      if (!running || !mix) return;
      await deck.seek(region(incoming).start); await deck.play();
      mix.started = performance.now(); played.add(trackId(incoming));
    };
    waitingStart = setTimeout(go, Math.max(0, wait * 1000 - 15));
    status(`Auto DJ: mezclando hacia «${entryOf(incoming)?.title ?? `deck ${incoming + 1}`}»${sync ? '' : ' (sin sincronizar: BPM dudoso)'}.`);
  }
  function finishMix() {
    const { from, to } = mix;
    decks[from].pause(); decks[to].bend(0); ui.setLow(from, 0);
    ui.setCrossfade(to === 0 ? 0 : 1);
    mix = null; current = to;
    prepare(from);
  }
  async function tick() {
    if (!running) return;
    const out = decks[current];
    if (mix) {
      if (!mix.started) return;
      const progress = Math.min(1, (performance.now() - mix.started) / 1000 / mix.seconds);
      ui.setCrossfade(mix.from === 0 ? progress : 1 - progress);
      if (!mix.swapped && progress >= 0.5) { mix.swapped = true; ui.setLow(mix.from, SILENT_EQ); ui.setLow(mix.to, 0); }
      // Keeps the beats together like a DJ nudging the platter: a small speed offset proportional to the drift.
      if (mix.sync && decks[mix.from].playing) {
        let drift = decks[mix.to].beatPhase - decks[mix.from].beatPhase; drift -= Math.round(drift);
        decks[mix.to].bend(Math.abs(drift) < 0.004 ? 0 : Math.max(-0.03, Math.min(0.03, -drift * 0.4)));
      }
      if (progress >= 1 || !decks[mix.from].playing) finishMix();
      return;
    }
    if (!out.playing) {
      // Nothing playing on the current deck (start, or a track ended without a mix): play whatever is ready.
      if (decks[other(current)].buffer && trackId(other(current)) && !played.has(trackId(other(current)))) await startOn(other(current));
      else if (out.buffer && trackId(current) && !played.has(trackId(current))) await startOn(current);
      else if (!loading) {
        if (nextEntry()) await prepare(current);
        else { stop(); status('Auto DJ: no quedan pistas sin sonar en la biblioteca.'); }
      }
      return;
    }
    const next = other(current);
    if (!decks[next].buffer || played.has(trackId(next))) { prepare(next); return; }
    const { end, beats } = region(current);
    if (out.position >= end - beats * 60 / out.bpm) beginMix();
  }
  function start() {
    if (running) return;
    running = true;
    // Decks 1 and 2 on each side of the crossfader, channel faders up; continues from a deck already playing.
    ui.setAssign(0, 'A'); ui.setAssign(1, 'B');
    for (const index of [0, 1]) if (Number(decks[index].gain.gain.value) < 0.5) ui.setVolume(index, 1);
    current = decks[1].playing && !decks[0].playing ? 1 : 0;
    if (decks[current].playing) { played.add(trackId(current)); ui.setCrossfade(current === 0 ? 0 : 1); }
    timer = setInterval(() => { tick().catch(error => { status(`Auto DJ: ${error.message}`); }); }, 50);
    status('Auto DJ activado: primero los pedidos del público, después la biblioteca de arriba abajo.');
  }
  function stop() {
    if (!running) return;
    running = false; clearInterval(timer); clearTimeout(waitingStart);
    if (mix) { decks[mix.to].bend(0); mix = null; }
    status('Auto DJ desactivado: las pistas siguen sonando y los controles vuelven a ser tuyos.');
  }
  return {
    get running() { return running; },
    toggle() { if (running) stop(); else start(); },
    stop,
    // One line for the screen: what is playing, what comes next and when the mix starts.
    describe() {
      if (!running) return 'Mezcla sola la biblioteca: primero los pedidos del público.';
      if (mix) return `Mezclando hacia el deck ${mix.to + 1}…`;
      const out = decks[current], next = entryOf(other(current));
      if (!out.playing) return 'Preparando la primera pista…';
      const left = region(current).end - region(current).beats * 60 / out.bpm - out.position;
      return next ? `Siguiente: ${next.title} · mezcla en ${Math.max(0, Math.floor(left / out.speed / 60))}:${String(Math.max(0, Math.floor(left / out.speed % 60))).padStart(2, '0')}`
        : loading ? 'Cargando la siguiente pista…' : 'No hay más pistas en la cola.';
    }
  };
}

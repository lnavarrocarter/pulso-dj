// Integration check using the actual Electron renderer. No physical audio or MIDI required.
const { app, BrowserWindow } = require('electron');
const { writeFile } = require('node:fs/promises');
const path = require('node:path');
app.disableHardwareAcceleration();
require('./main.cjs');
const timeout = setTimeout(() => { console.error('Integration timeout'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  try {
    const window = BrowserWindow.getAllWindows()[0];
    await new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    const errors = [];
    window.webContents.on('console-message', (_event, details) => { if (details.level === 'error') errors.push(details.message); });
    const result = await window.webContents.executeJavaScript(`(async () => {
      const { Mixer, Deck } = await import('./audio.mjs');
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      check(document.querySelectorAll('.deck').length === 4 && document.querySelectorAll('.strip').length === 4, 'Four deck views and mixer strips');
      check(document.querySelector('#target').options.length === 90, 'MIDI targets');
      check(window.desktop && !window.require, 'Isolated preload');
      const mixer = new Mixer(); mixer.setMaster(0);
      const deck = mixer.decks[0];
      // Construct a real PCM WAV and exercise the native decoder.
      const bytes = new ArrayBuffer(44 + 48000 * 2), v = new DataView(bytes);
      const text = (at, value) => [...value].forEach((c, i) => v.setUint8(at+i, c.charCodeAt(0)));
      text(0,'RIFF'); v.setUint32(4,bytes.byteLength-8,true); text(8,'WAVE'); text(12,'fmt ');
      v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
      v.setUint32(24,48000,true); v.setUint32(28,96000,true); v.setUint16(32,2,true); v.setUint16(34,16,true);
      text(36,'data'); v.setUint32(40,96000,true);
      for (let i=0;i<48000;i++) v.setInt16(44+i*2, Math.sin(i*2*Math.PI*440/48000)*8000,true);
      await deck.load(bytes); check(Math.abs(deck.duration-1)<0.01,'WAV decode');
      await deck.play(); check(deck.playing,'Playback started');
      await new Promise(resolve => setTimeout(resolve,120));
      check(deck.position>0,'Transport advances');
      deck.pause(); const paused = deck.position;
      await new Promise(resolve => setTimeout(resolve,50)); check(deck.position===paused,'Pause holds position');
      await deck.seek(0.5); deck.setRate(1.16); await deck.play();
      check(deck.playing && deck.rate===1.16,'Seek and rate');
      await new Promise(resolve => setTimeout(resolve,650));
      check(!deck.playing && deck.position===deck.duration,'Natural end');
      deck.setRate(1); await deck.seek(0.2); check(deck.enableLoop(1),'Loop activation');
      await deck.play(); await new Promise(resolve => setTimeout(resolve,800));
      check(deck.playing && deck.position>=0.2 && deck.position<0.7,'Loop survives end and wraps');
      deck.pause(); const loopPaused=deck.position;
      await new Promise(resolve => setTimeout(resolve,50)); check(deck.position===loopPaused,'Loop pause holds');
      await deck.play(); deck.disableLoop();
      await new Promise(resolve => setTimeout(resolve,1000)); check(!deck.playing,'Exit loop reaches natural end');
      await deck.seek(0.3); await deck.triggerHotCue(0); check(Math.abs(deck.hotCues[0]-0.3)<0.01,'Save hot cue');
      await deck.seek(0.7); await deck.triggerHotCue(0); check(deck.playing && deck.position<0.4,'Recall hot cue');
      await deck.triggerHotCue(0,true); check(deck.hotCues[0]===null,'Clear hot cue'); deck.pause();
      await deck.seek(0.5); deck.scrub(0.1); check(Math.abs(deck.position-0.6)<0.001,'Jog scrub while paused');
      deck.bend(0.2); check(Math.abs(deck.speed-1.2)<1e-9 && deck.rate===1,'Jog bend keeps tempo'); deck.bend(0);
      deck.setFX('drive',1); check(deck.shaper.curve.length===2048,'Drive curve');
      deck.setFX('drive',0); check(deck.shaper.curve===null,'Drive reset');
      const renderFX = async effect => {
        const offline = new OfflineAudioContext(2,48000,48000), testDeck = new Deck(offline,offline.destination);
        const buffer=offline.createBuffer(1,48000,48000), samples=buffer.getChannelData(0);
        if(effect==='filter'||effect==='baseline') { for(let i=0;i<48000;i++) samples[i]=Math.sin(i*2*Math.PI*8000/48000)*0.1; }
        else samples[9600]=0.5;
        if(effect!=='baseline') testDeck.setFX(effect,1);
        const source=offline.createBufferSource(); source.buffer=buffer; source.connect(testDeck.filters[0]); source.start();
        const rendered=await offline.startRendering(); return rendered.getChannelData(0);
      };
      const energy=(samples,from=12000,to=48000)=>{let sum=0; for(let i=from;i<to;i++)sum+=samples[i]*samples[i]; return sum;};
      check(energy(await renderFX('echo'),20000)>0.001,'Echo produces delayed audio');
      check(energy(await renderFX('reverb'),12000)>0.000001,'Reverb produces tail');
      check(energy(await renderFX('filter'))<energy(await renderFX('baseline'))*0.02,'Filter attenuates high frequencies');
      deck.setEQ(0,50); check(deck.filters[0].gain.value<=12,'EQ bounds');
      await mixer.context.close();
      return { decks:4, midiTargets:90, decode:true, transport:true, looping:true, hotCues:true, echo:true, reverb:true, filter:true, drive:true, isolated:true };
    })()`);
    if (errors.length) throw new Error(errors.join('\n'));
    await writeFile(path.join(__dirname, '../preview.png'), (await window.webContents.capturePage()).toPNG());
    console.log(JSON.stringify(result)); clearTimeout(timeout); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
});

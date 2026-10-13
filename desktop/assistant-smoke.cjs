const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
// Synthetic camera provided by Chromium: this test never opens real hardware.
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
require('./main.cjs');
const timeout = setTimeout(() => { console.error('Assistant test timeout'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
  try {
    const window = BrowserWindow.getAllWindows()[0];
    await new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    const result = await window.webContents.executeJavaScript(`(async () => {
      const check=(condition,message)=>{if(!condition)throw new Error(message);};
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const {generateSegment}=await import('./assistant-core.mjs'); const {SegmentLayer}=await import('./assistant.mjs');
      const context=new AudioContext(); const mute=context.createGain(); mute.gain.value=0; mute.connect(context.destination);
      const layer=new SegmentLayer(context,mute); const segment=generateSegment({bars:1,bpm:120});
      const decoded=await context.decodeAudioData(segment.bytes.buffer.slice(0)); check(Math.abs(decoded.duration-2)<0.001,'Generated WAV decodes');
      await layer.start(segment); check(layer.playing&&layer.source.loop,'Segment loops');
      layer.adapt(80); layer.setLevel(0.35); await wait(50); check(layer.level===0.35,'Level adjustment');
      layer.stop(); check(!layer.playing,'Stop segment'); await wait(50); await context.close();
      let rejected=false; try {const stream=await navigator.mediaDevices.getUserMedia({video:true});stream.getTracks().forEach(track=>track.stop());}catch{rejected=true;}
      check(rejected,'Camera denied before explicit activation');
      document.querySelector('#camera-start').click();
      for(let i=0;i<40&&!document.querySelector('#party-camera').srcObject;i++)await wait(100);
      const stream=document.querySelector('#party-camera').srcObject; check(stream,'Explicit camera activation');
      check(stream.getAudioTracks().length===0,'No audio capture'); const tracks=stream.getTracks();
      rejected=false; try{const mic=await navigator.mediaDevices.getUserMedia({audio:true});mic.getTracks().forEach(track=>track.stop());}catch{rejected=true;}
      check(rejected,'Microphone remains denied');
      document.querySelector('#camera-stop').click(); await wait(100); check(tracks.every(track=>track.readyState==='ended'),'Camera stop releases tracks');
      document.querySelector('#assistant-instruction').value='sube energía'; document.querySelector('#assistant-apply').click();
      check(document.querySelector('#assistant-energy').value==='65','Operator instruction applied');
      const master=document.querySelector('#master'); master.value=0; master.dispatchEvent(new Event('input'));
      document.querySelector('#segment-create').click();
      for(let i=0;i<30&&document.querySelector('#segment-stop').disabled;i++)await wait(100);
      check(!document.querySelector('#segment-stop').disabled,'UI segment creation');
      document.querySelector('#assistant-auto').click(); await wait(400);
      check(document.querySelector('#assistant-decision').textContent.includes('ajustados'),'Assistance changes layer');
      check([...document.querySelectorAll('.track')].every(element=>element.textContent==='Tu próxima pista'),'Decks not replaced');
      check(document.querySelector('#crossfade').value==='0.5','Deck crossfader remains manual');
      document.querySelector('#segment-level').value=0.1; document.querySelector('#segment-level').dispatchEvent(new Event('input'));
      check(!document.querySelector('#assistant-auto').classList.contains('active'),'Manual layer control overrides assistance');
      document.querySelector('#segment-stop').click();
      return {wavDecoded:true,layerLoop:true,layerStop:true,cameraExplicit:true,fakeCamera:true,microphoneDenied:true,cameraReleased:true,instructions:true,uiGeneration:true,assistance:true,manualOverride:true};
    })()`);
    console.log(JSON.stringify(result)); clearTimeout(timeout); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
});

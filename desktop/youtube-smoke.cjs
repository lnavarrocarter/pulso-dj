const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration(); require('./main.cjs');
const timeout = setTimeout(() => { console.error('YouTube test timeout'); app.exit(1); }, 90000);
app.whenReady().then(async () => {
  try {
    const window = BrowserWindow.getAllWindows()[0];
    await new Promise(resolve => window.webContents.once('did-finish-load', resolve));
    const result = await window.webContents.executeJavaScript(`(async () => {
      const file = await window.desktop.importYouTube('https://www.youtube.com/watch?v=aqz-KE-bpKQ');
      const { Mixer } = await import('./audio.mjs'); const mixer = new Mixer(); mixer.setMaster(0);
      await mixer.decks[0].load(new Uint8Array(file.bytes).buffer);
      const duration = mixer.decks[0].duration;
      if (!(duration > 0 && duration <= 1200)) throw new Error('Invalid decoded duration');
      await mixer.context.close(); return { name: file.name, duration, decoded: true };
    })()`);
    console.log(JSON.stringify(result)); clearTimeout(timeout); app.exit(0);
  } catch (error) { console.error(error.message); clearTimeout(timeout); app.exit(1); }
});

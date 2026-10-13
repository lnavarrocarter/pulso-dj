const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const { readFile, writeFile, stat } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createImporter } = require('./youtube.cjs');
const { checkPermission, requestPermission } = require('./permissions.cjs');
const entry = path.join(__dirname, '../src/index.html');
const entryURL = pathToFileURL(entry).href;
let window;
let cameraEnabled = false;
app.whenReady().then(() => {
  const toolFolder = app.isPackaged ? path.join(process.resourcesPath, 'tools') : path.join(__dirname, '../assets/tools', process.platform === 'win32' ? 'win' : 'mac');
  const importer = createImporter({ executable: path.join(toolFolder, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'), runtime: process.execPath, tempRoot: app.getPath('temp') });
  const authorized = event => event.sender === window?.webContents && event.senderFrame?.url === entryURL;
  ipcMain.handle('camera:enable', (event, enabled) => {
    if (!authorized(event) || typeof enabled !== 'boolean') throw new Error('Solicitud de cámara no permitida');
    cameraEnabled = enabled; return enabled;
  });
  ipcMain.handle('youtube:import', async (event, url) => {
    if (!authorized(event)) throw new Error('Origen no permitido');
    return importer.importAudio(url, progress => { if (!event.sender.isDestroyed()) event.sender.send('youtube:progress', progress); });
  });
  ipcMain.handle('youtube:cancel', event => { if (!authorized(event)) throw new Error('Origen no permitido'); importer.cancel(); });
  ipcMain.handle('audio:save-import', async (event, file) => {
    if (!authorized(event)) throw new Error('Origen no permitido');
    if (!file || !['m4a', 'webm', 'wav'].includes(file.format) || !(file.bytes instanceof Uint8Array) || file.bytes.byteLength > 128 * 1024 * 1024) throw new Error('Audio no válido para guardar.');
    const name = String(file.name || 'Pista').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120);
    const result = await dialog.showSaveDialog(window, { defaultPath: `${name}.${file.format}`, filters: [{ name: 'Audio original', extensions: [file.format] }] });
    if (result.canceled) return false;
    await writeFile(result.filePath, file.bytes); return true;
  });
  app.on('before-quit', () => importer.cancel());
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    contents === window?.webContents && contents.getURL() === entryURL && checkPermission(permission, details, cameraEnabled));
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(contents === window?.webContents && contents.getURL() === entryURL && requestPermission(permission, details, cameraEnabled)));
  ipcMain.handle('audio:choose', async event => {
    if (!authorized(event)) throw new Error('Origen no permitido');
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aiff'] }]
    });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    if ((await stat(file)).size > 128 * 1024 * 1024) throw new Error('El archivo supera 128 MB');
    return { name: path.basename(file), bytes: new Uint8Array(await readFile(file)) };
  });
  const createWindow = () => {
    window = new BrowserWindow({ width: 1280, height: 880, minWidth: 960, minHeight: 740,
      backgroundColor: '#0b1017', webPreferences: { preload: path.join(__dirname, 'preload.cjs'),
        nodeIntegration: false, contextIsolation: true, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('closed', () => { cameraEnabled = false; importer.cancel(); });
    window.loadFile(entry);
  };
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

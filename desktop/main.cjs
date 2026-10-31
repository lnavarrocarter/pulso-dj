const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const { readFile, writeFile, stat, copyFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createImporter } = require('./youtube.cjs');
const { createLibrary, FORMATS } = require('./library.cjs');
const { checkPermission, requestPermission } = require('./permissions.cjs');
const { createRequestService } = require('./requests.cjs');
const entry = path.join(__dirname, '../src/index.html');
const entryURL = pathToFileURL(entry).href;
let window;
let cameraEnabled = false;
app.whenReady().then(() => {
  const toolFolder = app.isPackaged ? path.join(process.resourcesPath, 'tools') : path.join(__dirname, '../assets/tools', { win32: 'win', darwin: 'mac' }[process.platform] ?? 'linux');
  const importer = createImporter({ executable: path.join(toolFolder, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'), runtime: process.execPath, tempRoot: app.getPath('temp') });
  const authorized = event => event.sender === window?.webContents && event.senderFrame?.url === entryURL;
  ipcMain.handle('camera:enable', (event, enabled) => {
    if (!authorized(event) || typeof enabled !== 'boolean') throw new Error('Solicitud de cámara no permitida');
    cameraEnabled = enabled; return enabled;
  });
  // One YouTube download at a time: the DJ's own imports and accepted guest requests share the importer.
  let downloads = Promise.resolve();
  const exclusive = task => { const run = downloads.then(task, task); downloads = run.catch(() => {}); return run; };
  ipcMain.handle('youtube:import', async (event, url) => {
    if (!authorized(event)) throw new Error('Origen no permitido');
    return exclusive(() => importer.importAudio(url, progress => { if (!event.sender.isDestroyed()) event.sender.send('youtube:progress', progress); }));
  });
  ipcMain.handle('youtube:cancel', event => { if (!authorized(event)) throw new Error('Origen no permitido'); importer.cancel(); });
  const library = createLibrary(path.join(app.getPath('userData'), 'library'));
  const handle = (channel, action) => ipcMain.handle(channel, (event, ...args) => {
    if (!authorized(event)) throw new Error('Origen no permitido');
    return action(event, ...args);
  });
  handle('library:list', () => library.list());
  handle('library:import-youtube', async (event, url) => {
    const file = await exclusive(() => importer.importAudio(url, progress => { if (!event.sender.isDestroyed()) event.sender.send('youtube:progress', progress); }));
    return library.addImport(file, url);
  });
  const notify = (channel, payload) => { if (window && !window.isDestroyed()) window.webContents.send(channel, payload); };
  const requests = createRequestService({ guestFolder: path.join(__dirname, 'guest'), onChange: list => notify('requests:changed', list) });
  handle('requests:open', () => requests.open());
  handle('requests:close', () => requests.close());
  handle('requests:state', () => ({ info: requests.info(), list: requests.list() }));
  handle('requests:reject', (_event, id) => { requests.update(id, { status: 'rejected', message: '' }); });
  handle('requests:clear', () => requests.clearFinished());
  // Accepting downloads the whole song and stores the guest's part with it, so the DJ (or the Auto DJ) can mix in and out.
  handle('requests:approve', (_event, id) => {
    const item = requests.get(id);
    if (!item || !['pending', 'failed'].includes(item.status)) throw new Error('Ese pedido ya no está en espera.');
    requests.update(id, { status: 'approved', message: 'En cola de descarga' });
    exclusive(async () => {
      let step = -1;
      requests.update(id, { status: 'downloading', message: 'Descargando…' });
      const file = await importer.importAudio(item.url, progress => {
        const tenth = Math.floor((progress.percent ?? 0) / 10);
        if (tenth !== step) { step = tenth; requests.update(id, { message: progress.percent === undefined ? progress.message : `Descargando ${tenth * 10} %` }); }
      });
      const entry = await library.addImport(file, item.url, { by: item.name, start: item.start, end: item.end });
      requests.update(id, { status: 'ready', message: '', entryId: entry.id, title: entry.title });
      notify('library:changed');
    }).catch(error => requests.update(id, { status: 'failed', message: error.message }));
    return true;
  });
  handle('library:add-files', async (_event, multiple) => {
    const result = await dialog.showOpenDialog(window, {
      properties: multiple === false ? ['openFile'] : ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: FORMATS }]
    });
    const added = [], errors = [];
    for (const file of result.canceled ? [] : result.filePaths) {
      try { added.push(await library.addLocal(file)); } catch (error) { errors.push(error.message); }
    }
    return { added, errors };
  });
  handle('library:read', (_event, id) => library.read(id));
  handle('library:set-duration', (_event, id, duration) => library.setDuration(id, duration));
  handle('library:remove', (_event, id) => library.remove(id));
  handle('library:export', async (_event, id) => {
    const { file, name, format } = await library.exportPath(id);
    const result = await dialog.showSaveDialog(window, { defaultPath: `${name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.${format}`, filters: [{ name: 'Audio original', extensions: [format] }] });
    if (result.canceled) return false;
    await copyFile(file, result.filePath); return true;
  });
  ipcMain.handle('audio:save-import', async (event, file) => {
    if (!authorized(event)) throw new Error('Origen no permitido');
    if (!file || !['m4a', 'webm', 'wav'].includes(file.format) || !(file.bytes instanceof Uint8Array) || file.bytes.byteLength > 128 * 1024 * 1024) throw new Error('Audio no válido para guardar.');
    const name = String(file.name || 'Pista').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120);
    const result = await dialog.showSaveDialog(window, { defaultPath: `${name}.${file.format}`, filters: [{ name: 'Audio original', extensions: [file.format] }] });
    if (result.canceled) return false;
    await writeFile(result.filePath, file.bytes); return true;
  });
  app.on('before-quit', () => { importer.cancel(); requests.close(); });
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

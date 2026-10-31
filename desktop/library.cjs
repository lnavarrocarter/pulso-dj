// Track library persisted in the app's data folder. YouTube imports are stored as files the library owns;
// local files are referenced by path so the user's music is not duplicated.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_BYTES = 128 * 1024 * 1024;
const FORMATS = ['m4a', 'webm', 'mp3', 'wav', 'flac', 'ogg', 'aiff'];
const validId = id => typeof id === 'string' && /^[a-f0-9]{16}$/.test(id);
function createLibrary(folder) {
  const indexFile = path.join(folder, 'library.json');
  let entries = null, saving = Promise.resolve();
  async function load() {
    if (entries) return entries;
    await fs.mkdir(folder, { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(indexFile, 'utf8'));
      entries = Array.isArray(parsed) ? parsed.filter(entry => validId(entry?.id) && typeof entry.title === 'string') : [];
    } catch { entries = []; }
    return entries;
  }
  // Writes are serialised and atomic (temporary file + rename) so a crash cannot leave a half-written index.
  function save() {
    saving = saving.then(async () => {
      const temporary = `${indexFile}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(entries, null, 2)); await fs.rename(temporary, indexFile);
    });
    return saving;
  }
  const publicEntry = ({ id, title, source, url, format, duration, addedAt }) => ({ id, title, source, url, format, duration, addedAt });
  const ownedFile = entry => path.join(folder, `${entry.id}.${entry.format}`);
  async function list() { return (await load()).map(publicEntry); }
  async function addImport({ name, format, bytes }, url) {
    if (!FORMATS.includes(format) || !(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BYTES) throw new Error('Audio no válido para la biblioteca.');
    await load();
    const entry = { id: crypto.randomBytes(8).toString('hex'), title: String(name || 'Audio de YouTube').slice(0, 200), source: 'youtube', url, format, duration: null, addedAt: Date.now() };
    await fs.writeFile(ownedFile(entry), bytes);
    entries.unshift(entry); await save();
    return publicEntry(entry);
  }
  async function addLocal(file) {
    const format = path.extname(file).slice(1).toLowerCase();
    if (!FORMATS.includes(format)) throw new Error(`Formato no compatible: ${path.basename(file)}`);
    if ((await fs.stat(file)).size > MAX_BYTES) throw new Error(`${path.basename(file)} supera 128 MB.`);
    await load();
    const existing = entries.find(entry => entry.source === 'file' && entry.path === file);
    if (existing) return publicEntry(existing);
    const entry = { id: crypto.randomBytes(8).toString('hex'), title: path.basename(file, path.extname(file)).slice(0, 200), source: 'file', path: file, format, duration: null, addedAt: Date.now() };
    entries.unshift(entry); await save();
    return publicEntry(entry);
  }
  async function find(id) {
    if (!validId(id)) throw new Error('Pista no válida.');
    const entry = (await load()).find(item => item.id === id);
    if (!entry) throw new Error('La pista ya no está en la biblioteca.');
    return entry;
  }
  async function read(id) {
    const entry = await find(id), file = entry.source === 'file' ? entry.path : ownedFile(entry);
    try {
      if ((await fs.stat(file)).size > MAX_BYTES) throw new Error('El archivo supera 128 MB.');
      return { id, name: entry.title, format: entry.format, bytes: new Uint8Array(await fs.readFile(file)) };
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`No se encuentra el archivo de «${entry.title}». Puede que se haya movido o borrado.`);
      throw error;
    }
  }
  async function setDuration(id, duration) {
    const entry = await find(id);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 3600) return;
    entry.duration = Math.round(duration * 10) / 10; await save();
  }
  async function remove(id) {
    const entry = await find(id);
    entries = entries.filter(item => item !== entry); await save();
    if (entry.source === 'youtube') await fs.rm(ownedFile(entry), { force: true });
  }
  async function exportPath(id) {
    const entry = await find(id);
    return { file: entry.source === 'file' ? entry.path : ownedFile(entry), name: entry.title, format: entry.format };
  }
  return { list, addImport, addLocal, read, setDuration, remove, exportPath };
}
module.exports = { createLibrary, FORMATS };

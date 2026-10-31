import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createLibrary } = require('../desktop/library.cjs');
async function testRoot() { await mkdir('work', { recursive: true }); return mkdtemp(path.resolve('work/library-test-')); }
test('guarda importaciones de YouTube, las lee y las conserva al reabrir', async () => {
  const root = await testRoot();
  try {
    const library = createLibrary(path.join(root, 'library'));
    const entry = await library.addImport({ name: 'Mi tema', format: 'm4a', bytes: new Uint8Array([1, 2, 3]) }, 'https://www.youtube.com/watch?v=BaW_jenozKc');
    assert.match(entry.id, /^[a-f0-9]{16}$/); assert.equal(entry.source, 'youtube'); assert.equal(entry.path, undefined);
    assert.deepEqual([...(await library.read(entry.id)).bytes], [1, 2, 3]);
    await library.setDuration(entry.id, 201.37);
    const reopened = createLibrary(path.join(root, 'library'));
    assert.deepEqual((await reopened.list()).map(item => [item.title, item.duration]), [['Mi tema', 201.4]]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('referencia archivos locales sin copiarlos y no los duplica', async () => {
  const root = await testRoot();
  try {
    const song = path.join(root, 'Canción.mp3'); await writeFile(song, new Uint8Array([9]));
    const library = createLibrary(path.join(root, 'library'));
    const first = await library.addLocal(song), second = await library.addLocal(song);
    assert.equal(first.id, second.id); assert.equal(first.title, 'Canción');
    assert.deepEqual(await readdir(path.join(root, 'library')), ['library.json']);
    await assert.rejects(library.addLocal(path.join(root, 'notas.txt')), /Formato no compatible/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('borrar quita el archivo propio pero nunca el archivo local del usuario', async () => {
  const root = await testRoot();
  try {
    const song = path.join(root, 'local.wav'); await writeFile(song, new Uint8Array([1]));
    const library = createLibrary(path.join(root, 'library'));
    const local = await library.addLocal(song);
    const imported = await library.addImport({ name: 'YT', format: 'webm', bytes: new Uint8Array([2]) }, 'https://youtu.be/BaW_jenozKc');
    await library.remove(local.id); await library.remove(imported.id);
    assert.deepEqual(await readdir(root).then(names => names.sort()), ['library', 'local.wav']);
    assert.deepEqual(await readdir(path.join(root, 'library')), ['library.json']);
    assert.deepEqual(await library.list(), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('rechaza identificadores manipulados y avisa si un archivo local desaparece', async () => {
  const root = await testRoot();
  try {
    const song = path.join(root, 'se-va.ogg'); await writeFile(song, new Uint8Array([1]));
    const library = createLibrary(path.join(root, 'library'));
    const entry = await library.addLocal(song);
    await assert.rejects(library.read('../library'), /no válida/);
    await rm(song);
    await assert.rejects(library.read(entry.id), /No se encuentra el archivo de «se-va»/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

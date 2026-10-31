import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { normalizeYouTubeURL, downloadArgs, createImporter } = require('../desktop/youtube.cjs');
const url = 'https://www.youtube.com/watch?v=BaW_jenozKc';
async function testRoot() { await mkdir('work', { recursive: true }); return mkdtemp(path.resolve('work/youtube-test-')); }
async function cleanRoot(root) {
  const relative = path.relative(path.resolve('work'), path.resolve(root));
  assert.ok(relative.startsWith('youtube-test-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
  await rm(root, { recursive: true, force: true });
}
test('acepta vídeos individuales y descarta parámetros de playlist y seguimiento', () => {
  assert.equal(normalizeYouTubeURL('https://youtu.be/BaW_jenozKc?t=10'), url);
  assert.equal(normalizeYouTubeURL(url + '&list=123'), url);
  assert.equal(normalizeYouTubeURL('https://youtube.com/shorts/BaW_jenozKc'), url);
});
test('rechaza hosts suplantados, credenciales, protocolos y listas', () => {
  for (const value of ['file:///etc/passwd', 'https://youtube.com.evil.test/watch?v=BaW_jenozKc', 'https://user@youtube.com/watch?v=BaW_jenozKc', 'https://youtube.com/playlist?list=123', '--exec dangerous', 'https://youtu.be/not-an-id', 'https://youtube.com:8080/watch?v=BaW_jenozKc']) assert.throws(() => normalizeYouTubeURL(value));
});
test('el proceso no utiliza shell, configuración, cookies ni comandos de usuario', () => {
  const args = downloadArgs(url, 'C:/temp/test', 'C:/Program Files/Pulso DJ.exe');
  assert.ok(args.includes('--ignore-config')); assert.ok(args.includes('--no-plugin-dirs'));
  assert.equal(args[args.indexOf('--encoding') + 1], 'utf-8', 'títulos con acentos y emoji');
  assert.equal(args.at(-2), '--'); assert.equal(args.at(-1), url);
  assert.ok(!args.some(value => /cookies|allow-unplayable|exec$/.test(value)));
});
test('importa bytes, emite progreso y limpia únicamente su carpeta temporal', async () => {
  const root = await testRoot();
  const executable = path.join(root, 'fake-tool'); await writeFile(executable, 'fixture');
  let options;
  const fakeSpawn = (_file, args, config) => {
    options = config;
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', -1);
    const output = args[args.indexOf('--output') + 1].replace('%(ext)s', 'm4a');
    setTimeout(async () => {
      await writeFile(output, 'test-audio');
      child.stdout.write('PULSO_TITLE:Mi pista\n');
      child.stderr.write('PULSO_PROGRESS: 5'); child.stderr.write('0.0%\n'); child.emit('close', 0);
    }, 10);
    return child;
  };
  try {
    const importer = createImporter({ executable, runtime: process.execPath, tempRoot: root, spawnProcess: fakeSpawn });
    const updates = []; const file = await importer.importAudio(url, progress => updates.push(progress));
    assert.equal(file.name, 'Mi pista'); assert.equal(Buffer.from(file.bytes).toString(), 'test-audio');
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    assert.ok(updates.some(item => item.percent === 50));
    assert.deepEqual(await readdir(root), ['fake-tool']);
  } finally { await cleanRoot(root); }
});
test('cancelación y bloqueo de una segunda importación simultánea', async () => {
  const root = await testRoot();
  const executable = path.join(root, 'fake-tool'); await writeFile(executable, 'fixture');
  let started; const ready = new Promise(resolve => { started = resolve; });
  const fakeSpawn = () => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => setImmediate(() => child.emit('close', -1)); started(); return child;
  };
  try {
    const importer = createImporter({ executable, runtime: process.execPath, tempRoot: root, spawnProcess: fakeSpawn });
    const pending = importer.importAudio(url); const rejected = assert.rejects(pending, /cancelada/); await ready;
    await assert.rejects(importer.importAudio(url), /curso/); importer.cancel(); await rejected;
    assert.deepEqual(await readdir(root), ['fake-tool']);
  } finally { await cleanRoot(root); }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import http from 'node:http';
const require = createRequire(import.meta.url);
const { createRequestService, cleanPart } = require('../desktop/requests.cjs');
const guestFolder = path.resolve('desktop/guest');
const video = id => `https://youtu.be/${id}`;
async function open(changes = []) {
  let time = 1_000_000;
  const service = createRequestService({ guestFolder, onChange: list => changes.push(list), now: () => time });
  const info = await service.open({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${info.port}`;
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(async response => ({ status: response.status, body: await response.json() }));
  return { service, info, base, post, advance: ms => { time += ms; } };
}
const client = 'a1b2c3d4e5f6a7b8c9d0';
test('sirve la página del móvil con su política de seguridad', async () => {
  const { service, base } = await open();
  try {
    const response = await fetch(base + '/');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /frame-src https:\/\/www\.youtube\.com/);
    assert.match(await response.text(), /Pide tu canción/);
    assert.equal((await fetch(base + '/../main.cjs')).status, 404);
    assert.equal((await fetch(base + '/package.json')).status, 404);
  } finally { await service.close(); }
});
test('un pedido válido queda en espera y el invitado ve su estado', async () => {
  const changes = [];
  const { service, info, post } = await open(changes);
  try {
    const sent = await post('/api/requests', { code: info.code.toLowerCase(), client, name: '  Ana  ', url: video('dQw4w9WgXcQ'), start: 42, end: 120.25, title: 'Tema' });
    assert.equal(sent.status, 201); assert.equal(sent.body.status, 'pending');
    const [item] = service.list();
    assert.equal(item.name, 'Ana'); assert.equal(item.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'); assert.equal(item.end, 120.3);
    assert.equal(changes.length, 1);
    service.update(item.id, { status: 'ready' });
    const mine = await post('/api/mine', { code: info.code, client });
    assert.deepEqual(mine.body.map(entry => entry.status), ['ready']);
    assert.equal(mine.body[0].name, undefined, 'el invitado no ve datos de otros');
    assert.deepEqual((await post('/api/mine', { code: info.code, client: 'ffffffffffffffffffff' })).body, []);
  } finally { await service.close(); }
});
test('rechaza código incorrecto, y bloquea tras 10 intentos', async () => {
  const { service, info, post } = await open();
  try {
    assert.equal((await post('/api/check', { code: 'ZZZZ' })).status, 403);
    for (let i = 0; i < 9; i++) await post('/api/check', { code: 'ZZZZ' });
    assert.equal((await post('/api/check', { code: info.code })).status, 429, 'bloqueado aunque ahora acierte');
  } finally { await service.close(); }
});
test('valida la parte, el enlace, el nombre, los límites por invitado y los duplicados', async () => {
  const { service, info, post, advance } = await open();
  try {
    const ask = (id, extra = {}) => post('/api/requests', { code: info.code, client, name: 'Luis', url: video(id), start: 0, end: 60, ...extra });
    assert.equal((await ask('aaaaaaaaaaa', { end: 181 })).status, 400, 'más de 3 minutos');
    assert.equal((await ask('aaaaaaaaaaa', { end: 5 })).status, 400, 'menos de 10 segundos');
    assert.equal((await ask('aaaaaaaaaaa', { url: 'https://example.com/watch?v=aaaaaaaaaaa' })).status, 400);
    assert.equal((await ask('aaaaaaaaaaa', { name: ' ' })).status, 400);
    assert.equal((await ask('aaaaaaaaaaa')).status, 201);
    assert.equal((await ask('bbbbbbbbbbb')).status, 429, 'espera entre pedidos');
    advance(21000); assert.equal((await ask('aaaaaaaaaaa', { client: 'b'.repeat(20) })).status, 409, 'canción ya pedida');
    advance(21000); assert.equal((await ask('bbbbbbbbbbb')).status, 201);
    advance(21000); assert.equal((await ask('ccccccccccc')).status, 201);
    advance(21000); assert.equal((await ask('ddddddddddd')).status, 429, 'máximo 3 en espera');
    service.update(service.list()[0].id, { status: 'rejected' });
    assert.equal((await ask('ddddddddddd')).status, 201, 'al terminar uno puede pedir otro');
    service.clearFinished(); assert.equal(service.list().length, 3);
  } finally { await service.close(); }
});
test('solo responde a las direcciones de este ordenador (protege de DNS rebinding)', async () => {
  const { service, info } = await open();
  try {
    const status = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: info.port, path: '/', headers: { Host: 'evil.example:80' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(status, 421);
  } finally { await service.close(); }
});
test('la parte se redondea y respeta 10 s-3 min', () => {
  assert.deepEqual(cleanPart(10.04, 70.06), { start: 10, end: 70.1 });
  assert.throws(() => cleanPart(50, 20)); assert.throws(() => cleanPart(0, 1300)); assert.throws(() => cleanPart(NaN, 20));
});

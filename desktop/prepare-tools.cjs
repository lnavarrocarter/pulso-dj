const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : null;
const asset = platform === 'win' ? 'yt-dlp.exe' : 'yt-dlp_macos';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'Pulso-DJ-build' } });
  if (!response.ok) throw new Error(`Descarga fallida: HTTP ${response.status}`);
  return response;
}
async function prepare() {
  if (!platform) throw new Error('Solo Windows y macOS por ahora');
  const folder = path.join(__dirname, '../assets/tools', platform);
  const executable = path.join(folder, platform === 'win' ? 'yt-dlp.exe' : 'yt-dlp');
  const manifestPath = path.join(folder, 'manifest.json');
  if (!process.argv.includes('--update')) {
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      if (hash(await fs.readFile(executable)) === manifest.sha256) {
        await ensureNotices(folder, manifest.version);
        console.log(`yt-dlp ${manifest.version}: verificado`); return;
      }
    } catch { /* First installation or damaged binary: download a verified copy. */ }
  }
  const release = await (await get('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest')).json();
  const prefix = `https://github.com/yt-dlp/yt-dlp/releases/download/${encodeURIComponent(release.tag_name)}/`;
  const checksumText = await (await get(prefix + 'SHA2-256SUMS')).text();
  const line = checksumText.split('\n').find(line => line.trim().split(/\s+/).at(-1).replace(/^\*/, '') === asset);
  const expected = line?.split(/\s+/)[0];
  if (!/^[a-f0-9]{64}$/i.test(expected || '')) throw new Error('No se encontró checksum del ejecutable');
  console.log(`Descargando yt-dlp ${release.tag_name} desde su repositorio oficial…`);
  const bytes = Buffer.from(await (await get(prefix + asset)).arrayBuffer());
  if (hash(bytes) !== expected.toLowerCase()) throw new Error('Checksum de yt-dlp incorrecto');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(executable, bytes); if (platform === 'mac') await fs.chmod(executable, 0o755);
  await fs.writeFile(manifestPath, JSON.stringify({ version: release.tag_name, sha256: hash(bytes), source: prefix + asset }, null, 2));
  const license = await (await get(`https://raw.githubusercontent.com/yt-dlp/yt-dlp/${encodeURIComponent(release.tag_name)}/LICENSE`)).text();
  await fs.writeFile(path.join(folder, 'LICENSE-yt-dlp.txt'), license);
  await fs.writeFile(path.join(folder, 'NOTICE.txt'), 'yt-dlp: https://github.com/yt-dlp/yt-dlp\nOfficial standalone binary; includes upstream dependencies and embedded EJS.\nUpstream license and bundled binary license notices apply. Source for this release: '+`https://github.com/yt-dlp/yt-dlp/tree/${release.tag_name}\n`);
  await ensureNotices(folder, release.tag_name, true);
  console.log(`yt-dlp ${release.tag_name}: descargado y verificado`);
}
async function ensureNotices(folder, version, refresh = false) {
  const file = path.join(folder, 'THIRD_PARTY_LICENSES.txt');
  try { if (refresh) throw new Error('Refresh notices'); await fs.access(file); } catch {
    const text = await (await get(`https://raw.githubusercontent.com/yt-dlp/yt-dlp/${encodeURIComponent(version)}/THIRD_PARTY_LICENSES.txt`)).text();
    await fs.writeFile(file, text);
  }
}
prepare().catch(error => { console.error(error.message); process.exitCode = 1; });

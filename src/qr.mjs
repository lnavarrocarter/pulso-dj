// Minimal QR code encoder (ISO/IEC 18004): byte mode, error correction level M, versions 1-10.
// Enough for the request page address (up to 213 bytes). Follows the structure of Project Nayuki's reference encoder.
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const FORMAT_M = 0;
const rawModules = version => {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) { const align = Math.floor(version / 7) + 2; result -= (25 * align - 10) * align - 55; if (version >= 7) result -= 36; }
  return result;
};
const dataCodewords = version => Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version];
function multiply(x, y) { // GF(2^8) modulo x^8 + x^4 + x^3 + x^2 + 1
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z;
}
function divisor(degree) {
  const result = new Array(degree).fill(0); result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) { result[j] = multiply(result[j], root); if (j + 1 < degree) result[j] ^= result[j + 1]; }
    root = multiply(root, 2);
  }
  return result;
}
function remainder(data, generator) {
  const result = new Array(generator.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ result.shift(); result.push(0);
    generator.forEach((coefficient, i) => { result[i] ^= multiply(coefficient, factor); });
  }
  return result;
}
function alignmentPositions(version, size) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2, step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2, result = [6];
  for (let position = size - 7; result.length < count; position -= step) result.splice(1, 0, position);
  return result;
}
export function encodeQR(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 1;
  const bitsNeeded = v => 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
  while (version <= 10 && bitsNeeded(version) > dataCodewords(version) * 8) version++;
  if (version > 10) throw new Error('Texto demasiado largo para el código QR.');
  // Data bits: mode, length, bytes, terminator, padding.
  const bits = [], push = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  push(4, 4); push(bytes.length, version < 10 ? 8 : 16); for (const byte of bytes) push(byte, 8);
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length)); push(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  // Error correction blocks, interleaved.
  const blockCount = BLOCKS[version], eccLength = ECC_PER_BLOCK[version], total = Math.floor(rawModules(version) / 8);
  const shortBlocks = blockCount - total % blockCount, shortLength = Math.floor(total / blockCount), generator = divisor(eccLength);
  const blocks = [];
  for (let i = 0, k = 0; i < blockCount; i++) {
    const block = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1)); k += block.length;
    const ecc = remainder(block, generator); if (i < shortBlocks) block.push(0);
    blocks.push(block.concat(ecc));
  }
  const codewords = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((block, j) => { if (i !== shortLength - eccLength || j >= shortBlocks) codewords.push(block[i]); });
  // Function patterns.
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { modules[y][x] = dark; reserved[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, distance = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4);
    }
  }
  const align = alignmentPositions(version, size), last = align.length - 1;
  align.forEach((x, i) => align.forEach((y, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = mask => {
    const value = (FORMAT_M << 3) | mask; let rem = value;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const format = ((value << 10) | rem) ^ 0x5412, bit = i => ((format >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const value = (version << 12) | rem;
    for (let i = 0; i < 18; i++) { const dark = ((value >>> i) & 1) === 1, a = size - 11 + i % 3, b = Math.floor(i / 3); set(a, b, dark); set(b, a, dark); }
  }
  // Codewords in the zigzag order, then the mask with the lowest penalty.
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vertical : vertical;
      if (!reserved[y][x] && index < codewords.length * 8) { modules[y][x] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) === 1; index++; }
    }
  }
  const masks = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
  const applyMask = mask => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!reserved[y][x] && masks[mask](x, y)) modules[y][x] = !modules[y][x]; };
  const penalty = () => {
    let score = 0, dark = 0;
    for (let line = 0; line < size; line++) for (const horizontal of [true, false]) {
      let run = 1;
      for (let i = 1; i <= size; i++) {
        const same = i < size && (horizontal ? modules[line][i] === modules[line][i - 1] : modules[i][line] === modules[i - 1][line]);
        if (same) run++; else { if (run >= 5) score += run - 2; run = 1; }
      }
    }
    for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x]; if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
    }
    for (const row of modules) for (const cell of row) if (cell) dark++;
    return score + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  };
  let best = 0, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask); drawFormat(mask);
    const score = penalty(); if (score < bestScore) { bestScore = score; best = mask; }
    applyMask(mask);
  }
  applyMask(best); drawFormat(best);
  return { size, version, modules };
}
// Draws the code with a 4-module quiet zone, black on white so phone cameras read it in any theme.
export function drawQR(canvas, text) {
  const { size, modules } = encodeQR(text), scale = Math.floor(canvas.width / (size + 8)), offset = Math.floor((canvas.width - scale * size) / 2);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#000';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (modules[y][x]) context.fillRect(offset + x * scale, offset + y * scale, scale, scale);
}

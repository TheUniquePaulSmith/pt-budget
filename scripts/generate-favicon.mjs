import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

// Draws the winged-money (💸) favicon from the same pixel sprite the 404 page
// animates (src/lib/pixelMoneySprite.json) and writes:
//   src/app/icon.svg      the modern, scalable icon
//   src/app/favicon.ico   16/32/48 px PNG-in-ICO for browsers that still ask for /favicon.ico
// No dependencies: the PNG/ICO encoding below is just zlib plus a CRC table.
// Usage: npm run favicon:generate [-- --wings=up|mid|down]

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPRITE_PATH = path.join(ROOT, 'src', 'lib', 'pixelMoneySprite.json');
const ICON_SIZE = 16;
const ICO_SCALES = [1, 2, 3];

const wingsArg = process.argv.find((arg) => arg.startsWith('--wings='))?.slice('--wings='.length) ?? 'up';
const sprite = JSON.parse(readFileSync(SPRITE_PATH, 'utf8'));
if (!sprite.wings[wingsArg]) {
  console.error(`Unknown wing frame "${wingsArg}"; use ${Object.keys(sprite.wings).join(', ')}.`);
  process.exit(1);
}

// Composite bill over wings onto the square icon grid, sprite centred.
const offsetX = Math.floor((ICON_SIZE - sprite.width) / 2);
const offsetY = Math.floor((ICON_SIZE - sprite.height) / 2);
const grid = Array.from({ length: ICON_SIZE }, () => Array(ICON_SIZE).fill(null));
for (let y = 0; y < sprite.height; y += 1) {
  for (let x = 0; x < sprite.width; x += 1) {
    const key = sprite.bill[y][x] !== '.' ? sprite.bill[y][x] : sprite.wings[wingsArg][y][x];
    if (key !== '.') grid[y + offsetY][x + offsetX] = sprite.palette[key];
  }
}

function toSvg() {
  const pathByColor = new Map();
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const color = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === color) end += 1;
      if (color) pathByColor.set(color, `${pathByColor.get(color) ?? ''}M${x} ${y}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  });
  const paths = [...pathByColor.entries()].map(([color, d]) => `<path fill="${color}" d="${d}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" shape-rendering="crispEdges">${paths}</svg>\n`;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUInt32BE(data.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), body.length + 4);
  return chunk;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Nearest-neighbour upscale keeps the pixel art crisp at 32 and 48 px.
function toPng(scale) {
  const size = ICON_SIZE * scale;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const color = grid[Math.floor(y / scale)][Math.floor(x / scale)];
      const [r, g, b] = color ? hexToRgb(color) : [0, 0, 0];
      raw.set([r, g, b, color ? 255 : 0], rowStart + 1 + x * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function toIco() {
  const images = ICO_SCALES.map((scale) => ({ size: ICON_SIZE * scale, png: toPng(scale) }));
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2); // type: icon
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    directory[entry] = size;
    directory[entry + 1] = size;
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([directory, ...images.map(({ png }) => png)]);
}

writeFileSync(path.join(ROOT, 'src', 'app', 'icon.svg'), toSvg());
writeFileSync(path.join(ROOT, 'src', 'app', 'favicon.ico'), toIco());
console.log(`Wrote src/app/icon.svg and src/app/favicon.ico (wings: ${wingsArg}).`);

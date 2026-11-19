// Generates icons/icon-192.png and icons/icon-512.png from a simple vector-ish
// design (rounded square, five strings, a pluck dot) using only Node built-ins.
// Run: node scripts/gen-icons.mjs
// NOTE: generation script is an addition to the C1 layout (see DEVIATIONS.md).

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- minimal PNG encoder ----
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- drawing ----
function drawIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const s = size / 192; // design in 192 units
  const px = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };

  // rounded-rectangle background
  const radius = 36 * s;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.max(radius - x, x - (size - 1 - radius), 0);
      const cy = Math.max(radius - y, y - (size - 1 - radius), 0);
      if (cx * cx + cy * cy <= radius * radius || (x >= radius && x < size - radius) || (y >= radius && y < size - radius)) {
        const insideCorner = (x < radius || x >= size - radius) && (y < radius || y >= size - radius);
        if (!insideCorner || cx * cx + cy * cy <= radius * radius) px(x, y, 0x2f, 0x5d, 0x50);
      }
    }
  }

  // five strings (light lines)
  for (let line = 0; line < 5; line++) {
    const y0 = Math.round((52 + line * 22) * s);
    for (let x = Math.round(28 * s); x < Math.round(164 * s); x++) {
      for (let dy = -1; dy <= 1; dy++) px(x, y0 + dy, 0xe9, 0xf2, 0xee);
    }
  }

  // pluck dot on the middle string
  const dx = 118 * s, dy = 96 * s, r = 14 * s;
  for (let y = Math.floor(dy - r); y <= dy + r; y++) {
    for (let x = Math.floor(dx - r); x <= dx + r; x++) {
      if ((x - dx) ** 2 + (y - dy) ** 2 <= r * r) px(x, y, 0xe9, 0xf2, 0xee);
    }
  }

  return buf;
}

mkdirSync(join(root, 'icons'), { recursive: true });
for (const size of [192, 512]) {
  const png = encodePng(size, drawIcon(size));
  writeFileSync(join(root, 'icons', `icon-${size}.png`), png);
  console.log(`wrote icons/icon-${size}.png (${png.length} bytes)`);
}

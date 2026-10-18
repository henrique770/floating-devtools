// Generates the toolbar icons (black circle + up/down arrows) as PNGs, no dependencies.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Same geometry as the in-page Logo (24x24 viewBox).
const SEGMENTS = [
  [8, 19, 8, 5], [4, 9, 8, 5], [8, 5, 12, 9],
  [16, 5, 16, 19], [12, 15, 16, 19], [16, 19, 20, 15],
];

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const scale = size / 32;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / scale, py = (y + 0.5) / scale; // 32-unit space
      const r = Math.hypot(px - 16, py - 16);
      const circle = Math.max(0, Math.min(1, (15.5 - r) * scale + 0.5));
      const ring = Math.max(0, Math.min(1, (0.9 - Math.abs(r - 15)) * scale)) * 0.35;
      // glyph: 24-unit logo centered in 32 units at 0.75 scale
      const gx = (px - 16) / 0.75 + 12, gy = (py - 16) / 0.75 + 12;
      const d = Math.min(...SEGMENTS.map((s) => segDist(gx, gy, ...s)));
      const glyph = Math.max(0, Math.min(1, (1.4 - d) * scale * 0.75 + 0.5));
      const v = Math.round(255 * Math.min(1, glyph + ring));
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = raw[o + 1] = raw[o + 2] = v;
      raw[o + 3] = Math.round(255 * circle);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function writeIcons(dir) {
  mkdirSync(dir, { recursive: true });
  for (const size of [16, 32, 48, 128]) writeFileSync(`${dir}/icon${size}.png`, png(size));
}

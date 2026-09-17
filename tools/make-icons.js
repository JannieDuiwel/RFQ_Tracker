'use strict';
/**
 * Generates the app icons as PNGs, so the repo carries no binary blobs and
 * `npm install` always produces them.
 *
 * Hand-rolled PNG encoding rather than an image dependency: for solid blocks
 * and a simple glyph it is a few dozen lines of zlib + CRC32, and it means the
 * artwork is tweaked by editing numbers rather than opening an editor.
 *
 * The mark is a clipboard with three lines on it - the same thing the tkinter
 * app used as its window title glyph, and legible at 16px, which is the only
 * real constraint on an app icon.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'src', 'assets');

const BG = [0x2d, 0x35, 0x61];   // the toolbar navy
const BOARD = [0xf4, 0xf6, 0xfb];
const CLIP = [0x6c, 0x5c, 0xe7]; // the accent violet
const LINE = [0x9a, 0xa3, 0xc4];
const DONE = [0x00, 0xb8, 0x94]; // one line ticked off, in the "won" green

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, draw) {
  // One filter byte (0 = none) per row, then RGB triples.
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);

  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = draw(x, y, size);
      const o = y * stride + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // colour type: truecolour
  // 10..12 stay 0: deflate, adaptive filtering, no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** True inside a rounded rectangle, all in 32-unit design space. */
function inRounded(gx, gy, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(gx, x0 + r), x1 - r);
  const cy = Math.min(Math.max(gy, y0 + r), y1 - r);
  return Math.hypot(gx - cx, gy - cy) <= r;
}

function icon(x, y, size) {
  const u = size / 32;              // design on a 32-unit grid
  const gx = x / u;
  const gy = y / u;

  // The board.
  if (!inRounded(gx, gy, 6, 5, 26, 28, 2.5)) return BG;

  // The clip at the top, drawn over the board.
  if (inRounded(gx, gy, 12, 3, 20, 8, 1.5)) return CLIP;

  // Three ruled lines. The first is the accent, the last is "done" green, and
  // the lines are 2 units apart so they survive being scaled to 16px.
  const lines = [
    { top: 12, right: 22, colour: LINE },
    { top: 17, right: 20, colour: LINE },
    { top: 22, right: 18, colour: DONE },
  ];
  for (const l of lines) {
    if (gy >= l.top && gy <= l.top + 2 && gx >= 10 && gx <= l.right) return l.colour;
  }

  return BOARD;
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of [512, 256, 64]) {
  const name = size === 512 ? 'icon-512.png' : size === 64 ? 'tray.png' : 'icon.png';
  fs.writeFileSync(path.join(OUT, name), png(size, icon));
}
console.log('icons written to src/assets');

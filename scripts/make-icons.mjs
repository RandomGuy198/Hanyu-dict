// scripts/make-icons.mjs
//
// Pure-Node PWA icon generator for this app. No npm dependencies: only node:fs and
// node:zlib. It hand-encodes valid PNGs (signature + IHDR/IDAT/IEND chunks, CRC32 per
// chunk, RGBA / bit depth 8, zlib-deflated scanlines prefixed with filter byte 0).
//
// The artwork is an ORIGINAL geometric mark. The on-screen BrandMark in
// src/app/icons.tsx is just the text glyph "语" drawn with the device's own CJK font,
// which we deliberately do NOT rasterise (that would require a third-party font binary
// and reproduce another vendor's glyph outlines). Instead this script renders the mark
// described in that file's own comment -- "an abstract seal/square with a stroke" -- as:
//   * a rounded square in the brand teal (--brand-600 / --primary = #1f6f5c), and
//   * a white (--on-primary #ffffff) abstract seal glyph: a square ring plus one
//     diagonal calligraphic stroke.
// No third-party logo, no trademark, no text, no photo content.
//
// Idempotent: output is fully deterministic (no timestamps, no tIME chunk), so running
// it again rewrites byte-identical files.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// --- palette, taken verbatim from src/styles/tokens.css -------------------------------
const TEAL = [0x1f, 0x6f, 0x5c]; // --brand-600 == --primary == meta theme-color
const WHITE = [0xff, 0xff, 0xff]; // --on-primary
const PAPER = [0xfb, 0xfa, 0xf6]; // --paper

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const ICONS_DIR = join(ROOT, 'public', 'icons');
const PUBLIC_DIR = join(ROOT, 'public');

// --- CRC32 (PNG polynomial 0xEDB88320) ------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- PNG chunk + encoder --------------------------------------------------------------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Encode an RGBA byte buffer as a valid PNG (colour type 6, bit depth 8, no interlace). */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression (deflate)
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter byte 0 (None)
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// --- geometry helpers (all in normalised 0..1 space) ----------------------------------
function inRoundRect(u, v, x0, y0, x1, y1, r) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const rx = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  const nx = Math.min(Math.max(u, x0 + rx), x1 - rx);
  const ny = Math.min(Math.max(v, y0 + rx), y1 - rx);
  const dx = u - nx;
  const dy = v - ny;
  return dx * dx + dy * dy <= rx * rx;
}

function distToSegment(u, v, ax, ay, bx, by) {
  const px = u - ax;
  const py = v - ay;
  const vx = bx - ax;
  const vy = by - ay;
  const L = vx * vx + vy * vy;
  let t = L ? (px * vx + py * vy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - vx * t, py - vy * t);
}

/**
 * Render one square icon.
 *  kind 'any'       -> transparent background, brand-teal squircle, white glyph.
 *  kind 'apple'     -> opaque paper background (Apple touch icons are composited
 *                      without alpha), same squircle + glyph.
 *  kind 'maskable'  -> full-bleed teal background, glyph kept inside the central
 *                      safe zone (>=10% padding on every edge) so platform masks
 *                      (circle / squircle) never clip it.
 */
function renderIcon(size, kind) {
  const SQU = 0.04; // squircle inset for 'any'/'apple'
  const SQ_END = 1 - SQU;
  const SQ_R = 0.27 * (SQ_END - SQU); // ~ matches .brand-mark radius ratio

  // Glyph geometry: normal ('any'/'apple') vs enlarged-but-safe ('maskable').
  const g =
    kind === 'maskable'
      ? { ro: 0.22, ri: 0.31, rr: 0.08, rir: 0.05, a: 0.35, b: 0.65, half: 0.035 }
      : { ro: 0.27, ri: 0.345, rr: 0.1, rir: 0.05, a: 0.4, b: 0.6, half: 0.03 };

  const sample = (u, v) => {
    // returns [r, g, b, a]
    let cr, cg, cb, ca;
    if (kind === 'maskable') {
      [cr, cg, cb, ca] = [...TEAL, 255];
    } else {
      const inSq = inRoundRect(u, v, SQU, SQU, SQ_END, SQ_END, SQ_R);
      if (inSq) [cr, cg, cb, ca] = [...TEAL, 255];
      else if (kind === 'apple') [cr, cg, cb, ca] = [...PAPER, 255];
      else [cr, cg, cb, ca] = [0, 0, 0, 0];
    }
    const ring =
      inRoundRect(u, v, g.ro, g.ro, 1 - g.ro, 1 - g.ro, g.rr) &&
      !inRoundRect(u, v, g.ri, g.ri, 1 - g.ri, 1 - g.ri, g.rir);
    const stroke = distToSegment(u, v, g.a, g.b, g.b, g.a) <= g.half;
    if (ring || stroke) [cr, cg, cb, ca] = [...WHITE, 255];
    return [cr, cg, cb, ca];
  };

  const ss = size <= 192 ? 4 : size <= 384 ? 3 : 2; // supersampling factor for AA
  const step = 1 / ss;
  const rgba = Buffer.alloc(size * size * 4);
  let p = 0;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let aSum = 0;
      let pr = 0;
      let pg = 0;
      let pb = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (px + (sx + 0.5) * step) / size;
          const v = (py + (sy + 0.5) * step) / size;
          const [r, gch, b, a] = sample(u, v);
          aSum += a;
          pr += r * a; // premultiplied accumulation
          pg += gch * a;
          pb += b * a;
        }
      }
      const n = ss * ss;
      const alpha = aSum / n;
      rgba[p++] = alpha > 0 ? Math.round(pr / aSum) : 0;
      rgba[p++] = alpha > 0 ? Math.round(pg / aSum) : 0;
      rgba[p++] = alpha > 0 ? Math.round(pb / aSum) : 0;
      rgba[p++] = Math.round(alpha);
    }
  }
  return encodePng(size, size, rgba);
}

// --- vector master + favicon (same mark, as SVG) --------------------------------------
function squircleSvg(size) {
  const sq = 0.04 * size;
  const sqEnd = 0.96 * size;
  const sqR = 0.27 * (sqEnd - sq);
  // glyph: square ring drawn as a stroked rounded rect along the band's midline
  const frameX = 0.3075 * size; // midline of the ring band
  const frameW = (0.6925 - 0.3075) * size;
  const frameR = 0.08 * size;
  const bandW = 0.075 * size; // ring thickness (outer 0.27 .. inner 0.345)
  const strokeW = 0.06 * size; // diagonal stroke thickness (half-width 0.03)
  const a = 0.4 * size;
  const b = 0.6 * size;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Hanyu Dictionary mark">
  <title>Hanyu Dictionary</title>
  <rect x="${sq}" y="${sq}" width="${(sqEnd - sq).toFixed(2)}" height="${(sqEnd - sq).toFixed(2)}" rx="${sqR.toFixed(2)}" fill="#1f6f5c"/>
  <rect x="${frameX.toFixed(2)}" y="${frameX.toFixed(2)}" width="${frameW.toFixed(2)}" height="${frameW.toFixed(2)}" rx="${frameR.toFixed(2)}" fill="none" stroke="#ffffff" stroke-width="${bandW.toFixed(2)}"/>
  <line x1="${a.toFixed(2)}" y1="${b.toFixed(2)}" x2="${b.toFixed(2)}" y2="${a.toFixed(2)}" stroke="#ffffff" stroke-width="${strokeW.toFixed(2)}" stroke-linecap="round"/>
  <desc>Original abstract seal mark: a brand-teal rounded square with a white square ring and one diagonal stroke. Not derived from any third-party logo or font glyph.</desc>
</svg>
`;
}

// --- self-verification: decode a PNG back and prove IHDR/IDAT/CRC integrity -----------
function verifyPng(path, expectedW, expectedH) {
  const buf = readFileSync(path);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error(`${path}: bad signature`);
  let off = 8;
  const seen = [];
  let ihdr = null;
  let idatLen = 0;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    const crcRead = buf.readUInt32BE(off + 8 + len);
    const crcCalc = crc32(buf.subarray(off + 4, off + 8 + len));
    if (crcRead !== crcCalc) throw new Error(`${path}: CRC mismatch in ${type}`);
    seen.push(type);
    if (type === 'IHDR') {
      ihdr = {
        w: data.readUInt32BE(0),
        h: data.readUInt32BE(4),
        depth: data[8],
        color: data[9],
        interlace: data[12],
      };
    }
    if (type === 'IDAT') idatLen += len;
    off += 12 + len;
  }
  if (seen.join(',') !== 'IHDR,IDAT,IEND') throw new Error(`${path}: unexpected chunk order ${seen}`);
  if (!ihdr || ihdr.w !== expectedW || ihdr.h !== expectedH || ihdr.depth !== 8 || ihdr.color !== 6 || ihdr.interlace !== 0) {
    throw new Error(`${path}: IHDR mismatch ${JSON.stringify(ihdr)}`);
  }
  if (idatLen === 0) throw new Error(`${path}: empty IDAT`);
  return { chunks: seen, ...ihdr, bytes: buf.length };
}

// --- outputs --------------------------------------------------------------------------
const PNG_TARGETS = [
  { file: 'icon-192.png', size: 192, kind: 'any' },
  { file: 'icon-384.png', size: 384, kind: 'any' },
  { file: 'icon-512.png', size: 512, kind: 'any' },
  { file: 'icon-180.png', size: 180, kind: 'apple' },
  { file: 'icon-maskable-512.png', size: 512, kind: 'maskable' },
];

mkdirSync(ICONS_DIR, { recursive: true });

for (const t of PNG_TARGETS) {
  const png = renderIcon(t.size, t.kind);
  const path = join(ICONS_DIR, t.file);
  writeFileSync(path, png);
  const info = verifyPng(path, t.size, t.size);
  const kindLabel = t.kind === 'apple' ? 'apple-touch' : t.kind === 'maskable' ? 'maskable' : 'any';
  console.log(
    `${t.file.padEnd(22)} ${t.size}x${t.size}px  ${info.depth}-bit RGBA (colour type 6)  purpose=${kindLabel}  ${info.bytes} bytes  [IHDR/IDAT/IEND CRC ok]`,
  );
}

// vector master + favicon
writeFileSync(join(ICONS_DIR, 'icon.svg'), squircleSvg(512));
writeFileSync(join(PUBLIC_DIR, 'favicon.svg'), squircleSvg(64));
console.log('icon.svg / favicon.svg   vector masters written (original seal mark, no font glyphs).');

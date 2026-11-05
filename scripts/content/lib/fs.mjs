/**
 * Filesystem / hashing / streaming helpers for the content pipeline.
 *
 * Everything in this directory is build-time only. No network access happens
 * here; see fetch-sources.mjs and build-licenses.mjs for that.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** scripts/content/lib -> scripts/content -> scripts -> repo root */
export const LIB_DIR = HERE;
export const CONTENT_DIR = path.resolve(HERE, '..');
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
export const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
export const DATA_DIR = path.join(PUBLIC_DIR, 'data');
export const PACKS_DIR = path.join(DATA_DIR, 'packs');
export const LICENSES_DIR = path.join(PUBLIC_DIR, 'licenses');

/** Default raw-download cache; always OUTSIDE the repository. */
export function defaultCacheDir() {
  return path.resolve(REPO_ROOT, '..', '.cache', 'raw');
}

export function resolveCacheDir(argv = process.argv) {
  const i = argv.indexOf('--cache');
  if (i !== -1 && argv[i + 1]) return path.resolve(argv[i + 1]);
  if (process.env.HANYU_CACHE) return path.resolve(process.env.HANYU_CACHE);
  return defaultCacheDir();
}

export const exists = (p) => fs.existsSync(p);

export async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
  return p;
}

/**
 * Removes every regular file inside `dir` (non-recursive) so a pack directory
 * never mixes stale shards from an older build with the new ones.
 */
export async function clearDir(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) throw new Error(`Refusing to recurse into ${path.join(dir, entry.name)} during clearDir`);
    await fsp.rm(path.join(dir, entry.name), { force: true });
    n++;
  }
  return n;
}

export function readText(p, encoding = 'utf8') {
  return fs.readFileSync(p, encoding);
}

export async function writeTextAtomic(p, text) {
  await ensureDir(path.dirname(p));
  const tmp = `${p}.tmp-${process.pid}`;
  await fsp.writeFile(tmp, text, 'utf8');
  await fsp.rename(tmp, p);
  return p;
}

export function sha256Buf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function sha256File(p) {
  const h = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const s = fs.createReadStream(p);
    s.on('error', reject);
    s.on('data', (c) => h.update(c));
    s.on('end', resolve);
  });
  return h.digest('hex');
}

export function sha256FileSync(p) {
  return sha256Buf(fs.readFileSync(p));
}

export async function byteSize(p) {
  return (await fsp.stat(p)).size;
}

/** Deterministic gzip (fixed mtime, no embedded name) so hashes are stable. */
export async function gzipFile(src, dest, level = 9) {
  await ensureDir(path.dirname(dest));
  const buf = await fsp.readFile(src);
  const out = zlib.gzipSync(buf, { level, mtime: 0 });
  await fsp.writeFile(dest, out);
  return { bytes: out.size ?? out.length, rawBytes: buf.length };
}

export async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fsp.copyFile(src, dest);
  return dest;
}

/** Line-by-line reading of a large UTF-8 file without loading it whole. */
export async function* eachLine(file, { encoding = 'utf8' } = {}) {
  const readline = await import('node:readline/promises');
  const stream = fs.createReadStream(file, { encoding });
  try {
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) yield line;
    rl.close();
  } finally {
    stream.destroy();
  }
}

/** Whole-file split that tolerates CRLF and skips empty trailing lines. */
export function splitLines(text) {
  return text.split(/\r?\n/).filter((l) => l.length > 0);
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '?';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${u === 0 ? v : v.toFixed(v < 10 ? 2 : 1)} ${units[u]}`;
}

/**
 * Fixed-width terminal table used by fetch/build/check scripts.
 * Columns are given as [header, key] pairs.
 */
export function table(rows, columns) {
  const widths = columns.map(([h, k]) => Math.max(String(h).length, ...rows.map((r) => String(r[k] ?? '').length)));
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();
  const out = [line(columns.map((c) => c[0])), line(widths.map((w) => '-'.repeat(w)))];
  for (const r of rows) out.push(line(columns.map(([, k]) => r[k] ?? '')));
  return out.join('\n');
}

/** Build timestamp honouring SOURCE_DATE_EPOCH for reproducible output. */
export function buildTimestamp() {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  if (epoch) {
    const n = Number(epoch);
    if (!Number.isFinite(n)) throw new Error(`SOURCE_DATE_EPOCH is not a number: ${epoch}`);
    return new Date(n * 1000).toISOString().replace(/\.000Z$/, '.000Z');
  }
  return new Date().toISOString().replace(/\.000Z$/, '.000Z');
}

export function log(...args) {
  console.log(...args);
}

/** Code-point ordering: locale-independent and stable across platforms. */
export function compareCodePoints(a, b) {
  const ca = Array.from(a);
  const cb = Array.from(b);
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const x = ca[i].codePointAt(0);
    const y = cb[i].codePointAt(0);
    if (x !== y) return x - y;
  }
  return ca.length - cb.length;
}

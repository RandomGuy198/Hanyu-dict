#!/usr/bin/env node
/**
 * check-public-tree.mjs — the public/private boundary guard (D-23).
 *
 * WHAT THIS IS FOR
 * ----------------
 * This repository is public and is deployed to GitHub Pages. The owner also keeps a *private*
 * repository that holds (a) page images rendered from copyrighted textbooks, (b) OCR-derived
 * lesson JSON, (c) the textbook's companion lesson recordings, (d) machine-generated TTS audio,
 * and (e) personal learning state. None of that may ever appear here — not in the working tree,
 * not in `dist/`, and not in a new commit.
 *
 * This script is the automated half of that promise; `02_LEGAL_AND_LICENSING.md` §4 and §4.1 are
 * its specification. It is deliberately dependency-free and reads only bytes, so it behaves the
 * same locally, in `npm run build`, and in the Pages workflow.
 *
 * WHAT IT CHECKS (each is a hard failure, exit code 1)
 * ---------------------------------------------------
 *  1. Audio files anywhere outside an explicitly allow-listed prefix.
 *  2. Any path segment suggesting a mirrored book/private tree (`books/`, `hanyu-data/`, `pages/`,
 *     `scans/`, `lessons-audio/`, `book/`).
 *  3. Page-scan image names (`p031.webp`, `page-12.jpg`, …).
 *  4. PDFs.
 *  5. GitHub token shapes in any text file.
 *  6. Book/publisher identifiers in `public/`, `src/` and `dist/` (NFC-normalised before matching).
 *  7. Baidu BOS signed-image URLs.
 *  8. Runtime references to the unofficial Edge TTS endpoint / its voice ids.
 *  9. Third-party CDN hosts.
 * 10. A CSP whose `connect-src` allows any origin other than this one and `https://api.github.com`.
 * 11. Personal state files (`progress*.json`, `srs*.json`, `sync*.json`).
 * 12. A Git LFS `.gitattributes` (LFS has a metered bandwidth quota; policy forbids it).
 * 13. Any tracked file larger than 50 MB.
 *
 * SCOPE
 * -----
 * Files tracked by git (`git ls-files`) plus, when present, every file under `dist/`. A file that
 * is neither tracked nor part of a build is out of scope by design: the guard is about what would
 * publish. `dist/` is scanned because `vite build` copies `public/` into it, and because a stale
 * `dist/` left on disk is exactly how a page image reaches a deploy.
 *
 * USAGE
 * -----
 *   node scripts/legal/check-public-tree.mjs           # tracked tree + dist/ if present
 *   node scripts/legal/check-public-tree.mjs --no-dist # tracked tree only
 *   node scripts/legal/check-public-tree.mjs --json    # machine-readable report
 *
 * Exit code 0 = clean, 1 = violations found (listed with file and reason).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'legal', 'allowlist.json');

/* ------------------------------------------------------------------ patterns */

const AUDIO_EXT = /\.(mp3|m4a|ogg|opus|wav|flac|aac)$/i;
const PDF_EXT = /\.pdf$/i;
const PAGE_IMAGE = /(^|\/)page[-_]?\d+\.(png|jpe?g|webp|avif)$/i;
const SHORT_PAGE_IMAGE = /(^|\/)p\d{3,4}\.(png|jpe?g|webp)$/i;
const BOOK_DIRS = /(^|\/)(book|books|hanyu-data|lessons-audio|pages|scans)(\/|$)/i;
const CODE_MODULE_PREFIX = 'src/modules/books/';

const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9]{36}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /gh[ousr]_[A-Za-z0-9]{36}/,
];

const BOOK_IDENTIFIERS = /Giáo trình|GT Hán Ngữ|MCBooks|(?<![A-Za-z])HANKA(?![A-Za-z])|hanka\.edu\.vn|汉语教程|BLCUP/i;
const BAIDU_URL = /bcebos\.com/i;
const EDGE_TTS = /edge[-_]?tts|speech\.platform\.bing\.com|XiaoxiaoNeural/i;
const CDN_HOSTS = /fonts\.googleapis|fonts\.gstatic|cdn\.jsdelivr|unpkg\.com|cdnjs/i;
const PERSONAL_STATE = /(^|\/)(progress|srs|sync)[^/]*\.json$/i;

/** Directories that hold hostile-to-scan content and never need to be read. */
const SKIP_SUBTREES = new Set(['node_modules', '.git', '.cache', 'coverage', 'playwright-report', 'test-results', '.vite']);

/** Extensions whose bytes are never text and must not be decoded for string scanning. */
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'ico', 'bmp', 'tif', 'tiff',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'pdf',
  'mp3', 'm4a', 'ogg', 'opus', 'wav', 'flac', 'aac', 'mp4', 'webm',
  'zip', 'gz', 'bz2', 'xz', '7z', 'tar', 'br',
  'wasm', 'bin', 'apk', 'dex',
]);

const MAX_SOURCE_BYTES = 50 * 1024 * 1024; // 13. no tracked file above this

/* ------------------------------------------------------------------ helpers */

const violations = [];

function violate(check, file, detail) {
  violations.push({ check, file, detail });
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function isTextFile(absPath) {
  const ext = path.extname(absPath).slice(1).toLowerCase();
  if (BINARY_EXT.has(ext)) return false;
  return true;
}

/** Read a file as NFC-normalised UTF-8 text, or null when it cannot be read. */
function readText(absPath) {
  let buf;
  try {
    buf = readFileSync(absPath);
  } catch {
    return null;
  }
  return buf.toString('utf8').normalize('NFC');
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_SUBTREES.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function gitTrackedFiles() {
  try {
    const raw = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
    return raw
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .map((rel) => path.join(ROOT, rel));
  } catch {
    // Not a git checkout (e.g. an exported archive). Fall back to the working tree minus dist/.
    return walk(ROOT).filter((abs) => !toPosix(path.relative(ROOT, abs)).startsWith('dist/'));
  }
}

function loadAllowlist() {
  try {
    const parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
    return Array.isArray(parsed.allowedAudioPrefixes) ? parsed.allowedAudioPrefixes : [];
  } catch {
    violate('allowlist', 'scripts/legal/allowlist.json', 'missing or unparseable; expected { "allowedAudioPrefixes": [] }');
    return [];
  }
}

/* ------------------------------------------------------------------ checks */

function checkFilePath(rel, abs, allowlist) {
  if (AUDIO_EXT.test(rel)) {
    const allowed = allowlist.some((prefix) => rel === prefix || rel.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`));
    if (!allowed) {
      violate('audio', rel, 'audio file outside the licensed allow-list (02 §4.1). Book recordings and TTS output belong in the private repo.');
    }
  }

  if (BOOK_DIRS.test(rel) && !(rel.startsWith(CODE_MODULE_PREFIX) && /\.(tsx?|css)$/i.test(rel))) {
    violate('book-folder', rel, 'path segment looks like a mirrored book/private tree. Private content lives in the `Hanyu data` repo only.');
  }

  if (PAGE_IMAGE.test(rel) || SHORT_PAGE_IMAGE.test(rel)) {
    violate('page-image', rel, 'page-scan image name. Rendered textbook pages are private-repo only (D-01).');
  }

  if (PDF_EXT.test(rel)) {
    violate('pdf', rel, 'PDF is never published (02 §3 D9: originals stay on the owner\'s PC).');
  }

  if (PERSONAL_STATE.test(rel)) {
    violate('personal-state', rel, 'personal progress/SRS/sync state must never be public (R4).');
  }

  let size = 0;
  try {
    size = statSync(abs).size;
  } catch {
    return;
  }
  if (size > MAX_SOURCE_BYTES) {
    violate('size', rel, `tracked file is ${(size / 1024 / 1024).toFixed(1)} MB; limit is 50 MB.`);
  }
}

function scanText(rel, abs, scope) {
  if (!isTextFile(abs)) return;
  const text = readText(abs);
  if (text === null) return;

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      violate('secret', rel, `matches token pattern ${pattern}. Revoke the token, then remove it (R3).`);
    }
  }

  // The detector itself necessarily spells out the strings it detects. Only these two files are
  // exempt, and only from the content scans — secret detection still applies to them.
  const isDetector = rel === 'scripts/legal/check-public-tree.mjs' || rel === 'scripts/legal/allowlist.json';
  if (isDetector) return;

  if (BAIDU_URL.test(text)) {
    violate('baidu-url', rel, 'contains a bcebos.com signed URL (D-18: strip it; never a runtime dependency).');
  }

  if (scope === 'content' || scope === 'source') {
    if (BOOK_IDENTIFIERS.test(text)) {
      const match = text.match(BOOK_IDENTIFIERS);
      violate('book-identifier', rel, `contains the book/publisher identifier "${match?.[0] ?? '?'}" (R16).`);
    }
    if (EDGE_TTS.test(text)) {
      violate('edge-tts', rel, 'runtime reference to the unofficial Edge TTS endpoint/voice. TTS runs locally and lands in the private repo (D-09).');
    }
  }

  if (scope === 'source') {
    if (CDN_HOSTS.test(text)) {
      violate('cdn', rel, 'references a third-party CDN; assets must be self-hosted (R5 / 02 §3.2 S13).');
    }
  }
}

/**
 * `connect-src` must not widen beyond this origin + the GitHub API.
 * `03_ARCHITECTURE_AND_SCHEMAS.md` §5 and `09_TESTS_AND_ACCEPTANCE.md` §1 both spell the
 * production value as `'self' https://api.github.com data: blob:` (blob:/data: are needed for
 * private media played from object URLs). `02_LEGAL_AND_LICENSING.md` §4.1 states the narrower
 * `'self' https://api.github.com`. The rule enforced here is the intent shared by all three:
 * the only *network origin* is api.github.com. `data:` and `blob:` are not hosts.
 */
function checkCsp(rel, abs) {
  const text = readText(abs);
  if (text === null) return;

  // Attribute values may be single-quoted inside a double-quoted `content` (CSP keywords are),
  // so parse the tag first and then read `content` with its own quoting.
  const metaTag = text.match(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/i)?.[0];
  const contentMatch = metaTag?.match(/\bcontent=(?:"([^"]*)"|'([^']*)')/i);
  const policy = contentMatch ? (contentMatch[1] ?? contentMatch[2]) : null;

  if (!policy) {
    violate('csp', rel, 'no Content-Security-Policy meta tag. Pages cannot send headers, so this tag is the policy.');
    return;
  }

  const directive = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith('connect-src'));

  if (!directive) {
    violate('csp', rel, 'CSP has no connect-src directive.');
    return;
  }

  const sources = directive.split(/\s+/).slice(1);
  const allowedNetworkHosts = new Set(["'self'", 'https://api.github.com']);
  const allowedNonHosts = new Set(["'self'", 'data:', 'blob:']);

  for (const source of sources) {
    const lower = source.toLowerCase();
    const isHostLike = lower.startsWith('http') || lower.startsWith('ws') || /^[a-z0-9*.-]+\.[a-z]{2,}$/i.test(source);
    if (isHostLike && !allowedNetworkHosts.has(lower)) {
      violate('csp', rel, `connect-src allows the extra origin "${source}"; only 'self' and https://api.github.com are permitted (R5).`);
    } else if (!isHostLike && !allowedNonHosts.has(lower)) {
      violate('csp', rel, `connect-src contains the unrecognised source "${source}".`);
    }
  }

  if (!sources.some((source) => source.toLowerCase() === 'https://api.github.com')) {
    violate('csp', rel, "connect-src does not include https://api.github.com, so private-repo sync and books cannot work.");
  }

  // Hardening directives that protect the localStorage-resident PAT from XSS.
  const lowered = policy.toLowerCase();
  for (const [name, expected] of [["object-src", "'none'"], ["base-uri", "'self'"], ["frame-ancestors", "'none'"]]) {
    const found = lowered.split(';').map((part) => part.trim()).find((part) => part.startsWith(name));
    if (!found) {
      violate('csp', rel, `CSP is missing \`${name} ${expected}\` (02 §7).`);
    }
  }
}

function checkLfs() {
  const abs = path.join(ROOT, '.gitattributes');
  if (!existsSync(abs)) return;
  const text = readText(abs) ?? '';
  if (/filter\s*=\s*lfs/i.test(text)) {
    violate('lfs', '.gitattributes', 'Git LFS is forbidden: its 1 GB bandwidth quota bills the owner (D-04 / R11).');
  }
}

/* ------------------------------------------------------------------ driver */

/**
 * Which scans apply to a path.
 *
 *  - `content`: book/publisher identifiers and Edge-TTS references are forbidden. This covers the
 *    files the project *authors* (`src/`, `public/`, `index.html`) and everything a build copies
 *    out of them (`dist/`, minus hashed third-party bundles).
 *  - `source`: additionally, third-party CDN hosts are forbidden. Only authored files are checked:
 *    a vendored library may legitimately contain an unused default CDN string (Hanzi Writer ships
 *    one, which `StrokePanel` overrides with `charDataLoader`), and flagging it would train the
 *    owner to ignore this gate. Dependency licences are covered by R13's `licenses:runtime` scan.
 */
function scopeFor(rel) {
  if (rel.startsWith('src/') || rel.startsWith('public/') || rel === 'index.html') return 'source';
  if (rel.startsWith('dist/')) {
    if (/^dist\/assets\//.test(rel)) return 'content';
    return 'content';
  }
  return 'other';
}

function main() {
  const args = new Set(process.argv.slice(2));
  const includeDist = !args.has('--no-dist');
  const asJson = args.has('--json');

  const allowlist = loadAllowlist();

  const tracked = gitTrackedFiles();
  const set = new Set(tracked.map((abs) => toPosix(path.relative(ROOT, abs))));

  if (includeDist) {
    const distDir = path.join(ROOT, 'dist');
    if (existsSync(distDir)) {
      for (const abs of walk(distDir)) set.add(toPosix(path.relative(ROOT, abs)));
    }
  }

  const files = [...set].sort();

  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    checkFilePath(rel, abs, allowlist);
    scanText(rel, abs, scopeFor(rel));
  }

  // The CSP is injected by `vite.config.ts` at build time, so `dist/index.html` is the artifact
  // that matters. The source `index.html` carries none by design (dev HMR needs an inline
  // bootstrap the production policy forbids); if one is ever added there, it is validated too.
  for (const rel of ['index.html', 'dist/index.html']) {
    if (!files.includes(rel)) continue;
    if (rel === 'index.html' && !/Content-Security-Policy/i.test(readText(path.join(ROOT, rel)) ?? '')) continue;
    checkCsp(rel, path.join(ROOT, rel));
  }

  checkLfs();

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ ok: violations.length === 0, scanned: files.length, violations }, null, 2)}\n`);
  } else if (violations.length === 0) {
    console.log(`legal:check — OK (${files.length} files scanned: tracked tree${includeDist ? ' + dist/' : ''}).`);
  } else {
    console.error(`legal:check — ${violations.length} violation(s) across ${files.length} scanned files:\n`);
    for (const item of violations) {
      console.error(`  ✗ [${item.check}] ${item.file}`);
      console.error(`      ${item.detail}`);
    }
    console.error('\nThe public repository must contain only open-licensed code and data. Move private content to the `Hanyu data` repository.');
  }

  process.exit(violations.length === 0 ? 0 : 1);
}

main();

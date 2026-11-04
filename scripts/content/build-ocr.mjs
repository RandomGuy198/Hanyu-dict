/**
 * build-ocr.mjs - stage the offline OCR runtime and language models under public/data/ocr/.
 *
 * These are opaque binaries (WebAssembly and tesseract traineddata), not text records, so they
 * are NOT IndexedDB packs and are not listed in public/data/manifest.json. They are served as
 * same-origin static files that the capture screen fetches only after the user opts in, having
 * seen the real byte sizes published in public/data/ocr/manifest.json. The service worker does not
 * precache them (see vite.config.ts globPatterns), so first use costs bandwidth, not storage.
 *
 * Inputs, all hash-verified before use:
 *   - cache: chi_sim.traineddata / eng.traineddata from tesseract-ocr/tessdata_fast (Apache-2.0)
 *   - node_modules/tesseract.js/dist/worker.min.js                       (Apache-2.0)
 *   - node_modules/tesseract.js-core/tesseract-core[-simd]-lstm.wasm.js   (Apache-2.0)
 * Only the LSTM cores are staged: the tessdata_fast models are LSTM-only and tesseract.js 5
 * loads exactly tesseract-core[-simd]-lstm.wasm.js, so the legacy/threaded variants would be
 * dead weight in the download.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OCR_DIR, REPO_ROOT, ensureDir, exists, formatBytes, gzipFile, sha256File, sha256FileSync, table, resolveCacheDir, log } from './lib/fs.mjs';
import { OCR_LANGS, OCR_WORKER_FILES } from './lib/packs.mjs';
import { loadProvenance } from './lib/provenance.mjs';

const MANIFEST_PATH = path.join(OCR_DIR, 'manifest.json');

/** Files staged verbatim from node_modules. */
const RUNTIME_DIR = path.join(REPO_ROOT, 'node_modules');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Assert that the installed npm package is the exact version provenance.json pins. */
function assertVersion(pkgName, expected) {
  const pkgPath = path.join(RUNTIME_DIR, pkgName, 'package.json');
  if (!exists(pkgPath)) throw new Error(`${pkgName} is not installed (looked in ${pkgPath})`);
  const pkg = readJson(pkgPath);
  if (pkg.version !== expected) {
    throw new Error(
      `${pkgName}: installed version ${pkg.version} does not match the pinned ${expected}. ` +
        `Re-install the pinned version or re-pin provenance.json after reviewing the upgrade.`
    );
  }
  return pkg;
}

async function stageRuntime() {
  const staged = [];
  const sources = [
    { from: path.join(RUNTIME_DIR, 'tesseract.js', 'dist', 'worker.min.js'), name: 'worker.min.js' },
    ...OCR_WORKER_FILES.filter((n) => n !== 'worker.min.js').map((n) => ({
      from: path.join(RUNTIME_DIR, 'tesseract.js-core', n),
      name: n,
    })),
  ];
  for (const s of sources) {
    if (!exists(s.from)) throw new Error(`missing ${s.from} - install the tesseract.js packages first (npm ci)`);
    const dest = path.join(OCR_DIR, s.name);
    await ensureDir(OCR_DIR);
    fs.copyFileSync(s.from, dest);
    staged.push({ path: s.name, bytes: fs.statSync(dest).size, sha256: await sha256File(dest), kind: 'runtime' });
  }
  return staged;
}

async function stageModels(cacheDir) {
  const reg = loadProvenance();
  const tess = reg.byId.get('tessdata-fast');
  if (!tess) throw new Error('provenance.json has no tessdata-fast source');
  const out = [];
  for (const { lang } of OCR_LANGS) {
    const raw = path.join(cacheDir, `${lang}.traineddata`);
    const pin = (tess.downloads || []).find((d) => d.cacheFile === `${lang}.traineddata`);
    if (!pin) throw new Error(`provenance.json pins no download for ${lang}.traineddata`);
    if (!exists(raw)) throw new Error(`model cache is missing ${raw} - run: node scripts/content/fetch-sources.mjs`);
    const digest = sha256FileSync(raw);
    if (digest !== pin.sha256) {
      throw new Error(`${lang}.traineddata: cache sha256 ${digest} does not match the pinned ${pin.sha256}`);
    }
    const gz = path.join(OCR_DIR, 'lang', `${lang}.traineddata.gz`);
    const { bytes, rawBytes } = await gzipFile(raw, gz);
    out.push({
      lang,
      path: `lang/${lang}.traineddata.gz`,
      bytes,
      rawBytes,
      sha256: await sha256File(gz),
      rawSha256: digest,
      license: tess.license,
    });
  }
  return out;
}

export async function build({ cacheDir, quiet = false } = {}) {
  const cache = cacheDir || resolveCacheDir(process.argv);
  await ensureDir(path.join(OCR_DIR, 'lang'));

  const reg = loadProvenance();
  for (const [pkg, sourceId] of [
    ['tesseract.js', 'tesseract.js'],
    ['tesseract.js-core', 'tesseract.js-core'],
  ]) {
    const src = reg.byId.get(sourceId);
    if (!src) throw new Error(`provenance.json has no source ${sourceId}`);
    const version = src.upstreamVersion.replace(/^installed dependency version\s*/, '');
    assertVersion(pkg, version);
  }

  const runtime = await stageRuntime();
  const models = await stageModels(cache);

  // Remove anything left over from a different tesseract.js version.
  const allowed = new Set([...runtime.map((r) => r.path), ...models.map((m) => m.path)]);
  for (const name of fs.readdirSync(OCR_DIR)) {
    if (name === 'lang' || name === 'manifest.json') continue;
    if (!allowed.has(name)) fs.rmSync(path.join(OCR_DIR, name), { force: true });
  }

  const doc = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString().replace(/\.000Z$/, '.000Z'),
    note: 'Opt-in OCR assets, served as static same-origin files. Nothing here loads until the user starts a recognition on the capture screen. Models and runtime are Apache-2.0; see public/licenses.',
    usage: 'tesseract.js 5 with workerPath=<base>/ocr/worker.min.js, corePath=<base>/ocr, langPath=<base>/ocr/lang, gzip=true.',
    runtime,
    models,
    totalBytes: runtime.reduce((s, r) => s + r.bytes, 0) + models.reduce((s, m) => s + m.bytes, 0),
  };
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

  if (!quiet) {
    const rows = [
      ...runtime.map((r) => ({ file: r.path, bytes: formatBytes(r.bytes), sha: r.sha256.slice(0, 12), role: 'runtime' })),
      ...models.map((m) => ({ file: m.path, bytes: formatBytes(m.bytes), sha: m.sha256.slice(0, 12), role: `model ${m.lang}` })),
    ];
    log(`ocr assets staged in ${path.relative(process.cwd(), OCR_DIR)}`);
    log(
      table(rows, [
        ['file', 'file'],
        ['size', 'bytes'],
        ['sha256', 'sha'],
        ['role', 'role'],
      ])
    );
    log(`  total opt-in download: ${formatBytes(doc.totalBytes)}`);
  }

  return { path: MANIFEST_PATH, runtime, models, totalBytes: doc.totalBytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await build({});
}

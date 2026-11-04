/**
 * check-provenance.mjs - the release gate. Runs first in `npm run build` and in CI.
 *
 * It answers one question: is every byte this app can download attributable, licence-complete and
 * exactly what the manifest promises? If not, the build stops. Nothing here needs the network, so
 * CI can run it against the committed packs.
 *
 * Checks
 *   1. provenance.json is complete and internally consistent with the pack registry.
 *   2. public/data/manifest.json satisfies the same rules the runtime enforces (src/data/schema.ts).
 *   3. Every manifest file exists on disk with the recorded sha256 and byte count, and no
 *      unrecorded file hides in a pack directory.
 *   4. Every licence text referenced by provenance exists, is non-empty and matches any pinned hash.
 *   5. THIRD_PARTY_NOTICES.md names every source and its licence.
 *   6. The opt-in OCR assets match public/data/ocr/manifest.json and the pinned model hashes.
 *   7. If the raw cache is present, every pinned download hash is re-verified (skipped with a note
 *      when it is not, as in CI).
 *   8. Clean-room guard: no reference APK, decompiled source or third-party product name leaks into
 *      the shipped app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DATA_DIR,
  LICENSES_DIR,
  OCR_DIR,
  PACKS_DIR,
  REPO_ROOT,
  exists,
  readText,
  resolveCacheDir,
  sha256File,
  formatBytes,
  log,
} from './lib/fs.mjs';
import { PACK_DEFS, PACK_ORDER } from './lib/packs.mjs';
import { loadProvenance, sourceForPack, cacheExpectations } from './lib/provenance.mjs';

const STATIC_ONLY_KINDS = new Set(['ocr']);
const SHA = /^[a-f0-9]{64}$/;
const failures = [];
const notes = [];

function fail(check, message) {
  failures.push({ check, message });
}

function walk(dir, filter) {
  if (!exists(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, filter));
    else if (filter(full)) out.push(full);
  }
  return out;
}

/** 1. provenance register <-> pack registry. */
function checkRegister(reg) {
  for (const packId of PACK_ORDER) {
    const def = PACK_DEFS[packId];
    if (!def) fail('register', `PACK_ORDER lists ${packId} but PACK_DEFS has no entry for it`);
    if (def && def.kind === 'ocr' && !STATIC_ONLY_KINDS.has(def.kind)) fail('register', `${packId} kind mismatch`);
  }
  for (const [packId, def] of Object.entries(PACK_DEFS)) {
    if (!PACK_ORDER.includes(packId)) fail('register', `PACK_DEFS entry ${packId} (${def.kind}) is not in PACK_ORDER`);
    try {
      sourceForPack(reg, packId);
    } catch (error) {
      fail('register', error.message);
    }
  }
  for (const src of reg.sources) {
    for (const packId of src.packs || []) {
      if (!PACK_DEFS[packId]) fail('register', `source ${src.id} claims unknown pack ${packId}`);
      else if (PACK_DEFS[packId].source !== src.id) {
        fail('register', `source ${src.id} claims ${packId}, but the registry attributes it to ${PACK_DEFS[packId].source}`);
      }
    }
  }
}

/** 2 + 3. the manifest, its files and any file it forgot. */
async function checkManifest(reg) {
  const manifestPath = path.join(DATA_DIR, 'manifest.json');
  if (!exists(manifestPath)) {
    fail('manifest', 'public/data/manifest.json is missing - run: npm run data:build');
    return null;
  }
  let manifest;
  try {
    manifest = JSON.parse(readText(manifestPath));
  } catch (error) {
    fail('manifest', `public/data/manifest.json is not valid JSON: ${error.message}`);
    return null;
  }

  if (manifest.schemaVersion !== 1) fail('manifest', `schemaVersion must be 1, got ${manifest.schemaVersion}`);
  if (!manifest.minAppVersion) fail('manifest', 'minAppVersion is missing');
  if (!Array.isArray(manifest.packs) || !manifest.packs.length) fail('manifest', 'packs[] is empty');

  const declaredDirs = new Set();
  const declaredPaths = new Set();

  for (const pack of manifest.packs || []) {
    const label = `pack ${pack.id}`;
    const def = PACK_DEFS[pack.id];
    if (!def) fail('manifest', `${label} is not in the pack registry`);
    else {
      if (pack.kind !== def.kind) fail('manifest', `${label}: kind ${pack.kind} != registry ${def.kind}`);
      if (pack.required !== Boolean(def.required)) fail('manifest', `${label}: required flag ${pack.required} != registry ${def.required}`);
      const src = reg.byId.get(def.source);
      if (src) {
        if (pack.license !== src.license) fail('manifest', `${label}: licence ${pack.license} != provenance ${src.license}`);
        if (pack.attribution !== src.attribution) fail('manifest', `${label}: attribution does not match provenance.json`);
        if (String(src.sourceUrl).startsWith('http') && pack.sourceUrl !== src.sourceUrl) {
          fail('manifest', `${label}: sourceUrl ${pack.sourceUrl} != provenance ${src.sourceUrl}`);
        }
        if (!String(src.sourceUrl).startsWith('http') && pack.sourceUrl) {
          fail('manifest', `${label}: original content must not claim an external sourceUrl`);
        }
        if (!String(src.sourceUrl).startsWith('http') && !pack.attribution.startsWith('Original content')) {
          fail('manifest', `${label}: original content attribution must start with "Original content"`);
        }
      }
      declaredDirs.add(pack.id);
    }

    if (!def || def.kind !== 'content') {
      if (!pack.modifications) notes.push(`${label}: no modifications recorded (only required for transformed data)`);
    }
    if (!pack.files?.length) fail('manifest', `${label}: files[] is empty`);
    if (!pack.bytes) fail('manifest', `${label}: bytes is missing or zero`);

    for (const file of pack.files || []) {
      if (file.path.startsWith('/') || file.path.includes('..')) fail('manifest', `${label}: unsafe path ${file.path}`);
      if (!SHA.test(file.sha256)) fail('manifest', `${label}/${file.path}: sha256 is not 64 lowercase hex`);
      if (!Number.isInteger(file.bytes) || file.bytes < 0) fail('manifest', `${label}/${file.path}: bad byte count`);
      if (declaredPaths.has(file.path)) fail('manifest', `duplicate file path across packs: ${file.path}`);
      declaredPaths.add(file.path);

      const full = path.join(DATA_DIR, file.path);
      if (!exists(full)) {
        fail('manifest', `${label}/${file.path}: declared file is missing from disk`);
        continue;
      }
      const stat = fs.statSync(full);
      if (stat.size !== file.bytes) fail('manifest', `${label}/${file.path}: size drift (${stat.size} on disk, ${file.bytes} in manifest)`);
      const digest = await sha256File(full);
      if (digest !== file.sha256) fail('manifest', `${label}/${file.path}: sha256 drift (${digest.slice(0, 16)}… != ${file.sha256.slice(0, 16)}…)`);
    }

    const sum = (pack.files || []).reduce((s, f) => s + (f.bytes || 0), 0);
    if (sum !== pack.bytes) fail('manifest', `${label}: pack bytes ${pack.bytes} != sum of its files ${sum}`);
  }

  for (const packId of PACK_ORDER) {
    const def = PACK_DEFS[packId];
    if (STATIC_ONLY_KINDS.has(def.kind)) continue;
    if (!exists(path.join(PACKS_DIR, packId))) continue;
    if (!declaredDirs.has(packId)) fail('manifest', `public/data/packs/${packId} exists on disk but no manifest pack declares it`);
  }

  const onDisk = walk(PACKS_DIR, () => true).map((f) => path.relative(DATA_DIR, f).replace(/\\/g, '/'));
  for (const rel of onDisk) {
    if (!declaredPaths.has(rel)) fail('manifest', `${rel} is on disk but not declared in the manifest (stale shard?)`);
  }

  return manifest;
}

/** 4 + 5. licence texts and the generated notice document. */
async function checkLicences(reg) {
  for (const src of reg.sources) {
    const full = path.join(REPO_ROOT, src.licenseFile);
    if (!exists(full)) {
      fail('licences', `source ${src.id}: ${src.licenseFile} is missing - run: node scripts/content/build-licenses.mjs`);
      continue;
    }
    const text = readText(full);
    if (text.trim().length < 200 && !src.licenseFile.endsWith('.md')) {
      fail('licences', `source ${src.id}: ${src.licenseFile} looks truncated (${text.length} characters)`);
    }
    if (src.licenseTextSha256) {
      const digest = await sha256File(full);
      if (digest !== src.licenseTextSha256) fail('licences', `${src.licenseFile}: sha256 ${digest.slice(0, 16)}… != pinned ${src.licenseTextSha256.slice(0, 16)}…`);
    }
  }

  const notices = path.join(LICENSES_DIR, 'THIRD_PARTY_NOTICES.md');
  if (!exists(notices)) {
    fail('licences', 'public/licenses/THIRD_PARTY_NOTICES.md is missing - run: node scripts/content/build-licenses.mjs');
    return;
  }
  const doc = readText(notices);
  for (const src of reg.sources) {
    if (!doc.includes(src.upstreamProject)) fail('licences', `THIRD_PARTY_NOTICES.md does not mention ${src.upstreamProject}`);
    if (!doc.includes(src.license)) fail('licences', `THIRD_PARTY_NOTICES.md does not name the ${src.id} licence (${src.license})`);
    if (src.attributionGap && !doc.includes(src.attributionGap)) fail('licences', `THIRD_PARTY_NOTICES.md hides the known gap for ${src.id}`);
  }
  if (!/generated/i.test(doc)) fail('licences', 'THIRD_PARTY_NOTICES.md does not say it is generated (it must not be hand-edited)');
}

/** 6. the opt-in OCR payload. */
async function checkOcr(reg) {
  const manifestPath = path.join(OCR_DIR, 'manifest.json');
  if (!exists(manifestPath)) {
    fail('ocr', 'public/data/ocr/manifest.json is missing - run: node scripts/content/build-ocr.mjs');
    return;
  }
  const doc = JSON.parse(readText(manifestPath));
  const tess = reg.byId.get('tessdata-fast');
  for (const model of doc.models || []) {
    const full = path.join(OCR_DIR, model.path);
    if (!exists(full)) {
      fail('ocr', `${model.path} is declared but missing`);
      continue;
    }
    const digest = await sha256File(full);
    if (digest !== model.sha256) fail('ocr', `${model.path}: sha256 drift`);
    if (fs.statSync(full).size !== model.bytes) fail('ocr', `${model.path}: size drift`);
    const pin = (tess?.downloads || []).find((d) => d.cacheFile === `${model.lang}.traineddata`);
    if (!pin) fail('ocr', `no provenance pin for ${model.lang}.traineddata`);
    else if (model.rawSha256 !== pin.sha256) fail('ocr', `${model.lang}: model hash ${model.rawSha256} does not match the pinned raw traineddata ${pin.sha256}`);
  }
  for (const runtime of doc.runtime || []) {
    const full = path.join(OCR_DIR, runtime.path);
    if (!exists(full)) fail('ocr', `${runtime.path} is declared but missing`);
    else if ((await sha256File(full)) !== runtime.sha256) fail('ocr', `${runtime.path}: sha256 drift`);
  }
  if (!(doc.runtime || []).length) fail('ocr', 'no OCR worker/core files staged');
}

/** 7. optional cache re-verification. */
async function checkCache(reg, cacheDir) {
  if (!exists(cacheDir)) {
    notes.push(`raw cache ${cacheDir} is absent (expected in CI); pack hashes were verified instead`);
    return;
  }
  let verified = 0;
  for (const row of cacheExpectations(reg)) {
    const full = path.join(cacheDir, row.cacheFile);
    if (!exists(full)) {
      fail('cache', `${row.source}/${row.cacheFile} is missing from the cache`);
      continue;
    }
    const digest = await sha256File(full);
    if (digest !== row.sha256) fail('cache', `${row.source}/${row.cacheFile}: sha256 ${digest.slice(0, 16)}… != pinned ${row.sha256.slice(0, 16)}…`);
    else verified++;
  }
  notes.push(`${verified}/${cacheExpectations(reg).length} cache files re-verified against provenance.json`);
}

/** 8. clean-room guard over the shipped application only. */
function checkCleanRoom() {
  const shipped = [path.join(REPO_ROOT, 'src'), path.join(REPO_ROOT, 'public'), path.join(REPO_ROOT, 'scripts')];
  const bannedNames = /\.apk$|\.apk\.|jadx|smali|decompil/i;
  for (const dir of shipped) {
    for (const full of walk(dir, () => true)) {
      const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
      if (bannedNames.test(rel)) fail('clean-room', `${rel} looks like reference-app material and must not ship`);
      if (/\.(ts|tsx|js|mjs|json|css|html|webmanifest|txt|md|svg)$/.test(full)) {
        const text = readText(full, 'latin1');
        if (/\bhanzii\b/i.test(text) && !/not|never|no |independent|clean|instead|imitat|affiliat/i.test(text.replace(/#[^\n]*|\/\/[^\n]*/g, ''))) {
          fail('clean-room', `${rel} names the reference product without an explicit disclaimer`);
        }
      }
    }
  }
  for (const full of walk(REPO_ROOT, (f) => /\.apk$/i.test(f))) {
    fail('clean-room', `${path.relative(REPO_ROOT, full)} - an APK must never live inside the repository`);
  }
}

export async function check({ cacheDir, quiet = false } = {}) {
  const cache = cacheDir || resolveCacheDir(process.argv);
  let reg;
  try {
    reg = loadProvenance();
  } catch (error) {
    log(`PROVENANCE REGISTER UNREADABLE: ${error.message}`);
    return { ok: false, failures: [{ check: 'register', message: error.message }], notes: [] };
  }

  checkRegister(reg);
  const manifest = await checkManifest(reg);
  await checkLicences(reg);
  await checkOcr(reg);
  await checkCache(reg, cache);
  checkCleanRoom();

  if (!quiet) {
    if (manifest) {
      const total = manifest.packs.reduce((s, p) => s + p.bytes, 0);
      const records = manifest.packs.reduce((s, p) => s + (p.coverage?.records || 0), 0);
      log(`provenance: ${manifest.packs.length} packs, ${records.toLocaleString('en-US')} records, ${formatBytes(total)} of data`);
    }
    for (const note of notes) log(`  note: ${note}`);
  }

  if (failures.length) {
    log(`\nPROVENANCE CHECK FAILED (${failures.length} problem${failures.length === 1 ? '' : 's'})`);
    let last = null;
    for (const f of failures) {
      if (f.check !== last) {
        log(`\n[${f.check}]`);
        last = f.check;
      }
      log(`  - ${f.message}`);
    }
    log('\nThe build stops here: a pack without verifiable provenance is not published.');
  } else if (!quiet) {
    log('provenance check: OK — every shipped byte is attributed, licensed and hash-matched.');
  }

  return { ok: failures.length === 0, failures, notes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await check({});
  process.exitCode = result.ok ? 0 : 1;
}

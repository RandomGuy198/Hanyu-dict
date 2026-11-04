/**
 * Loader and cross-checks for scripts/content/provenance.json.
 */
import path from 'node:path';
import { CONTENT_DIR, REPO_ROOT, readText } from './fs.mjs';
import { PACK_DEFS } from './packs.mjs';

export const PROVENANCE_PATH = path.join(CONTENT_DIR, 'provenance.json');

export function loadProvenance() {
  const doc = JSON.parse(readText(PROVENANCE_PATH));
  if (!doc || !Array.isArray(doc.sources)) throw new Error(`${PROVENANCE_PATH}: missing sources[]`);
  const byId = new Map();
  for (const src of doc.sources) {
    for (const key of ['id', 'upstreamProject', 'sourceUrl', 'upstreamVersion', 'license', 'licenseFile', 'attribution', 'packs']) {
      if (src[key] === undefined || src[key] === null || src[key] === '') {
        throw new Error(`provenance.json: source ${src.id || '?'} is missing required field "${key}"`);
      }
    }
    if (byId.has(src.id)) throw new Error(`provenance.json: duplicate source id ${src.id}`);
    byId.set(src.id, src);
  }
  return { doc, sources: doc.sources, byId };
}

export function sourceForPack(reg, packId) {
  const def = PACK_DEFS[packId];
  if (!def) throw new Error(`Unknown pack id ${packId}`);
  const src = reg.byId.get(def.source);
  if (!src) throw new Error(`Pack ${packId} has no provenance entry for source ${def.source}`);
  if (!src.packs.includes(packId)) {
    throw new Error(`Provenance source ${src.id} does not declare pack ${packId} in its packs[] list`);
  }
  return src;
}

/** Absolute path of a provenance license file (stored repo-relative). */
export function licenseFilePath(src) {
  return path.join(REPO_ROOT, src.licenseFile);
}

export function allLicenseFiles(reg) {
  return [...new Set(reg.sources.map((s) => s.licenseFile))];
}

/** Every cache file the register expects, with its hash. */
export function cacheExpectations(reg) {
  const rows = [];
  for (const src of reg.sources) {
    for (const dl of src.downloads || []) {
      rows.push({
        source: src.id,
        cacheFile: dl.cacheFile,
        sha256: dl.sha256,
        bytes: dl.bytes,
        fetch: dl.fetch,
        extract: dl.extract || null,
        consumedFrom: dl.consumedFrom || null,
      });
    }
  }
  return rows;
}

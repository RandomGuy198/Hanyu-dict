/**
 * build-manifest.mjs - assemble public/data/manifest.json from the generated packs on disk
 * plus the legal metadata in scripts/content/provenance.json.
 *
 * The manifest is the app's only description of what it may download, so this script is the
 * single place where product metadata (packs.mjs) and rights metadata (provenance.json) meet.
 * It never invents a licence, an attribution or a source URL: missing provenance fails the build.
 *
 * Paths in the manifest are relative to public/data/ and are always verified against the bytes
 * actually present, so a stale or truncated shard cannot be published.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { DATA_DIR, PACKS_DIR, buildTimestamp, exists, formatBytes, sha256File, table, writeTextAtomic, log } from './lib/fs.mjs';
import { PACK_DEFS, PACK_ORDER } from './lib/packs.mjs';
import { loadProvenance, sourceForPack } from './lib/provenance.mjs';

const MANIFEST_PATH = path.join(DATA_DIR, 'manifest.json');
const SCHEMA_VERSION = 1;
const MIN_APP_VERSION = '1.0.0';

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function countLines(file) {
  let count = 0;
  const buf = fs.readFileSync(file);
  for (const byte of buf) if (byte === 0x0a) count++;
  if (buf.length && buf[buf.length - 1] !== 0x0a) count++;
  return count;
}

/** Pack files, sorted, with the record count that belongs in the manifest. */
async function collectFiles(packId, def) {
  const dir = path.join(PACKS_DIR, packId);
  if (!exists(dir)) throw new Error(`pack ${packId}: ${path.relative(process.cwd(), dir)} does not exist - run the build script for this pack first`);
  const matcher = globToRegExp(def.shardGlob);
  const names = fs.readdirSync(dir).filter((n) => matcher.test(n)).sort();
  if (!names.length) throw new Error(`pack ${packId}: no files matching ${def.shardGlob} in ${path.relative(process.cwd(), dir)}`);

  const files = [];
  for (const name of names) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    const records = def.coverageMode === 'sum-shards' || def.coverageMode === 'sum-jsonl' ? countLines(full) : 1;
    files.push({
      path: path.relative(DATA_DIR, full).replace(/\\/g, '/'),
      sha256: await sha256File(full),
      bytes: stat.size,
      records,
    });
  }

  // Files outside the shard glob (an index, a checksum) still have to ship and be verified.
  const extras = fs
    .readdirSync(dir)
    .filter((n) => !matcher.test(n) && fs.statSync(path.join(dir, n)).isFile())
    .sort();
  for (const name of extras) {
    const full = path.join(dir, name);
    files.push({
      path: path.relative(DATA_DIR, full).replace(/\\/g, '/'),
      sha256: await sha256File(full),
      bytes: fs.statSync(full).size,
    });
  }
  return { files, extras: extras.length };
}

function coverageRecords(def, files) {
  if (def.coverageMode === 'item-files') return files.reduce((s, f) => s + (f.records ?? 0), 0);
  if (def.coverageMode === 'sum-jsonl') return files.filter((f) => f.records !== undefined).reduce((s, f) => s + f.records, 0);
  return files.filter((f) => f.records !== undefined).reduce((s, f) => s + f.records, 0);
}

/** A version that changes when the data changes, while staying readable. */
function packVersion(src, files) {
  const digest = crypto
    .createHash('sha256')
    .update(files.map((f) => f.sha256).join('\n'))
    .digest('hex')
    .slice(0, 8);
  const base = String(src.upstreamVersion || '')
    .replace(/\s*\(.+?\)\s*/g, ' ')
    .replace(/[^0-9A-Za-z.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${base || src.id}-${digest}`;
}

export async function build({ quiet = false } = {}) {
  const reg = loadProvenance();
  const packs = [];

  for (const packId of PACK_ORDER) {
    const def = PACK_DEFS[packId];
    const src = sourceForPack(reg, packId);
    const { files, extras } = await collectFiles(packId, def);
    const bytes = files.reduce((sum, f) => sum + f.bytes, 0);
    const records = coverageRecords(def, files);

    const descriptor = {
      id: packId,
      kind: def.kind,
      label: def.label,
      version: packVersion(src, files),
      required: Boolean(def.required),
      license: src.license,
      ...(src.sourceUrl.startsWith('http') ? { sourceUrl: src.sourceUrl } : {}),
      attribution: src.attribution,
      ...(src.transformations?.length ? { modifications: src.transformations.join(' ') } : {}),
      coverage: { records, languages: def.languages, ...(extras ? { sidecarFiles: extras } : {}) },
      bytes,
      files,
    };
    packs.push(descriptor);
  }

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: buildTimestamp(),
    minAppVersion: MIN_APP_VERSION,
    packs,
  };

  await writeTextAtomic(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

  if (!quiet) {
    const rows = packs.map((p) => ({
      pack: p.id,
      required: p.required ? 'auto' : 'opt-in',
      records: String(p.coverage.records ?? ''),
      files: String(p.files.length),
      size: formatBytes(p.bytes),
      license: p.license,
      version: p.version,
    }));
    log(`manifest: ${packs.length} packs, ${formatBytes(packs.reduce((s, p) => s + p.bytes, 0))} of data`);
    log(table(rows, [
      ['pack', 'pack'],
      ['install', 'required'],
      ['records', 'records'],
      ['files', 'files'],
      ['size', 'size'],
      ['licence', 'license'],
      ['version', 'version'],
    ]));
    log(`  wrote ${path.relative(process.cwd(), MANIFEST_PATH)}`);
  }

  return { manifest, path: MANIFEST_PATH };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await build({});
}

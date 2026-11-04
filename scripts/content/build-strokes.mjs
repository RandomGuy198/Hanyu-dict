/**
 * build-strokes.mjs - hanzi-writer-data -> public/data/packs/strokes/
 *
 * Emits `<n>.jsonl` shards of 400 characters, one compact JSON object per line:
 *   {"c":"中","s":["M 254 596 Q ... z"],"m":[[194,598,229,572,...]]}
 * plus `index.txt` with one `<char> US <shardFile>` record per character.
 *
 * Upstream shape is { strokes: [pathString], medians: [[[x,y],...]], radStrokes: [...] }.
 * `radStrokes` is dropped (docs/DATA_FORMAT.md) and medians are flattened to
 * [x0,y0,x1,y1,...] for the runtime to re-pair.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA_DIR, PACKS_DIR, clearDir, ensureDir, formatBytes, resolveCacheDir, sha256File, table } from './lib/fs.mjs';
import { RecordWriter, US, assertFieldSafe } from './lib/record.mjs';
import { SHARD_SIZES } from './lib/packs.mjs';

const PACK_ID = 'strokes';
const PACK_DIR = path.join(PACKS_DIR, PACK_ID);
const INDEX_FILE = 'index.txt';

/** hanzi-writer-data npm tarballs always unpack to `<cache>/hw/package`. */
export function charDataDir(cacheDir) {
  const candidates = [path.join(cacheDir, 'hw', 'package'), path.join(cacheDir, 'hwdata', 'package'), cacheDir];
  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.json') && f !== 'package.json')) return dir;
  }
  throw new Error(
    `No character JSON found under ${candidates.join(', ')} - run scripts/content/fetch-sources.mjs first (it unpacks hwdata.tgz into <cache>/hw/package)`
  );
}

/**
 * Upstream files carry extra non-character JSON (package.json, index.js); only
 * single-codepoint `.json` names are data.
 */
function listCharFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const ch = entry.name.slice(0, -'.json'.length);
    const cps = Array.from(ch);
    if (cps.length !== 1) continue;
    out.push({ char: ch, codePoint: cps[0].codePointAt(0), file: path.join(dir, entry.name) });
  }
  return out.sort((a, b) => a.codePoint - b.codePoint || a.char.localeCompare(b.char));
}

/** [[x,y],...] -> [x0,y0,x1,y1,...]; already-flat arrays pass through untouched. */
export function flattenMedian(median) {
  if (!Array.isArray(median)) throw new Error(`median is not an array: ${JSON.stringify(median)}`);
  const flat = [];
  for (const point of median) {
    if (Array.isArray(point)) {
      if (point.length !== 2) throw new Error(`median point has ${point.length} numbers, expected 2`);
      flat.push(point[0], point[1]);
    } else if (typeof point === 'number') {
      flat.push(point);
    } else {
      throw new Error(`median point is neither a pair nor a number: ${JSON.stringify(point)}`);
    }
  }
  if (flat.length % 2 !== 0) throw new Error(`flattened median has an odd length (${flat.length})`);
  for (const n of flat) {
    if (!Number.isFinite(n)) throw new Error(`non-finite median coordinate: ${n}`);
  }
  return flat;
}

export async function build({ cacheDir, quiet = false } = {}) {
  const dataDir = charDataDir(cacheDir);
  const entries = listCharFiles(dataDir);
  if (entries.length < 9000) {
    throw new Error(`Only ${entries.length} character files found in ${dataDir}; expected ~9574 - check the cache`);
  }

  const lines = [];
  const indexRows = [];
  let decimalsKept = 0;
  let decimalPaths = 0;
  let missingMedians = 0;
  let strokeCountMismatch = 0;

  for (const entry of entries) {
    let raw;
    try {
      raw = JSON.parse(await fsp.readFile(entry.file, 'utf8'));
    } catch (err) {
      throw new Error(`${entry.file}: unreadable hanzi-writer JSON: ${err.message}`);
    }
    const strokes = Array.isArray(raw.strokes) ? raw.strokes : null;
    if (!strokes || strokes.length === 0) throw new Error(`${entry.file}: has no stroke outlines`);
    if (strokes.some((s) => typeof s !== 'string' || s.length === 0)) {
      throw new Error(`${entry.file}: has a non-string or empty stroke path`);
    }
    let charHasDecimals = false;
    for (const s of strokes) {
      if (/[0-9]+\.[0-9]/.test(s)) {
        decimalPaths++;
        charHasDecimals = true;
      }
    }
    if (charHasDecimals) decimalsKept++;
    const medians = Array.isArray(raw.medians) ? raw.medians.map(flattenMedian) : [];
    if (medians.length === 0) missingMedians++;
    if (medians.length !== strokes.length) strokeCountMismatch++;
    const obj = { c: entry.char, s: strokes, m: medians };
    const line = JSON.stringify(obj);
    // JSON.stringify escapes real control characters, but a raw separator in the
    // output would still break "one record per line", so assert on the bytes.
    assertFieldSafe(line, { label: `${PACK_ID} JSONL`, index: lines.length, fieldIndex: 0 });
    if (line.includes(US)) throw new Error(`${entry.file}: stroke JSON contains a literal U+001F`);
    lines.push(line);
    indexRows.push(entry.char);
  }

  await ensureDir(PACK_DIR);
  const removed = await clearDir(PACK_DIR);

  const shardSize = SHARD_SIZES[PACK_ID];
  const files = [];
  const shardNames = [];
  for (let start = 0; start < lines.length; start += shardSize) {
    const name = `${String(shardNames.length).padStart(3, '0')}.jsonl`;
    shardNames.push(name);
    const slice = lines.slice(start, start + shardSize);
    const file = path.join(PACK_DIR, name);
    await fsp.writeFile(file, `${slice.join('\n')}\n`, 'utf8');
    files.push({ path: path.relative(DATA_DIR, file).replace(/\\/g, '/'), sha256: await sha256File(file), bytes: (await fsp.stat(file)).size, records: slice.length });
  }

  // index.txt is a U+001F record file: <char> US <shardFile>
  const indexWriter = new RecordWriter(path.join(PACK_DIR, INDEX_FILE), 2, `${PACK_ID}/${INDEX_FILE}`);
  await indexWriter.open();
  for (let i = 0; i < indexRows.length; i++) {
    await indexWriter.write([indexRows[i], shardNames[Math.floor(i / shardSize)]]);
  }
  const indexSummary = await indexWriter.close();

  const records = files.reduce((n, f) => n + f.records, 0);
  const bytes = files.reduce((n, f) => n + f.bytes, 0) + indexSummary.bytes;

  if (!quiet) {
    console.log(
      `strokes: ${records} characters in ${files.length} JSONL shards of ${shardSize} + ${INDEX_FILE} ` +
        `(${formatBytes(bytes)}), radStrokes dropped, medians flattened`
    );
    console.log(
      table(
        files.slice(0, 3).concat(files.length > 4 ? [files[files.length - 1]] : []).map((f) => ({
          file: f.path,
          records: String(f.records),
          bytes: formatBytes(f.bytes),
          sha: f.sha256.slice(0, 12),
        })),
        [
          ['file', 'file'],
          ['records', 'records'],
          ['bytes', 'bytes'],
          ['sha256', 'sha'],
        ]
      )
    );
    if (files.length > 4) console.log(`  ... ${files.length - 4} further shards`);
    console.log(`  index: ${indexSummary.records} records, ${formatBytes(indexSummary.bytes)}, sha ${indexSummary.sha256.slice(0, 12)}`);
  }

  return {
    packId: PACK_ID,
    files,
    indexFile: { path: path.relative(DATA_DIR, indexSummary.path).replace(/\\/g, '/'), sha256: indexSummary.sha256, bytes: indexSummary.bytes, records: indexSummary.records },
    coverage: { records, languages: null },
    stats: {
      shardSize,
      sourceDir: dataDir,
      strokePathsWithDecimalCoordinates: decimalsKept,
      decimalStrokePaths: decimalPaths,
      missingMedians,
      strokeCountMismatch,
      indexFile: INDEX_FILE,
      clearedStaleFiles: removed,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await build({ cacheDir: resolveCacheDir(process.argv) });
  const firstLine = (await fsp.readFile(path.join(PACK_DIR, '000.jsonl'), 'utf8')).split('\n')[0];
  console.log(
    JSON.stringify(
      {
        pack: r.packId,
        records: r.coverage.records,
        files: r.files.length,
        index: r.indexFile,
        stats: r.stats,
        firstLineHead: firstLine.slice(0, 160),
        firstLineLength: firstLine.length,
      },
      null,
      2
    )
  );
}

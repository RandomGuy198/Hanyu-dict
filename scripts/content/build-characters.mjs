/**
 * build-characters.mjs - Unicode Unihan -> public/data/packs/characters/NNN.txt
 *
 * Record: codepointHex US char US mandarin US cantonese US definition US
 *         radical US strokeCount US simplifiedVariant US traditionalVariant
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA_DIR, PACKS_DIR, clearDir, ensureDir, exists, formatBytes, resolveCacheDir, sha256File, table } from './lib/fs.mjs';
import { RecordWriter } from './lib/record.mjs';
import { SHARD_SIZES } from './lib/packs.mjs';
import { VARIANT_CAP, codePointList, firstValue, loadUnihan, normalizeRadical } from './lib/unihan.mjs';

const PACK_ID = 'characters';
const PACK_DIR = path.join(PACKS_DIR, PACK_ID);
export const CHARACTER_FIELDS = 9;

export async function build({ cacheDir, quiet = false } = {}) {
  const zip = path.join(cacheDir, 'Unihan.zip');
  if (!exists(zip)) throw new Error(`Missing cache file ${zip} - run scripts/content/fetch-sources.mjs first`);

  const { byCodePoint, header } = loadUnihan(zip);
  // Numeric code-point order, which is the invariant `DictionaryService.character()` binary-searches
  // against. `Number(a, 16)` is not a hex parse - Number() ignores the radix - so it read these
  // strings as decimal (`'26127'` -> 26127) or as scientific notation (`'257e3'` -> 257000) or as
  // NaN (`'4e2d'`), which silently scrambled the order and made most characters unfindable.
  const cps = [...byCodePoint.keys()].sort((a, b) => parseInt(a, 16) - parseInt(b, 16) || a.localeCompare(b));
  if (cps.length === 0) throw new Error('Unihan loaded but contained no codepoints');

  const rows = [];
  let cappedVariants = 0;
  let emptyFieldRecords = 0;
  for (const cp of cps) {
    const rec = byCodePoint.get(cp);
    const mandarin = rec.kMandarin ? rec.kMandarin.trim() : '';
    const cantonese = rec.kCantonese ? rec.kCantonese.trim() : '';
    const definition = rec.kDefinition ? rec.kDefinition.trim() : '';
    const radical = normalizeRadical(rec.kRSUnicode);
    const strokeCount = firstValue(rec.kTotalStrokes);
    const simpAll = (rec.kSimplifiedVariant || '').trim().split(/\s+/).filter(Boolean).length;
    const tradAll = (rec.kTraditionalVariant || '').trim().split(/\s+/).filter(Boolean).length;
    if (simpAll > VARIANT_CAP || tradAll > VARIANT_CAP) cappedVariants++;
    const simp = codePointList(rec.kSimplifiedVariant);
    const trad = codePointList(rec.kTraditionalVariant);
    if (!mandarin && !cantonese && !definition && !radical && !strokeCount) emptyFieldRecords++;
    rows.push([cp.toLowerCase(), rec.char, mandarin, cantonese, definition, radical, strokeCount, simp, trad]);
  }

  let previousCodePoint = -1;
  for (const r of rows) {
    if (!/^[0-9a-f]{4,6}$/.test(r[0])) throw new Error(`Bad codepoint hex in characters pack: ${r[0]}`);
    const codePoint = Number.parseInt(r[0], 16);
    if (r[1].codePointAt(0) !== codePoint) throw new Error(`char/codepoint mismatch for ${r[0]}`);
    // The runtime finds a character by binary search over the concatenated shards, so global
    // code-point order is part of the pack contract, not a nicety. Fail the build here rather than
    // ship a pack where most characters read as "not recorded".
    if (codePoint <= previousCodePoint) {
      throw new Error(`characters pack is not in code-point order at ${r[0]} (after ${previousCodePoint})`);
    }
    previousCodePoint = codePoint;
  }

  await ensureDir(PACK_DIR);
  const removed = await clearDir(PACK_DIR);
  const shardSize = SHARD_SIZES[PACK_ID];
  const files = [];
  for (let start = 0; start < rows.length; start += shardSize) {
    const name = `${String(files.length).padStart(3, '0')}.txt`;
    const writer = new RecordWriter(path.join(PACK_DIR, name), CHARACTER_FIELDS, `${PACK_ID}/${name}`);
    await writer.open();
    const slice = rows.slice(start, start + shardSize);
    for (const row of slice) await writer.write(row);
    const summary = await writer.close();
    files.push({ path: path.relative(DATA_DIR, summary.path).replace(/\\/g, '/'), sha256: await sha256File(summary.path), bytes: summary.bytes, records: slice.length });
  }

  const records = files.reduce((n, f) => n + f.records, 0);
  const bytes = files.reduce((n, f) => n + f.bytes, 0);
  if (!quiet) {
    console.log(
      `characters: ${records} records (Unicode ${header.unicodeVersion}) in ${files.length} shards (${formatBytes(bytes)}), ` +
        `variant lists capped at ${VARIANT_CAP} in ${cappedVariants} records, cleared ${removed} stale files`
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
  }
  return {
    packId: PACK_ID,
    files,
    coverage: { records, languages: null },
    stats: { unicodeVersion: header.unicodeVersion, cappedVariants, emptyFieldRecords, variantCap: VARIANT_CAP },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await build({ cacheDir: resolveCacheDir(process.argv) });
  console.log(JSON.stringify({ pack: r.packId, records: r.coverage.records, stats: r.stats }, null, 2));
}

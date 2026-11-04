/**
 * build-dictionary.mjs - CC-CEDICT -> public/data/packs/dictionary-core/NNN.txt
 *
 * Record: simplified US traditional US pinyinNumbered US pinyinMarked US pinyinPlain US definition
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DATA_DIR,
  PACKS_DIR,
  clearDir,
  compareCodePoints,
  ensureDir,
  exists,
  formatBytes,
  readText,
  resolveCacheDir,
  sha256File,
  table,
} from './lib/fs.mjs';
import { RecordWriter } from './lib/record.mjs';
import { numberedToMarked, toPlain } from './lib/pinyin.mjs';
import { DICTIONARY_FIELDS, cleanGloss } from './lib/cedict.mjs';
import { SHARD_SIZES } from './lib/packs.mjs';
import { loadProvenance } from './lib/provenance.mjs';

const PACK_ID = 'dictionary-core';
const PACK_DIR = path.join(PACKS_DIR, PACK_ID);

export async function build({ cacheDir, quiet = false } = {}) {
  const srcFile = path.join(cacheDir, 'cedict_ts.u8');
  if (!exists(srcFile)) throw new Error(`Missing cache file ${srcFile} - run scripts/content/fetch-sources.mjs first`);

  const reg = loadProvenance();
  const cedict = reg.byId.get('cc-cedict');
  const text = readText(srcFile);

  // Guard: the cache must be the release provenance.json pins.
  const dateLine = text.match(/^#! date=(\S+)$/m);
  const entriesLine = text.match(/^#! entries=(\d+)$/m);
  const headerDate = dateLine ? dateLine[1] : null;
  if (headerDate && cedict.upstreamDate !== headerDate) {
    throw new Error(
      `Cache drift: cedict_ts.u8 header says date=${headerDate} but provenance.json pins ${cedict.upstreamDate}. ` +
        'Update provenance.json (and re-check the licence/version) before building.'
    );
  }

  const rows = [];
  let boilerplateStripped = 0;
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+) (\S+) \[([^\]]*)\] (\/.*\/)$/);
    if (!m) {
      skipped++;
      continue;
    }
    // CC-CEDICT writes TRADITIONAL first, SIMPLIFIED second. The pack format (and everything
    // downstream - entry ids, the `byS` index, `displayScript`) is defined the other way round, so
    // the capture groups are bound against the pack's field names, not the source's column order.
    const [, traditional, simplified, pinyinRaw, defRaw] = m;
    const glosses = defRaw.slice(1, -1).split('/').map((g) => g.trim());
    const cleaned = glosses.map(cleanGloss);
    for (let i = 0; i < glosses.length; i++) if (cleaned[i] !== glosses[i]) boilerplateStripped++;
    const definition = cleaned.filter((g) => g.length > 0).join('; ');
    if (!definition) throw new Error(`Record with empty definition: ${line.slice(0, 100)}`);
    const pinyinNumbered = pinyinRaw.trim().toLowerCase().replace(/\s+/g, ' ');
    rows.push([simplified, traditional, pinyinNumbered, numberedToMarked(pinyinNumbered), toPlain(pinyinNumbered), definition]);
  }

  if (skipped > 0) throw new Error(`${skipped} CC-CEDICT data lines did not match the expected "TRAD SIMP [py] /def/" shape`);

  const declared = entriesLine ? Number(entriesLine[1]) : null;
  if (declared !== null && declared !== rows.length) {
    throw new Error(`Record count mismatch: parsed ${rows.length} but the CC-CEDICT header declares ${declared}`);
  }

  rows.sort((a, b) => {
    const c = compareCodePoints(a[0], b[0]);
    if (c !== 0) return c;
    return compareCodePoints(a[2], b[2]);
  });

  await ensureDir(PACK_DIR);
  const removed = await clearDir(PACK_DIR);
  const shardSize = SHARD_SIZES[PACK_ID];
  const shardCount = Math.ceil(rows.length / shardSize);
  const files = [];
  let writer = null;
  let inShard = 0;
  for (let i = 0; i < rows.length; i++) {
    if (!writer || inShard === 0) {
      const name = `${String(files.length).padStart(3, '0')}.txt`;
      writer = new RecordWriter(path.join(PACK_DIR, name), DICTIONARY_FIELDS, `${PACK_ID}/${name}`);
      await writer.open();
    }
    await writer.write(rows[i]);
    inShard++;
    if (inShard === shardSize || i === rows.length - 1) {
      const summary = await writer.close();
      files.push({ ...summary, path: path.relative(DATA_DIR, summary.path).replace(/\\/g, '/'), records: writer.records });
      writer = null;
      inShard = 0;
    }
  }
  if (files.length !== shardCount) throw new Error(`Expected ${shardCount} shards, wrote ${files.length}`);

  for (const f of files) f.sha256 = await sha256File(path.join(DATA_DIR, f.path));

  const records = files.reduce((n, f) => n + f.records, 0);
  const bytes = files.reduce((n, f) => n + f.bytes, 0);
  if (!quiet) {
    console.log(`dictionary-core: ${records} records in ${files.length} shards (${formatBytes(bytes)}), cleared ${removed} stale files`);
    console.log(
      table(
        files.map((f) => ({ file: f.path, records: String(f.records), bytes: formatBytes(f.bytes), sha: f.sha256.slice(0, 12) })),
        [
          ['file', 'file'],
          ['records', 'records'],
          ['bytes', 'bytes'],
          ['sha256', 'sha'],
        ]
      )
    );
  }
  let maxHeadwordChars = 0;
  for (const r of rows) maxHeadwordChars = Math.max(maxHeadwordChars, [...r[0]].length);

  return {
    packId: PACK_ID,
    files,
    coverage: { records, languages: null },
    stats: { parsed: rows.length, boilerplateStripped, shardSize, maxHeadwordChars },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await build({ cacheDir: resolveCacheDir(process.argv) });
  console.log(JSON.stringify({ pack: r.packId, records: r.coverage.records, stats: r.stats }, null, 2));
}

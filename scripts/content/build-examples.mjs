/**
 * build-examples.mjs - Tatoeba cmn/eng exports -> public/data/packs/examples/NNN.txt
 *
 * Record: headword US simplifiedSentence US traditionalSentence US pinyin US english US sourceRefs
 *
 * Join path: cmn_sentences.tsv.bz2 --(cmn-eng_links.tsv.bz2)--> eng_sentences.tsv.bz2.
 * Only linked cmn->eng pairs are used, at most 3 sentences per headword, only CEDICT
 * headwords of length >= 2 that occur as a substring of the (simplified-normalised)
 * sentence, and sentences with 4..60 Hanzi characters.
 *
 * `pinyin` is the headword's CC-CEDICT reading in numbered form. Sentence-level pinyin is
 * NOT invented here: it would require a segmentation of the Tatoeba sentence that CEDICT
 * cannot provide authoritatively, and the pipeline never fabricates readings.
 *
 * `sourceRefs` keeps the Tatoeba sentence ids so contributors can be credited:
 * `tatoeba:<cmnId>:<author>+tatoeba:<engId>:<author>`. The pinned exports publish usernames
 * only in the multi-GB user_logs dumps, so <author> is the literal `unknown` (see the
 * `attributionGap` recorded in provenance.json).
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA_DIR, PACKS_DIR, clearDir, ensureDir, exists, formatBytes, resolveCacheDir, sha256File, table, compareCodePoints, readText } from './lib/fs.mjs';
import { RecordWriter } from './lib/record.mjs';
import { PACK_DEFS, SHARD_SIZES } from './lib/packs.mjs';
import { iterateRecords } from './lib/cedict.mjs';
import { bz2Backend, tsvLines } from './lib/archive.mjs';
import { loadUnihan, variantMaps, convertCase } from './lib/unihan.mjs';

const PACK_ID = 'examples';
const PACK_DIR = path.join(PACKS_DIR, PACK_ID);
export const EXAMPLE_FIELDS = 6;

const MIN_HANZI = 4;
const MAX_HANZI = 60;
const MAX_SENTENCES_PER_HEADWORD = 3;
const MIN_HEADWORD_CHARS = 2;

/** CJK ideograph ranges counted as Hanzi for the length guard. */
export function isHanzi(ch) {
  const c = ch.codePointAt(0);
  return (
    (c >= 0x3400 && c <= 0x4dbf) || // Ext A
    (c >= 0x4e00 && c <= 0x9fff) || // Unified
    (c >= 0xf900 && c <= 0xfaff) || // Compatibility
    (c >= 0x20000 && c <= 0x2a6df) || // Ext B
    (c >= 0x2a700 && c <= 0x2ebef) // Ext C-F
  );
}

export function hanziCount(text) {
  let n = 0;
  for (const ch of text) if (isHanzi(ch)) n++;
  return n;
}

/** CC-CEDICT headwords of length >= 2 -> deterministic numbered reading. */
function loadHeadwords(cedictPath) {
  const text = readText(cedictPath);
  const map = new Map();
  let entries = 0;
  for (const rec of iterateRecords(text)) {
    entries++;
    if (Array.from(rec.simplified).length < MIN_HEADWORD_CHARS) continue;
    const existing = map.get(rec.simplified);
    if (existing === undefined || compareCodePoints(rec.pinyinNumbered, existing) < 0) {
      map.set(rec.simplified, rec.pinyinNumbered);
    }
  }
  return { map, entries };
}

/** cmn id -> eng id; a cmn sentence with several links keeps the lowest eng id. */
async function loadLinks(linksFile) {
  const byCmn = new Map();
  let rows = 0;
  for await (const line of tsvLines(linksFile)) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 2) throw new Error(`${path.basename(linksFile)}: malformed link row: ${line.slice(0, 80)}`);
    const cmnId = Number(parts[0]);
    const engId = Number(parts[1]);
    if (!Number.isSafeInteger(cmnId) || !Number.isSafeInteger(engId)) {
      throw new Error(`${path.basename(linksFile)}: non-numeric link row: ${line.slice(0, 80)}`);
    }
    rows++;
    const known = byCmn.get(cmnId);
    if (known === undefined || engId < known) byCmn.set(cmnId, engId);
  }
  return { byCmn, rows };
}

async function loadCmnTexts(sentencesFile, wantedIds) {
  const texts = new Map();
  let rows = 0;
  let langMismatch = 0;
  for await (const line of tsvLines(sentencesFile)) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 3) throw new Error(`${path.basename(sentencesFile)}: malformed row: ${line.slice(0, 80)}`);
    rows++;
    const id = Number(parts[0]);
    if (!wantedIds.has(id)) continue;
    if (parts[1] !== 'cmn') langMismatch++;
    texts.set(id, parts.slice(2).join('\t').trim());
  }
  return { texts, rows, langMismatch };
}

async function loadEngTexts(sentencesFile, wantedIds) {
  const texts = new Map();
  let rows = 0;
  for await (const line of tsvLines(sentencesFile)) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    rows++;
    const id = Number(parts[0]);
    if (!wantedIds.has(id)) continue;
    if (parts[1] !== 'eng') continue;
    texts.set(id, parts.slice(2).join('\t').trim());
  }
  return { texts, rows };
}

export async function build({ cacheDir, quiet = false } = {}) {
  const cedict = path.join(cacheDir, 'cedict_ts.u8');
  const unihanZip = path.join(cacheDir, 'Unihan.zip');
  const linksFile = path.join(cacheDir, 'cmn-eng_links.tsv.bz2');
  const cmnFile = path.join(cacheDir, 'cmn_sentences.tsv.bz2');
  const engFile = path.join(cacheDir, 'eng_sentences.tsv.bz2');
  for (const f of [cedict, unihanZip, linksFile, cmnFile, engFile]) {
    if (!exists(f)) throw new Error(`Missing cache file ${f} - run scripts/content/fetch-sources.mjs first`);
  }

  const backend = bz2Backend();
  if (!quiet) console.log(`examples: reading Tatoeba exports with the ${backend} backend (eng file is the large one)`);

  const { map: headwords, entries: cedictEntries } = loadHeadwords(cedict);
  const { byCodePoint } = loadUnihan(unihanZip);
  const { toSimplified, toTraditional } = variantMaps(byCodePoint);

  const { byCmn: links, rows: linkRows } = await loadLinks(linksFile);
  if (linkRows === 0) throw new Error('cmn-eng_links.tsv.bz2 contained no rows');

  const { texts: cmnTexts, rows: cmnRows, langMismatch } = await loadCmnTexts(cmnFile, new Set(links.keys()));
  const { texts: engTexts, rows: engRows } = await loadEngTexts(engFile, new Set(links.values()));

  // ---- match sentences to headwords -------------------------------------------
  const candidates = new Map(); // headword -> [{id, len}]
  const sentences = new Map(); // cmn id -> {simp, trad, eng, len, id}
  let tooShort = 0;
  let tooLong = 0;
  let untranslated = 0;
  let matchedSentences = 0;
  let substringChecks = 0;

  let maxHeadwordChars = 0;
  for (const k of headwords.keys()) maxHeadwordChars = Math.max(maxHeadwordChars, Array.from(k).length);
  const cmnIds = [...links.keys()].sort((a, b) => a - b);
  for (const id of cmnIds) {
    const raw = cmnTexts.get(id);
    if (raw === undefined) continue;
    const engId = links.get(id);
    const english = engTexts.get(engId);
    if (!english || english.length === 0) {
      untranslated++;
      continue;
    }
    const simplified = convertCase(raw, toSimplified);
    const len = hanziCount(simplified);
    if (len < MIN_HANZI) {
      tooShort++;
      continue;
    }
    if (len > MAX_HANZI) {
      tooLong++;
      continue;
    }
    const chars = Array.from(simplified);
    const found = new Set();
    for (let i = 0; i < chars.length; i++) {
      for (let l = MIN_HEADWORD_CHARS; l <= maxHeadwordChars && i + l <= chars.length; l++) {
        const slice = chars.slice(i, i + l).join('');
        substringChecks++;
        if (headwords.has(slice)) found.add(slice);
      }
    }
    if (found.size === 0) continue;
    matchedSentences++;
    sentences.set(id, {
      id,
      engId,
      len,
      simplified,
      traditional: convertCase(raw, toTraditional),
      english,
    });
    for (const headword of found) {
      let list = candidates.get(headword);
      if (!list) candidates.set(headword, (list = []));
      list.push({ id, len });
    }
  }

  // ---- pick at most 3 sentences per headword (shortest first, then lowest id) --
  const rowsOut = [];
  for (const [headword, list] of candidates) {
    list.sort((a, b) => a.len - b.len || a.id - b.id);
    for (const pick of list.slice(0, MAX_SENTENCES_PER_HEADWORD)) {
      const s = sentences.get(pick.id);
      rowsOut.push([
        headword,
        s.simplified,
        s.traditional,
        headwords.get(headword),
        s.english,
        `tatoeba:${s.id}:unknown+tatoeba:${s.engId}:unknown`,
      ]);
    }
  }
  rowsOut.sort((a, b) => compareCodePoints(a[0], b[0]) || compareCodePoints(a[3], b[3]) || a[5].localeCompare(b[5]));

  // ---- write shards ----------------------------------------------------------
  await ensureDir(PACK_DIR);
  const removed = await clearDir(PACK_DIR);
  const shardSize = SHARD_SIZES[PACK_ID];
  const files = [];
  for (let start = 0; start < rowsOut.length; start += shardSize) {
    const name = `${String(files.length).padStart(3, '0')}.txt`;
    const writer = new RecordWriter(path.join(PACK_DIR, name), EXAMPLE_FIELDS, `${PACK_ID}/${name}`);
    await writer.open();
    const slice = rowsOut.slice(start, start + shardSize);
    for (const row of slice) await writer.write(row);
    const summary = await writer.close();
    files.push({ path: path.relative(DATA_DIR, summary.path).replace(/\\/g, '/'), sha256: await sha256File(summary.path), bytes: summary.bytes, records: slice.length });
  }

  const records = files.reduce((n, f) => n + f.records, 0);
  const bytes = files.reduce((n, f) => n + f.bytes, 0);
  const stats = {
    bz2Backend: backend,
    cedictEntries,
    headwordsLengthGe2: headwords.size,
    maxHeadwordChars,
    linkRows,
    linkedCmnSentences: links.size,
    cmnRows,
    engRows,
    cmnTextsFound: cmnTexts.size,
    engTextsFound: engTexts.size,
    langMismatch,
    tooShort,
    tooLong,
    untranslated,
    sentencesWithHeadwords: matchedSentences,
    headwordsWithExamples: candidates.size,
    substringChecks,
    minHanzi: MIN_HANZI,
    maxHanzi: MAX_HANZI,
    maxSentencesPerHeadword: MAX_SENTENCES_PER_HEADWORD,
  };

  if (!quiet) {
    console.log(
      `examples: ${records} records for ${stats.headwordsWithExamples} headwords from ${matchedSentences} linked Tatoeba ` +
        `sentences in ${files.length} shards (${formatBytes(bytes)}), cleared ${removed} stale files`
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
    console.log(
      `  filtered out: ${tooShort} too short (<${MIN_HANZI} Hanzi), ${tooLong} too long (>${MAX_HANZI} Hanzi), ` +
        `${untranslated} without an English link`
    );
  }

  return { packId: PACK_ID, files, coverage: { records, languages: PACK_DEFS[PACK_ID].languages }, stats };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await build({ cacheDir: resolveCacheDir(process.argv) });
  console.log(JSON.stringify({ pack: r.packId, records: r.coverage.records, files: r.files.length, stats: r.stats }, null, 2));
}

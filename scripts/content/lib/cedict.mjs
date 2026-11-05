/**
 * CC-CEDICT `cedict_ts.u8` parser.
 *
 * Line format:  SIMP TRAD [pinyin] /gloss1/gloss2/
 * Comment lines start with `#!` or `#` and are skipped.
 */
import { canonicalNumbered } from './pinyin.mjs';

const LINE = /^(\S+) (\S+) \[([^\]]*)\] (\/.*\/)$/;

/**
 * A leading `(also ...)` / `(variant of ...)` note is metadata about the
 * headword rather than its meaning. Removing it is only "trivially safe" when
 * the gloss still says something afterwards, so that - and only that - case is
 * stripped; everything else is kept verbatim.
 */
const BOILERPLATE = /^\((?:also|variant|variants)(?:\s+of)?\s[^)]*\)\s*/i;

export function cleanGloss(gloss) {
  const stripped = gloss.replace(BOILERPLATE, '');
  if (stripped !== gloss && stripped.trim().length > 0) return stripped.trim();
  return gloss;
}

/** @returns {{simplified:string,traditional:string,pinyinNumbered:string,glosses:string[],definition:string}|null} */
export function parseLine(line) {
  const m = line.match(LINE);
  if (!m) return null;
  // CC-CEDICT writes the TRADITIONAL headword first and the SIMPLIFIED one second
  // (`developing country` above is `發展中國家 发展中国家 [...]`). Reading the capture groups in
  // source order silently inverts every entry: the packs, the index and the UI all key off
  // `simplified` being field 0, so the labels have to be bound the other way round here.
  const [, traditional, simplified, pinyinRaw, defRaw] = m;
  const inner = defRaw.slice(1, -1);
  const glosses = inner.split('/').map((g) => cleanGloss(g.trim())).filter((g) => g.length > 0);
  return {
    simplified,
    traditional,
    pinyinNumbered: canonicalNumbered(pinyinRaw),
    glosses,
    definition: glosses.join('; '),
  };
}

export const DICTIONARY_FIELDS = 8;

/** Record order is fixed by docs/DATA_FORMAT.md (v0.2: 8 fields). */
export function toFields(entry, marked, plain, definitionVi = '', hanViet = '') {
  return [
    entry.simplified,
    entry.traditional,
    entry.pinyinNumbered,
    marked,
    plain,
    entry.definition,
    definitionVi,
    hanViet,
  ];
}

/** Iterates every data record of a decoded cedict buffer/string. */
export function* iterateRecords(text) {
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const rec = parseLine(line);
    if (!rec) throw new Error(`Unparseable CC-CEDICT line: ${line.slice(0, 120)}`);
    yield rec;
  }
}

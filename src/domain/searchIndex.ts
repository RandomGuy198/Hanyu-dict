/** The dictionary index: column arrays plus sorted id views, queried by binary search. */

import { isHanCharacter, pinyinKey, queryPinyinKeys } from './pinyin';
import {
  SCORE,
  compareResults,
  detectMode,
  editDistance,
  entryId,
  foldVietnamese,
  initialsKey,
  lengthPenalty,
  normaliseQuery,
  tokeniseDefinition,
} from './searchRanking';
import { US, type DictEntry, type MatchKind, type SearchResult, type TextSpan } from './types';

/** A character above every BMP code unit, used as the exclusive end of a prefix range. */
const HIGH = String.fromCharCode(0xffff);

export interface IndexStats {
  entries: number;
  shards: number;
  buildMs: number;
}

export class DictionaryIndex {
  private s: string[] = [];
  private t: string[] = [];
  private pn: string[] = [];
  private pm: string[] = [];
  private pk: string[] = [];
  private ini: string[] = [];
  private def: string[] = [];
  private defVi: string[] = [];
  private hv: string[] = [];
  private len: number[] = [];
  private byId = new Map<string, number>();

  private byS: Uint32Array = new Uint32Array(0);
  private byT: Uint32Array = new Uint32Array(0);
  private byP: Uint32Array = new Uint32Array(0);
  private byI: Uint32Array = new Uint32Array(0);

  private tokenKeys: string[] = [];
  private tokenPostings: Uint32Array[] = [];
  private defReady = false;
  private shards = 0;
  private buildMs = 0;
  private ready = false;

  get size(): number {
    return this.s.length;
  }

  isReady(): boolean {
    return this.ready;
  }

  stats(): IndexStats {
    return { entries: this.s.length, shards: this.shards, buildMs: this.buildMs };
  }

  reset(): void {
    this.s = [];
    this.t = [];
    this.pn = [];
    this.pm = [];
    this.pk = [];
    this.ini = [];
    this.def = [];
    this.defVi = [];
    this.hv = [];
    this.len = [];
    this.byId = new Map();
    this.tokenKeys = [];
    this.tokenPostings = [];
    this.defReady = false;
    this.shards = 0;
    this.ready = false;
  }

  /** Append one decoded shard (array of encoded lines). */
  addShard(lines: string[]): void {
    this.shards += 1;
    for (const line of lines) {
      if (!line) continue;
      const parts = line.split(US);
      if (parts.length < 6) continue;
      const simplified = parts[0];
      const definition = parts[5];
      if (!simplified || !definition) continue;
      const numbered = parts[2] ?? '';
      const id = entryId(simplified, numbered);
      const index = this.s.length;
      if (!this.byId.has(id)) this.byId.set(id, index);
      this.s.push(simplified);
      this.t.push(parts[1] ?? simplified);
      this.pn.push(numbered);
      this.pm.push(parts[3] ?? '');
      // The engine derives its own toneless key so a pack's plain field stays informational.
      this.pk.push(pinyinKey(parts[4] || numbered));
      this.ini.push(initialsKey(numbered));
      this.def.push(definition);
      this.defVi.push(parts[6] ?? '');
      this.hv.push(parts[7] ?? '');
      this.len.push([...simplified].length);
    }
  }

  build(): IndexStats {
    const started = Date.now();
    const n = this.s.length;
    const order = (keyOf: (i: number) => string): Uint32Array => {
      const arr = new Array<number>(n);
      for (let i = 0; i < n; i++) arr[i] = i;
      arr.sort((a, b) => {
        const ka = keyOf(a);
        const kb = keyOf(b);
        if (ka !== kb) return ka < kb ? -1 : 1;
        const pa = this.pn[a];
        const pb = this.pn[b];
        if (pa !== pb) return pa < pb ? -1 : 1;
        return a - b;
      });
      return Uint32Array.from(arr);
    };
    this.byS = order((i) => this.s[i]);
    this.byT = order((i) => this.t[i]);
    this.byP = order((i) => this.pk[i]);
    this.byI = order((i) => this.ini[i]);
    this.ready = true;
    this.buildMs = Date.now() - started;
    return this.stats();
  }

  entryAt(i: number): DictEntry {
    const defVi = this.defVi[i];
    const hv = this.hv[i];
    const defsVi = defVi ? defVi.split('; ').filter(Boolean) : undefined;
    return {
      id: entryId(this.s[i], this.pn[i]),
      simplified: this.s[i],
      traditional: this.t[i],
      pinyinNumbered: this.pn[i],
      pinyinMarked: this.pm[i],
      pinyinPlain: this.pk[i],
      definition: this.def[i],
      ...(defVi ? { definitionVi: defVi } : {}),
      ...(defsVi && defsVi.length > 0 ? { definitionsVi: defsVi } : {}),
      ...(hv ? { hanViet: hv } : {}),
      length: this.len[i],
    };
  }

  byEntryId(id: string): DictEntry | undefined {
    const i = this.byId.get(id);
    return i === undefined ? undefined : this.entryAt(i);
  }

  /** First position in `view` whose key is >= target. */
  private lowerBound(view: Uint32Array, keyOf: (i: number) => string, target: string): number {
    let lo = 0;
    let hi = view.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (keyOf(view[mid]) < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private range(view: Uint32Array, keyOf: (i: number) => string, prefix: string): [number, number] {
    const lo = this.lowerBound(view, keyOf, prefix);
    const hi = this.lowerBound(view, keyOf, prefix + HIGH);
    return [lo, hi];
  }

  /** Every record sharing a headword (a word can have several readings). */
  exactByHeadword(headword: string): DictEntry[] {
    if (!this.ready) return [];
    const key = (i: number) => this.s[i];
    const [lo, hi] = this.range(this.byS, key, headword);
    const out: DictEntry[] = [];
    for (let i = lo; i < hi && out.length < 40; i++) {
      const index = viewAt(this.byS, i);
      if (this.s[index] === headword) out.push(this.entryAt(index));
    }
    if (out.length > 0) return out;
    const tkey = (i: number) => this.t[i];
    const [tlo, thi] = this.range(this.byT, tkey, headword);
    for (let i = tlo; i < thi && out.length < 40; i++) {
      const index = viewAt(this.byT, i);
      if (this.t[index] === headword) out.push(this.entryAt(index));
    }
    return out;
  }

  entriesByIds(ids: number[]): DictEntry[] {
    return ids.map((i) => this.entryAt(i));
  }

  /* ------------------------------------------------------------------ search */

  search(query: { text: string; mode?: string; limit?: number }): SearchResult[] {
    const text = normaliseQuery(query.text ?? '');
    if (!text || !this.ready) return [];
    const limit = Math.max(1, Math.min(400, query.limit ?? 60));
    const wanted = new Map<number, { score: number; match: MatchKind; via: SearchResult['via'] }>();
    const keep = (i: number, score: number, match: MatchKind, via: SearchResult['via']) => {
      const existing = wanted.get(i);
      const adjusted = score - lengthPenalty(this.len[i]);
      if (!existing || adjusted > existing.score) wanted.set(i, { score: adjusted, match, via });
    };

    const mode = query.mode && query.mode !== 'auto' ? query.mode : detectMode(text);
    const isHan = isHanCharacter(text);

    if (mode === 'auto' || mode === 'hans' || mode === 'hant') {
      this.hanziPass(keep, text, isHan);
    }
    if (mode === 'auto' || mode === 'pinyin') {
      this.pinyinPass(keep, text);
    }
    if (mode === 'auto' || mode === 'english') {
      this.definitionPass(keep, text);
    }

    const results: SearchResult[] = [];
    for (const [i, hit] of wanted) {
      results.push({
        entry: this.entryAt(i),
        score: hit.score,
        match: hit.match,
        via: hit.via,
      });
    }
    results.sort(compareResults);
    return results.slice(0, limit);
  }

  private hanziPass(
    keep: (i: number, score: number, match: MatchKind, via: SearchResult['via']) => void,
    text: string,
    isHan: boolean,
  ): void {
    if (!isHan) return;
    const sKey = (i: number) => this.s[i];
    const tKey = (i: number) => this.t[i];
    const views: [Uint32Array, (i: number) => string, number, number, SearchResult['via']][] = [
      [this.byS, sKey, SCORE.exactHans, SCORE.prefixHans, 'simplified'],
      [this.byT, tKey, SCORE.exactHant, SCORE.prefixHant, 'traditional'],
    ];
    for (const [view, key, exactScore, prefixScore, via] of views) {
      const [lo, hi] = this.range(view, key, text);
      // exact first so a direct hit outranks its own prefixes
      for (let i = lo; i < hi; i++) {
        const id = viewAt(view, i);
        if (key(id) === text) keep(id, exactScore, 'exact', via);
        else keep(id, prefixScore - Math.min(40, i - lo), 'prefix', via);
      }
    }
  }

  private pinyinPass(
    keep: (i: number, score: number, match: MatchKind, via: SearchResult['via']) => void,
    text: string,
  ): void {
    if (!/[a-z]/i.test(text)) return;
    const keys = queryPinyinKeys(text);
    const pKey = (i: number) => this.pk[i];
    for (const key of keys) {
      if (key.length === 0) continue;
      const [lo, hi] = this.range(this.byP, pKey, key);
      for (let i = lo; i < hi; i++) {
        const id = viewAt(this.byP, i);
        if (pKey(id) === key) keep(id, SCORE.exactPinyin, 'exact', 'pinyin');
        else keep(id, SCORE.prefixPinyin - Math.min(40, i - lo), 'prefix', 'pinyin');
        if (i - lo > 200) break;
      }
    }
    // abbreviation search: zg -> zhongguo words
    const abbrev = text.toLowerCase().replace(/[^a-z]/g, '');
    if (abbrev.length >= 2 && abbrev.length <= 8) {
      const iKey = (i: number) => this.ini[i];
      const [lo, hi] = this.range(this.byI, iKey, abbrev);
      for (let i = lo; i < hi && i - lo < 120; i++) {
        const id = viewAt(this.byI, i);
        keep(id, iKey(id) === abbrev ? SCORE.prefixInitials : SCORE.prefixInitials - 20, 'prefix', 'pinyin');
      }
    }
    // one-typo tolerance, bounded to prefix candidates of the first four characters
    if (keys.length > 0 && keys[0].length >= 4) {
      const probe = keys[0].slice(0, 4);
      const [lo, hi] = this.range(this.byP, pKey, probe);
      for (let i = lo; i < hi && i - lo < 400; i++) {
        const id = viewAt(this.byP, i);
        if (editDistance(pKey(id), keys[0], 1) <= 1) keep(id, SCORE.fuzzyPinyin, 'fuzzy', 'pinyin');
      }
    }
  }

  private definitionPass(
    keep: (i: number, score: number, match: MatchKind, via: SearchResult['via']) => void,
    text: string,
  ): void {
    const rawTokens = (text.toLowerCase().match(/[\p{Script=Latin}\p{N}]+/gu) ?? []).filter(
      (t) => t.length > 1 || /[\p{Script=Latin}]/u.test(t),
    );
    if (rawTokens.length === 0) return;
    this.ensureDefinitionIndex();
    const postings = rawTokens.map((token) => this.postingsFor(token));
    const queryLower = rawTokens.join(' ');
    const queryFolded = foldVietnamese(queryLower);
    const exactPhrase = this.phrasePostings(rawTokens, queryLower, queryFolded);
    for (const [i, phraseScore] of exactPhrase) {
      keep(i, phraseScore, 'contains', 'definition');
    }
    // tokens present in every result
    let shared: Set<number> | null = null;
    for (const list of postings) {
      const set = new Set(list);
      shared = shared === null ? set : intersect(shared, set);
    }
    if (shared) {
      for (const i of shared) {
        if (exactPhrase.has(i)) continue;
        let score: number = SCORE.definitionAll;
        const hvLower = this.hv[i].toLowerCase();
        if (hvLower && (hvLower === queryLower || foldVietnamese(hvLower) === queryFolded)) {
          score = SCORE.definitionPhrase + 40;
        } else {
          const defViLower = this.defVi[i].toLowerCase();
          if (defViLower) {
            const glosses = defViLower.split(';').map((g) => g.trim());
            if (glosses.some((g) => g === queryLower || foldVietnamese(g) === queryFolded)) {
              score = SCORE.definitionPhrase + 20;
            }
          }
        }
        keep(i, score, 'definition', 'definition');
      }
    }
    if (rawTokens.length > 1 && shared && shared.size === 0) {
      for (const list of postings) {
        const capped = list.slice(0, 120);
        for (const i of capped) keep(i, SCORE.definitionAny, 'definition', 'definition');
      }
    }
  }

  private ensureDefinitionIndex(): void {
    if (this.defReady) return;
    const buckets = new Map<string, number[]>();
    const addTokens = (i: number, text: string, seen: Set<string>) => {
      if (!text) return;
      for (const token of tokeniseDefinition(text)) {
        if (seen.has(token)) continue;
        seen.add(token);
        const list = buckets.get(token);
        if (list) list.push(i);
        else buckets.set(token, [i]);
      }
    };
    for (let i = 0; i < this.def.length; i++) {
      const seen = new Set<string>();
      addTokens(i, this.def[i], seen);
      addTokens(i, this.defVi[i], seen);
      addTokens(i, this.hv[i], seen);
    }
    const keys = [...buckets.keys()].sort();
    this.tokenKeys = keys;
    this.tokenPostings = keys.map((k) => Uint32Array.from(buckets.get(k) ?? []));
    this.defReady = true;
  }

  /** Postings for a token, including prefix expansions for the tail of a query. */
  private postingsFor(token: string): Uint32Array {
    this.ensureDefinitionIndex();
    const exact = this.tokenIndex(token);
    if (exact >= 0 && this.tokenKeys[exact] === token) {
      const direct = this.tokenPostings[exact];
      if (direct.length <= 4000) return direct;
      return direct.slice(0, 4000);
    }
    const [lo, hi] = this.tokenRange(token);
    if (hi - lo === 0) return new Uint32Array(0);
    const merged: number[] = [];
    for (let k = lo; k < hi && k < lo + 24; k++) {
      for (const i of this.tokenPostings[k]) {
        if (merged.length < 2000) merged.push(i);
      }
    }
    return Uint32Array.from(merged);
  }

  private phrasePostings(tokens: string[], phraseLower: string, phraseFolded: string): Map<number, number> {
    if (tokens.length < 2) return new Map();
    const out = new Map<number, number>();
    const probe = this.postingsFor(tokens[0]).slice(0, 1500);
    for (const i of probe) {
      const hvLower = this.hv[i].toLowerCase();
      if (hvLower && (hvLower === phraseLower || foldVietnamese(hvLower) === phraseFolded)) {
        out.set(i, SCORE.definitionPhrase + 40);
        continue;
      }
      const defViLower = this.defVi[i].toLowerCase();
      if (defViLower) {
        const glosses = defViLower.split(';').map((g) => g.trim());
        if (glosses.some((g) => g === phraseLower || foldVietnamese(g) === phraseFolded)) {
          out.set(i, SCORE.definitionPhrase + 20);
          continue;
        }
        if (defViLower.includes(phraseLower) || foldVietnamese(defViLower).includes(phraseFolded)) {
          out.set(i, SCORE.definitionPhrase);
          continue;
        }
      }
      if (this.def[i].toLowerCase().includes(phraseLower)) {
        out.set(i, SCORE.definitionPhrase);
      }
    }
    return out;
  }

  private tokenIndex(token: string): number {
    let lo = 0;
    let hi = this.tokenKeys.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.tokenKeys[mid] < token) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private tokenRange(prefix: string): [number, number] {
    const lo = this.tokenIndex(prefix);
    const hi = this.tokenIndex(prefix + HIGH);
    return [lo, hi];
  }

  /* ------------------------------------------------------------------ reader spans */

  /** Longest-first dictionary spans inside a run of text, for the reader and OCR review. */
  lookupSpans(text: string, maxLen = 6): TextSpan[] {
    if (!this.ready || !text) return [];
    const chars = [...text];
    const taken = new Array<boolean>(chars.length).fill(false);
    const spans: TextSpan[] = [];
    for (let start = 0; start < chars.length; start++) {
      if (taken[start]) continue;
      if (!isHanCharacter(chars[start])) continue;
      let matched: { end: number; entries: DictEntry[] } | null = null;
      for (let len = Math.min(maxLen, chars.length - start); len >= 1; len--) {
        const slice = chars.slice(start, start + len).join('');
        const entries = this.exactByHeadword(slice);
        if (entries.length > 0) {
          matched = { end: start + len, entries };
          break;
        }
      }
      if (matched) {
        for (let i = start; i < matched.end; i++) taken[i] = true;
        spans.push({
          start,
          end: matched.end,
          text: chars.slice(start, matched.end).join(''),
          entries: matched.entries,
        });
        start = matched.end - 1;
      }
    }
    return spans;
  }

  /** Characters a learner has evidence about, used by the writing-practice picker. */
  sampleCharacters(count: number, filter?: (char: string) => boolean): string[] {
    const out: string[] = [];
    for (let i = 0; i < this.s.length && out.length < count * 12; i++) {
      for (const ch of this.s[i]) {
        if (!isHanCharacter(ch)) continue;
        if (filter && !filter(ch)) continue;
        if (!out.includes(ch)) out.push(ch);
      }
    }
    return out.slice(0, count);
  }
}

function viewAt(view: Uint32Array, position: number): number {
  return view[position];
}

function intersect(a: Set<number>, b: Set<number>): Set<number> {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  const out = new Set<number>();
  for (const value of small) if (large.has(value)) out.add(value);
  return out;
}

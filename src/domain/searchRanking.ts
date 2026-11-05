/** Dictionary search engine helpers: normalisation, scoring rubric and comparison.
 *  Deterministic in-memory index lives in searchIndex.ts. See docs/DATA_FORMAT.md. */

import { hasCjk, pinyinKey } from './pinyin';
import { US } from './types';
import type { DictEntry, SearchMode } from './types';

export const SCORE = {
  exactHans: 1000,
  exactHant: 970,
  exactPinyin: 900,
  prefixHans: 720,
  prefixHant: 700,
  prefixPinyin: 660,
  prefixInitials: 430,
  containsHans: 380,
  containsHant: 370,
  definitionPhrase: 340,
  definitionAll: 300,
  definitionAny: 140,
  fuzzyPinyin: 120,
} as const;

/** Shorter headwords rank above longer ones at equal score. */
export function lengthPenalty(charLen: number): number {
  return Math.min(60, (charLen - 1) * 6);
}

export interface Ranked {
  score: number;
  entry: { length: number; id: string };
}

/** Deterministic ordering: score desc, then headword length asc, then id asc. */
export function compareResults(a: Ranked, b: Ranked): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.entry.length !== b.entry.length) return a.entry.length - b.entry.length;
  return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
}

/** Levenshtein distance, bailing out past `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/** Zero-width and control characters that learners paste from PDFs and screenshots. */
const STRIP_CODEPOINTS = new Set<number>([
  0x0000, 0x000b, 0x000c, 0x001c, 0x001d, 0x001e, 0x001f, 0x007f, 0x200b, 0x200c, 0x200d, 0x2060,
  0xfeff,
]);

export function normaliseQuery(text: string): string {
  const cleaned: string[] = [];
  for (const ch of text.normalize('NFKC')) {
    const code = ch.codePointAt(0) ?? 0;
    if (STRIP_CODEPOINTS.has(code)) continue;
    cleaned.push(ch);
  }
  return cleaned
    .join('')
    .trim()
    .replace(/\s+/g, ' ');
}

export function detectMode(text: string): SearchMode {
  const q = normaliseQuery(text);
  if (!q) return 'auto';
  if (hasCjk(q)) return 'hans';
  return 'auto';
}

/** Stable, derived id: headword plus numbered reading. */
export function entryId(simplified: string, pinyinNumbered: string): string {
  return simplified + US + pinyinNumbered;
}

export function buildEntry(id: string, parts: string[]): DictEntry {
  const s = parts[0] ?? '';
  const t = parts[1] ?? '';
  const pn = parts[2] ?? '';
  const pm = parts[3] ?? '';
  const def = parts[5] ?? '';
  const defVi = parts[6] ? parts[6] : undefined;
  const defsVi = defVi ? defVi.split('; ').filter(Boolean) : undefined;
  const hanViet = parts[7] ? parts[7] : undefined;
  return {
    id,
    simplified: s,
    traditional: t,
    pinyinNumbered: pn,
    pinyinMarked: pm,
    pinyinPlain: pinyinKey(pn),
    definition: def,
    ...(defVi ? { definitionVi: defVi } : {}),
    ...(defsVi && defsVi.length > 0 ? { definitionsVi: defsVi } : {}),
    ...(hanViet ? { hanViet } : {}),
    length: [...s].length,
  };
}

/** `zhong3 guo2` -> `zg`, for abbreviation searches. */
export function initialsKey(numbered: string): string {
  return numbered
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/[^a-zü]/g, '').charAt(0))
    .join('');
}

/** Strip Vietnamese diacritics and fold đ/Đ -> d for accent-insensitive search. */
export function foldVietnamese(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .normalize('NFC');
}

const TOKEN_RE = /[\p{Script=Latin}\p{N}]+/gu;

export function tokeniseDefinition(text: string): string[] {
  const raw = text.toLowerCase().match(TOKEN_RE) ?? [];
  const out: string[] = [];
  for (const token of raw) {
    out.push(token);
    const folded = foldVietnamese(token);
    if (folded && folded !== token) {
      out.push(folded);
    }
  }
  return out;
}

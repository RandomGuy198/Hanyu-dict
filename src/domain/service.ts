/** DictionaryService: the only place that turns pack bytes into queryable facts.
 *  The UI and the worker both go through it, so a search behaves identically on either
 *  thread and can be tested without a browser. */

import { DictionaryIndex, type IndexStats } from '../domain/searchIndex';
import { US } from '../domain/types';
import type {
  DictEntry,
  ExampleSentence,
  SearchMode,
  SearchResult,
  StrokeData,
  TextSpan,
} from '../domain/types';
import { packText, readPackFile } from '../data/packs';

const STROKE_CACHE_SHARDS = 3;

export interface CharRecord {
  codepoint: number;
  char: string;
  mandarin: string[];
  cantonese: string;
  definition: string;
  radical: string;
  strokeCount: number | null;
  simplifiedOf: number[];
  traditionalOf: number[];
  hanViet?: string[];
}

export function parseCharacterLine(line: string): CharRecord | null {
  const parts = line.split(US);
  if (parts.length < 7) return null;
  const codepoint = Number.parseInt(parts[0], 16);
  if (!Number.isFinite(codepoint)) return null;
  const stroke = parts[6] ? Number.parseInt(parts[6], 10) : Number.NaN;
  const hanViet = (parts[9] || '').split(' ').filter(Boolean);
  return {
    codepoint,
    char: parts[1] ?? '',
    mandarin: (parts[2] || '').split(' ').filter(Boolean),
    cantonese: parts[3] || '',
    definition: parts[4] || '',
    radical: parts[5] || '',
    strokeCount: Number.isFinite(stroke) ? stroke : null,
    simplifiedOf: parseCodepointList(parts[7] || ''),
    traditionalOf: parseCodepointList(parts[8] || ''),
    hanViet: hanViet.length > 0 ? hanViet : undefined,
  };
}

function parseCodepointList(raw: string): number[] {
  return raw
    .split(' ')
    .map((token) => Number.parseInt(token, 16))
    .filter((value) => Number.isFinite(value))
    .slice(0, 8);
}

export interface ServiceProgress {
  phase: 'dictionary' | 'index' | 'characters';
  message: string;
  done: number;
  total: number;
}

export class DictionaryService {
  private index = new DictionaryIndex();
  private charLines: string[] | null = null;
  private charIndex: Map<number, CharRecord> | null = null;
  private strokeShards = new Map<string, Map<string, StrokeData>>();
  private strokeOrder: string[] = [];
  private strokePlacement: Map<string, string> | null = null;
  private exampleBuckets: Map<string, ExampleSentence[]> | null = null;
  private loadPromise: Promise<IndexStats> | null = null;

  constructor(private onProgress?: (progress: ServiceProgress) => void) {}

  get entries(): number {
    return this.index.size;
  }

  /** Idempotent: concurrent callers share one build. */
  ready(): Promise<IndexStats> {
    if (!this.loadPromise) {
      this.loadPromise = this.build();
    }
    return this.loadPromise;
  }

  private async build(): Promise<IndexStats> {
    const texts = await packText('dictionary-core');
    if (texts.length === 0) throw new Error('The dictionary pack is not installed.');
    this.onProgress?.({ phase: 'dictionary', message: 'Reading dictionary data', done: 0, total: texts.length });
    for (const [i, text] of texts.entries()) {
      this.index.addShard(text.split('\n'));
      this.onProgress?.({ phase: 'dictionary', message: 'Reading dictionary data', done: i + 1, total: texts.length });
    }
    this.onProgress?.({ phase: 'index', message: 'Building search index', done: 0, total: 1 });
    const stats = this.index.build();
    this.onProgress?.({ phase: 'index', message: 'Search index ready', done: 1, total: 1 });
    return stats;
  }

  /** Forget everything; used when a pack changes underneath a running session. */
  invalidate(): void {
    this.index.reset();
    this.loadPromise = null;
    this.charLines = null;
    this.charIndex = null;
    this.exampleBuckets = null;
    this.strokeShards.clear();
    this.strokeOrder = [];
  }

  search(query: { text: string; mode?: SearchMode; limit?: number }): {
    results: SearchResult[];
    coverage: { entries: number; partial: boolean };
  } {
    const results = this.index.search({ ...query, mode: query.mode ?? 'auto' });
    return {
      results,
      coverage: { entries: this.index.size, partial: this.index.size < 1000 },
    };
  }

  entryById(id: string): DictEntry | undefined {
    return this.index.byEntryId(id);
  }

  entriesForHeadword(headword: string): DictEntry[] {
    return this.index.exactByHeadword(headword);
  }

  lookupSpans(text: string, maxLen?: number): TextSpan[] {
    return this.index.lookupSpans(text, maxLen);
  }

  /** Characters this device has learning evidence for, for the practice picker. */
  sampleCharacters(count: number, filter?: (char: string) => boolean): string[] {
    return this.index.sampleCharacters(count, filter);
  }

  /* ------------------------------------------------------------ characters */

  private async ensureCharacterLines(): Promise<string[]> {
    if (this.charLines) return this.charLines;
    const texts = await packText('characters');
    // Every shard ends in a newline, so joining and splitting leaves one empty element per file.
    // They must go: the binary search below compares `parseInt` of a line prefix, and an empty line
    // parses to NaN - which fails both `<` and `>`, so the probe stops dead and a character that is
    // plainly in the pack reports as "not recorded".
    this.charLines = texts.length ? texts.join('\n').split('\n').filter((line) => line.length > 0) : [];
    return this.charLines;
  }

  /** Binary search over code-point-sorted character shards; no full map unless asked. */
  async character(char: string): Promise<CharRecord | null> {
    const lines = await this.ensureCharacterLines();
    if (lines.length === 0) return null;
    const target = char.codePointAt(0);
    if (target === undefined) return null;
    const keyOf = (line: string): number => Number.parseInt(line.slice(0, line.indexOf(US)), 16);
    let lo = 0;
    let hi = lines.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const value = keyOf(lines[mid]);
      if (value === target) return parseCharacterLine(lines[mid]);
      if (value < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }

  async characters(chars: string[]): Promise<(CharRecord | null)[]> {
    const lines = await this.ensureCharacterLines();
    if (lines.length === 0) return chars.map(() => null);
    if (!this.charIndex) {
      const map = new Map<number, CharRecord>();
      for (const line of lines) {
        const record = parseCharacterLine(line);
        if (record) map.set(record.codepoint, record);
      }
      this.charIndex = map;
    }
    return chars.map((char) => this.charIndex!.get(char.codePointAt(0) ?? -1) ?? null);
  }

  /** Code-point conversion for a whole run of text, using the Unihan mappings only. */
  async convert(text: string, direction: 'toSimplified' | 'toTraditional'): Promise<string> {
    const records = await this.characters([...text]);
    return records
      .map((record) => {
        if (!record) return null;
        const targets = direction === 'toSimplified' ? record.simplifiedOf : record.traditionalOf;
        if (targets.length !== 1) return null;
        return String.fromCodePoint(targets[0]);
      })
      .map((replacement, i) => replacement ?? text[i])
      .join('');
  }

  /* ------------------------------------------------------------ strokes */

  private async ensureStrokePlacement(): Promise<Map<string, string>> {
    if (this.strokePlacement) return this.strokePlacement;
    const placement = new Map<string, string>();
    const indexText = await readPackFile('packs/strokes/index.txt');
    for (const line of (indexText ?? '').split('\n')) {
      const [char, file] = line.split(US);
      if (char && file) placement.set(char, file);
    }
    this.strokePlacement = placement;
    return placement;
  }

  /** One stroke shard is loaded at a time and the last few stay cached. */
  async strokes(char: string): Promise<StrokeData | null> {
    const placement = await this.ensureStrokePlacement();
    const file = placement.get(char);
    if (!file) return null;
    const cached = this.strokeShards.get(file);
    if (cached) return cached.get(char) ?? null;
    const shardPath = `packs/strokes/${file}`;
    const shardText = await readPackFile(shardPath);
    if (shardText === null) return null;
    const map = new Map<string, StrokeData>();
    for (const line of shardText.split('\n')) {
      if (!line) continue;
      try {
        const raw = JSON.parse(line) as { c: string; s: string[]; m: number[][] };
        map.set(raw.c, { char: raw.c, strokes: raw.s ?? [], medians: raw.m ?? [] });
      } catch {
        // A malformed line must not break the whole shard.
      }
    }
    this.strokeShards.set(file, map);
    this.strokeOrder.push(file);
    while (this.strokeOrder.length > STROKE_CACHE_SHARDS) {
      const oldest = this.strokeOrder.shift();
      if (oldest) this.strokeShards.delete(oldest);
    }
    return map.get(char) ?? null;
  }

  async strokeShardCount(): Promise<number> {
    const placement = await this.ensureStrokePlacement();
    return new Set([...placement.values()]).size;
  }

  async characterDataInstalled(): Promise<boolean> {
    const lines = await this.ensureCharacterLines();
    return lines.length > 0;
  }

  hasStrokes(char: string): Promise<boolean> {
    return this.ensureStrokePlacement().then((placement) => placement.has(char));
  }

  /* ------------------------------------------------------------ examples */

  private async ensureExamples(): Promise<Map<string, ExampleSentence[]>> {
    if (this.exampleBuckets) return this.exampleBuckets;
    const texts = await packText('examples');
    const buckets = new Map<string, ExampleSentence[]>();
    for (const text of texts) {
      for (const line of text.split('\n')) {
        const parts = line.split(US);
        if (parts.length < 6) continue;
        const sentence: ExampleSentence = {
          headword: parts[0],
          simplified: parts[1],
          traditional: parts[2],
          pinyin: parts[3],
          english: parts[4],
          refs: (parts[5] || '').split('+').filter(Boolean),
        };
        const list = buckets.get(sentence.headword);
        if (list) list.push(sentence);
        else buckets.set(sentence.headword, [sentence]);
      }
    }
    this.exampleBuckets = buckets;
    return buckets;
  }

  async examples(headword: string, limit = 3): Promise<ExampleSentence[]> {
    const buckets = await this.ensureExamples();
    return (buckets.get(headword) ?? []).slice(0, limit);
  }

  async examplesInstalled(): Promise<boolean> {
    const buckets = await this.ensureExamples();
    return buckets.size > 0;
  }

  /** What this device can actually answer right now, for the coverage screen. */
  coverage(): { entries: number; charactersReady: boolean; strokesReady: boolean } {
    return {
      entries: this.index.size,
      charactersReady: this.charLines !== null && this.charLines.length > 0,
      strokesReady: this.strokePlacement !== null && this.strokePlacement.size > 0,
    };
  }

  async coverageSnapshot(): Promise<{ entries: number; characters: number; strokeShards: number; examples: number }> {
    const lines = await this.ensureCharacterLines();
    const placement = await this.ensureStrokePlacement();
    const buckets = await this.ensureExamples();
    return {
      entries: this.index.size,
      characters: lines.length,
      strokeShards: new Set([...placement.values()]).size,
      examples: buckets.size,
    };
  }
}

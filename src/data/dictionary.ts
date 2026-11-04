/** Client for the search worker, with an honest main-thread fallback for environments where
 *  module workers are unavailable. Callers see one interface either way. */

import { DictionaryService, type CharRecord, type ServiceProgress } from '../domain/service';
import type {
  DictEntry,
  ExampleSentence,
  SearchMode,
  SearchResult,
  StrokeData,
  TextSpan,
} from '../domain/types';
import type { IndexStats } from '../domain/searchIndex';

export interface LoadState {
  phase: 'idle' | 'installing' | 'loading' | 'indexing' | 'ready' | 'error';
  message: string;
  done: number;
  total: number;
  error?: string;
  /** True when the index is being served on the main thread instead of a worker. */
  inline?: boolean;
}

export interface SearchOutcome {
  results: SearchResult[];
  coverage: { entries: number; partial: boolean };
  tookMs: number;
}

export interface DictionaryApi {
  mode: 'worker' | 'inline';
  search(text: string, options?: { mode?: SearchMode; limit?: number }): Promise<SearchOutcome>;
  entry(id: string): Promise<DictEntry | undefined>;
  headword(text: string): Promise<DictEntry[]>;
  spans(text: string, maxLen?: number): Promise<TextSpan[]>;
  character(char: string): Promise<CharRecord | null>;
  characters(chars: string[]): Promise<(CharRecord | null)[]>;
  convert(text: string, direction: 'toSimplified' | 'toTraditional'): Promise<string>;
  strokes(char: string): Promise<StrokeData | null>;
  examples(headword: string, limit?: number): Promise<ExampleSentence[]>;
  sampleCharacters(count: number): Promise<string[]>;
}

type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void };

class WorkerChannel {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(worker: Worker) {
    this.worker = worker;
    this.worker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { id?: number; ok?: boolean; value?: unknown; error?: string; kind?: string; payload?: ServiceProgress };
      if (data.kind === 'progress') {
        this.onProgress?.(data.payload!);
        return;
      }
      if (!data.id) return;
      const entry = this.pending.get(data.id);
      if (!entry) return;
      this.pending.delete(data.id);
      if (data.ok) entry.resolve(data.value);
      else entry.reject(new Error(data.error ?? 'Worker request failed'));
    });
    this.worker.addEventListener('error', (event) => {
      const message = event.message || 'The search worker crashed.';
      for (const entry of this.pending.values()) entry.reject(new Error(message));
      this.pending.clear();
    });
  }

  onProgress?: (progress: ServiceProgress) => void;

  request<T>(kind: string, payload?: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ id, kind, payload });
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}

function inlineApi(service: DictionaryService): DictionaryApi {
  return {
    mode: 'inline',
    async search(text, options) {
      const started = Date.now();
      const outcome = service.search({ text, mode: options?.mode, limit: options?.limit });
      return { ...outcome, tookMs: Date.now() - started };
    },
    async entry(id) {
      await service.ready();
      return service.entryById(id);
    },
    async headword(text) {
      await service.ready();
      return service.entriesForHeadword(text);
    },
    async spans(text, maxLen) {
      await service.ready();
      return service.lookupSpans(text, maxLen);
    },
    async character(char) {
      return service.character(char);
    },
    async characters(chars) {
      return service.characters(chars);
    },
    async convert(text, direction) {
      return service.convert(text, direction);
    },
    async strokes(char) {
      return service.strokes(char);
    },
    async examples(headword, limit) {
      return service.examples(headword, limit);
    },
    async sampleCharacters(count) {
      await service.ready();
      return service.sampleCharacters(count);
    },
  };
}

/** Boot the index. `onState` reports progress so the UI can show an honest loading screen. */
export async function createDictionary(
  onState: (state: LoadState) => void,
): Promise<{ api: DictionaryApi; stats: IndexStats }> {
  const report = (state: LoadState) => onState(state);
  report({ phase: 'loading', message: 'Starting the search worker', done: 0, total: 1 });

  let channel: WorkerChannel | null = null;
  if (typeof Worker !== 'undefined') {
    try {
      const worker = new Worker(new URL('../workers/search.worker.ts', import.meta.url), {
        type: 'module',
      });
      channel = new WorkerChannel(worker);
      channel.onProgress = (progress: ServiceProgress) => {
        report({
          phase: progress.phase === 'index' ? 'indexing' : 'loading',
          message: progress.message,
          done: progress.done,
          total: progress.total,
        });
      };
      const stats = await channel.request<IndexStats>('init');
      report({ phase: 'ready', message: `${stats.entries} entries indexed`, done: 1, total: 1 });
      return { api: workerApi(channel), stats };
    } catch (error) {
      channel?.terminate();
      channel = null;
      report({
        phase: 'loading',
        message: 'Workers are unavailable; indexing on this thread instead',
        done: 0,
        total: 1,
        inline: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const service = new DictionaryService((progress) => {
    report({
      phase: progress.phase === 'index' ? 'indexing' : 'loading',
      message: progress.message,
      done: progress.done,
      total: progress.total,
      inline: true,
    });
  });
  const stats = await service.ready();
  report({ phase: 'ready', message: `${stats.entries} entries indexed`, done: 1, total: 1, inline: true });
  return { api: inlineApi(service), stats };
}

function workerApi(channel: WorkerChannel): DictionaryApi {
  return {
    mode: 'worker',
    async search(text, options) {
      const started = Date.now();
      const outcome = await channel.request<SearchOutcome>('search', {
        text,
        mode: options?.mode ?? 'auto',
        limit: options?.limit ?? 60,
      });
      return { ...outcome, tookMs: Date.now() - started };
    },
    entry: (id) => channel.request<DictEntry | undefined>('entry', { id }),
    headword: (text) => channel.request<DictEntry[]>('headword', { text }),
    spans: (text, maxLen) => channel.request<TextSpan[]>('spans', { text, maxLen }),
    character: (char) => channel.request<CharRecord | null>('character', { char }),
    characters: (chars) => channel.request<(CharRecord | null)[]>('characters', { chars }),
    convert: (text, direction) => channel.request<string>('convert', { text, direction }),
    strokes: (char) => channel.request<StrokeData | null>('strokes', { char }),
    examples: (headword, limit) =>
      channel.request<ExampleSentence[]>('examples', { headword, limit }),
    sampleCharacters: (count) => channel.request<string[]>('sampleCharacters', { count }),
  };
}

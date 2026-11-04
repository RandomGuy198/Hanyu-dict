/// <reference lib="webworker" />
/** Search/index worker. Heavy parsing, index building, stroke shards and reader lookups never
 *  touch the main thread. */

import { DictionaryService, type ServiceProgress } from '../domain/service';
import type { SearchMode } from '../domain/types';

interface Request {
  id: number;
  kind: string;
  payload?: Record<string, unknown>;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

const service = new DictionaryService((progress: ServiceProgress) => {
  ctx.postMessage({ kind: 'progress', payload: progress });
});

function str(payload: Record<string, unknown> | undefined, key: string): string {
  const value = payload?.[key];
  return typeof value === 'string' ? value : '';
}

function num(payload: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = payload?.[key];
  return typeof value === 'number' ? value : undefined;
}

async function dispatch(kind: string, payload: Record<string, unknown> | undefined): Promise<unknown> {
  switch (kind) {
    case 'init':
      return service.ready();
    case 'search':
      return service.search({
        text: str(payload, 'text'),
        mode: (str(payload, 'mode') || 'auto') as SearchMode,
        limit: num(payload, 'limit'),
      });
    case 'entry':
      return service.entryById(str(payload, 'id'));
    case 'headword':
      return service.entriesForHeadword(str(payload, 'text'));
    case 'spans':
      return service.lookupSpans(str(payload, 'text'), num(payload, 'maxLen'));
    case 'character':
      return service.character(str(payload, 'char'));
    case 'characters':
      return service.characters(Array.isArray(payload?.chars) ? (payload!.chars as string[]) : []);
    case 'convert':
      return service.convert(
        str(payload, 'text'),
        str(payload, 'direction') === 'toTraditional' ? 'toTraditional' : 'toSimplified',
      );
    case 'strokes':
      return service.strokes(str(payload, 'char'));
    case 'hasStrokes':
      return service.hasStrokes(str(payload, 'char'));
    case 'examples':
      return service.examples(str(payload, 'headword'), num(payload, 'limit'));
    case 'sampleCharacters':
      return service.sampleCharacters(num(payload, 'count') ?? 40);
    case 'coverageSnapshot':
      return service.coverageSnapshot();
    default:
      throw new Error(`Unknown worker request: ${kind}`);
  }
}

ctx.addEventListener('message', (event: MessageEvent<Request>) => {
  const { id, kind, payload } = event.data;
  if (!id || !kind) return;
  dispatch(kind, payload)
    .then((value) => {
      ctx.postMessage({ id, ok: true, value });
    })
    .catch((error: unknown) => {
      ctx.postMessage({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
});

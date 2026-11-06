/**
 * The pack registry: product-side metadata for every pack the pipeline can
 * emit. Legal metadata (license, attribution, source URL, upstream version,
 * modifications) lives in scripts/content/provenance.json and is joined in by
 * build-manifest.mjs / check-provenance.mjs.
 */

export const SHARD_SIZES = {
  'dictionary-core': 8192,
  characters: 2048,
  strokes: 400,
  examples: 8192,
};

/** coverageMode: how coverage.records is derived from a pack's files. */
export const PACK_DEFS = {
  'dictionary-core': {
    kind: 'dictionary',
    label: 'CC-CEDICT & CVDICT words',
    source: 'cc-cedict',
    required: true,
    languages: ['zh-Hans', 'zh-Hant', 'vi', 'en'],
    coverageMode: 'sum-shards',
    shardGlob: '*.txt',
  },
  characters: {
    kind: 'characters',
    label: 'Unihan character data',
    source: 'unicode-unihan',
    required: true,
    languages: ['zh-Hans', 'zh-Hant', 'vi'],
    coverageMode: 'sum-shards',
    shardGlob: '*.txt',
  },
  strokes: {
    kind: 'strokes',
    label: 'Stroke order graphics',
    source: 'hanzi-writer-data',
    required: true,
    languages: ['zh-Hans', 'zh-Hant'],
    coverageMode: 'sum-jsonl', // index.txt mirrors the shards and must not be counted twice
    shardGlob: '*.jsonl',
  },
  examples: {
    kind: 'examples',
    label: 'Example sentences',
    source: 'tatoeba',
    required: true,
    languages: ['zh-Hans', 'zh-Hant', 'en'],
    coverageMode: 'sum-shards',
    shardGlob: '*.txt',
  },
  'content-tips': {
    kind: 'content',
    label: 'Study tips',
    source: 'original',
    required: true,
    languages: ['en', 'zh-Hans'],
    coverageMode: 'item-files',
    shardGlob: '*.json',
  },
  'content-lessons': {
    kind: 'content',
    label: 'Lessons',
    source: 'original',
    required: true,
    languages: ['en', 'zh-Hans'],
    coverageMode: 'item-files',
    shardGlob: '*.json',
  },
  'content-stories': {
    kind: 'content',
    label: 'Short stories',
    source: 'original',
    required: true,
    languages: ['en', 'zh-Hans'],
    coverageMode: 'item-files',
    shardGlob: '*.json',
  },
  'content-articles': {
    kind: 'content',
    label: 'Reference articles',
    source: 'original',
    required: true,
    languages: ['en', 'zh-Hans'],
    coverageMode: 'item-files',
    shardGlob: '*.json',
  },
};

export const PACK_ORDER = [
  'dictionary-core',
  'characters',
  'strokes',
  'examples',
  'content-tips',
  'content-lessons',
  'content-stories',
  'content-articles',
];

export function packDef(packId) {
  const def = PACK_DEFS[packId];
  if (!def) throw new Error(`Unknown pack id: ${packId}`);
  return def;
}

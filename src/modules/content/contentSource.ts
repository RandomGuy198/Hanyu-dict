/** Reading content is read from installed content packs and nowhere else.
 *
 *  Every item is one JSON file inside a pack (docs/DATA_FORMAT.md), so the text on screen is
 *  always exactly what shipped in a pack that passed its sha256 check — nothing is invented,
 *  cached from a network read, or filled in when a pack is missing. Each file is re-validated
 *  with `contentItemSchema` before it reaches the UI. */

import { useCallback, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, setMeta } from '../../data/db';
import { cachedManifest, loadManifest, packText } from '../../data/packs';
import { contentItemSchema, formatIssues } from '../../data/schema';
import type { ContentItem, PackDescriptor, PackInstallState } from '../../domain/types';

export type ContentKind = ContentItem['kind'];
export type ContentLevel = ContentItem['level'];

export const CONTENT_KINDS: ContentKind[] = ['tip', 'lesson', 'story', 'article'];
export const CONTENT_LEVELS: ContentLevel[] = ['beginner', 'elementary', 'intermediate'];

/** Read markers live in the `meta` table: `learn-read:<itemId>` -> ISO timestamp. */
export const READ_KEY_PREFIX = 'learn-read:';

export interface ContentPackStatus {
  id: string;
  label: string;
  version: string;
  license: string;
  bytes: number;
  descriptor: PackDescriptor;
  installed: boolean;
  state?: PackInstallState;
}

export interface ContentCatalog {
  packs: ContentPackStatus[];
  items: ContentItem[];
  /** Files that are present but unusable, with the reason shown to the user. */
  problems: string[];
  /** Set when the pack registry could not be read at all. */
  registryError?: string;
}

export interface ItemStats {
  blocks: number;
  zhLines: number;
  listItems: number;
  notes: number;
  speakers: number;
}

export function sortItems(items: ContentItem[]): ContentItem[] {
  const kindRank = (kind: ContentKind) => CONTENT_KINDS.indexOf(kind);
  const levelRank = (level: ContentLevel) => CONTENT_LEVELS.indexOf(level);
  return [...items].sort((a, b) => {
    const byLevel = levelRank(a.level) - levelRank(b.level);
    if (byLevel !== 0) return byLevel;
    const byKind = kindRank(a.kind) - kindRank(b.kind);
    if (byKind !== 0) return byKind;
    return a.title.localeCompare(b.title);
  });
}

/** Every string in the item that can contain Hanzi, in reading order. Used for lookup scans. */
export function chineseTexts(item: ContentItem): string[] {
  const out: string[] = [];
  for (const block of item.blocks) {
    if (block.type === 'text' || block.type === 'note') out.push(block.body);
    else if (block.type === 'list') out.push(...block.body);
    else out.push(...block.body.map((line) => line.zh));
  }
  return out.filter((text) => text.trim().length > 0);
}

export function itemStats(item: ContentItem): ItemStats {
  let zhLines = 0;
  let listItems = 0;
  let notes = 0;
  const speakers = new Set<string>();
  for (const block of item.blocks) {
    if (block.type === 'dialogue') {
      zhLines += block.body.length;
      for (const line of block.body) speakers.add(line.speaker);
    } else if (block.type === 'list') listItems += block.body.length;
    else if (block.type === 'note') notes += 1;
  }
  return { blocks: item.blocks.length, zhLines, listItems, notes, speakers: speakers.size };
}

async function contentPacks(): Promise<{ packs: ContentPackStatus[]; registryError?: string }> {
  let registryError: string | undefined;
  let packs: PackDescriptor[] = [];
  try {
    const manifest = (await cachedManifest()) ?? (await loadManifest());
    packs = manifest.packs.filter((pack) => pack.kind === 'content');
  } catch (error) {
    registryError = error instanceof Error ? error.message : String(error);
  }
  const states = await db.packs.toArray();
  return {
    packs: packs.map((pack) => {
      const state = states.find((entry) => entry.id === pack.id);
      return {
        id: pack.id,
        label: pack.label,
        version: pack.version,
        license: pack.license,
        bytes: pack.bytes,
        descriptor: pack,
        installed: state?.status === 'ready' && state.version === pack.version,
        state,
      };
    }),
    registryError,
  };
}

/** Parse one packed file with the published content schema; null means "do not show it". */
function parseItem(text: string, packId: string, problems: string[]): ContentItem | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    problems.push(`${packId}: a packed file is not valid JSON.`);
    return null;
  }
  const parsed = contentItemSchema.safeParse(raw);
  if (!parsed.success) {
    problems.push(`${packId}: ${formatIssues(parsed.error)}`);
    return null;
  }
  return parsed.data;
}

export async function loadContentCatalog(): Promise<ContentCatalog> {
  const { packs, registryError } = await contentPacks();
  const items: ContentItem[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    const texts = await packText(pack.id);
    if (texts.length === 0) {
      problems.push(`${pack.id} holds no files on this device.`);
      continue;
    }
    pack.installed = true;
    for (const text of texts) {
      const item = parseItem(text, pack.id, problems);
      if (!item) continue;
      if (seen.has(item.id)) {
        problems.push(`${pack.id}: duplicate item id "${item.id}" was ignored.`);
        continue;
      }
      seen.add(item.id);
      items.push(item);
    }
  }
  return { packs, items: sortItems(items), problems: [...new Set(problems)], registryError };
}

export interface ContentItemResult {
  item?: ContentItem;
  packs: ContentPackStatus[];
  problems: string[];
  registryError?: string;
}

/** Single item lookup: stops as soon as the id is found instead of parsing every file. */
export async function loadContentItem(id: string): Promise<ContentItemResult> {
  const { packs, registryError } = await contentPacks();
  const problems: string[] = [];
  for (const pack of packs) {
    const texts = await packText(pack.id);
    if (texts.length > 0) pack.installed = true;
    for (const text of texts) {
      const item = parseItem(text, pack.id, problems);
      if (item && item.id === id) return { item, packs, problems, registryError };
    }
  }
  return { packs, problems: [...new Set(problems)], registryError };
}

export interface ReadMarks {
  /** itemId -> when it was first marked read. */
  marks: Map<string, string>;
  loaded: boolean;
  toggle: (itemId: string, read: boolean) => Promise<void>;
}

/** Read/unread markers, persisted device-side in IndexedDB `meta`. */
export function useReadMarks(): ReadMarks {
  const rows = useLiveQuery(() => db.meta.where('key').startsWith(READ_KEY_PREFIX).toArray(), []);
  const marks = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows ?? []) {
      const id = row.key.slice(READ_KEY_PREFIX.length);
      map.set(id, typeof row.value === 'string' ? row.value : '');
    }
    return map;
  }, [rows]);

  const toggle = useCallback(async (itemId: string, read: boolean) => {
    const key = READ_KEY_PREFIX + itemId;
    if (read) await setMeta(key, new Date().toISOString());
    else await db.meta.delete(key);
  }, []);

  return { marks, loaded: rows !== undefined, toggle };
}

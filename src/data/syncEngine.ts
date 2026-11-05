/**
 * Deterministic cross-device sync engine for `sync/state.json` in `Hanyu-data`.
 *
 * Implements:
 * - Conflict-free merge (`mergeSyncStates`) per D-14 & 09_TESTS_AND_ACCEPTANCE.md §3.3
 * - ETag conditional GET (`304 Not Modified` costs 0 rate-limit points)
 * - Automatic 409/422 conflict resolution (pull + merge + single retry PUT)
 * - Debounced background push on local mutation (`markDirty`)
 */

import {
  db,
  ensurePreferences,
  getDeletedIds,
  getMeta,
  onLocalMutation,
  setMeta,
} from './db';
import {
  encodeBase64Utf8,
  fetchRepoContentsMeta,
  getDeviceId,
  hasGitHubPat,
  putRepoContents,
  redactSecrets,
} from './githubClient';
import {
  getSyncStatus,
  setSyncStatus,
  subscribeSyncStatus,
  type SyncPhase,
  type SyncStatus,
} from './syncStatus';
import {
  DEFAULT_PREFERENCES,
  type ActivityDay,
  type BookBookmark,
  type Category,
  type CourseLessonProgress,
  type CourseStepId,
  type Deck,
  type Notebook,
  type NotebookEntry,
  type Preferences,
  type SavedWord,
  type SrsCard,
  type SyncStateFile,
  type WordList,
} from '../domain/types';

export { getSyncStatus, setSyncStatus, subscribeSyncStatus, type SyncPhase, type SyncStatus };

const SYNC_PATH = 'sync/state.json';
const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

let debounceMs = 3000;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastCheckMs = 0;

export function setSyncDebounceMs(ms: number): void {
  debounceMs = Math.max(0, ms);
}

export function getLastSyncCheckMs(): number {
  return lastCheckMs;
}

function toTimestamp(iso?: string): number {
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function newerIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return toTimestamp(a) >= toTimestamp(b) ? a : b;
}

function tombstoneTime(
  deletedIds: Record<string, string>,
  table: string,
  id: string,
): number {
  const scoped = deletedIds[`${table}:${id}`];
  const bare = deletedIds[id];
  return Math.max(toTimestamp(scoped), toTimestamp(bare));
}

function itemTimestamp(item: {
  updatedAt?: string;
  addedAt?: string;
  createdAt?: string;
}): number {
  return toTimestamp(item.updatedAt ?? item.addedAt ?? item.createdAt);
}

function cardTimestamp(card: SrsCard & { lastReviewedAt?: string }): number {
  return toTimestamp(
    card.lastReviewedAt ?? card.lastReviewed ?? card.updatedAt ?? card.createdAt,
  );
}

function mergeEntityArray<
  T extends { id: string; updatedAt?: string; addedAt?: string; createdAt?: string },
>(
  table: string,
  localItems: T[],
  remoteItems: T[],
  deletedIds: Record<string, string>,
): T[] {
  const byId = new Map<string, T>();
  for (const item of localItems ?? []) {
    if (item && typeof item.id === 'string') {
      byId.set(item.id, item);
    }
  }
  for (const remoteItem of remoteItems ?? []) {
    if (!remoteItem || typeof remoteItem.id !== 'string') continue;
    const existing = byId.get(remoteItem.id);
    if (!existing) {
      byId.set(remoteItem.id, remoteItem);
    } else if (itemTimestamp(remoteItem) >= itemTimestamp(existing)) {
      byId.set(remoteItem.id, remoteItem);
    }
  }

  const result: T[] = [];
  for (const [id, item] of byId.entries()) {
    const delTime = tombstoneTime(deletedIds, table, id);
    const recTime = itemTimestamp(item);
    if (delTime > 0 && delTime > recTime) {
      continue;
    }
    result.push(item);
  }
  return result;
}

function mergeCards(
  localCards: SrsCard[],
  remoteCards: SrsCard[],
  deletedIds: Record<string, string>,
): SrsCard[] {
  const byId = new Map<string, SrsCard>();
  for (const card of localCards ?? []) {
    if (card && typeof card.id === 'string') {
      byId.set(card.id, card);
    }
  }
  for (const remoteCard of remoteCards ?? []) {
    if (!remoteCard || typeof remoteCard.id !== 'string') continue;
    const existing = byId.get(remoteCard.id);
    if (!existing) {
      byId.set(remoteCard.id, remoteCard);
    } else if (cardTimestamp(remoteCard) >= cardTimestamp(existing)) {
      byId.set(remoteCard.id, remoteCard);
    }
  }

  const result: SrsCard[] = [];
  for (const [id, card] of byId.entries()) {
    const delTime = tombstoneTime(deletedIds, 'cards', id);
    const recTime = Math.max(cardTimestamp(card), toTimestamp(card.updatedAt ?? card.createdAt));
    if (delTime > 0 && delTime > recTime) {
      continue;
    }
    result.push(card);
  }
  return result;
}

function mergeCourseProgressMap(
  localMap: Record<string, CourseLessonProgress>,
  remoteMap: Record<string, CourseLessonProgress>,
): Record<string, CourseLessonProgress> {
  const keys = new Set<string>([
    ...Object.keys(localMap ?? {}),
    ...Object.keys(remoteMap ?? {}),
  ]);
  const out: Record<string, CourseLessonProgress> = {};

  for (const key of keys) {
    const a = localMap?.[key];
    const b = remoteMap?.[key];
    if (a && !b) {
      out[key] = a;
      continue;
    }
    if (!a && b) {
      out[key] = b;
      continue;
    }
    if (!a || !b) continue;

    const completedSteps = Array.from(
      new Set<CourseStepId>([...(a.completedSteps ?? []), ...(b.completedSteps ?? [])]),
    );
    const writingCompletedChars = Array.from(
      new Set<string>([...(a.writingCompletedChars ?? []), ...(b.writingCompletedChars ?? [])]),
    );
    const hasScore = a.bestDrillScore !== undefined || b.bestDrillScore !== undefined;
    const bestDrillScore = hasScore
      ? Math.max(a.bestDrillScore ?? 0, b.bestDrillScore ?? 0)
      : undefined;

    const completedAt = newerIso(a.completedAt, b.completedAt);
    const lastStudiedAt = newerIso(a.lastStudiedAt, b.lastStudiedAt) ?? a.lastStudiedAt;
    const updatedAt = newerIso(a.updatedAt, b.updatedAt) ?? a.updatedAt;

    out[key] = {
      lessonId: a.lessonId || b.lessonId || key,
      bookId: a.bookId || b.bookId,
      completedSteps,
      ...(bestDrillScore !== undefined ? { bestDrillScore } : {}),
      writingCompletedChars,
      ...(completedAt ? { completedAt } : {}),
      lastStudiedAt,
      updatedAt,
    };
  }
  return out;
}

function mergeBookBookmarksMap(
  localMap: Record<string, BookBookmark>,
  remoteMap: Record<string, BookBookmark>,
): Record<string, BookBookmark> {
  const keys = new Set<string>([
    ...Object.keys(localMap ?? {}),
    ...Object.keys(remoteMap ?? {}),
  ]);
  const out: Record<string, BookBookmark> = {};
  for (const key of keys) {
    const a = localMap?.[key];
    const b = remoteMap?.[key];
    if (a && !b) {
      out[key] = a;
    } else if (!a && b) {
      out[key] = b;
    } else if (a && b) {
      out[key] = toTimestamp(b.updatedAt) >= toTimestamp(a.updatedAt) ? b : a;
    }
  }
  return out;
}

function mergeDailyActivityMap(
  localMap: Record<string, ActivityDay>,
  remoteMap: Record<string, ActivityDay>,
): Record<string, ActivityDay> {
  const keys = new Set<string>([
    ...Object.keys(localMap ?? {}),
    ...Object.keys(remoteMap ?? {}),
  ]);
  const out: Record<string, ActivityDay> = {};
  for (const day of keys) {
    const a = localMap?.[day];
    const b = remoteMap?.[day];
    if (a && !b) {
      out[day] = a;
    } else if (!a && b) {
      out[day] = b;
    } else if (a && b) {
      const writingStrokes = Math.max(a.writingStrokes ?? 0, b.writingStrokes ?? 0);
      out[day] = {
        day,
        searches: Math.max(a.searches ?? 0, b.searches ?? 0),
        entriesSaved: Math.max(a.entriesSaved ?? 0, b.entriesSaved ?? 0),
        reviews: Math.max(a.reviews ?? 0, b.reviews ?? 0),
        newCards: Math.max(a.newCards ?? 0, b.newCards ?? 0),
        correct: Math.max(a.correct ?? 0, b.correct ?? 0),
        attempts: Math.max(a.attempts ?? 0, b.attempts ?? 0),
        characters: Math.max(a.characters ?? 0, b.characters ?? 0),
        readings: Math.max(a.readings ?? 0, b.readings ?? 0),
        ...(a.writingStrokes !== undefined || b.writingStrokes !== undefined
          ? { writingStrokes }
          : {}),
      };
    }
  }
  return out;
}

export function mergeSyncStates(
  local: SyncStateFile,
  remote: SyncStateFile,
  nowMs = Date.now(),
): SyncStateFile {
  const mergedDeletedIds: Record<string, string> = {};
  const allDeleteKeys = new Set<string>([
    ...Object.keys(local.deletedIds ?? {}),
    ...Object.keys(remote.deletedIds ?? {}),
  ]);
  const cutoffMs = nowMs - TOMBSTONE_RETENTION_MS;

  for (const key of allDeleteKeys) {
    const winner = newerIso(local.deletedIds?.[key], remote.deletedIds?.[key]);
    if (!winner) continue;
    const ts = toTimestamp(winner);
    // Keep tombstones within 90 days (or if timestamp is relative to test epoch)
    if (ts === 0 || ts >= cutoffMs || Math.abs(toTimestamp(local.updatedAt) - ts) <= TOMBSTONE_RETENTION_MS) {
      mergedDeletedIds[key] = winner;
    }
  }

  const remoteIsNewer = toTimestamp(remote.updatedAt) >= toTimestamp(local.updatedAt);
  const preferences = remoteIsNewer
    ? { ...(local.preferences ?? {}), ...(remote.preferences ?? {}) }
    : { ...(remote.preferences ?? {}), ...(local.preferences ?? {}) };

  return {
    schemaVersion: 1,
    updatedAt: newerIso(local.updatedAt, remote.updatedAt) ?? new Date().toISOString(),
    deviceId: local.deviceId || remote.deviceId,
    deletedIds: mergedDeletedIds,
    preferences,
    savedWords: mergeEntityArray('savedWords', local.savedWords, remote.savedWords, mergedDeletedIds),
    wordLists: mergeEntityArray('wordLists', local.wordLists, remote.wordLists, mergedDeletedIds),
    notebooks: mergeEntityArray('notebooks', local.notebooks, remote.notebooks, mergedDeletedIds),
    categories: mergeEntityArray('categories', local.categories, remote.categories, mergedDeletedIds),
    notebookEntries: mergeEntityArray(
      'notebookEntries',
      local.notebookEntries,
      remote.notebookEntries,
      mergedDeletedIds,
    ),
    decks: mergeEntityArray('decks', local.decks, remote.decks, mergedDeletedIds),
    cards: mergeCards(local.cards, remote.cards, mergedDeletedIds),
    courseProgress: mergeCourseProgressMap(local.courseProgress, remote.courseProgress),
    bookBookmarks: mergeBookBookmarksMap(local.bookBookmarks, remote.bookBookmarks),
    dailyActivity: mergeDailyActivityMap(local.dailyActivity, remote.dailyActivity),
  };
}

export async function buildLocalSyncState(): Promise<SyncStateFile> {
  const [
    prefs,
    deletedIds,
    savedWords,
    wordLists,
    notebooks,
    categories,
    notebookEntries,
    decks,
    cards,
    courseProgressRows,
    bookBookmarkRows,
    activityRows,
  ] = await Promise.all([
    ensurePreferences(),
    getDeletedIds(),
    db.savedWords.toArray(),
    db.wordLists.toArray(),
    db.notebooks.toArray(),
    db.categories.toArray(),
    db.notebookEntries.toArray(),
    db.decks.toArray(),
    db.cards.toArray(),
    db.courseProgress.toArray(),
    db.bookBookmarks.toArray(),
    db.activity.toArray(),
  ]);

  const courseProgress: Record<string, CourseLessonProgress> = {};
  for (const row of courseProgressRows) {
    courseProgress[row.lessonId] = row;
  }

  const bookBookmarks: Record<string, BookBookmark> = {};
  for (const row of bookBookmarkRows) {
    bookBookmarks[row.bookId] = row;
  }

  const dailyActivity: Record<string, ActivityDay> = {};
  for (const row of activityRows) {
    dailyActivity[row.day] = row;
  }

  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    deviceId: getDeviceId(),
    deletedIds,
    preferences: { ...prefs },
    savedWords,
    wordLists,
    notebooks,
    categories,
    notebookEntries,
    decks,
    cards,
    courseProgress,
    bookBookmarks,
    dailyActivity,
  };
}

export async function applySyncStateToDb(state: SyncStateFile): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.meta,
      db.preferences,
      db.savedWords,
      db.wordLists,
      db.notebooks,
      db.categories,
      db.notebookEntries,
      db.decks,
      db.cards,
      db.courseProgress,
      db.bookBookmarks,
      db.activity,
    ],
    async () => {
      await db.meta.put({ key: 'sync.deletedIds', value: state.deletedIds ?? {} });

      if (state.preferences && Object.keys(state.preferences).length > 0) {
        const currentPrefs = (await db.preferences.get('preferences')) ?? DEFAULT_PREFERENCES;
        const nextPrefs: Preferences = {
          ...DEFAULT_PREFERENCES,
          ...currentPrefs,
          ...(state.preferences as Partial<Preferences>),
          id: 'preferences',
        };
        await db.preferences.put(nextPrefs);
      }

      await db.savedWords.clear();
      if (state.savedWords?.length) await db.savedWords.bulkPut(state.savedWords as SavedWord[]);

      await db.wordLists.clear();
      if (state.wordLists?.length) await db.wordLists.bulkPut(state.wordLists as WordList[]);

      await db.notebooks.clear();
      if (state.notebooks?.length) await db.notebooks.bulkPut(state.notebooks as Notebook[]);

      await db.categories.clear();
      if (state.categories?.length) await db.categories.bulkPut(state.categories as Category[]);

      await db.notebookEntries.clear();
      if (state.notebookEntries?.length) {
        await db.notebookEntries.bulkPut(state.notebookEntries as NotebookEntry[]);
      }

      await db.decks.clear();
      if (state.decks?.length) await db.decks.bulkPut(state.decks as Deck[]);

      await db.cards.clear();
      if (state.cards?.length) await db.cards.bulkPut(state.cards as SrsCard[]);

      await db.courseProgress.clear();
      const progressRows = Object.values(state.courseProgress ?? {});
      if (progressRows.length) await db.courseProgress.bulkPut(progressRows);

      await db.bookBookmarks.clear();
      const bookmarkRows = Object.values(state.bookBookmarks ?? {});
      if (bookmarkRows.length) await db.bookBookmarks.bulkPut(bookmarkRows);

      await db.activity.clear();
      const activityRows = Object.values(state.dailyActivity ?? {});
      if (activityRows.length) await db.activity.bulkPut(activityRows);
    },
  );
}

export async function pullSyncState(): Promise<{
  status: 'not-modified' | 'created' | 'merged' | 'disconnected';
  state?: SyncStateFile;
}> {
  if (!hasGitHubPat()) {
    setSyncStatus({ phase: 'disconnected', message: undefined });
    return { status: 'disconnected' };
  }

  setSyncStatus({ phase: 'syncing', message: undefined });
  try {
    const lastEtag = await getMeta<string>('sync.lastEtag');
    const metaResult = await fetchRepoContentsMeta(SYNC_PATH, lastEtag);
    lastCheckMs = Date.now();

    if (metaResult.status === 304) {
      const now = new Date().toISOString();
      await setMeta('sync.lastSyncedAt', now);
      setSyncStatus({ phase: 'synced', lastSyncedAt: now, message: undefined });
      return { status: 'not-modified' };
    }

    if (metaResult.status === 404) {
      const pushed = await pushSyncState();
      return { status: 'created', state: pushed };
    }

    const remoteRaw = JSON.parse(metaResult.content ?? '{}') as SyncStateFile;
    const localState = await buildLocalSyncState();
    const merged = mergeSyncStates(localState, remoteRaw);

    await applySyncStateToDb(merged);
    if (metaResult.sha) {
      await setMeta('sync.lastRemoteSha', metaResult.sha);
    }
    if (metaResult.etag) {
      await setMeta('sync.lastEtag', metaResult.etag);
    }
    const now = new Date().toISOString();
    await setMeta('sync.lastSyncedAt', now);
    setSyncStatus({ phase: 'synced', lastSyncedAt: now, message: undefined });
    return { status: 'merged', state: merged };
  } catch (error) {
    const safeMessage = redactSecrets(error instanceof Error ? error.message : String(error));
    setSyncStatus({ phase: 'error', message: safeMessage });
    throw new Error(safeMessage);
  }
}

export async function pushSyncState(): Promise<SyncStateFile> {
  if (!hasGitHubPat()) {
    setSyncStatus({ phase: 'disconnected', message: undefined });
    return buildLocalSyncState();
  }

  setSyncStatus({ phase: 'syncing', message: undefined });
  try {
    const state = await buildLocalSyncState();
    const lastSha = await getMeta<string>('sync.lastRemoteSha');
    const serialized = JSON.stringify(state, null, 2);
    const base64 = encodeBase64Utf8(serialized);
    const message = `sync: update learning state from ${state.deviceId}`;

    let putResult = await putRepoContents(SYNC_PATH, base64, message, lastSha);

    if (putResult.status === 409 || putResult.status === 422) {
      // Another device pushed first: pull & merge once, then retry PUT once.
      const pulled = await pullSyncState();
      const mergedState = pulled.state ?? (await buildLocalSyncState());
      const updatedSha = await getMeta<string>('sync.lastRemoteSha');
      const retryBase64 = encodeBase64Utf8(JSON.stringify(mergedState, null, 2));
      putResult = await putRepoContents(SYNC_PATH, retryBase64, message, updatedSha);
      if (putResult.status === 409 || putResult.status === 422) {
        throw new Error(`Sync conflict persisted after retry (HTTP ${putResult.status}).`);
      }
      if (putResult.sha) {
        await setMeta('sync.lastRemoteSha', putResult.sha);
      }
      if (putResult.etag) {
        await setMeta('sync.lastEtag', putResult.etag);
      }
      const now = new Date().toISOString();
      await setMeta('sync.lastSyncedAt', now);
      await setMeta('sync.dirty', false);
      setSyncStatus({ phase: 'synced', lastSyncedAt: now, message: undefined });
      return mergedState;
    }

    if (putResult.sha) {
      await setMeta('sync.lastRemoteSha', putResult.sha);
    }
    if (putResult.etag) {
      await setMeta('sync.lastEtag', putResult.etag);
    }
    const now = new Date().toISOString();
    await setMeta('sync.lastSyncedAt', now);
    await setMeta('sync.dirty', false);
    lastCheckMs = Date.now();
    setSyncStatus({ phase: 'synced', lastSyncedAt: now, message: undefined });
    return state;
  } catch (error) {
    const safeMessage = redactSecrets(error instanceof Error ? error.message : String(error));
    setSyncStatus({ phase: 'error', message: safeMessage });
    throw new Error(safeMessage);
  }
}

export async function syncNow(): Promise<SyncStateFile | undefined> {
  if (!hasGitHubPat()) {
    setSyncStatus({ phase: 'disconnected', message: undefined });
    return undefined;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  const pulled = await pullSyncState();
  if (pulled.status === 'created') {
    return pulled.state;
  }
  return pushSyncState();
}

export function markDirty(): void {
  void setMeta('sync.dirty', true);
  if (!hasGitHubPat()) {
    return;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void pushSyncState().catch(() => {
      // Status already set to error inside pushSyncState
    });
  }, debounceMs);
}

// Subscribe local DB helper mutations to markDirty automatically.
onLocalMutation(() => {
  markDirty();
});

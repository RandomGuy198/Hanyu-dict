/** IndexedDB layer. User data and replaceable dictionary packs live in separate stores so a
 *  content upgrade can never erase learning progress, and a data reset never deletes packs
 *  the user still needs. */

import Dexie, { type Table } from 'dexie';
import type {
  ActivityDay,
  Achievement,
  Category,
  Deck,
  DictEntry,
  ImportedDocument,
  Notebook,
  NotebookEntry,
  PackInstallState,
  PhotoWord,
  PracticeAttempt,
  PracticeSession,
  Preferences,
  SavedWord,
  SrsCard,
  WordList,
} from '../domain/types';
import { DEFAULT_PREFERENCES } from '../domain/types';

export interface SearchHistoryRow {
  id?: number;
  text: string;
  mode: string;
  at: string;
}

export interface PackFileRow {
  /** path relative to public/data, e.g. packs/dictionary-core/000.txt */
  path: string;
  packId: string;
  sha256: string;
  bytes: number;
  text: string;
}

export interface DocumentBlobRow {
  id: string;
  blob: Blob;
}

export interface PhotoImageRow {
  id: string;
  blob: Blob;
}

export class HanyuDatabase extends Dexie {
  meta!: Table<{ key: string; value: unknown }, string>;
  preferences!: Table<Preferences, string>;
  searchHistory!: Table<SearchHistoryRow, number>;
  savedWords!: Table<SavedWord, string>;
  wordLists!: Table<WordList, string>;
  notebooks!: Table<Notebook, string>;
  categories!: Table<Category, string>;
  notebookEntries!: Table<NotebookEntry, string>;
  decks!: Table<Deck, string>;
  cards!: Table<SrsCard, string>;
  attempts!: Table<PracticeAttempt, number>;
  sessions!: Table<PracticeSession, string>;
  activity!: Table<ActivityDay, string>;
  achievements!: Table<Achievement, string>;
  packs!: Table<PackInstallState, string>;
  packFiles!: Table<PackFileRow, string>;
  documents!: Table<ImportedDocument, string>;
  documentBlobs!: Table<DocumentBlobRow, string>;
  photos!: Table<PhotoWord, string>;
  photoImages!: Table<PhotoImageRow, string>;

  constructor(name = 'hanyu-web') {
    super(name);
    this.version(1).stores({
      meta: 'key',
      preferences: 'id',
      searchHistory: '++id, text, at',
      savedWords: 'id, addedAt, *lists',
      wordLists: 'id, updatedAt',
      notebooks: 'id, categoryId, updatedAt',
      categories: 'id, parentId',
      notebookEntries: 'id, notebookId, updatedAt, *entryIds',
      decks: 'id, updatedAt',
      cards: 'id, deckId, due, repetitions',
      attempts: '++id, sessionId, entryId, kind, at',
      sessions: 'id, kind, startedAt',
      activity: 'day',
      achievements: 'id, unlockedAt',
      packs: 'id, kind, status',
      packFiles: 'path, packId, sha256',
      documents: 'id, addedAt, kind',
      documentBlobs: 'id',
      photos: 'id, createdAt',
      photoImages: 'id',
    });
    // v2 adds the name indexes the entry and library screens sort by. IndexedDB cannot order by an
    // unindexed property - `orderBy('name')` rejects with "KeyPath name ... is not indexed" - so
    // without these two indexes the entry screen died on open for every user who had lists.
    this.version(2).stores({
      wordLists: 'id, updatedAt, name',
      categories: 'id, parentId, name',
    });
  }
}

/** Single shared instance for the app; tests construct their own named database. */
export const db = new HanyuDatabase();

export const SCHEMA_VERSION = 2;

export async function ensurePreferences(): Promise<Preferences> {
  const existing = await db.preferences.get('preferences');
  if (existing) {
    // New fields from an upgrade get their defaults instead of undefined.
    const merged: Preferences = { ...DEFAULT_PREFERENCES, ...existing };
    if (JSON.stringify(merged) !== JSON.stringify(existing)) {
      await db.preferences.put(merged);
    }
    return merged;
  }
  await db.preferences.add(DEFAULT_PREFERENCES);
  return DEFAULT_PREFERENCES;
}

export async function savePreferences(next: Preferences): Promise<void> {
  await db.preferences.put(next);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row ? (row.value as T) : undefined;
}

export async function bumpActivity(
  day: string,
  patch: Partial<Omit<ActivityDay, 'day'>>,
): Promise<ActivityDay> {
  return db.transaction('rw', db.activity, async () => {
    const current =
      (await db.activity.get(day)) ??
      ({
        day,
        searches: 0,
        entriesSaved: 0,
        reviews: 0,
        newCards: 0,
        correct: 0,
        attempts: 0,
        characters: 0,
        readings: 0,
      }) satisfies ActivityDay;
    for (const [field, delta] of Object.entries(patch)) {
      if (field === 'day') continue;
      const key = field as keyof Omit<ActivityDay, 'day'>;
      current[key] = (current[key] ?? 0) + Number(delta ?? 0);
    }
    await db.activity.put(current);
    return current;
  });
}

export function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Delete a notebook/list/category and everything that pointed at it, in one transaction. */
export async function deleteListCascade(listId: string): Promise<void> {
  await db.transaction('rw', db.wordLists, db.savedWords, async () => {
    await db.savedWords.where('lists').equals(listId).modify((word) => {
      word.lists = word.lists.filter((id) => id !== listId);
    });
    await db.wordLists.delete(listId);
  });
}

export async function deleteNotebookCascade(notebookId: string): Promise<void> {
  await db.transaction('rw', db.notebooks, db.notebookEntries, async () => {
    await db.notebookEntries.where('notebookId').equals(notebookId).delete();
    await db.notebooks.delete(notebookId);
  });
}

export async function deleteCategoryCascade(categoryId: string): Promise<void> {
  await db.transaction('rw', db.categories, db.notebooks, async () => {
    const all = await db.categories.toArray();
    const doomed = new Set<string>([categoryId]);
    // Collect descendants iteratively: a nested transaction would deadlock on IDB locks.
    let grew = true;
    while (grew) {
      grew = false;
      for (const category of all) {
        if (category.parentId && doomed.has(category.parentId) && !doomed.has(category.id)) {
          doomed.add(category.id);
          grew = true;
        }
      }
    }
    // notebooks lose their category rather than being deleted with it
    await db.notebooks
      .where('categoryId')
      .anyOf([...doomed])
      .modify((notebook) => {
        delete notebook.categoryId;
      });
    await db.categories.bulkDelete([...doomed]);
  });
}

/** Every user-data table, in export order. Pack files are deliberately excluded: they are
 *  replaceable content, not user data. */
export const USER_STORES = [
  'preferences',
  'searchHistory',
  'savedWords',
  'wordLists',
  'notebooks',
  'categories',
  'notebookEntries',
  'decks',
  'cards',
  'attempts',
  'sessions',
  'activity',
  'achievements',
  'documents',
  'photos',
] as const;

export type UserStore = (typeof USER_STORES)[number];

export function tableFor(store: UserStore): Table<Record<string, unknown>, unknown> {
  return db.table(store) as unknown as Table<Record<string, unknown>, unknown>;
}

export function entrySummary(entry: DictEntry): Pick<
  SavedWord,
  'simplified' | 'traditional' | 'pinyinMarked' | 'definition'
> {
  return {
    simplified: entry.simplified,
    traditional: entry.traditional,
    pinyinMarked: entry.pinyinMarked,
    definition: entry.definition,
  };
}

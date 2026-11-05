/**
 * IndexedDB layer tests on fake-indexeddb: the v1 schema, preference defaults, the activity
 * accumulator, the cascade deletes (asserted by row counts, because "no orphans" is the promise),
 * the cached entry summary and persistence across a close/re-open.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  USER_STORES,
  bumpActivity,
  db,
  deleteCategoryCascade,
  deleteListCascade,
  deleteNotebookCascade,
  entrySummary,
  ensurePreferences,
  getMeta,
  savePreferences,
  setMeta,
  tableFor,
  todayKey,
} from '@/data/db';
import { DEFAULT_PREFERENCES, US, type ActivityDay, type DictEntry, type Preferences } from '@/domain/types';

const DAY = '2026-04-05';

async function count(
  store: (typeof USER_STORES)[number] | 'meta' | 'packs' | 'packFiles' | 'documentBlobs' | 'photoImages',
): Promise<number> {
  return db.table(store).count();
}

function row(day: string, overrides: Partial<ActivityDay> = {}): ActivityDay {
  return {
    day,
    searches: 0,
    entriesSaved: 0,
    reviews: 0,
    newCards: 0,
    correct: 0,
    attempts: 0,
    characters: 0,
    readings: 0,
    ...overrides,
  };
}

beforeAll(async () => {
  await db.open();
});

describe('current schema', () => {
  it('opens with the declared version and every documented table', async () => {
    expect(SCHEMA_VERSION).toBe(3);
    expect(db.verno).toBe(3);
    const names = db.tables.map((table) => table.name);
    for (const expected of [
      'meta',
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
      'packs',
      'packFiles',
      'documents',
      'documentBlobs',
      'photos',
      'photoImages',
      'remoteCache',
      'courseProgress',
      'bookBookmarks',
    ]) {
      expect(names).toContain(expected);
    }
    expect(names).toHaveLength(23);
  });

  it('indexes the secondary keys the queries rely on', () => {
    const cards = db.tables.find((table) => table.name === 'cards')?.schema;
    expect(cards?.primKey.keyPath).toBe('id');
    expect(cards?.indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(['deckId', 'due', 'repetitions']),
    );
    const saved = db.tables.find((table) => table.name === 'savedWords')?.schema;
    const lists = saved?.indexes.find((index) => index.name === 'lists');
    expect(lists?.keyPath).toBe('lists');
    expect(lists?.multi).toBe(true); // multiEntry index declared as *lists
    // EntryPage and the library screens call `orderBy('name')`; on an unindexed key that throws
    // rather than falling back to a scan, so the index is load-bearing and stays asserted here.
    for (const table of ['wordLists', 'categories']) {
      const indexes = db.tables.find((t) => t.name === table)?.schema?.indexes.map((i) => i.name);
      expect(indexes, table).toContain('name');
    }
  });

  it('exposes a writable table object for every exported user store', () => {
    for (const store of USER_STORES) {
      expect(tableFor(store).name).toBe(store);
    }
    // Pack content is deliberately not user data: it must never be exported.
    expect(USER_STORES).not.toContain('packFiles');
    expect(USER_STORES).not.toContain('packs');
    expect(USER_STORES).not.toContain('documentBlobs');
    expect(USER_STORES).not.toContain('photoImages');
  });

  it('persists rows written through one Dexie instance', async () => {
    await db.savedWords.put({
      id: `书${US}shu1`,
      addedAt: '2026-04-05T00:00:00.000Z',
      lists: ['l1'],
      simplified: '书',
      traditional: '書',
      pinyinMarked: 'shū',
      definition: 'book',
    });
    db.close();
    await db.open(); // same factory, same name: the row must still be there
    const back = await db.savedWords.get(`书${US}shu1`);
    expect(back?.simplified).toBe('书');
    expect(await count('savedWords')).toBe(1);
  });
});

describe('preferences', () => {
  it('fills the defaults on a fresh device', async () => {
    const loaded = await ensurePreferences();
    expect(loaded).toEqual(DEFAULT_PREFERENCES);
    expect(await count('preferences')).toBe(1);
  });

  it('is idempotent: a second call returns the stored row untouched', async () => {
    await ensurePreferences();
    const second = await ensurePreferences();
    expect(second).toEqual(DEFAULT_PREFERENCES);
    expect(await count('preferences')).toBe(1);
  });

  it('keeps a stored choice and backfills a field added by an upgrade', async () => {
    await savePreferences({ ...DEFAULT_PREFERENCES, theme: 'dark', dailyGoal: 40 });
    // Simulate an older row that predates a newer preference field.
    await db.preferences.put({ id: 'preferences', theme: 'dark' } as unknown as typeof DEFAULT_PREFERENCES);
    const loaded = await ensurePreferences();
    expect(loaded.theme).toBe('dark');
    expect(loaded.pinyinStyle).toBe(DEFAULT_PREFERENCES.pinyinStyle);
    expect(loaded.installedPacks).toEqual([]);
    const stored = await db.preferences.get('preferences');
    expect(stored).toEqual(loaded);
  });

  it('saves a full preferences row', async () => {
    const next: Preferences = { ...DEFAULT_PREFERENCES, displayScript: 'traditional', textScale: 1.25 };
    await savePreferences(next);
    expect(await db.preferences.get('preferences')).toEqual(next);
    expect((await ensurePreferences()).displayScript).toBe('traditional');
  });
});

describe('meta', () => {
  it('round-trips arbitrary values and reports a missing key as undefined', async () => {
    await setMeta('pack-manifest', { schemaVersion: 1, packs: [] });
    await setMeta('counter', 7);
    expect(await getMeta<{ schemaVersion: number }>('pack-manifest')).toEqual({ schemaVersion: 1, packs: [] });
    expect(await getMeta<number>('counter')).toBe(7);
    expect(await getMeta('nothing-here')).toBeUndefined();
    await setMeta('counter', 8);
    expect(await getMeta<number>('counter')).toBe(8);
    expect(await count('meta')).toBe(2);
  });
});

describe('bumpActivity', () => {
  it('creates the day row on first use and accumulates afterwards', async () => {
    const first = await bumpActivity(DAY, { searches: 1 });
    expect(first).toEqual(row(DAY, { searches: 1 }));
    const second = await bumpActivity(DAY, { searches: 2, reviews: 1 });
    expect(second.searches).toBe(3);
    expect(second.reviews).toBe(1);
    const third = await bumpActivity(DAY, { entriesSaved: 5, newCards: 2, correct: 3, attempts: 4 });
    expect(third).toEqual(
      row(DAY, { searches: 3, reviews: 1, entriesSaved: 5, newCards: 2, correct: 3, attempts: 4 }),
    );
    await bumpActivity(DAY, { characters: 1, readings: 2, writingStrokes: 9 });
    const stored = await db.activity.get(DAY);
    expect(stored).toEqual(
      row(DAY, {
        searches: 3,
        reviews: 1,
        entriesSaved: 5,
        newCards: 2,
        correct: 3,
        attempts: 4,
        characters: 1,
        readings: 2,
        writingStrokes: 9,
      }),
    );
    expect(await count('activity')).toBe(1);
  });

  it('keeps separate days separate and ignores an empty patch', async () => {
    await bumpActivity(DAY, { searches: 1 });
    await bumpActivity('2026-04-06', { reviews: 3 });
    expect((await db.activity.get(DAY))?.searches).toBe(1);
    expect((await db.activity.get('2026-04-06'))?.reviews).toBe(3);
    expect(await count('activity')).toBe(2);
    const unchanged = await bumpActivity(DAY, {});
    expect(unchanged).toEqual(row(DAY, { searches: 1 }));
  });

  it('treats a null or undefined delta as zero rather than NaN', async () => {
    await bumpActivity(DAY, { searches: 2 });
    const after = await bumpActivity(DAY, { reviews: undefined, searches: undefined });
    expect(after.searches).toBe(2);
    expect(after.reviews).toBe(0);
    expect(Number.isNaN(after.searches)).toBe(false);
  });

  it('never lets a patch overwrite the day key', async () => {
    // A hostile or legacy row that carries `day`: the key argument always wins.
    const patch = { day: 'other', searches: 1 } as unknown as Parameters<typeof bumpActivity>[1];
    const after = await bumpActivity(DAY, patch);
    expect(after.day).toBe(DAY);
    expect(await db.activity.get('other')).toBeUndefined();
  });

  it('todayKey formats the local calendar day with zero padding', () => {
    expect(todayKey(new Date(2026, 0, 9))).toBe('2026-01-09');
    expect(todayKey(new Date(2026, 10, 4))).toBe('2026-11-04');
    expect(todayKey(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31');
  });
});

describe('cascade deletes leave no orphan rows', () => {
  it('deleteListCascade removes the list and its membership, not the saved word', async () => {
    await db.wordLists.bulkAdd([
      { id: 'keep', name: 'Keep', createdAt: 'x', updatedAt: 'y' },
      { id: 'doomed', name: 'Doomed', createdAt: 'x', updatedAt: 'y' },
    ]);
    await db.savedWords.bulkAdd([
      {
        id: `a${US}a1`,
        addedAt: '1',
        lists: ['doomed', 'keep'],
        simplified: 'a',
        traditional: 'a',
        pinyinMarked: 'ā',
        definition: 'letter a',
      },
      {
        id: `b${US}b1`,
        addedAt: '2',
        lists: ['doomed'],
        simplified: 'b',
        traditional: 'b',
        pinyinMarked: 'b̄',
        definition: 'letter b',
      },
    ]);

    await deleteListCascade('doomed');

    expect(await count('wordLists')).toBe(1);
    expect(await db.wordLists.get('doomed')).toBeUndefined();
    expect(await count('savedWords')).toBe(2); // the words themselves are the user's
    const a = await db.savedWords.get(`a${US}a1`);
    const b = await db.savedWords.get(`b${US}b1`);
    expect(a?.lists).toEqual(['keep']);
    expect(b?.lists).toEqual([]);
    const stillReferencing = await db.savedWords.where('lists').equals('doomed').toArray();
    expect(stillReferencing).toEqual([]);
  });

  it('deleteNotebookCascade removes the notebook and every entry inside it', async () => {
    await db.notebooks.bulkAdd([
      { id: 'nb1', name: 'One', createdAt: 'x', updatedAt: 'y' },
      { id: 'nb2', name: 'Two', categoryId: 'c1', createdAt: 'x', updatedAt: 'y' },
    ]);
    await db.notebookEntries.bulkAdd([
      { id: 'e1', notebookId: 'nb1', title: 't', body: 'b', entryIds: [], createdAt: 'x', updatedAt: 'y' },
      { id: 'e2', notebookId: 'nb1', title: 't', body: 'b', entryIds: [`a${US}a1`], createdAt: 'x', updatedAt: 'y' },
      { id: 'e3', notebookId: 'nb2', title: 't', body: 'b', entryIds: [], createdAt: 'x', updatedAt: 'y' },
    ]);

    await deleteNotebookCascade('nb1');

    expect(await count('notebooks')).toBe(1);
    expect(await db.notebooks.get('nb1')).toBeUndefined();
    expect(await count('notebookEntries')).toBe(1);
    const orphans = await db.notebookEntries.where('notebookId').equals('nb1').count();
    expect(orphans).toBe(0);
    expect(await db.notebookEntries.get('e3')).toBeDefined();
  });

  it('deleteCategoryCascade deletes nested children and detaches notebooks', async () => {
    await db.categories.bulkAdd([
      { id: 'root', name: 'Root', createdAt: 'x' },
      { id: 'child', name: 'Child', parentId: 'root', createdAt: 'x' },
      { id: 'grandchild', name: 'Grandchild', parentId: 'child', createdAt: 'x' },
      { id: 'sibling', name: 'Sibling', parentId: 'other', createdAt: 'x' },
      { id: 'other', name: 'Other', createdAt: 'x' },
    ]);
    await db.notebooks.bulkAdd([
      { id: 'n1', name: 'in root', categoryId: 'root', createdAt: 'x', updatedAt: 'y' },
      { id: 'n2', name: 'in grandchild', categoryId: 'grandchild', createdAt: 'x', updatedAt: 'y' },
      { id: 'n3', name: 'in sibling', categoryId: 'sibling', createdAt: 'x', updatedAt: 'y' },
      { id: 'n4', name: 'unfiled', createdAt: 'x', updatedAt: 'y' },
    ]);

    await deleteCategoryCascade('root');

    expect(await count('categories')).toBe(2); // sibling + other survive
    expect(await db.categories.get('root')).toBeUndefined();
    expect(await db.categories.get('child')).toBeUndefined();
    expect(await db.categories.get('grandchild')).toBeUndefined();
    // Notebooks survive their category, but nothing may still point at a deleted one.
    expect(await count('notebooks')).toBe(4);
    const notebooks = await db.notebooks.toArray();
    const dangling = notebooks.filter((notebook) =>
      ['root', 'child', 'grandchild'].includes(notebook.categoryId ?? ''),
    );
    expect(dangling).toEqual([]);
    expect(notebooks.find((notebook) => notebook.id === 'n1')?.categoryId).toBeUndefined();
    expect(notebooks.find((notebook) => notebook.id === 'n3')?.categoryId).toBe('sibling');
    const childless = await db.categories.where('parentId').anyOf(['root', 'child', 'grandchild']).count();
    expect(childless).toBe(0);
  });

  it('is a no-op for an id that does not exist', async () => {
    await deleteListCascade('ghost');
    await deleteNotebookCascade('ghost');
    await deleteCategoryCascade('ghost');
    expect(await count('wordLists')).toBe(0);
    expect(await count('notebooks')).toBe(0);
    expect(await count('categories')).toBe(0);
  });
});

describe('entrySummary', () => {
  it('caches exactly the four display fields a saved word needs', () => {
    const entry: DictEntry = {
      id: `中国${US}zhong1 guo2`,
      simplified: '中国',
      traditional: '中國',
      pinyinNumbered: 'zhong1 guo2',
      pinyinMarked: 'zhōngguó',
      pinyinPlain: 'zhongguo',
      definition: 'China',
      length: 2,
    };
    const summary = entrySummary(entry);
    expect(Object.keys(summary).sort()).toEqual([
      'definition',
      'pinyinMarked',
      'simplified',
      'traditional',
    ]);
    expect(summary).toEqual({
      simplified: '中国',
      traditional: '中國',
      pinyinMarked: 'zhōngguó',
      definition: 'China',
    });
    expect(summary).not.toHaveProperty('pinyinNumbered');
  });

  it('survives a pack change because it is a detached copy', async () => {
    const entry: DictEntry = {
      id: `书${US}shu1`,
      simplified: '书',
      traditional: '書',
      pinyinNumbered: 'shu1',
      pinyinMarked: 'shū',
      pinyinPlain: 'shu',
      definition: 'book',
      length: 1,
    };
    await db.savedWords.put({ id: entry.id, addedAt: '3', lists: [], ...entrySummary(entry) });
    expect(await count('savedWords')).toBe(1);
    const stored = await db.savedWords.get(entry.id);
    expect(stored).toEqual({
      id: entry.id,
      addedAt: '3',
      lists: [],
      simplified: '书',
      traditional: '書',
      pinyinMarked: 'shū',
      definition: 'book',
    });
  });
});

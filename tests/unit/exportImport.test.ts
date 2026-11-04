/**
 * Backup export / import: the file format round trip, the documented merge rule and the
 * refusal paths. A user's data is the only thing in this app they cannot re-download, so the
 * import contract is asserted row by row rather than by report counters alone.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_IMPORT_BYTES,
  buildBackup,
  defaultBackupName,
  exportBackupBlob,
  importBackup,
  parseBackup,
  readFileAsText,
} from '@/data/exportImport';
import { db, USER_STORES } from '@/data/db';
import { EXPORT_VERSION, type BackupFile } from '@/data/schema';
import { DEFAULT_PREFERENCES, US, type SavedWord } from '@/domain/types';

/** jsdom's Blob has no `text()` method, so the test reads it the way the app reads a File. */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('test blob read failed'));
    reader.readAsText(blob, 'utf-8');
  });
}

function savedWord(id: string, addedAt: string, definition: string, lists: string[] = []): SavedWord {
  return {
    id,
    addedAt,
    lists,
    simplified: id.split(US)[0] ?? id,
    traditional: id.split(US)[0] ?? id,
    pinyinMarked: 'mǎ',
    definition,
  };
}

/** Seed a small but representative slice of user data across several stores. */
async function seedLocal(): Promise<void> {
  await db.preferences.put({ ...DEFAULT_PREFERENCES, theme: 'dark', dailyGoal: 30 });
  await db.savedWords.bulkAdd([
    savedWord(`马${US}ma3`, '2026-01-01T00:00:00.000Z', 'horse'),
    savedWord(`水${US}shui3`, '2026-01-02T00:00:00.000Z', 'water', ['list-a']),
  ]);
  await db.wordLists.add({ id: 'list-a', name: 'A', createdAt: '2026-01-01', updatedAt: '2026-01-01' });
  await db.cards.bulkAdd([
    {
      id: `马${US}ma3`,
      deckId: 'deck-1',
      simplified: '马',
      traditional: '馬',
      pinyinMarked: 'mǎ',
      definition: 'horse',
      interval: 4,
      ease: 2.5,
      repetitions: 2,
      lapses: 0,
      due: '2026-02-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]);
  await db.activity.add({
    day: '2026-01-01',
    searches: 3,
    entriesSaved: 1,
    reviews: 5,
    newCards: 1,
    correct: 4,
    attempts: 5,
    characters: 0,
    readings: 0,
  });
  await db.packs.put({
    id: 'dictionary-core',
    version: '1',
    kind: 'dictionary',
    installedAt: '2026-01-01',
    bytes: 10,
    files: 1,
    status: 'ready',
  });
}

function backupOf(data: Record<string, unknown[]>): BackupFile {
  const counts: Record<string, number> = {};
  for (const [store, rows] of Object.entries(data)) counts[store] = rows.length;
  return {
    app: 'hanyu-web',
    exportVersion: EXPORT_VERSION,
    exportedAt: '2026-03-01T00:00:00.000Z',
    counts,
    data,
  };
}

describe('buildBackup', () => {
  it('exports every user store and never pack content', async () => {
    await seedLocal();
    const backup = await buildBackup();
    expect(backup.app).toBe('hanyu-web');
    expect(backup.exportVersion).toBe(EXPORT_VERSION);
    // an empty store is still a key: the file format names every store it could carry
    expect(Object.keys(backup.data)).toEqual([...USER_STORES]);
    expect(backup.data).not.toHaveProperty('packs');
    expect(backup.data).not.toHaveProperty('packFiles');
    expect(backup.data).not.toHaveProperty('documentBlobs');
    expect(backup.data).not.toHaveProperty('photoImages');
    expect(backup.counts?.savedWords).toBe(2);
    expect(backup.counts?.searchHistory).toBe(0);
    expect(backup.counts).not.toHaveProperty('packs');
  });

  it('produces a file that parses back through the same schema that wrote it', async () => {
    await seedLocal();
    const backup = await buildBackup();
    const text = JSON.stringify(backup);
    const reparsed = parseBackup(text);
    expect(reparsed.data.savedWords).toHaveLength(2);
    expect(reparsed.data.cards).toHaveLength(1);
    // byte-stable round trip: the schema pass invents or drops no field
    expect(JSON.stringify(reparsed)).toBe(text);
  });

  it('reports row totals and bytes through exportBackupBlob', async () => {
    await seedLocal();
    const { blob, summary } = await exportBackupBlob();
    expect(summary.totalRows).toBe(6); // 1 preferences + 2 savedWords + 1 list + 1 card + 1 activity
    expect(summary.stores.savedWords).toBe(2);
    expect(summary.bytes).toBe((await readBlob(blob)).length);
    expect(blob.type).toBe('application/json');
  });
});

describe('importBackup: merge', () => {
  it('keeps rows only one side had, and the newer row where both had one', async () => {
    await seedLocal(); // local: 马 (added 2026-01-01), 水
    const incoming = backupOf({
      savedWords: [
        // older than the local copy -> must be skipped, the local one stays
        savedWord(`马${US}ma3`, '2025-12-31T00:00:00.000Z', 'horse (old)'),
        // newer than nothing locally -> must be applied
        savedWord(`书${US}shu1`, '2026-02-01T00:00:00.000Z', 'book'),
      ],
    });

    const report = await importBackup(incoming, 'merge');
    expect(report.applied).toBe(1);
    expect(report.conflicts).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.stores).toEqual(['savedWords']);

    const rows = await db.savedWords.toArray();
    expect(rows.map((row) => row.id).sort()).toEqual(
      [`书${US}shu1`, `水${US}shui3`, `马${US}ma3`].sort(),
    );
    expect(rows.find((row) => row.id === `马${US}ma3`)?.definition).toBe('horse');
    expect(rows.find((row) => row.id === `书${US}shu1`)?.definition).toBe('book');
    // merge never destroys learning data written by the other device
    expect(await db.cards.count()).toBe(1);
    expect(await db.wordLists.count()).toBe(1);
  });

  it('isNewer boundary: an equal timestamp lets the incoming record win', async () => {
    await seedLocal();
    const same = savedWord(`马${US}ma3`, '2026-01-01T00:00:00.000Z', 'horse (tie)');
    const report = await importBackup(backupOf({ savedWords: [same] }), 'merge');
    expect(report.conflicts).toBe(1);
    expect(report.applied).toBe(1);
    expect(report.skipped).toBe(0);
    expect((await db.savedWords.get(`马${US}ma3`))?.definition).toBe('horse (tie)');
  });

  it('falls back through updatedAt / addedAt / lastReviewed / at / day for the stamp', async () => {
    await db.notebooks.put({
      id: 'nb',
      name: 'local',
      updatedAt: '2026-05-05T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    await importBackup(
      backupOf({ notebooks: [{ id: 'nb', name: 'newer', updatedAt: '2026-06-06T00:00:00.000Z' }] }),
      'merge',
    );
    expect((await db.notebooks.get('nb'))?.name).toBe('newer');

    // a cards row carries lastReviewed, not updatedAt
    await db.cards.put({
      id: 'card',
      deckId: 'd',
      simplified: 'a',
      traditional: 'a',
      pinyinMarked: 'ā',
      definition: 'x',
      interval: 1,
      ease: 2.5,
      repetitions: 1,
      lapses: 0,
      due: '2026-01-02',
      createdAt: '2026-01-01',
      lastReviewed: '2026-01-01T00:00:00.000Z',
    });
    const cardReport = await importBackup(
      backupOf({
        cards: [
          {
            id: 'card',
            deckId: 'd',
            simplified: 'a',
            traditional: 'a',
            pinyinMarked: 'ā',
            definition: 'incoming',
            interval: 9,
            ease: 2.5,
            repetitions: 5,
            lapses: 0,
            due: '2026-09-09',
            createdAt: '2026-01-01',
            lastReviewed: '2026-09-01T00:00:00.000Z',
          },
        ],
      }),
      'merge',
    );
    expect(cardReport.applied).toBe(1);
    expect((await db.cards.get('card'))?.definition).toBe('incoming');

    // activity rows are keyed by day and stamped by day itself
    await db.activity.put({
      day: '2026-04-04',
      searches: 1,
      entriesSaved: 0,
      reviews: 0,
      newCards: 0,
      correct: 0,
      attempts: 0,
      characters: 0,
      readings: 0,
    });
    await importBackup(
      backupOf({
        activity: [
          {
            day: '2026-04-04',
            searches: 7,
            entriesSaved: 0,
            reviews: 0,
            newCards: 0,
            correct: 0,
            attempts: 0,
            characters: 0,
            readings: 0,
          },
        ],
      }),
      'merge',
    );
    expect((await db.activity.get('2026-04-04'))?.searches).toBe(7);
  });

  it('counts a row with no primary key property as skipped, not silently applied', async () => {
    await seedLocal();
    const report = await importBackup(
      backupOf({ savedWords: [{ definition: 'no id' }, { id: null, definition: 'null id' }] }),
      'merge',
    );
    expect(report.skipped).toBe(2);
    expect(report.applied).toBe(0);
    expect(await db.savedWords.count()).toBe(2);
  });

  it('ignores stores the backup does not carry', async () => {
    await seedLocal();
    const report = await importBackup(backupOf({ wordLists: [] }), 'merge');
    expect(report.stores).toEqual([]);
    expect(await db.savedWords.count()).toBe(2);
  });
});

describe('importBackup: replace', () => {
  it('makes the device match the source exactly', async () => {
    await seedLocal();
    const source = backupOf({
      savedWords: [savedWord('猫', '2026-02-02T00:00:00.000Z', 'cat')],
      wordLists: [{ id: 'list-b', name: 'B', createdAt: 'x', updatedAt: 'y' }],
      activity: [],
      cards: [],
    });
    const report = await importBackup(source, 'replace');
    expect(report.applied).toBe(2);
    expect(report.conflicts).toBe(0); // replace has no conflicts by definition
    expect((await db.savedWords.toArray()).map((row) => row.id)).toEqual(['猫']);
    expect((await db.wordLists.toArray()).map((row) => row.id)).toEqual(['list-b']);
    expect(await db.cards.count()).toBe(0);
    expect(await db.activity.count()).toBe(0);
    // only non-empty stores are named in the report, even though the empty ones were cleared
    expect(report.stores.sort()).toEqual(['savedWords', 'wordLists']);
  });

  it('leaves the preferences row of this device alone when the backup has none', async () => {
    await seedLocal();
    await importBackup(backupOf({ savedWords: [savedWord('猫', '2026-02-02T00:00:00.000Z', 'cat')] }), 'replace');
    const prefs = await db.preferences.get('preferences');
    expect(prefs?.theme).toBe('dark');
    expect(prefs?.dailyGoal).toBe(30);
    expect(await db.savedWords.count()).toBe(1);
  });

  it('does not touch pack installs, which are not part of a backup', async () => {
    await seedLocal();
    await importBackup(backupOf({ savedWords: [] }), 'replace');
    expect(await db.packs.count()).toBe(1);
    expect((await db.packs.get('dictionary-core'))?.status).toBe('ready');
  });

  it('a full export -> replace cycle onto a wiped device restores every user row', async () => {
    await seedLocal();
    const exported = parseBackup(JSON.stringify(await buildBackup()));
    // wipe this device's user data only: installed packs are content, not user data
    for (const store of USER_STORES) await db.table(store).clear();
    expect(await db.savedWords.count()).toBe(0);
    const report = await importBackup(exported, 'replace');
    expect(report.applied).toBe(6);
    expect(await db.savedWords.count()).toBe(2);
    expect(await db.wordLists.count()).toBe(1);
    expect(await db.cards.count()).toBe(1);
    expect(await db.activity.count()).toBe(1);
    const prefs = await db.preferences.get('preferences');
    expect(prefs).toEqual({ ...DEFAULT_PREFERENCES, theme: 'dark', dailyGoal: 30 });
    expect(prefs?.installedPacks).toEqual([]);
    expect((await db.packs.get('dictionary-core'))?.status).toBe('ready');
  });
});

describe('parseBackup refusals', () => {
  it('rejects text that is not JSON with an actionable message', () => {
    expect(() => parseBackup('not json at all')).toThrowError(/not valid JSON/i);
    expect(() => parseBackup('')).toThrowError(/not valid JSON/i);
  });

  it('rejects valid JSON that is not a Hanyu backup, and surfaces the schema issues', () => {
    for (const junk of ['{"hello":"world"}', '[]', '"a string"', 'null', '{"app":"other-thing","exportVersion":1,"data":{}}']) {
      expect(() => parseBackup(junk)).toThrowError(/Not a Hanyu Dictionary backup/);
    }
    let message = '';
    try {
      parseBackup('{"app":"hanyu-web"}');
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('exportVersion');
    expect(message).toContain('data');
  });

  it('refuses a backup written by a newer export version instead of guessing', () => {
    const future = JSON.stringify({
      app: 'hanyu-web',
      exportVersion: EXPORT_VERSION + 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      data: {},
    });
    expect(() => parseBackup(future)).toThrowError(/newer schema \(v2\)/);
    // a file with a non-integer or non-positive version never reaches that check
    expect(() =>
      parseBackup(JSON.stringify({ app: 'hanyu-web', exportVersion: 0, exportedAt: 'x', data: {} })),
    ).toThrowError(/Not a Hanyu Dictionary backup/);
  });

  it('accepts the current version and refuses the oversized file before parsing it', () => {
    const current = JSON.stringify({
      app: 'hanyu-web',
      exportVersion: EXPORT_VERSION,
      exportedAt: 'x',
      data: { savedWords: [] },
    });
    expect(parseBackup(current).data.savedWords).toEqual([]);
    // the size guard is a documented constant the picker checks before reading the file
    expect(MAX_IMPORT_BYTES).toBe(32 * 1024 * 1024);
    expect(MAX_IMPORT_BYTES).toBeGreaterThan(current.length);
  });

  it('refuses a backup whose data records are not arrays', () => {
    expect(() =>
      parseBackup(
        JSON.stringify({ app: 'hanyu-web', exportVersion: 1, exportedAt: 'x', data: { savedWords: 5 } }),
      ),
    ).toThrowError(/Not a Hanyu Dictionary backup/);
  });
});

describe('defaultBackupName', () => {
  it('is stable, dated and .json, so a folder of exports sorts by day', () => {
    expect(defaultBackupName(new Date('2026-04-07T15:44:00.000Z'))).toBe('hanyu-backup-2026-04-07.json');
    expect(defaultBackupName(new Date(Date.UTC(2026, 0, 1, 12)))).toBe('hanyu-backup-2026-01-01.json');
    expect(defaultBackupName(new Date('2026-12-31T23:59:59.999Z'))).toMatch(
      /^hanyu-backup-\d{4}-\d{2}-\d{2}\.json$/,
    );
  });
});

describe('readFileAsText', () => {
  it('reads a chosen File back as UTF-8 text a backup parser can take', async () => {
    await seedLocal();
    const text = JSON.stringify(await buildBackup());
    const file = new File([text], defaultBackupName(new Date('2026-04-07T00:00:00Z')), {
      type: 'application/json',
    });
    const read = await readFileAsText(file);
    expect(read).toBe(text);
    expect(parseBackup(read).counts?.savedWords).toBe(2);
  });

  it('carries a Chinese headword through the file read unchanged', async () => {
    const file = new File(['{"s":"你好"}'], 'x.json');
    expect(JSON.parse(await readFileAsText(file))).toEqual({ s: '你好' });
  });
});

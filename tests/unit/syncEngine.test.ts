/**
 * Unit tests for `src/data/syncEngine.ts` and `src/data/githubClient.ts` (09 §3.3).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, getMeta, setMeta } from '@/data/db';
import {
  clearGitHubConfig,
  encodeBase64Utf8,
  redactSecrets,
  setGitHubConfig,
} from '@/data/githubClient';
import {
  buildLocalSyncState,
  mergeSyncStates,
  pullSyncState,
  pushSyncState,
} from '@/data/syncEngine';
import type { SyncStateFile } from '@/domain/types';

function emptySyncState(overrides: Partial<SyncStateFile> = {}): SyncStateFile {
  return {
    schemaVersion: 1,
    updatedAt: '2026-11-05T08:00:00.000Z',
    deviceId: 'device-a',
    deletedIds: {},
    preferences: {},
    savedWords: [],
    wordLists: [],
    notebooks: [],
    categories: [],
    notebookEntries: [],
    decks: [],
    cards: [],
    courseProgress: {},
    bookBookmarks: {},
    dailyActivity: {},
    ...overrides,
  };
}

describe('mergeSyncStates (deterministic CRDT-like merge)', () => {
  it('unions savedWords by id and picks the record with newer updatedAt', () => {
    const deviceA = emptySyncState({
      savedWords: [
        {
          id: '忙|mang2',
          addedAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-02T00:00:00.000Z',
          lists: [],
          simplified: '忙',
          traditional: '忙',
          pinyinMarked: 'máng',
          definition: 'busy (old)',
        },
        {
          id: '书|shu1',
          addedAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
          lists: [],
          simplified: '书',
          traditional: '書',
          pinyinMarked: 'shū',
          definition: 'book',
        },
      ],
    });

    const deviceB = emptySyncState({
      deviceId: 'device-b',
      savedWords: [
        {
          id: '忙|mang2',
          addedAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-04T00:00:00.000Z',
          lists: ['fav'],
          simplified: '忙',
          traditional: '忙',
          pinyinMarked: 'máng',
          definition: 'busy (updated on B)',
        },
        {
          id: '茶|cha2',
          addedAt: '2026-11-03T00:00:00.000Z',
          updatedAt: '2026-11-03T00:00:00.000Z',
          lists: [],
          simplified: '茶',
          traditional: '茶',
          pinyinMarked: 'chá',
          definition: 'tea',
        },
      ],
    });

    const merged = mergeSyncStates(deviceA, deviceB);
    expect(merged.savedWords).toHaveLength(3);
    const mang = merged.savedWords.find((w) => w.id === '忙|mang2');
    expect(mang?.definition).toBe('busy (updated on B)');
    expect(mang?.lists).toEqual(['fav']);
  });

  it('honors tombstones in deletedIds when deletedAt > item.updatedAt', () => {
    const deviceA = emptySyncState({
      savedWords: [
        {
          id: '忙|mang2',
          addedAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-02T00:00:00.000Z',
          lists: [],
          simplified: '忙',
          traditional: '忙',
          pinyinMarked: 'máng',
          definition: 'busy',
        },
      ],
    });

    const deviceB = emptySyncState({
      deletedIds: {
        'savedWords:忙|mang2': '2026-11-05T00:00:00.000Z',
      },
    });

    const merged = mergeSyncStates(deviceA, deviceB);
    expect(merged.savedWords).toEqual([]);
    expect(merged.deletedIds['savedWords:忙|mang2']).toBe('2026-11-05T00:00:00.000Z');
  });

  it('picks newer lastReviewed per SRS card', () => {
    const deviceA = emptySyncState({
      cards: [
        {
          id: 'card-1',
          deckId: 'd1',
          simplified: '好',
          traditional: '好',
          pinyinMarked: 'hǎo',
          definition: 'good',
          interval: 2,
          ease: 2.5,
          repetitions: 1,
          lapses: 0,
          due: '2026-11-06T00:00:00.000Z',
          lastReviewed: '2026-11-04T00:00:00.000Z',
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      ],
    });

    const deviceB = emptySyncState({
      cards: [
        {
          id: 'card-1',
          deckId: 'd1',
          simplified: '好',
          traditional: '好',
          pinyinMarked: 'hǎo',
          definition: 'good',
          interval: 6,
          ease: 2.6,
          repetitions: 2,
          lapses: 0,
          due: '2026-11-11T00:00:00.000Z',
          lastReviewed: '2026-11-05T08:00:00.000Z',
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      ],
    });

    const merged = mergeSyncStates(deviceA, deviceB);
    expect(merged.cards).toHaveLength(1);
    expect(merged.cards[0].interval).toBe(6);
    expect(merged.cards[0].repetitions).toBe(2);
  });

  it('unions completedSteps, writingCompletedChars, and keeps max bestDrillScore in courseProgress', () => {
    const deviceA = emptySyncState({
      courseProgress: {
        'b1-l02': {
          lessonId: 'b1-l02',
          bookId: 'b1',
          completedSteps: ['vocab', 'dialogue'],
          bestDrillScore: 75,
          writingCompletedChars: ['汉', '语'],
          lastStudiedAt: '2026-11-04T10:00:00.000Z',
          updatedAt: '2026-11-04T10:00:00.000Z',
        },
      },
    });

    const deviceB = emptySyncState({
      courseProgress: {
        'b1-l02': {
          lessonId: 'b1-l02',
          bookId: 'b1',
          completedSteps: ['dialogue', 'grammar', 'drill'],
          bestDrillScore: 92,
          writingCompletedChars: ['语', '难'],
          lastStudiedAt: '2026-11-05T09:00:00.000Z',
          updatedAt: '2026-11-05T09:00:00.000Z',
        },
      },
    });

    const merged = mergeSyncStates(deviceA, deviceB);
    const p = merged.courseProgress['b1-l02'];
    expect(p).toBeDefined();
    expect(p.completedSteps).toEqual(['vocab', 'dialogue', 'grammar', 'drill']);
    expect(p.writingCompletedChars).toEqual(['汉', '语', '难']);
    expect(p.bestDrillScore).toBe(92);
    expect(p.updatedAt).toBe('2026-11-05T09:00:00.000Z');
  });

  it('takes max of each counter in dailyActivity', () => {
    const deviceA = emptySyncState({
      dailyActivity: {
        '2026-11-05': {
          day: '2026-11-05',
          searches: 5,
          entriesSaved: 2,
          reviews: 10,
          newCards: 3,
          correct: 8,
          attempts: 10,
          characters: 4,
          readings: 1,
        },
      },
    });
    const deviceB = emptySyncState({
      dailyActivity: {
        '2026-11-05': {
          day: '2026-11-05',
          searches: 2,
          entriesSaved: 6,
          reviews: 14,
          newCards: 1,
          correct: 12,
          attempts: 15,
          characters: 2,
          readings: 3,
        },
      },
    });

    const merged = mergeSyncStates(deviceA, deviceB);
    expect(merged.dailyActivity['2026-11-05']).toEqual({
      day: '2026-11-05',
      searches: 5,
      entriesSaved: 6,
      reviews: 14,
      newCards: 3,
      correct: 12,
      attempts: 15,
      characters: 4,
      readings: 3,
    });
  });
});

describe('pullSyncState & pushSyncState network protocol', () => {
  beforeEach(() => {
    clearGitHubConfig();
    const fakePat = 'github_' + 'pat_1234567890abcdefghijklmnop';
    setGitHubConfig({
      owner: 'RandomGuy198',
      repo: 'Hanyu-data',
      branch: 'main',
      pat: fakePat,
    });
  });

  it('pullSyncState sends If-None-Match with stored ETag and treats 304 Not Modified as a no-op', async () => {
    await setMeta('sync.lastEtag', '"etag-v1"');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 304,
        headers: { etag: '"etag-v1"' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await pullSyncState();
    expect(result.status).toBe('not-modified');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['If-None-Match']).toBe('"etag-v1"');
  });

  it('pushSyncState retries once with pull+merge when GitHub returns 409 Conflict', async () => {
    await setMeta('sync.lastRemoteSha', 'sha-old');
    await db.savedWords.put({
      id: '本地|ben3 di4',
      addedAt: '2026-11-05T01:00:00.000Z',
      updatedAt: '2026-11-05T01:00:00.000Z',
      lists: [],
      simplified: '本地',
      traditional: '本地',
      pinyinMarked: 'běndì',
      definition: 'local',
    });

    const remoteState = emptySyncState({
      deviceId: 'device-remote',
      savedWords: [
        {
          id: '远程|yuan3 cheng2',
          addedAt: '2026-11-05T02:00:00.000Z',
          updatedAt: '2026-11-05T02:00:00.000Z',
          lists: [],
          simplified: '远程',
          traditional: '遠程',
          pinyinMarked: 'yuǎnchéng',
          definition: 'remote',
        },
      ],
    });
    const remoteBase64 = encodeBase64Utf8(JSON.stringify(remoteState));

    const fetchMock = vi
      .fn()
      // 1st call: PUT fails with 409 Conflict
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Conflict' }), { status: 409 }),
      )
      // 2nd call: GET pulls remote state with new sha
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sha: 'sha-remote-2',
            content: remoteBase64,
            encoding: 'base64',
          }),
          { status: 200, headers: { etag: '"etag-2"' } },
        ),
      )
      // 3rd call: retry PUT succeeds with sha-remote-2
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: { sha: 'sha-merged-3' },
          }),
          { status: 200, headers: { etag: '"etag-3"' } },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    const finalState = await pushSyncState();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(finalState.savedWords.map((w) => w.simplified).sort()).toEqual(['本地', '远程'].sort());
    expect(await getMeta<string>('sync.lastRemoteSha')).toBe('sha-merged-3');
    const secondPutBody = JSON.parse(
      (fetchMock.mock.calls[2] as [string, RequestInit])[1].body as string,
    ) as { sha: string };
    expect(secondPutBody.sha).toBe('sha-remote-2');
  });

  it('strips secret tokens from thrown error strings', async () => {
    const fakePat = 'github_' + 'pat_SecretValue9876543210abcdef';
    const fakeClassic = 'gh' + 'p_1234567890abcdefghijklmnopqrstuvwxyz';
    setGitHubConfig({ pat: fakePat });

    const cleaned = redactSecrets(
      `Failed with Authorization: Bearer ${fakePat} and ${fakeClassic}`,
    );
    expect(cleaned).not.toContain(fakePat);
    expect(cleaned).not.toContain(fakeClassic);
    expect(cleaned).toContain('[REDACTED]');

    const fetchMock = vi.fn().mockRejectedValue(
      new Error(`Network error for token ${fakePat} and ${fakeClassic}`),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(pullSyncState()).rejects.toThrow(/\[REDACTED\]/);
    try {
      await pullSyncState();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).not.toContain(fakePat);
      expect(msg).not.toContain(fakeClassic);
    }
  });

  it('buildLocalSyncState snapshots local IndexedDB stores accurately', async () => {
    await db.bookBookmarks.put({
      bookId: 'b1',
      lastPageNumber: 31,
      lastLessonId: 'b1-l02',
      viewMode: 'page',
      updatedAt: '2026-11-05T10:00:00.000Z',
    });
    const state = await buildLocalSyncState();
    expect(state.bookBookmarks.b1?.lastPageNumber).toBe(31);
  });
});

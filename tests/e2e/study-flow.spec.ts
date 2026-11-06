/** The v0.2 study journey, driven against a mocked private study repository.
 *
 *  Everything the books shelf, the reader, the five-step course and the sync engine normally reads
 *  from `RandomGuy198/Hanyu-data` is intercepted here and answered from the synthetic fixtures in
 *  `tests/fixtures/courseLesson.ts` - invented vocabulary and sentences, never book material, because
 *  a public repository must stay clean even inside its own tests. The GitHub API is faked the same
 *  way: `GET …/contents/<path>` in both raw and JSON encodings, and `PUT` for the push. */

import { expect, test, type Page, type Route } from '@playwright/test';
import {
  COURSE_FIXTURE_GENERATED_AT,
  COURSE_LESSON,
  COURSE_MANIFEST,
} from '../fixtures/courseLesson';
import { gotoReady } from './support';

const RAW_ACCEPT = 'application/vnd.github.v3.raw';

interface MockRepo {
  /** repository path -> file text */
  files: Map<string, string>;
  /** the decoded JSON body of every PUT the app has attempted, in order */
  pushes: string[];
  /** answer the next PUT with 409 once, then behave again */
  conflictNextPut: boolean;
  /** served for `sync/state.json` while no conflict is armed */
  syncState: string;
  /** what the other device pushed while this device was mid-write */
  remoteDeviceState: string;
}

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

/** A saved-word row shaped like the ones the library stores, so `mergeSyncStates` treats it as real. */
function savedWord(hanzi: string): Record<string, unknown> {
  return {
    id: hanzi,
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lists: [],
    simplified: hanzi,
    traditional: hanzi,
    pinyinMarked: 'pīn yīn',
    definition: 'mocked entry',
  };
}

function syncStateFile(words: string[], deviceId: string, updatedAt: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    updatedAt,
    deviceId,
    deletedIds: {},
    preferences: {},
    savedWords: words.map(savedWord),
    wordLists: [],
    notebooks: [],
    categories: [],
    notebookEntries: [],
    decks: [],
    cards: [],
    courseProgress: {},
    bookBookmarks: {},
    dailyActivity: {},
  });
}

/** The repository the app believes it is talking to: owner `mock`, repo `hanyu-mock`. */
function mockPrivateRepo(page: Page, repo: MockRepo) {
  return page.route('**/api.github.com/**', async (route: Route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const contents = /^\/repos\/mock\/hanyu-mock\/contents\/(.+)$/.exec(pathname);

    if (request.method() === 'PUT' && contents) {
      const payload = JSON.parse(request.postData() ?? '{}') as { content?: string };
      repo.pushes.push(Buffer.from(String(payload.content ?? ''), 'base64').toString('utf8'));
      if (repo.conflictNextPut) {
        repo.conflictNextPut = false;
        repo.files.set('sync/state.json', repo.remoteDeviceState);
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: '{"message":"countout-of-date"}',
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: { sha: `push-sha-${repo.pushes.length}` },
          commit: { sha: `commit-${repo.pushes.length}` },
        }),
      });
      return;
    }

    if (request.method() === 'GET' && contents) {
      const path = contents[1];
      const text = repo.files.get(path);
      if (text === undefined) {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: '{"message":"Not Found"}',
        });
        return;
      }
      if ((request.headers()['accept'] ?? '').includes(RAW_ACCEPT)) {
        await route.fulfill({
          status: 200,
          contentType: 'application/octet-stream',
          body: text,
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { etag: `W/"${path}-${COURSE_FIXTURE_GENERATED_AT}"` },
        body: JSON.stringify({ sha: `sha-${path}`, content: base64(text) }),
      });
      return;
    }

    // Git Data API fallback (used only when the Contents API rejects a >1 MB file).
    const trees = /^\/repos\/mock\/hanyu-mock\/git\/trees\/(.+)$/.exec(pathname);
    if (request.method() === 'GET' && trees) {
      const tree = [...repo.files.keys()].map((p) => ({ path: p, type: 'blob', sha: `sha-${p}`, size: p.length }));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tree, truncated: false }),
      });
      return;
    }

    const blobs = /^\/repos\/mock\/hanyu-mock\/git\/blobs\/(.+)$/.exec(pathname);
    if (request.method() === 'GET' && blobs) {
      const sha = blobs[1];
      const path = [...repo.files.keys()].find((p) => `sha-${p}` === sha);
      const text = path ? repo.files.get(path) : undefined;
      if (text === undefined) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: text });
      return;
    }

    if (request.method() === 'GET' && pathname === '/repos/mock/hanyu-mock') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ private: true, full_name: 'mock/hanyu-mock', permissions: { push: true } }),
      });
      return;
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
  });
}

function connectAsOwner(page: Page) {
  return page.addInitScript(() => {
    localStorage.setItem('hanyu.gh.owner', 'mock');
    localStorage.setItem('hanyu.gh.repo', 'hanyu-mock');
    localStorage.setItem('hanyu.gh.branch', 'main');
    localStorage.setItem('hanyu.gh.pat', 'playwright-mock-token-value');
  });
}

/** The dev and preview servers bridge the real `Hanyu data` folder on this machine at
 *  `/__local_private_data__/`, so every test here closes it: a run that read the developer's disk
 *  would pass on one machine and fail on the next, and the mocked repository is what is under test. */
function closeLocalBridge(page: Page) {
  return page.route('**/__local_private_data__/**', (route: Route) =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'local bridge is closed for tests' }),
  );
}

function courseRepo(): MockRepo {
  return {
    files: new Map([
      ['books/manifest.json', JSON.stringify(COURSE_MANIFEST)],
      ['books/b1/lessons/l03.json', JSON.stringify(COURSE_LESSON)],
    ]),
    pushes: [],
    conflictNextPut: false,
    syncState: '',
    remoteDeviceState: '',
  };
}

/** The first PUT the app completes, parsed once it exists. */
function lastPush(repo: MockRepo) {
  return () => {
    const raw = repo.pushes[repo.pushes.length - 1];
    return raw ? (JSON.parse(raw) as { savedWords: { id: string }[] }) : null;
  };
}

/** Saved-word ids are entry ids, which append the numbered pinyin to the headword. */
function savedHeadwords(readPush: () => { savedWords: { id: string }[] } | null): string[] {
  return (readPush()?.savedWords ?? [])
    .map((word) => word.id.match(/^[一-鿿]+/)?.[0] ?? word.id)
    .sort();
}

test.describe('study flow with a mocked private repository', () => {
  test('the shelf asks for a repository instead of showing nothing at all', async ({ page }) => {
    await closeLocalBridge(page);
    await gotoReady(page, '/#/books');
    await expect(page.getByRole('heading', { name: 'Sách & Khóa học' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Kết nối kho dữ liệu/ })).toBeVisible();
    await expect(page.getByLabel('Fine-Grained Personal Access Token')).toBeVisible();
  });

  test('a connected repository drives the shelf, the reader and the five-step course', async ({
    page,
  }) => {
    const repo = courseRepo();
    await mockPrivateRepo(page, repo);
    await closeLocalBridge(page);
    await connectAsOwner(page);

    await gotoReady(page, '/#/books');
    await expect(
      page.getByText(COURSE_MANIFEST.books[0].titleVi, { exact: false }).first(),
      'the volume from the connected manifest should appear on the shelf',
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /Kết nối kho dữ liệu/ }),
      'the connect card must give way once data loads',
    ).toHaveCount(0);
    await expect(
      page.getByText(/Bài 3–3/).first(),
      'the shelf lists the mocked manifest lessons, so nothing here came from the local disk',
    ).toBeVisible();

    await gotoReady(page, '/#/books/b1/page/40');
    const textPane = page.getByRole('region', { name: 'Văn bản tương tác' });
    await expect(textPane, 'the reader shows the mocked lesson text').toBeVisible();
    // Sentences render as one button per token, so a sentence is only reachable through its
    // tokens and its pinyin line - never as a single text node.
    const dialogue = textPane.getByRole('region', { name: COURSE_LESSON.dialogues[0].title });
    await expect(dialogue.getByRole('button', { name: /^汉语/ })).toBeVisible();
    await expect(dialogue.getByText(/Hànyǔ bú tài nán\./)).toBeVisible();
    await expect(
      textPane.getByRole('region', { name: 'Từ mới trong bài' }).getByRole('button', { name: /^1 忙/ }),
      'the vocabulary strip lists the mocked words',
    ).toBeVisible();

    await gotoReady(page, '/#/courses/b1/b1-l03');
    await expect(page.getByRole('heading', { name: /Bước 1 — Từ mới/ })).toBeVisible();
    await expect(page.getByText(COURSE_LESSON.vocabulary[0].meaningVi)).toBeVisible();

    await page.getByRole('button', { name: /Nhận biết/ }).first().click();
    await expect(page.getByRole('heading', { name: /Bước 4 — Luyện nhận biết/ })).toBeVisible();
    await expect(page.getByText(/Câu 1\/12/)).toBeVisible();

    await page.getByRole('button', { name: /Tập viết/ }).first().click();
    await expect(page.getByRole('heading', { name: /Bước 5 — Tập viết chữ Hán/ })).toBeVisible();
    await expect(page.getByText(/Chữ 1\/3/)).toBeVisible();
  });

  test('writing practice opens the characters the course asks for', async ({ page }) => {
    await gotoReady(page, `/#/writing?chars=${encodeURIComponent(COURSE_LESSON.writingTargets.join(''))}`);
    await expect(page.getByRole('region', { name: `Practice grid for ${COURSE_LESSON.writingTargets[0]}` })).toBeVisible();
  });

  test('sync pulls the remote state, pushes local changes and merges a conflict', async ({ page }) => {
    const repo = courseRepo();
    repo.syncState = syncStateFile(['汉语'], 'device-a', '2026-01-02T00:00:00.000Z');
    repo.remoteDeviceState = syncStateFile(['汉语', '电脑'], 'device-b', '2026-02-02T00:00:00.000Z');
    repo.files.set('sync/state.json', repo.syncState);
    await mockPrivateRepo(page, repo);
    await closeLocalBridge(page);
    await connectAsOwner(page);

    // Boot pull: the remote saved word lands in this device's library.
    await gotoReady(page, '/#/library');
    await expect(
      page.getByText('汉语', { exact: false }).first(),
      'a word saved on another device must arrive on this one',
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /Kết nối/ })).toHaveCount(0);

    // Local change: saving a word is pushed, and the push still carries the remote word.
    await gotoReady(page, '/#/search?q=' + encodeURIComponent('中国'));
    await page.getByRole('button', { name: /中国/ }).first().click();
    await page.getByRole('button', { name: /^Save 中国$/ }).click();

    await expect
      .poll(lastPush(repo), { message: 'the app should PUT the merged state', timeout: 30_000 })
      .not.toBeNull();
    expect(savedHeadwords(lastPush(repo))).toEqual(['中国', '汉语']);

    // Conflict: another device wrote first, so the app must re-pull and push the union.
    repo.conflictNextPut = true;
    await gotoReady(page, '/#/search?q=' + encodeURIComponent('图书馆'));
    await page.getByRole('button', { name: /图书馆/ }).first().click();
    await page.getByRole('button', { name: /^Save 图书馆$/ }).click();

    await expect
      .poll(() => repo.pushes.length, { message: 'a 409 should trigger a retried PUT', timeout: 40_000 })
      .toBeGreaterThanOrEqual(2);
    expect(savedHeadwords(lastPush(repo))).toEqual(['中国', '电脑', '图书馆', '汉语'].sort());
  });
});

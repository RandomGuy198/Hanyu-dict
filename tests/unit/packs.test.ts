/**
 * Pack installation against a stubbed same-origin `fetch`: the manifest gate, hash verification,
 * the atomic swap and the rollback promise. No test here touches the network; every response is
 * served from a map built in-process, and the recorded checksums are real SHA-256 digests of the
 * bytes being served (node:crypto), so `sha256Hex` is exercised, not faked.
 */
import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  cachedManifest,
  dataUrl,
  ensurePackInstalled,
  ensureRequiredPacks,
  installPack,
  installedPackIds,
  loadManifest,
  packFilePaths,
  packOverview,
  packText,
  readPackFile,
  requestPersistence,
  storageUsage,
  uninstallPack,
} from '@/data/packs';
import { db } from '@/data/db';
import type { InstallProgress } from '@/data/packs';
import type { PackDescriptor, PackManifest } from '@/domain/types';

const encoder = new TextEncoder();

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function descriptor(overrides: Partial<PackDescriptor> & { id: string }): PackDescriptor {
  const files = overrides.files ?? [
    { path: `packs/${overrides.id}/000.txt`, sha256: '', bytes: 0 },
  ];
  return {
    kind: 'dictionary',
    label: `Pack ${overrides.id}`,
    version: '1',
    required: true,
    license: 'CC-BY-4.0',
    attribution: 'Original content authored for this project.',
    bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
    ...overrides,
  };
}

/** A pack whose served bytes match its manifest entry, plus the text it serves. */
function makePack(
  id: string,
  version: string,
  contents: Record<string, string>,
  overrides: Partial<PackDescriptor> = {},
): { pack: PackDescriptor; bodies: Record<string, string> } {
  const files = Object.entries(contents).map(([path, text]) => ({
    path,
    sha256: sha256(text),
    bytes: encoder.encode(text).length,
    records: text.split('\n').filter(Boolean).length,
  }));
  return {
    pack: descriptor({ id, version, files, ...overrides }),
    bodies: contents,
  };
}

function manifest(packs: PackDescriptor[]): PackManifest {
  return { schemaVersion: 1, generatedAt: '2026-04-01T00:00:00.000Z', minAppVersion: '1.0.0', packs };
}

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

/** Serve same-origin paths from a map. Anything not listed 404s, exactly as a static host would. */
function stubFetch(routes: Record<string, string>, manifestJson?: unknown): void {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL): Promise<FakeResponse> => {
    const url = String(input);
    const status = url === dataUrl('manifest.json') ? 200 : routes[url] === undefined ? 404 : 200;
    if (url === dataUrl('manifest.json')) {
      return {
        ok: true,
        status: 200,
        json: async () => manifestJson,
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    const body = routes[url] ?? '';
    const bytes = encoder.encode(body);
    return {
      ok: status === 200,
      status,
      json: async () => {
        throw new Error('pack files are read as bytes, never as JSON');
      },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  });
  vi.stubGlobal('fetch', fetchImpl);
}

/** Build the route map a static host would serve for a manifest and its pack files. */
function routesFor(entries: { pack: PackDescriptor; bodies: Record<string, string> }[]): Record<string, string> {
  const routes: Record<string, string> = {};
  for (const entry of entries) {
    for (const [path, text] of Object.entries(entry.bodies)) routes[dataUrl(path)] = text;
  }
  return routes;
}

describe('dataUrl', () => {
  it('joins the Vite base, the data directory and the pack path', () => {
    expect(dataUrl('manifest.json')).toBe(`${import.meta.env.BASE_URL.replace(/\/+$/, '')}/data/manifest.json`);
    expect(dataUrl('packs/dictionary-core/000.txt')).toContain('/data/packs/dictionary-core/000.txt');
  });

  it('tolerates a leading slash and never doubles the separator', () => {
    expect(dataUrl('/packs/a/000.txt')).toBe(dataUrl('packs/a/000.txt'));
    expect(dataUrl('///packs/a/000.txt')).toBe(dataUrl('packs/a/000.txt'));
    expect(dataUrl('packs/a/000.txt')).not.toMatch(/\/{2,}data/);
    expect(dataUrl('packs/a/000.txt')).not.toMatch(/data\/{2,}/);
  });
});

describe('integrity primitive', () => {
  it('the environment really does provide SHA-256, so verification is not stubbed away', async () => {
    // "abc" is the published FIPS 180-2 vector for SHA-256.
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode('abc').buffer as ArrayBuffer);
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('abc')).toBe(hex);
  });
});

describe('loadManifest', () => {
  it('validates, returns and caches a well-formed manifest', async () => {
    const core = makePack('dictionary-core', '1', { 'packs/dictionary-core/000.txt': 'a\u001fb\n' });
    stubFetch(routesFor([core]), manifest([core.pack]));
    const loaded = await loadManifest();
    expect(loaded.packs.map((pack) => pack.id)).toEqual(['dictionary-core']);
    expect(await cachedManifest()).toEqual(loaded);
    // a second call must be served from IndexedDB: the stub would have to be called again
    const fetchMock = vi.mocked(fetch);
    const before = fetchMock.mock.calls.length;
    await expect(loadManifest()).resolves.toEqual(loaded);
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it('refuses a manifest that does not satisfy the schema, and names the problem', async () => {
    stubFetch({}, { schemaVersion: 2, packs: [] });
    await expect(loadManifest()).rejects.toThrowError(/not valid/i);
    await expect(loadManifest()).rejects.toThrowError(/schemaVersion/);
  });

  it('surfaces an HTTP failure instead of pretending the pack list is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response),
    );
    await expect(loadManifest()).rejects.toThrowError(/404/);
  });

  it('reports no cached manifest before one was ever loaded', async () => {
    expect(await cachedManifest()).toBeNull();
  });
});

describe('installPack: happy path', () => {
  it('stores verified bytes, marks the pack ready and reports progress', async () => {
    const core = makePack('dictionary-core', '1', {
      'packs/dictionary-core/000.txt': '中国\x1f中國\x1fzhong1 guo2\x1fzhōngguó\x1f\x1fChina\n',
      'packs/dictionary-core/001.txt': '书\x1f書\x1fshu1\x1fshū\x1f\x1fbook\n',
    });
    stubFetch(routesFor([core]), manifest([core.pack]));

    const progress: InstallProgress[] = [];
    const state = await installPack(core.pack, (update) => progress.push(update));

    expect(state.status).toBe('ready');
    expect(state.version).toBe('1');
    expect(state.files).toBe(2);
    expect(state.bytes).toBe(core.pack.files.reduce((sum, file) => sum + file.bytes, 0));
    expect(state.error).toBeUndefined();
    expect(await installedPackIds()).toEqual(['dictionary-core']);

    expect(await readPackFile('packs/dictionary-core/000.txt')).toContain('中国');
    expect(await packFilePaths('dictionary-core')).toEqual([
      'packs/dictionary-core/000.txt',
      'packs/dictionary-core/001.txt',
    ]);
    expect(await packText('dictionary-core')).toHaveLength(2);

    // one download + one store event per file, then nothing left half-done
    expect(progress.map((p) => p.phase)).toEqual(['download', 'store', 'download', 'store']);
    expect(progress.at(-1)?.files).toBe(2);
    expect(progress.at(-1)?.bytes).toBe(state.bytes);
  });

  it('replaces an older version and drops files the new manifest no longer lists', async () => {
    const v1 = makePack('dictionary-core', '1', {
      'packs/dictionary-core/000.txt': 'one\n',
      'packs/dictionary-core/001.txt': 'two\n',
    });
    stubFetch(routesFor([v1]), manifest([v1.pack]));
    await installPack(v1.pack);
    expect(await db.packFiles.count()).toBe(2);

    const v2 = makePack('dictionary-core', '2', { 'packs/dictionary-core/000.txt': 'one (revised)\n' });
    stubFetch(routesFor([v2]), manifest([v2.pack]));
    const state = await installPack(v2.pack);

    expect(state.version).toBe('2');
    expect(state.files).toBe(1);
    expect(await db.packFiles.count()).toBe(1);
    expect(await readPackFile('packs/dictionary-core/001.txt')).toBeNull();
    expect(await readPackFile('packs/dictionary-core/000.txt')).toBe('one (revised)\n');
  });

  it('serves a multi-byte pack by byte count, not character count', async () => {
    const text = '你好世界\n'; // 4 Hanzi = 12 UTF-8 bytes
    const pack = makePack('characters', '1', { 'packs/characters/000.txt': text });
    stubFetch(routesFor([pack]), manifest([pack.pack]));
    const state = await installPack(pack.pack);
    expect(pack.pack.files[0]?.bytes).toBe(13);
    expect(state.bytes).toBe(13);
  });
});

describe('installPack: failure keeps the previous version readable', () => {
  it('a checksum mismatch aborts the install and leaves v1 intact', async () => {
    const v1 = makePack('dictionary-core', '1', {
      'packs/dictionary-core/000.txt': 'the good old bytes\n',
    });
    stubFetch(routesFor([v1]), manifest([v1.pack]));
    await installPack(v1.pack);
    const readableBefore = await readPackFile('packs/dictionary-core/000.txt');

    // second file of v2 is corrupted in flight; the first one is genuinely valid
    const v2 = makePack('dictionary-core', '2', {
      'packs/dictionary-core/000.txt': 'new first file\n',
      'packs/dictionary-core/001.txt': 'new second file\n',
    });
    const tampered = v2.pack.files[1];
    if (!tampered) throw new Error('fixture must have two files');
    tampered.sha256 = sha256('something else entirely');
    const routes = routesFor([v2]);
    stubFetch(routes, manifest([v2.pack]));

    await expect(installPack(v2.pack)).rejects.toThrowError(/checksum mismatch/);

    // the half-download never reached the store
    expect(await readPackFile('packs/dictionary-core/000.txt')).toBe(readableBefore);
    expect(await readPackFile('packs/dictionary-core/001.txt')).toBeNull();
    expect(await db.packFiles.count()).toBe(1);
    // and the device knows the pack is broken, with a readable reason
    const state = await db.packs.get('dictionary-core');
    expect(state?.status).toBe('error');
    expect(state?.error).toContain('checksum mismatch');
    expect(state?.version).toBe('2');
    expect(await installedPackIds()).toEqual([]);
  });

  it('an HTTP error mid-install also keeps the previous files', async () => {
    const v1 = makePack('dictionary-core', '1', { 'packs/dictionary-core/000.txt': 'v1 bytes\n' });
    stubFetch(routesFor([v1]), manifest([v1.pack]));
    await installPack(v1.pack);

    const v2 = makePack('dictionary-core', '2', {
      'packs/dictionary-core/000.txt': 'v2 first\n',
      'packs/dictionary-core/001.txt': 'v2 second\n',
    });
    const routes = routesFor([v2]);
    delete routes[dataUrl('packs/dictionary-core/001.txt')]; // 404 on the second file
    stubFetch(routes, manifest([v2.pack]));

    await expect(installPack(v2.pack)).rejects.toThrowError(/HTTP 404/);
    expect(await readPackFile('packs/dictionary-core/000.txt')).toBe('v1 bytes\n');
    expect((await db.packs.get('dictionary-core'))?.status).toBe('error');
  });

  it('a pack that never installed before simply has nothing to roll back to', async () => {
    const pack = makePack('examples', '1', { 'packs/examples/000.txt': 'x\n' });
    const first = pack.pack.files[0];
    if (!first) throw new Error('fixture must have one file');
    first.sha256 = sha256('a different payload');
    stubFetch(routesFor([pack]), manifest([pack.pack]));
    await expect(installPack(pack.pack)).rejects.toThrowError(/checksum mismatch/);
    expect(await db.packFiles.count()).toBe(0);
    expect(await readPackFile('packs/examples/000.txt')).toBeNull();
  });
});

describe('self-healing packs (D-05)', () => {
  it('calling packText when IndexedDB is empty automatically fetches, verifies SHA-256, stores in IndexedDB and returns text', async () => {
    const core = makePack('dictionary-core', '1', {
      'packs/dictionary-core/000.txt': '中国\x1f中國\x1fzhong1 guo2\x1fzhōngguó\x1fzhongguo\x1fChina\x1fTrung Quốc\x1ftrung quốc\n',
      'packs/dictionary-core/001.txt': '书\x1f書\x1fshu1\x1fshū\x1fshu\x1fbook\x1fsách\x1fthư\n',
    });
    stubFetch(routesFor([core]), manifest([core.pack]));

    expect(await db.packs.count()).toBe(0);
    expect(await db.packFiles.count()).toBe(0);

    const texts = await packText('dictionary-core');
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain('中国');
    expect(texts[1]).toContain('书');

    const state = await db.packs.get('dictionary-core');
    expect(state?.status).toBe('ready');
    expect(await db.packFiles.count()).toBe(2);
  });

  it('calling readPackFile for an uninstalled pack automatically installs its owning pack and returns the file text', async () => {
    const strokes = makePack(
      'strokes',
      '1',
      {
        'packs/strokes/index.txt': '中\x1f000.jsonl\n',
        'packs/strokes/000.jsonl': '{"c":"中","s":["M 0 0 L 1 1"],"m":[[0,0,1,1]]}\n',
      },
      { kind: 'strokes', required: false },
    );
    stubFetch(routesFor([strokes]), manifest([strokes.pack]));

    expect(await db.packFiles.count()).toBe(0);
    const indexText = await readPackFile('packs/strokes/index.txt');
    expect(indexText).toBe('中\x1f000.jsonl\n');
    expect((await db.packs.get('strokes'))?.status).toBe('ready');
    expect(await db.packFiles.count()).toBe(2);
  });

  it('concurrent calls for the same uninstalled pack trigger only 1 fetch per file', async () => {
    const core = makePack('dictionary-core', '1', {
      'packs/dictionary-core/000.txt': '汉语\x1f漢語\x1fhan4 yu3\x1fHànyǔ\x1fhanyu\x1fChinese language\x1ftiếng Hán\x1fhán ngữ\n',
      'packs/dictionary-core/001.txt': '忙\x1f忙\x1fmang2\x1fmáng\x1fmang\x1fbusy\x1fbận\x1fmang\n',
    });
    stubFetch(routesFor([core]), manifest([core.pack]));
    await loadManifest();

    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();

    const results = await Promise.all([
      packText('dictionary-core'),
      packText('dictionary-core'),
      readPackFile('packs/dictionary-core/000.txt'),
      readPackFile('packs/dictionary-core/001.txt'),
      ensurePackInstalled('dictionary-core'),
    ]);

    expect(results[0]).toHaveLength(2);
    expect(results[1]).toHaveLength(2);
    expect(results[2]).toContain('汉语');
    expect(results[3]).toContain('忙');

    const packFileCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/packs/dictionary-core/'));
    expect(packFileCalls).toHaveLength(2); // 1 fetch for 000.txt and 1 fetch for 001.txt
  });
});

describe('uninstallPack', () => {
  it('removes both the content and the install state', async () => {
    const keep = makePack('dictionary-core', '1', { 'packs/dictionary-core/000.txt': 'core\n' });
    const drop = makePack('examples', '1', {
      'packs/examples/000.txt': 'a\n',
      'packs/examples/001.txt': 'b\n',
    });
    const routes = { ...routesFor([keep]), ...routesFor([drop]) };
    stubFetch(routes, manifest([keep.pack, drop.pack]));
    await installPack(keep.pack);
    await installPack(drop.pack);
    expect(await db.packFiles.count()).toBe(3);

    await uninstallPack('examples');
    expect(await db.packFiles.count()).toBe(1);
    expect(await db.packs.get('examples')).toBeUndefined();
    expect(await installedPackIds()).toEqual(['dictionary-core']);
    // uninstalling something not installed is not an error
    await expect(uninstallPack('never-installed')).resolves.toBeUndefined();
  });
});

describe('packOverview', () => {
  it('marks each manifest pack installed only at its own version', async () => {
    const ready = makePack('dictionary-core', '1', { 'packs/dictionary-core/000.txt': 'core\n' });
    const stale = makePack('characters', '1', { 'packs/characters/000.txt': 'chars\n' });
    const optional = makePack('examples', '1', { 'packs/examples/000.txt': 'ex\n' }, { required: false });
    const routes = { ...routesFor([ready]), ...routesFor([stale]), ...routesFor([optional]) };
    stubFetch(routes, manifest([ready.pack, stale.pack, optional.pack]));
    await loadManifest();
    await installPack(ready.pack);
    await installPack(stale.pack);
    // then the characters pack gets a new manifest version and the app re-reads the manifest
    const upgraded = makePack('characters', '2', { 'packs/characters/000.txt': 'chars v2\n' });
    stubFetch({ ...routes, ...routesFor([upgraded]) }, manifest([ready.pack, upgraded.pack, optional.pack]));
    await loadManifest(true); // a cached manifest is trusted, so an update check must force a reload

    const overview = await packOverview();
    expect(overview.map((row) => [row.pack.id, row.installed])).toEqual([
      ['dictionary-core', true],
      ['characters', false],
      ['examples', false],
    ]);
    expect(overview.find((row) => row.pack.id === 'dictionary-core')?.state?.status).toBe('ready');
    expect(overview.find((row) => row.pack.id === 'examples')?.state).toBeUndefined();
  });

  it('reads the cached manifest offline instead of hitting the network again', async () => {
    const core = makePack('dictionary-core', '1', { 'packs/dictionary-core/000.txt': 'core\n' });
    stubFetch(routesFor([core]), manifest([core.pack]));
    await loadManifest();
    const offline = vi.fn(async () => {
      throw new TypeError('failed to fetch');
    });
    vi.stubGlobal('fetch', offline);
    const overview = await packOverview();
    expect(offline).not.toHaveBeenCalled();
    expect(overview.map((row) => row.pack.id)).toEqual(['dictionary-core']);
  });
});

describe('ensureRequiredPacks', () => {
  it('installs every required pack exactly once and skips ready versions', async () => {
    const core = makePack('dictionary-core', '1', { 'packs/dictionary-core/000.txt': 'core\n' });
    const chars = makePack('characters', '1', { 'packs/characters/000.txt': 'chars\n' });
    const optional = makePack('examples', '1', { 'packs/examples/000.txt': 'ex\n' }, { required: false });
    const routes = { ...routesFor([core]), ...routesFor([chars]), ...routesFor([optional]) };
    stubFetch(routes, manifest([core.pack, chars.pack, optional.pack]));

    expect(await ensureRequiredPacks()).toEqual(['dictionary-core', 'characters']);
    const fetchMock = vi.mocked(fetch);
    const callsAfterFirstRun = fetchMock.mock.calls.length;

    // second run: both are ready at the manifest version, so nothing is fetched for them
    expect(await ensureRequiredPacks()).toEqual([]);
    expect(vi.mocked(fetch).mock.calls.filter((call) => String(call[0]).includes('/packs/'))).toHaveLength(2);
    expect(callsAfterFirstRun).toBeGreaterThan(0);
    expect(await installedPackIds()).toEqual(['characters', 'dictionary-core']); // primary-key order
  });

  it('re-installs a pack whose recorded version is behind the manifest', async () => {
    const v1 = makePack('dictionary-core', '1', { 'packs/dictionary-core/000.txt': 'one\n' });
    stubFetch(routesFor([v1]), manifest([v1.pack]));
    await ensureRequiredPacks();

    const v2 = makePack('dictionary-core', '2', { 'packs/dictionary-core/000.txt': 'two\n' });
    stubFetch(routesFor([v2]), manifest([v2.pack]));
    await loadManifest(true); // an update check re-reads the registry; boot alone trusts the cache
    expect(await ensureRequiredPacks()).toEqual(['dictionary-core']);
    expect(await readPackFile('packs/dictionary-core/000.txt')).toBe('two\n');
  });

  it('retries a pack left in the error state', async () => {
    const broken = makePack('dictionary-core', '1', { 'packs/dictionary-core/000.txt': 'bytes\n' });
    const first = broken.pack.files[0];
    if (!first) throw new Error('fixture must have one file');
    const goodText = broken.bodies['packs/dictionary-core/000.txt'] ?? '';
    first.sha256 = sha256(`${goodText}corrupted`);
    stubFetch(routesFor([broken]), manifest([broken.pack]));
    await expect(ensureRequiredPacks()).rejects.toThrowError(/checksum mismatch/);
    expect((await db.packs.get('dictionary-core'))?.status).toBe('error');

    const fixed = makePack('dictionary-core', '1', { 'packs/dictionary-core/000.txt': goodText });
    stubFetch(routesFor([fixed]), manifest([fixed.pack]));
    await loadManifest(true); // drop the cached manifest that still names the corrupt checksum
    expect(await ensureRequiredPacks()).toEqual(['dictionary-core']);
    expect((await db.packs.get('dictionary-core'))?.status).toBe('ready');
  });

  it('reports nothing to install when the manifest lists no required packs', async () => {
    const optional = makePack('examples', '1', { 'packs/examples/000.txt': 'ex\n' }, { required: false });
    stubFetch(routesFor([optional]), manifest([optional.pack]));
    expect(await ensureRequiredPacks()).toEqual([]);
    expect(await installedPackIds()).toEqual([]);
  });
});

describe('storage accounting', () => {
  it('sums installed bytes and counts distinct packs', async () => {
    const core = makePack('dictionary-core', '1', {
      'packs/dictionary-core/000.txt': '0123456789\n',
      'packs/dictionary-core/001.txt': 'abc\n',
    });
    const chars = makePack('characters', '1', { 'packs/characters/000.txt': '你好\n' });
    stubFetch({ ...routesFor([core]), ...routesFor([chars]) }, manifest([core.pack, chars.pack]));
    expect(await storageUsage()).toMatchObject({ installedBytes: 0, packCount: 0, persisted: false });

    await installPack(core.pack);
    await installPack(chars.pack);
    const usage = await storageUsage();
    expect(usage.installedBytes).toBe(11 + 4 + 7);
    expect(usage.packCount).toBe(2);
    expect(usage.usageBytes).toBeUndefined(); // no StorageManager in this environment
  });

  it('reports persistence as unsupported rather than claiming it', async () => {
    expect(await requestPersistence()).toEqual({ persisted: false, reason: 'unsupported' });
  });
});

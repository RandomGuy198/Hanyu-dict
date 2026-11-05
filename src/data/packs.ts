/** Pack installation: download, hash-verify, install atomically, roll back on failure.
 *
 *  Packs are content, not code: nothing here executes fetched text, and the manifest is
 *  validated with zod before any path is fetched (paths must stay inside data/). */

import { packManifestSchema, formatIssues } from './schema';
import { db, setMeta, getMeta } from './db';
import type { PackDescriptor, PackInstallState, PackManifest } from '../domain/types';

const MANIFEST_KEY = 'pack-manifest';

export interface InstallProgress {
  packId: string;
  file: number;
  files: number;
  bytes: number;
  totalBytes: number;
  phase: 'download' | 'verify' | 'store' | 'done';
}

export function dataUrl(relativePath: string): string {
  const base = (import.meta.env.BASE_URL || './').replace(/\/+$/, '');
  return `${base}/data/${relativePath.replace(/^\/+/, '')}`;
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      'This browser cannot verify download integrity (Web Crypto needs a secure context). ' +
        'Open the site over https:// or on localhost.',
    );
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function loadManifest(force = false): Promise<PackManifest> {
  if (!force) {
    const cached = await getMeta<PackManifest>(MANIFEST_KEY);
    if (cached) {
      const parsed = packManifestSchema.safeParse(cached);
      if (parsed.success) return parsed.data as PackManifest;
    }
  }
  const response = await fetch(dataUrl('manifest.json'), { cache: 'default' });
  if (!response.ok) throw new Error(`Manifest request failed (${response.status})`);
  const json: unknown = await response.json();
  const parsed = packManifestSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Pack manifest is not valid:\n${formatIssues(parsed.error)}`);
  }
  const manifest = parsed.data as PackManifest;
  await setMeta(MANIFEST_KEY, manifest);
  return manifest;
}

/** Read a manifest that was previously cached in IndexedDB, so a fully installed app still
 *  knows its pack versions with no network at all. */
export async function cachedManifest(): Promise<PackManifest | null> {
  const cached = await getMeta<PackManifest>(MANIFEST_KEY);
  if (!cached) return null;
  const parsed = packManifestSchema.safeParse(cached);
  return parsed.success ? (parsed.data as PackManifest) : null;
}

export function packById(manifest: PackManifest, id: string): PackDescriptor | undefined {
  return manifest.packs.find((pack) => pack.id === id);
}

export interface StorageUsage {
  installedBytes: number;
  packCount: number;
  persisted: boolean;
  usageBytes?: number;
  quotaBytes?: number;
}

export async function storageUsage(): Promise<StorageUsage> {
  const rows = await db.packFiles.toArray();
  const installedBytes = rows.reduce((sum, row) => sum + row.bytes, 0);
  const persisted = await (globalThis.navigator as Navigator | undefined)?.storage?.persisted?.();
  let usageBytes: number | undefined;
  let quotaBytes: number | undefined;
  if (navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate();
    usageBytes = estimate.usage;
    quotaBytes = estimate.quota;
  }
  return {
    installedBytes,
    packCount: new Set(rows.map((row) => row.packId)).size,
    persisted: Boolean(persisted),
    usageBytes,
    quotaBytes,
  };
}

/** Ask for durable storage; a denial is reported, never hidden. */
export async function requestPersistence(): Promise<{ persisted: boolean; reason?: string }> {
  if (!navigator.storage?.persist) return { persisted: false, reason: 'unsupported' };
  try {
    return { persisted: await navigator.storage.persist() };
  } catch (error) {
    return { persisted: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Install one pack. The previous version stays readable until every new file is verified,
 *  so an interrupted or corrupt download cannot leave the dictionary half-installed. */
export async function installPack(
  pack: PackDescriptor,
  onProgress?: (progress: InstallProgress) => void,
): Promise<PackInstallState> {
  const totalBytes = pack.bytes;
  let downloaded = 0;
  const staging: { path: string; sha256: string; bytes: number; text: string }[] = [];

  await db.packs.put({
    id: pack.id,
    version: pack.version,
    kind: pack.kind,
    installedAt: new Date().toISOString(),
    bytes: 0,
    files: 0,
    status: 'installing',
  });

  try {
    for (const [index, file] of pack.files.entries()) {
      const response = await fetch(dataUrl(file.path), { cache: 'default' });
      if (!response.ok) throw new Error(`${file.path}: HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      downloaded += buffer.byteLength;
      onProgress?.({
        packId: pack.id,
        file: index + 1,
        files: pack.files.length,
        bytes: downloaded,
        totalBytes,
        phase: 'download',
      });
      const digest = await sha256Hex(buffer);
      if (digest !== file.sha256) {
        throw new Error(
          `${file.path}: checksum mismatch (expected ${file.sha256.slice(0, 12)}…, got ${digest.slice(0, 12)}…)`,
        );
      }
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
      staging.push({ path: file.path, sha256: file.sha256, bytes: file.bytes, text });
      onProgress?.({
        packId: pack.id,
        file: index + 1,
        files: pack.files.length,
        bytes: downloaded,
        totalBytes,
        phase: 'store',
      });
    }

    // All bytes verified: swap the pack over in one transaction.
    await db.transaction('rw', db.packFiles, db.packs, async () => {
      const stale = await db.packFiles.where('packId').equals(pack.id).toArray();
      const keep = new Set(staging.map((row) => row.path));
      for (const row of stale) {
        if (!keep.has(row.path)) await db.packFiles.delete(row.path);
      }
      await db.packFiles.bulkPut(staging.map((row) => ({ ...row, packId: pack.id })));
      const state: PackInstallState = {
        id: pack.id,
        version: pack.version,
        kind: pack.kind,
        installedAt: new Date().toISOString(),
        bytes: staging.reduce((sum, row) => sum + row.bytes, 0),
        files: staging.length,
        status: 'ready',
      };
      await db.packs.put(state);
    });

    const state = await db.packs.get(pack.id);
    return state!;
  } catch (error) {
    await db.packs.put({
      id: pack.id,
      version: pack.version,
      kind: pack.kind,
      installedAt: new Date().toISOString(),
      bytes: 0,
      files: 0,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function uninstallPack(id: string): Promise<void> {
  await db.transaction('rw', db.packFiles, db.packs, async () => {
    await db.packFiles.where('packId').equals(id).delete();
    await db.packs.delete(id);
  });
}

export async function installedPackIds(): Promise<string[]> {
  const ready = await db.packs.filter((pack) => pack.status === 'ready').toArray();
  return ready.map((pack) => pack.id);
}

export interface PackOverview {
  pack: PackDescriptor;
  state?: PackInstallState;
  installed: boolean;
}

export async function packOverview(): Promise<PackOverview[]> {
  const manifest = (await cachedManifest()) ?? (await loadManifest());
  const states = await db.packs.toArray();
  return manifest.packs.map((pack) => {
    const state = states.find((entry) => entry.id === pack.id);
    return { pack, state, installed: state?.status === 'ready' && state.version === pack.version };
  });
}

/** Install anything marked required that is not already present at the manifest version. */
export async function ensureRequiredPacks(
  onProgress?: (progress: InstallProgress) => void,
): Promise<string[]> {
  const manifest = await loadManifest();
  const states = await db.packs.toArray();
  const missing = manifest.packs.filter((pack) => {
    if (!pack.required) return false;
    const state = states.find((entry) => entry.id === pack.id);
    return !state || state.status !== 'ready' || state.version !== pack.version;
  });
  for (const pack of missing) await installPack(pack, onProgress);
  return missing.map((pack) => pack.id);
}

/** Paths of an installed pack's files, in manifest order. */
export async function packFilePaths(packId: string): Promise<string[]> {
  const manifest = (await cachedManifest()) ?? (await loadManifest());
  const pack = packById(manifest, packId);
  if (!pack) return [];
  return pack.files.map((file) => file.path);
}

const inflightInstalls = new Map<string, Promise<PackInstallState>>();

function installPackOnce(pack: PackDescriptor): Promise<PackInstallState> {
  const existing = inflightInstalls.get(pack.id);
  if (existing) return existing;
  const promise = installPack(pack).finally(() => {
    inflightInstalls.delete(pack.id);
  });
  inflightInstalls.set(pack.id, promise);
  return promise;
}

/** Ensure a pack is installed and all of its files exist in IndexedDB at the manifest version. */
export async function ensurePackInstalled(packId: string): Promise<void> {
  const manifest = (await cachedManifest()) ?? (await loadManifest());
  const pack = packById(manifest, packId);
  if (!pack) return;
  const state = await db.packs.get(packId);
  if (state && state.status === 'ready' && state.version === pack.version) {
    const paths = pack.files.map((file) => file.path);
    const rows = await db.packFiles.bulkGet(paths);
    if (rows.length === paths.length && rows.every(Boolean)) {
      return;
    }
  }
  await installPackOnce(pack);
}

/** Read one stored pack file by its manifest path, auto-installing its owning pack if needed. */
export async function readPackFile(path: string): Promise<string | null> {
  const existing = await db.packFiles.get(path);
  if (existing) return existing.text;

  try {
    const manifest = (await cachedManifest()) ?? (await loadManifest());
    let owningPack = manifest.packs.find((pack) => pack.files.some((file) => file.path === path));
    if (!owningPack) {
      const match = /^packs\/([^/]+)\//.exec(path);
      if (match) owningPack = packById(manifest, match[1]);
    }
    if (owningPack && owningPack.files.some((file) => file.path === path)) {
      await ensurePackInstalled(owningPack.id);
      const row = await db.packFiles.get(path);
      return row ? row.text : null;
    }
  } catch {
    // If manifest cannot be loaded, fall back to null.
  }
  return null;
}

/** Text of every file in a pack, in manifest order (auto-installing the pack if needed). */
export async function packText(packId: string): Promise<string[]> {
  try {
    await ensurePackInstalled(packId);
  } catch {
    // Fall back to whatever is already stored if auto-install fails.
  }
  const paths = await packFilePaths(packId);
  const rows = await db.packFiles.bulkGet(paths);
  return rows.filter((row): row is NonNullable<typeof row> => Boolean(row)).map((row) => row.text);
}

export async function clearAllData(): Promise<void> {
  inflightInstalls.clear();
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
}

/** Versioned export/import of user data. Dictionary packs are never included: they are
 *  replaceable content and are re-downloaded from this site instead. */

import { db, USER_STORES, type UserStore } from './db';
import { backupFileSchema, formatIssues, EXPORT_VERSION, type BackupFile } from './schema';

export interface BackupSummary {
  stores: Record<string, number>;
  totalRows: number;
  bytes: number;
}

export interface ImportReport {
  applied: number;
  conflicts: number;
  skipped: number;
  stores: string[];
}

export async function buildBackup(): Promise<BackupFile> {
  const data: Record<string, unknown[]> = {};
  const stores: Record<string, number> = {};
  for (const store of USER_STORES) {
    const rows = (await db.table(store).toArray()) as unknown[];
    data[store] = rows;
    stores[store] = rows.length;
  }
  return {
    app: 'hanyu-web',
    exportVersion: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    counts: stores,
    data,
  };
}

export async function exportBackupBlob(): Promise<{ blob: Blob; summary: BackupSummary }> {
  const backup = await buildBackup();
  const text = JSON.stringify(backup, null, 2);
  const totalRows = Object.values(backup.counts ?? {}).reduce((a, b) => a + b, 0);
  return {
    blob: new Blob([text], { type: 'application/json' }),
    summary: { stores: backup.counts ?? {}, totalRows, bytes: text.length },
  };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function defaultBackupName(date = new Date()): string {
  const stamp = date.toISOString().slice(0, 10);
  return `hanyu-backup-${stamp}.json`;
}

export function parseBackup(text: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const parsed = backupFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Not a Hanyu Dictionary backup:\n${formatIssues(parsed.error)}`);
  }
  const backup = parsed.data as BackupFile;
  if (backup.exportVersion > EXPORT_VERSION) {
    throw new Error(
      `That backup was written by a newer schema (v${backup.exportVersion}). This app reads v${EXPORT_VERSION}.`,
    );
  }
  return backup;
}

/** The primary key property of every exported store, spelled out rather than introspected:
 *  a backup is a file format, so its key handling must stay explicit and reviewable. */
const PRIMARY_KEYS: Record<UserStore, string> = {
  preferences: 'id',
  searchHistory: 'id',
  savedWords: 'id',
  wordLists: 'id',
  notebooks: 'id',
  categories: 'id',
  notebookEntries: 'id',
  decks: 'id',
  cards: 'id',
  attempts: 'id',
  sessions: 'id',
  activity: 'day',
  achievements: 'id',
  documents: 'id',
  photos: 'id',
};

function isNewer(candidate: Record<string, unknown>, existing: Record<string, unknown>): boolean {
  const stampOf = (row: Record<string, unknown>) =>
    Date.parse(String(row.updatedAt ?? row.addedAt ?? row.lastReviewed ?? row.at ?? row.day ?? '')) || 0;
  return stampOf(candidate) >= stampOf(existing);
}

/** Replace or merge. Merging keeps the newer record per key and counts every collision so the
 *  UI can say exactly what happened instead of silently overwriting. */
export async function importBackup(
  backup: BackupFile,
  mode: 'merge' | 'replace',
): Promise<ImportReport> {
  const report: ImportReport = { applied: 0, conflicts: 0, skipped: 0, stores: [] };
  const writable = USER_STORES.filter((store) => store in backup.data) as UserStore[];

  await db.transaction('rw', db.tables, async () => {
    for (const store of writable) {
      const table = db.table(store);
      const rows = (backup.data[store] ?? []) as Record<string, unknown>[];
      if (mode === 'replace' && store !== 'preferences') await table.clear();
      for (const row of rows) {
        const keyValue = row[PRIMARY_KEYS[store]];
        const keyValid =
          keyValue !== undefined &&
          keyValue !== null &&
          (Array.isArray(keyValue) ? keyValue.length > 0 : true);
        if (!keyValid) {
          report.skipped += 1;
          continue;
        }
        if (mode === 'merge') {
          const existing = (await table.get(keyValue as never)) as Record<string, unknown> | undefined;
          if (existing) {
            report.conflicts += 1;
            if (!isNewer(row, existing)) {
              report.skipped += 1;
              continue;
            }
          }
        }
        await table.put(row as never);
        report.applied += 1;
      }
      if (rows.length > 0) report.stores.push(store);
    }
  });
  return report;
}

export async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsText(file, 'utf-8');
  });
}

/** Guard against a stray huge file before we even try to parse it. */
export const MAX_IMPORT_BYTES = 32 * 1024 * 1024;

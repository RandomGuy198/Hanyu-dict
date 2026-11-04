/** `/data` — manual backup and restore of user data only, entirely on this device.
 *
 *  There is no account, no server and no sync anywhere in this app: exporting writes a JSON file
 *  through the browser’s own download, importing reads a file you pick, and nothing leaves the
 *  device unless you save that file yourself. Dictionary and content packs are never exported —
 *  they are replaceable content re-downloaded from this site (see `/offline-data`). Every count
 *  shown here is read straight from IndexedDB via `buildBackup()`. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog, PageHeader } from '../../components';
import { IconAlert, IconDownload, IconTrash } from '../../app/icons';
import { formatBytes } from '../../app/hooks';
import { useToast } from '../../app/providers';
import { USER_STORES, type UserStore } from '../../data/db';
import {
  buildBackup,
  defaultBackupName,
  downloadBlob,
  importBackup,
  MAX_IMPORT_BYTES,
  parseBackup,
  readFileAsText,
  type ImportReport,
} from '../../data/exportImport';
import { clearAllData } from '../../data/packs';
import { EXPORT_VERSION, type BackupFile } from '../../data/schema';
import './data.css';

const STORE_LABELS: Record<UserStore, string> = {
  preferences: 'Settings',
  searchHistory: 'Search history',
  savedWords: 'Saved words',
  wordLists: 'Word lists',
  notebooks: 'Notebooks',
  categories: 'Notebook categories',
  notebookEntries: 'Notes',
  decks: 'Flashcard decks',
  cards: 'Flashcard schedule',
  attempts: 'Practice answers',
  sessions: 'Practice sessions',
  activity: 'Daily activity',
  achievements: 'Achievements',
  documents: 'Imported documents',
  photos: 'Camera captures',
};

/** Plain-language list of what the export file actually holds, so the user is never guessing. */
const FILE_CONTENTS =
  'your settings, saved words, word lists, notebooks and notes, flashcard decks and their schedule, ' +
  'practice answers and sessions, daily activity, achievements, search history, and the records of ' +
  'imported documents and camera captures';

type ImportMode = 'merge' | 'replace';

interface BackupPreview {
  backup: BackupFile;
  counts: Record<string, number>;
  totalRows: number;
}

interface ParsedFile {
  name: string;
  bytes: number;
  backup: BackupFile;
}

function countRows(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, value) => sum + (value ?? 0), 0);
}

export default function DataPage() {
  const toast = useToast();

  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [lastExport, setLastExport] = useState<{ name: string; rows: number; bytes: number } | null>(null);

  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mode, setMode] = useState<ImportMode>('merge');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [needsPrefReload, setNeedsPrefReload] = useState(false);

  const [eraseText, setEraseText] = useState('');
  const [eraseOpen, setEraseOpen] = useState(false);
  const [erased, setErased] = useState(false);

  const refreshPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const backup = await buildBackup();
      const counts = backup.counts ?? {};
      setPreview({ backup, counts, totalRows: countRows(counts) });
      setPreviewError(null);
    } catch (error) {
      setPreview(null);
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshPreview();
  }, [refreshPreview]);

  const doExport = useCallback(async () => {
    setExportBusy(true);
    setExportError(null);
    try {
      const backup = preview?.backup ?? (await buildBackup());
      const text = JSON.stringify(backup, null, 2);
      const name = defaultBackupName();
      downloadBlob(new Blob([text], { type: 'application/json' }), name);
      const rows = countRows(backup.counts ?? {});
      setLastExport({ name, rows, bytes: text.length });
      toast.push({
        message: `Backup written: ${rows} record${rows === 1 ? '' : 's'}, ${formatBytes(text.length)}`,
        tone: 'info',
      });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
      toast.push({ message: 'Export failed', tone: 'danger' });
    } finally {
      setExportBusy(false);
    }
  }, [preview, toast]);

  const onPick = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      setParsed(null);
      setReport(null);
      setImportError(null);
      setNeedsPrefReload(false);
      if (!file) return;
      if (file.size > MAX_IMPORT_BYTES) {
        setImportError(
          `“${file.name}” is ${formatBytes(file.size)}. This app refuses files larger than ${formatBytes(
            MAX_IMPORT_BYTES,
          )}. A backup of your own records is normally only a few hundred kilobytes, so a file this big is probably not one.`,
        );
        return;
      }
      setImportBusy(true);
      try {
        const text = await readFileAsText(file);
        const backup = parseBackup(text);
        setParsed({ name: file.name, bytes: file.size, backup });
        toast.push({ message: 'File validated. Choose merge or replace, then import.', tone: 'info' });
      } catch (error) {
        setImportError(error instanceof Error ? error.message : String(error));
      } finally {
        setImportBusy(false);
      }
    },
    [toast],
  );

  const runImport = useCallback(async () => {
    if (!parsed) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const result = await importBackup(parsed.backup, mode);
      setReport(result);
      setNeedsPrefReload('preferences' in parsed.backup.data);
      toast.push({
        message: `Imported ${result.applied} record${result.applied === 1 ? '' : 's'} (${mode})`,
        tone: result.skipped > 0 ? 'warn' : 'info',
      });
      void refreshPreview();
    } catch (error) {
      setImportError(
        `Could not write the imported records: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setImportBusy(false);
      setReplaceOpen(false);
    }
  }, [mode, parsed, refreshPreview, toast]);

  const doErase = useCallback(async () => {
    setEraseOpen(false);
    try {
      await clearAllData();
      setErased(true);
      setEraseText('');
      setParsed(null);
      setReport(null);
      setLastExport(null);
      toast.push({ message: 'Every record on this device was erased', tone: 'warn' });
      void refreshPreview();
    } catch (error) {
      toast.push({
        message: `Erase failed: ${error instanceof Error ? error.message : String(error)}`,
        tone: 'danger',
      });
    }
  }, [refreshPreview, toast]);

  const parsedStores = useMemo(() => {
    if (!parsed) return [] as { store: UserStore; rows: number }[];
    return USER_STORES.filter((store) => store in parsed.backup.data).map((store) => ({
      store,
      rows: (parsed.backup.data[store] ?? []).length,
    }));
  }, [parsed]);

  /** Stores a `replace` import clears before writing, per the rules in `importBackup`. */
  const overwriteStores = useMemo(
    () =>
      USER_STORES.filter(
        (store) => store !== 'preferences' && store in (parsed?.backup.data ?? {}),
      ),
    [parsed],
  );

  return (
    <div className="stack">
      <PageHeader
        title="Backup & restore"
        subtitle="Your own records only, written and read as files on this device."
      />

      <div className="notice notice-info">
        <IconDownload />
        <div>
          <strong>Backups are files you keep — there is no cloud copy.</strong>
          <p className="text-sm">
            This app has no account, no server and no automatic sync. Exporting hands a JSON file to
            your browser&rsquo;s download; importing reads a file you choose. Nothing leaves the
            device unless you save that file yourself, and a backup sitting in your downloads folder
            is the only copy. Data packs are not included: they are re-downloaded from{' '}
            <Link to="/offline-data">offline data</Link>.
          </p>
        </div>
      </div>

      <section className="card data-section" aria-labelledby="data-export">
        <div className="data-section-head">
          <h2 id="data-export">Export a backup</h2>
          <span className="spacer" />
          <span className="data-count">
            {previewLoading
              ? 'Counting records…'
              : preview
                ? `${preview.totalRows} record${preview.totalRows === 1 ? '' : 's'} ready to write`
                : 'Could not count'}
          </span>
        </div>

        {previewError ? (
          <div className="notice notice-danger" role="alert">
            <IconAlert />
            <div>
              <strong>The local records could not be read</strong>
              <p className="text-sm">{previewError}</p>
            </div>
          </div>
        ) : null}

        {preview ? (
          <div className="data-scroll">
            <table className="table">
              <caption className="visually-hidden">
                Row count per store in the backup about to be written
              </caption>
              <thead>
                <tr>
                  <th scope="col">Store</th>
                  <th scope="col">Records</th>
                </tr>
              </thead>
              <tbody>
                {USER_STORES.map((store) => (
                  <tr key={store}>
                    <td>{STORE_LABELS[store]}</td>
                    <td className="data-num">{(preview.counts[store] ?? 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <p className="data-help">
          The file will contain {FILE_CONTENTS}. It does not contain the dictionary or content packs.
        </p>
        <div className="data-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={exportBusy || previewLoading || preview === null}
            onClick={() => void doExport()}
          >
            <IconDownload /> Export backup file
          </button>
          {lastExport ? (
            <span className="data-status" role="status" aria-live="polite">
              Wrote {lastExport.name} ({lastExport.rows} records, {formatBytes(lastExport.bytes)}).
              Check your browser&rsquo;s downloads folder.
            </span>
          ) : null}
        </div>
        {exportError ? (
          <div className="notice notice-danger" role="alert">
            <IconAlert />
            <div>{exportError}</div>
          </div>
        ) : null}
      </section>

      <section className="card data-section" aria-labelledby="data-import">
        <div className="data-section-head">
          <h2 id="data-import">Import a backup file</h2>
        </div>
        <div className="field">
          <label htmlFor="data-file">Backup file (.json)</label>
          <input
            id="data-file"
            className="input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void onPick(event)}
          />
          <span className="help">
            Read locally, never uploaded, and refused if larger than {formatBytes(MAX_IMPORT_BYTES)}.
            The file is validated against the backup schema (v{EXPORT_VERSION}) before a single
            record is written.
          </span>
        </div>

        {importBusy && !parsed ? (
          <p className="data-status" role="status" aria-live="polite">
            Reading and validating the file…
          </p>
        ) : null}

        {importError ? (
          <div className="notice notice-danger" role="alert">
            <IconAlert />
            <div>
              <strong>This file was refused</strong>
              <pre className="data-code">{importError}</pre>
            </div>
          </div>
        ) : null}

        {parsed ? (
          <>
            <p className="data-status" role="status">
              {parsed.name} · {formatBytes(parsed.bytes)} · exported {parsed.backup.exportedAt} ·
              schema v{parsed.backup.exportVersion}
            </p>
            <ul className="data-list" aria-label="Records found in this file">
              {parsedStores.length === 0 ? (
                <li>
                  <span className="muted">
                    This is a valid backup but it holds no records for any store this app knows.
                  </span>
                </li>
              ) : (
                parsedStores.map((entry) => (
                  <li key={entry.store}>
                    <strong>{STORE_LABELS[entry.store]}</strong>
                    <span className="data-num">{entry.rows.toLocaleString()} record(s)</span>
                  </li>
                ))
              )}
            </ul>

            <fieldset className="data-choices">
              <legend>How should it be imported?</legend>
              <label className="data-choice">
                <input
                  type="radio"
                  name="data-mode"
                  value="merge"
                  checked={mode === 'merge'}
                  onChange={() => setMode('merge')}
                />
                <span>
                  <strong>Merge</strong> — keep everything on this device and add what is in the file.
                  When the same id exists on both sides, the newer record wins (compared by updatedAt,
                  addedAt, lastReviewed or the session/day stamp); a record only in the file is added,
                  and nothing on this device is deleted.
                </span>
              </label>
              <label className="data-choice">
                <input
                  type="radio"
                  name="data-mode"
                  value="replace"
                  checked={mode === 'replace'}
                  onChange={() => setMode('replace')}
                />
                <span>
                  <strong>Replace</strong> — clear each store the file touches first, then write its
                  records. Anything on this device that is not in the file is lost in those stores
                  (settings are updated, not cleared). This needs a second confirmation.
                </span>
              </label>
            </fieldset>

            <div className="data-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={importBusy || parsedStores.length === 0}
                onClick={() => (mode === 'replace' ? setReplaceOpen(true) : void runImport())}
              >
                {importBusy ? 'Importing…' : `Import (${mode})`}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setParsed(null);
                  setReport(null);
                }}
              >
                Discard this file
              </button>
            </div>
          </>
        ) : null}

        {report ? (
          <div className="notice notice-info" role="status" aria-live="polite">
            <div>
              <strong>Import finished ({report.stores.length} store(s) touched)</strong>
              <p className="text-sm data-num">
                {report.applied} written · {report.conflicts} collided with an existing id ·{' '}
                {report.skipped} skipped (older or keyless records)
              </p>
              <p className="text-sm faint">
                No record was sent anywhere; this read and wrote only this device&rsquo;s database.
              </p>
            </div>
          </div>
        ) : null}

        {needsPrefReload ? (
          <p className="notice notice-warn text-sm" role="status">
            Restored settings are saved in the database, but this tab still holds the old ones. Close
            and reopen the app (or reload the page) to apply them.
          </p>
        ) : null}
      </section>

      <section className="card data-section" aria-labelledby="data-erase">
        <div className="data-section-head">
          <h2 id="data-erase">Erase everything on this device</h2>
        </div>
        <p className="data-help">
          This clears every table in this browser&rsquo;s database: settings, saved words, lists,
          notes, decks, history, achievements, imported-document and photo records,{' '}
          <strong>and the downloaded data packs</strong>. After an erase the packs must be
          re-downloaded from this site before search and reading work again. There is no undo and no
          server copy to restore from — unless you exported a file first.
        </p>
        <div className="field">
          <label htmlFor="data-erase-input">
            Type <kbd>ERASE</kbd> to unlock the button
          </label>
          <input
            id="data-erase-input"
            className="input"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={eraseText}
            onChange={(event) => setEraseText(event.target.value)}
          />
          <span className="help">
            Case-sensitive; this guard exists because the action cannot be undone.
          </span>
        </div>
        <div className="data-actions">
          <button
            type="button"
            className="btn btn-danger"
            disabled={eraseText !== 'ERASE'}
            onClick={() => setEraseOpen(true)}
          >
            <IconTrash /> Erase all data on this device
          </button>
          {erased ? (
            <span className="data-status" role="status" aria-live="polite">
              Erased. The downloaded packs are gone too.
            </span>
          ) : null}
        </div>
        {erased ? (
          <Link className="btn btn-sm" to="/offline-data">
            Download the required packs again
          </Link>
        ) : null}
      </section>

      <ConfirmDialog
        open={replaceOpen}
        danger
        title="Replace the data in these stores?"
        body={
          <div className="stack">
            <p>
              The following stores on this device will be cleared and then filled from {parsed?.name}.
              Anything you have here that is not in that file is lost:
            </p>
            <ul className="data-list">
              {overwriteStores.map((store) => (
                <li key={store}>
                  <strong>{STORE_LABELS[store]}</strong>
                  <span className="data-num">
                    {parsed ? (parsed.backup.data[store] ?? []).length : 0} record(s) in the file
                  </span>
                </li>
              ))}
            </ul>
            <p className="data-help">
              Settings are updated rather than cleared. Export a backup first if you are unsure —{' '}
              <strong>Cancel</strong> closes this dialog without writing anything.
            </p>
          </div>
        }
        confirmLabel="Replace and import"
        onConfirm={() => void runImport()}
        onCancel={() => setReplaceOpen(false)}
      />

      <ConfirmDialog
        open={eraseOpen}
        danger
        title="Erase all data on this device?"
        body={
          <div className="stack">
            <p>
              This clears the whole database, including the downloaded dictionary and content packs
              and the settings this app keeps here. You will need to re-download the packs from{' '}
              <Link to="/offline-data">offline data</Link>.
            </p>
            <p className="data-help">
              Nothing is sent anywhere when it is deleted: it is removed from this browser only.
            </p>
          </div>
        }
        confirmLabel="Yes, erase everything"
        onConfirm={() => void doErase()}
        onCancel={() => setEraseOpen(false)}
      />
    </div>
  );
}

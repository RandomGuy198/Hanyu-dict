/** `/offline-data` — the data-pack manager.
 *
 *  Packs are content, not code. Each one is fetched from this same site once, every file is
 *  compared against the sha256 recorded in the manifest, and only verified text is written to
 *  IndexedDB; the service worker precaches the app shell but never the pack bytes themselves.
 *  Afterwards the app works with no connection. Every byte count, version and status shown here
 *  is read back from IndexedDB or the storage API — nothing is invented, and an update is only
 *  reported when the manifest really lists a different version.
 *
 *  Unlike search screens, this page is deliberately NOT wrapped in `LoadingGate`: it is the
 *  screen the gate’s error branch links to, and hiding the pack table while the dictionary is
 *  missing (or while required packs are still downloading) would make it a dead end. Its honest
 *  loading / error states are surfaced inline instead, keeping the page to a single `h1`. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog, PageHeader, ProgressBar } from '../../components';
import { IconAlert, IconDownload } from '../../app/icons';
import { formatBytes } from '../../app/hooks';
import { useDictionary, usePreferences, useToast } from '../../app/providers';
import {
  cachedManifest,
  installPack,
  loadManifest,
  packOverview,
  requestPersistence,
  storageUsage,
  uninstallPack,
  type InstallProgress,
  type PackOverview,
  type StorageUsage,
} from '../../data/packs';
import type { PackDescriptor, PackKind } from '../../domain/types';
import './offline.css';

const KIND_LABEL: Record<PackKind, string> = {
  dictionary: 'word list',
  characters: 'character data',
  strokes: 'stroke graphics',
  examples: 'example sentences',
  content: 'reading content',
  ocr: 'recognition models',
};

/** Honest, pack-specific consequence of removing an opt-in pack, shown in the confirm dialog. */
const STOP_WORKING: Partial<Record<PackKind, string>> = {
  strokes:
    'Stroke-order animation stops drawing on the writing and character screens. Word lookups, pinyin, definitions and your saved data keep working.',
  examples:
    'Example sentences disappear from entry pages and the reader. Words, characters, definitions and your saved data keep working.',
};

const GENERIC_STOP =
  'Any screen that reads this pack will report that it is not installed until you download it again. Notes, saved words, decks and history are untouched.';

interface VersionDiff {
  id: string;
  label: string;
  installed?: string;
  listed: string;
  note: string;
}

function statusBadge(row: PackOverview): { text: string; tone: string } {
  if (row.installed) return { text: 'Ready', tone: 'badge-ok' };
  if (!row.state) return { text: 'Not installed', tone: '' };
  if (row.state.status === 'installing') return { text: 'Installing', tone: 'badge-warn' };
  if (row.state.status === 'error') return { text: 'Failed', tone: 'badge-danger' };
  return {
    text: `Installed v${row.state.version}, site wants v${row.pack.version}`,
    tone: 'badge-warn',
  };
}

function phaseLabel(phase: InstallProgress['phase']): string {
  switch (phase) {
    case 'download':
      return 'downloading from this site';
    case 'verify':
      return 'comparing sha256 against the manifest';
    case 'store':
      return 'writing verified text to IndexedDB';
    case 'done':
      return 'finished';
  }
}

export default function OfflineDataPage() {
  const toast = useToast();
  const { state, reload } = useDictionary();
  const { update } = usePreferences();

  const [rows, setRows] = useState<PackOverview[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [persistNote, setPersistNote] = useState<string | null>(null);
  const [busyPack, setBusyPack] = useState<string | null>(null);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<PackDescriptor | null>(null);
  const [needsIndex, setNeedsIndex] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkNote, setCheckNote] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<VersionDiff[] | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const overview = await packOverview();
      setRows(overview);
      setLoadError(null);
      update({ installedPacks: overview.filter((row) => row.installed).map((row) => row.pack.id) });
      setUsage(await storageUsage());
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setRows(null);
      setLoadError(reason);
    }
  }, [update]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totals = useMemo(() => {
    const list = rows ?? [];
    const ready = list.filter((row) => row.installed);
    return {
      listedBytes: list.reduce((sum, row) => sum + row.pack.bytes, 0),
      readyBytes: ready.reduce((sum, row) => sum + row.pack.bytes, 0),
      readyCount: ready.length,
      totalCount: list.length,
      optIn: list.filter((row) => !row.pack.required),
    };
  }, [rows]);

  const install = useCallback(
    async (pack: PackDescriptor) => {
      setBusyPack(pack.id);
      setActionError(null);
      setProgress(null);
      try {
        await installPack(pack, setProgress);
        toast.push({ message: `${pack.label} installed and verified`, tone: 'info' });
        if (pack.kind !== 'content' && pack.kind !== 'ocr') setNeedsIndex(true);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        setActionError(`${pack.label}: ${reason}`);
        toast.push({ message: `${pack.label} could not be installed`, tone: 'danger' });
      } finally {
        setBusyPack(null);
        setProgress(null);
        void refresh();
      }
    },
    [refresh, toast],
  );

  const confirmUninstall = useCallback(async () => {
    const pack = uninstallTarget;
    setUninstallTarget(null);
    if (!pack || pack.required) return;
    setActionError(null);
    try {
      await uninstallPack(pack.id);
      toast.push({ message: `${pack.label} removed from this device`, tone: 'info' });
      if (pack.kind !== 'content' && pack.kind !== 'ocr') setNeedsIndex(true);
    } catch (error) {
      setActionError(`${pack.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
    void refresh();
  }, [refresh, toast, uninstallTarget]);

  const askPersistence = useCallback(async () => {
    const result = await requestPersistence();
    if (result.persisted) {
      setPersistNote('The browser granted durable storage: it will try hard to keep this data.');
    } else if (result.reason === 'unsupported') {
      setPersistNote(
        'This browser cannot be asked for durable storage, so it may evict IndexedDB when space is tight. Keep a backup file of your own data.',
      );
    } else {
      setPersistNote(
        `Durable storage was refused${result.reason ? ` (${result.reason})` : ''}. The data stays usable but may be evicted under pressure. Keep a backup file.`,
      );
    }
    void refresh();
  }, [refresh]);

  const checkUpdates = useCallback(async () => {
    setChecking(true);
    setCheckError(null);
    setCheckNote(null);
    try {
      const before = await cachedManifest();
      const after = await loadManifest(true);
      if (!before) {
        setDiffs([]);
        setCheckNote(
          'There was no manifest cached on this device yet, so there is nothing to compare against. The version now shown is what this site publishes.',
        );
      } else {
        const overview = await packOverview();
        const list: VersionDiff[] = [];
        for (const pack of after.packs) {
          const previous = before.packs.find((entry) => entry.id === pack.id);
          if (!previous) {
            list.push({
              id: pack.id,
              label: pack.label,
              listed: pack.version,
              note: 'Newly listed pack',
            });
            continue;
          }
          if (previous.version !== pack.version) {
            const row = overview.find((entry) => entry.pack.id === pack.id);
            list.push({
              id: pack.id,
              label: pack.label,
              installed: row?.state?.version ?? 'not installed',
              listed: pack.version,
              note: row?.installed ? 'Update available' : 'Needs downloading',
            });
          }
        }
        setDiffs(list);
      }
      setCheckedAt(new Date().toISOString());
      void refresh();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setCheckError(reason);
      setDiffs(null);
      toast.push({ message: 'Could not check for newer data', tone: 'danger' });
    } finally {
      setChecking(false);
    }
  }, [refresh, toast]);

  const packTable = (
    <div className="offline-scroll">
      <table className="table">
        <caption className="visually-hidden">Every data pack listed for this device</caption>
        <thead>
          <tr>
            <th scope="col">Pack</th>
            <th scope="col">Version</th>
            <th scope="col">Coverage</th>
            <th scope="col">Size</th>
            <th scope="col">Licence</th>
            <th scope="col">Type</th>
            <th scope="col">Status</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((row) => {
            const { pack, state: installState } = row;
            const badge = statusBadge(row);
            const records = pack.coverage?.records;
            const languages = pack.coverage?.languages;
            const mismatch = installState?.status === 'ready' && installState.version !== pack.version;
            const errored = installState?.status === 'error';
            const busy = busyPack === pack.id;
            const downloadLabel = errored ? 'Retry download' : mismatch ? 'Update pack' : 'Download';
            return (
              <tr key={pack.id}>
                <td>
                  <strong>{pack.label}</strong>
                  <div className="text-sm faint">
                    {pack.id} · {KIND_LABEL[pack.kind]} · {pack.files.length} file
                    {pack.files.length === 1 ? '' : 's'} · {pack.required ? 'required' : 'opt-in'}
                  </div>
                  {errored && installState?.error ? (
                    <p className="offline-err">{installState.error}</p>
                  ) : null}
                </td>
                <td className="offline-num">v{pack.version}</td>
                <td className="offline-num">
                  {records === undefined || typeof records !== 'number'
                    ? '—'
                    : `${records.toLocaleString()} records`}
                  {Array.isArray(languages) && languages.length > 0 ? (
                    <div className="text-sm faint">{languages.filter((item) => typeof item === 'string').join(', ')}</div>
                  ) : null}
                </td>
                <td className="offline-num">{formatBytes(pack.bytes)}</td>
                <td>
                  {pack.license}
                  <div className="text-sm faint">{pack.attribution}</div>
                </td>
                <td>
                  <span className={`badge ${badge.tone}`.trim()}>{badge.text}</span>
                  {row.installed && installState ? (
                    <div className="text-sm faint">
                      stored {formatBytes(installState.bytes)} · {installState.installedAt.slice(0, 10)}
                    </div>
                  ) : null}
                </td>
                <td>
                  <div className="offline-actions">
                    {!row.installed ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        disabled={busyPack !== null}
                        onClick={() => void install(pack)}
                      >
                        <IconDownload />
                        {busy ? 'Working…' : `${downloadLabel} · ${formatBytes(pack.bytes)}`}
                      </button>
                    ) : null}
                    {pack.required ? (
                      <span className="offline-help">
                        Required — it cannot be removed here; without it the app cannot answer a
                        search, so it is re-downloaded automatically.
                      </span>
                    ) : row.installed ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busyPack !== null}
                        onClick={() => setUninstallTarget(pack)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="stack">
      <PageHeader
        title="Offline data"
        subtitle={`${totals.readyCount} of ${totals.totalCount} packs ready on this device · ${formatBytes(
          totals.readyBytes,
        )} of ${formatBytes(totals.listedBytes)} downloaded`}
        actions={
          <button
            type="button"
            className="btn btn-sm"
            disabled={busyPack !== null}
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        }
      />

      <p className="notice notice-info">
        <IconDownload />
        <span>
          Packs are fetched from this site once and each file is compared against the sha256 recorded
          in the manifest before the verified text is written to IndexedDB. A failed or truncated
          download leaves the previous version installed. The service worker only precaches the app
          shell (HTML, JS, CSS, icons) — pack bytes are never precached, they live in IndexedDB, can
          always be re-downloaded, and are never uploaded anywhere. Licence texts are on the{' '}
          <Link to="/about">about &amp; licences</Link> page.
        </span>
      </p>

      {loadError ? (
        <div className="notice notice-danger" role="alert">
          <div>
            <strong>The pack registry could not be read</strong>
            <p className="text-sm">{loadError}</p>
            <p className="text-sm faint">
              This usually means this site&rsquo;s <code>data/manifest.json</code> is unreachable
              (offline before a first install) or failed validation. Any packs already installed stay
              in IndexedDB and are listed once the registry loads.
            </p>
            <div className="offline-notice-actions">
              <button type="button" className="btn btn-sm" onClick={() => void refresh()}>
                Try again
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {state.phase === 'error' ? (
        <div className="notice notice-danger" role="alert">
          <div>
            <strong>The dictionary could not be prepared</strong>
            <p className="text-sm">{state.error ?? state.message}</p>
            <p className="text-sm faint">
              Download the required packs in the table below, then rebuild the search index. Saved
              words, notes and schedules are not affected.
            </p>
            <div className="offline-notice-actions">
              <button type="button" className="btn btn-sm" onClick={() => void reload()}>
                Retry the download
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="card offline-section" aria-labelledby="offline-packs">
        <div className="offline-section-head">
          <h2 id="offline-packs">Data packs on this device</h2>
          <span className="spacer" />
          <span className="offline-count">
            {totals.totalCount === 0
              ? 'No packs listed yet'
              : `${totals.readyCount}/${totals.totalCount} ready · ${totals.optIn.length} opt-in`}
          </span>
        </div>

        {rows === null && !loadError ? (
          <p className="offline-status" role="status" aria-live="polite">
            Reading the pack registry and installed versions from this device…
          </p>
        ) : null}

        {rows ? packTable : null}

        {busyPack && progress ? (
          <div className="offline-progress" role="status" aria-live="polite">
            <ProgressBar
              value={progress.bytes}
              total={progress.totalBytes}
              label={`Downloading pack ${progress.packId}`}
            />
            <p className="offline-status">
              {progress.packId}: file {progress.file} of {progress.files} ·{' '}
              {formatBytes(progress.bytes)} of {formatBytes(progress.totalBytes)} ·{' '}
              {phaseLabel(progress.phase)}
            </p>
          </div>
        ) : null}

        {actionError ? (
          <p className="notice notice-danger" role="alert">
            <IconAlert />
            <span>{actionError}</span>
          </p>
        ) : null}

        {needsIndex ? (
          <div className="notice notice-info">
            <div>
              <strong>Installed data changed underneath the running index.</strong>
              <p className="text-sm">
                Rebuild the in-memory search index so the new pack is used. Your notes, saved words
                and progress are not affected.
              </p>
              <div className="offline-notice-actions">
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={
                    state.phase === 'installing' ||
                    state.phase === 'loading' ||
                    state.phase === 'indexing'
                  }
                  onClick={() => {
                    setNeedsIndex(false);
                    void reload();
                  }}
                >
                  Rebuild the index now
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {totals.optIn.length > 0 ? (
          <p className="offline-help">
            Opt-in packs are only downloaded if you choose them, because they cost real bytes:{' '}
            {totals.optIn
              .map((row) => `${row.pack.label} (${formatBytes(row.pack.bytes)})`)
              .join(', ')}
            . They are not part of the app itself and removing them deletes only their files.
          </p>
        ) : null}
      </section>

      <section className="card offline-section" aria-labelledby="offline-storage">
        <div className="offline-section-head">
          <h2 id="offline-storage">Storage on this device</h2>
        </div>
        {usage ? (
          <dl className="offline-dl">
            <div>
              <dt>Pack bytes held in IndexedDB</dt>
              <dd>{formatBytes(usage.installedBytes)}</dd>
            </div>
            <div>
              <dt>Packs with files installed</dt>
              <dd>{usage.packCount}</dd>
            </div>
            <div>
              <dt>Browser usage for this site</dt>
              <dd>
                {usage.usageBytes === undefined
                  ? 'not reported by this browser'
                  : formatBytes(usage.usageBytes)}
                {usage.quotaBytes ? ` of a ${formatBytes(usage.quotaBytes)} quota` : ''}
              </dd>
            </div>
            <div>
              <dt>Durable storage</dt>
              <dd>{usage.persisted ? 'granted by the browser' : 'not granted'}</dd>
            </div>
          </dl>
        ) : (
          <p className="offline-status" role="status" aria-live="polite">
            Reading the browser&rsquo;s storage estimate…
          </p>
        )}
        <div className="offline-actions">
          <button type="button" className="btn" onClick={() => void askPersistence()}>
            Ask the browser to keep this data
          </button>
          {persistNote ? (
            <p className="offline-status" role="status" aria-live="polite">
              {persistNote}
            </p>
          ) : null}
        </div>
        <p className="offline-help">
          These figures cover the dictionary and content packs plus the browser&rsquo;s own estimate
          for this site. Your notes, saved words and history are counted on the{' '}
          <Link to="/data">backup &amp; restore</Link> screen.
        </p>
      </section>

      <section className="card offline-section" aria-labelledby="offline-updates">
        <div className="offline-section-head">
          <h2 id="offline-updates">Check for updated data</h2>
        </div>
        <p className="offline-help">
          Compares the manifest already cached in IndexedDB with the one published on this site
          right now. A difference means a pack version can be re-downloaded; installed packs keep
          working either way. Nothing is claimed unless the two manifests really differ.
        </p>
        <div className="offline-actions">
          <button type="button" className="btn" disabled={checking} onClick={() => void checkUpdates()}>
            {checking ? 'Checking…' : 'Check for updated data'}
          </button>
          {checkedAt && !checking ? (
            <span className="offline-count">Last checked {new Date(checkedAt).toLocaleString()}</span>
          ) : null}
        </div>
        {checkError ? (
          <div className="notice notice-danger" role="alert">
            <IconAlert />
            <div>
              <p>{checkError}</p>
              <p className="text-sm faint">
                You are probably offline, or this site&rsquo;s registry failed validation. No version
                information changed.
              </p>
            </div>
          </div>
        ) : null}
        {checkNote ? (
          <p className="offline-status" role="status" aria-live="polite">
            {checkNote}
          </p>
        ) : null}
        {diffs && diffs.length === 0 && !checkNote ? (
          <p className="offline-status" role="status" aria-live="polite">
            No differences: the pack versions this site lists match the manifest already cached here.
          </p>
        ) : null}
        {diffs && diffs.length > 0 ? (
          <ul className="offline-list" aria-label="Pack version differences found">
            {diffs.map((diff) => (
              <li key={diff.id}>
                <span className="badge badge-warn">{diff.note}</span>
                <strong>{diff.label}</strong>
                <span className="offline-num faint">
                  cached as v{diff.installed ?? 'unknown'} &rarr; site lists v{diff.listed}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="offline-help">
          Full licence texts and per-source attribution are on the{' '}
          <Link to="/about">about &amp; licences</Link> screen.
        </p>
      </section>

      <ConfirmDialog
        open={uninstallTarget !== null}
        danger
        title={uninstallTarget ? `Remove ${uninstallTarget.label} from this device?` : 'Remove pack?'}
        body={
          <div className="stack">
            <p>{uninstallTarget ? (STOP_WORKING[uninstallTarget.kind] ?? GENERIC_STOP) : ''}</p>
            <p className="offline-help">
              Only this pack&rsquo;s files are deleted from IndexedDB. Nothing is sent anywhere, and
              you can download the pack again from this site at any time.
            </p>
          </div>
        }
        confirmLabel="Remove pack"
        onConfirm={() => void confirmUninstall()}
        onCancel={() => setUninstallTarget(null)}
      />
    </div>
  );
}

/** `/learn` — the index of the reading content that ships in this project's content packs.
 *
 *  Items come from installed packs only (see contentSource.ts); when a pack is missing the
 *  screen says so and offers the real download instead of showing invented text. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  EmptyState,
  LoadingGate,
  PageHeader,
  ProgressBar,
  Segmented,
} from '../../components';
import { IconAlert, IconBook, IconCheck, IconDownload } from '../../app/icons';
import { formatBytes, useDebouncedValue, useQueryState } from '../../app/hooks';
import { useToast } from '../../app/providers';
import { installPack, type InstallProgress } from '../../data/packs';
import type { PackDescriptor } from '../../domain/types';
import {
  CONTENT_KINDS,
  CONTENT_LEVELS,
  itemStats,
  loadContentCatalog,
  useReadMarks,
  type ContentLevel,
  type ContentKind,
  type ContentPackStatus,
} from './contentSource';
import './content.css';

type KindFilter = ContentKind | 'all';
type LevelFilter = ContentLevel | 'all';

const KIND_LABEL: Record<ContentKind, string> = {
  tip: 'Study tip',
  lesson: 'Lesson',
  story: 'Short story',
  article: 'Article',
};

const KIND_PLURAL: Record<ContentKind, string> = {
  tip: 'Study tips',
  lesson: 'Lessons',
  story: 'Stories',
  article: 'Articles',
};

function matchesQuery(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle);
}

export default function LearnPage() {
  const toast = useToast();
  const catalog = useLiveQuery(() => loadContentCatalog(), []);
  const { marks, toggle: toggleRead } = useReadMarks();

  const [q, setQ] = useQueryState('q', '');
  const [draft, setDraft] = useState(q);
  const debouncedQuery = useDebouncedValue(draft);
  const [kind, setKind] = useState<KindFilter>('all');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busyPack, setBusyPack] = useState<string | null>(null);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [packError, setPackError] = useState<string | null>(null);

  useEffect(() => {
    if (debouncedQuery !== q) setQ(debouncedQuery);
  }, [debouncedQuery, q, setQ]);

  const items = useMemo(() => catalog?.items ?? [], [catalog]);
  const needle = debouncedQuery.trim().toLowerCase();

  const visible = useMemo(
    () =>
      items.filter((item) => {
        if (kind !== 'all' && item.kind !== kind) return false;
        if (level !== 'all' && item.level !== level) return false;
        if (unreadOnly && marks.has(item.id)) return false;
        if (!needle) return true;
        const haystack = [item.title, item.summary, ...item.tags].join(' ');
        return matchesQuery(haystack, needle);
      }),
    [items, kind, level, unreadOnly, marks, needle],
  );

  const kindCounts = useMemo(() => {
    const map = new Map<ContentKind, number>();
    for (const option of CONTENT_KINDS) map.set(option, 0);
    for (const item of items) map.set(item.kind, (map.get(item.kind) ?? 0) + 1);
    return map;
  }, [items]);

  const levelCounts = useMemo(() => {
    const map = new Map<ContentLevel, number>();
    for (const option of CONTENT_LEVELS) map.set(option, 0);
    for (const item of items) map.set(item.level, (map.get(item.level) ?? 0) + 1);
    return map;
  }, [items]);

  const missingPacks: ContentPackStatus[] = (catalog?.packs ?? []).filter((pack) => !pack.installed);
  const installedCount = (catalog?.packs ?? []).length - missingPacks.length;

  const install = useCallback(
    async (pack: PackDescriptor) => {
      setBusyPack(pack.id);
      setPackError(null);
      setProgress(null);
      try {
        await installPack(pack, (next) => setProgress(next));
        toast.push({ message: `${pack.label} is installed`, tone: 'info' });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        setPackError(`${pack.label}: ${reason}`);
        toast.push({ message: `${pack.label} could not be downloaded`, tone: 'danger' });
      } finally {
        setBusyPack(null);
        setProgress(null);
      }
    },
    [toast],
  );

  const body = (
    <div className="stack">
      <PageHeader
        title="Learn"
        subtitle={
          catalog
            ? `${visible.length} of ${items.length} items shown · ${installedCount} of ${catalog.packs.length} content packs on this device`
            : 'Reading content from this project’s own packs'
        }
        actions={
          <Link to="/settings" className="btn btn-sm">
            Display settings
          </Link>
        }
      />

      <div className="notice notice-info">
        <div>
          <strong>Written for this app, not taken from anywhere.</strong>
          <p className="text-sm">
            Every tip, lesson, story and article here was originally authored for this project and
            is licensed CC BY 4.0. None of it was scraped from another dictionary app, and none of it
            is a copy of a third party’s course material. The dictionary data those texts point at
            comes from CC-CEDICT and friends — see{' '}
            <Link to="/about">about &amp; licences</Link>.
          </p>
        </div>
      </div>

      {catalog?.registryError ? (
        <div className="notice notice-danger" role="alert">
          <div>
            <strong>The pack registry could not be read</strong>
            <p className="text-sm">{catalog.registryError}</p>
            <Link to="/offline-data" className="btn btn-sm">
              Open offline data
            </Link>
          </div>
        </div>
      ) : null}

      {missingPacks.length > 0 ? (
        <section className="card" aria-labelledby="learn-packs">
          <h2 id="learn-packs" className="learn-block-title">
            Content not on this device yet
          </h2>
          <p className="text-sm muted">
            Reading text only comes from an installed pack. Downloaded once, checksum-verified, then
            stored on this device.
          </p>
          {missingPacks.map((pack) => (
            <div className="learn-pack-row" key={pack.id}>
              <span className="badge badge-warn">
                {pack.state?.status === 'error' ? 'Failed' : 'Not installed'}
              </span>
              <span className="spacer" />
              <strong>{pack.label}</strong>
              <span className="text-sm faint">
                {formatBytes(pack.bytes)} · v{pack.version} · {pack.license}
              </span>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={busyPack !== null}
                onClick={() => void install(pack.descriptor)}
              >
                <IconDownload />
                {busyPack === pack.id ? 'Downloading…' : pack.state?.status === 'error' ? 'Retry download' : 'Download'}
              </button>
            </div>
          ))}
          {busyPack && progress ? (
            <div className="stack" role="status" aria-live="polite">
              <ProgressBar
                value={progress.bytes}
                total={progress.totalBytes}
                label={`Downloading ${busyPack}`}
              />
              <p className="text-sm faint">
                File {progress.file} of {progress.files} ({formatBytes(progress.bytes)} of{' '}
                {formatBytes(progress.totalBytes)}) — {progress.phase}
              </p>
            </div>
          ) : null}
          {packError ? (
            <p className="notice notice-danger text-sm" role="alert">
              <IconAlert /> {packError}
            </p>
          ) : null}
          {missingPacks.some((pack) => pack.state?.status === 'error' && pack.state.error) ? (
            <p className="text-sm faint">
              Last error recorded: {missingPacks.map((pack) => pack.state?.error).filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="learn-filters">
        <div className="learn-filter-row">
          <span className="learn-filter-label" aria-hidden="true">
            Type
          </span>
          <Segmented<KindFilter>
            label="Filter by content type"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: `All (${items.length})` },
              ...CONTENT_KINDS.map((option) => ({
                value: option as KindFilter,
                label: `${KIND_PLURAL[option]} (${kindCounts.get(option) ?? 0})`,
              })),
            ]}
          />
        </div>
        <div className="learn-filter-row">
          <span className="learn-filter-label" aria-hidden="true">
            Level
          </span>
          <Segmented<LevelFilter>
            label="Filter by level"
            value={level}
            onChange={setLevel}
            options={[
              { value: 'all', label: 'All levels' },
              ...CONTENT_LEVELS.map((option) => ({
                value: option as LevelFilter,
                label: `${option} (${levelCounts.get(option) ?? 0})`,
              })),
            ]}
          />
        </div>
        <div className="learn-filter-row">
          <button
            type="button"
            className="chip"
            aria-pressed={unreadOnly}
            onClick={() => setUnreadOnly((current) => !current)}
          >
            {unreadOnly ? <IconCheck /> : null}
            {unreadOnly ? 'Showing unread only' : 'Show unread only'}
          </button>
          {(kind !== 'all' || level !== 'all' || unreadOnly || needle) ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setKind('all');
                setLevel('all');
                setUnreadOnly(false);
                setDraft('');
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      </div>

      <div className="learn-search">
        <label htmlFor="learn-q">Search titles, summaries and tags</label>
        <input
          id="learn-q"
          className="input"
          type="search"
          value={draft}
          placeholder="e.g. tones, umbrella, HSK"
          onChange={(event) => setDraft(event.target.value)}
        />
        <p className="text-sm faint" role="status" aria-live="polite">
          {catalog
            ? `${visible.length} item${visible.length === 1 ? '' : 's'} match. Search runs on this device only.`
            : 'Checking which items are installed…'}
        </p>
      </div>

      {catalog && catalog.problems.length > 0 ? (
        <div className="notice notice-warn" role="alert">
          <div>
            <strong>{catalog.problems.length} packed file{catalog.problems.length === 1 ? '' : 's'} did not pass validation</strong>
            <ul className="text-sm">
              {catalog.problems.slice(0, 3).map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
            <p className="text-sm faint">
              Those items are hidden rather than guessed at. Reinstall the pack from{' '}
              <Link to="/offline-data">offline data</Link>.
            </p>
          </div>
        </div>
      ) : null}

      {!catalog ? (
        <div className="stack" role="status" aria-live="polite">
          <div className="skeleton" style={{ height: 72 }} />
          <div className="skeleton" style={{ height: 72 }} />
          <p className="text-sm faint">Reading the installed content packs…</p>
        </div>
      ) : visible.length === 0 ? (
        items.length === 0 ? (
          <EmptyState
            icon={<IconBook />}
            title={
              catalog.packs.length === 0
                ? 'This build lists no content packs'
                : 'No reading content is installed yet'
            }
            detail={
              catalog.packs.length === 0
                ? 'The manifest on this site contains no pack of kind “content”. Nothing was invented to fill the gap.'
                : 'Download the packs above to read the lessons, stories and tips written for this app.'
            }
            action={
              <Link to="/offline-data" className="btn btn-sm">
                Manage downloaded data
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="Nothing matches these filters"
            detail={
              needle
                ? `${items.length} items are installed; none of them matches “${needle}”${
                    kind === 'all' ? '' : ` as a ${KIND_LABEL[kind]}`
                  }${level === 'all' ? '' : ` at ${level} level`}.`
                : `${items.length} items are installed; none of them is a ${
                    kind === 'all' ? 'matching' : KIND_LABEL[kind].toLowerCase()
                  }${level === 'all' ? '' : ` at ${level} level`}${unreadOnly ? ' that is still unread' : ''}.`
            }
            action={
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setKind('all');
                  setLevel('all');
                  setUnreadOnly(false);
                  setDraft('');
                }}
              >
                Clear filters
              </button>
            }
          />
        )
      ) : (
        <ul className="learn-results">
          {visible.map((item) => {
            const stats = itemStats(item);
            const readAt = marks.get(item.id);
            return (
              <li className="card learn-card" key={item.id}>
                <div className="learn-card-head">
                  <Link className="learn-card-title" to={`/learn/${encodeURIComponent(item.id)}`}>
                    {item.title}
                  </Link>
                  <span className="spacer" />
                  <span className="learn-badges">
                    <span className="badge">{KIND_LABEL[item.kind]}</span>
                    <span className="badge">{item.level}</span>
                    <span className={`badge ${readAt ? 'badge-ok' : ''}`}>
                      {readAt ? <IconCheck /> : null}
                      {readAt ? 'Read' : 'Unread'}
                    </span>
                  </span>
                </div>
                <p className="learn-summary">{item.summary}</p>
                <div className="learn-stats">
                  <span>{stats.blocks} sections</span>
                  <span>{stats.zhLines} Chinese lines</span>
                  <span>{stats.listItems} list items</span>
                  {stats.notes > 0 ? <span>{stats.notes} notes</span> : null}
                  <span>{item.license}</span>
                </div>
                {item.tags.length > 0 ? (
                  <ul className="learn-tags" aria-label="Tags">
                    {item.tags.map((tag) => (
                      <li key={tag}>
                        <button
                          type="button"
                          className="chip"
                          onClick={() => setDraft(tag)}
                          aria-label={`Search for tag ${tag}`}
                        >
                          #{tag}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="learn-card-actions">
                  <Link className="btn btn-sm btn-primary" to={`/learn/${encodeURIComponent(item.id)}`}>
                    Open
                  </Link>
                  <button
                    type="button"
                    className="btn btn-sm"
                    aria-pressed={Boolean(readAt)}
                    onClick={() => void toggleRead(item.id, !readAt)}
                  >
                    {readAt ? 'Mark as unread' : 'Mark as read'}
                  </button>
                  <span className="text-sm faint">{item.attribution}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  return <LoadingGate>{body}</LoadingGate>;
}

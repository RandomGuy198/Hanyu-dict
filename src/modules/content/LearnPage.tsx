/** `/learn` — the index of the reading content that ships in this project's content packs.
 *
 *  Items come from the content packs (see contentSource.ts), which are automatically fetched,
 *  checksum-verified, and cached in IndexedDB on demand. */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  EmptyState,
  LoadingGate,
  PageHeader,
  Segmented,
} from '../../components';
import { IconBook, IconCheck } from '../../app/icons';
import { useDebouncedValue, useQueryState } from '../../app/hooks';
import {
  CONTENT_KINDS,
  CONTENT_LEVELS,
  itemStats,
  loadContentCatalog,
  useReadMarks,
  type ContentLevel,
  type ContentKind,
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

export default function LearnPage({ compact = false }: { compact?: boolean } = {}) {
  const catalog = useLiveQuery(() => loadContentCatalog(), []);
  const { marks, toggle: toggleRead } = useReadMarks();

  const [q, setQ] = useQueryState('q', '');
  const [draft, setDraft] = useState(q);
  const debouncedQuery = useDebouncedValue(draft);
  const [kind, setKind] = useState<KindFilter>('all');
  const [level, setLevel] = useState<LevelFilter>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);

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

  const body = (
    <div className="stack">
      {compact ? (
        <div className="prof-section-head">
          <h2>Bài đọc ngắn &amp; mẹo học</h2>
          <span className="spacer" />
          <Link to="/settings" className="btn btn-sm">
            Cài đặt hiển thị
          </Link>
        </div>
      ) : (
        <PageHeader
          title="Learn"
          subtitle={
            catalog
              ? `${visible.length} of ${items.length} items shown`
              : 'Reading content from this project’s own packs'
          }
          actions={
            <Link to="/settings" className="btn btn-sm">
              Display settings
            </Link>
          }
        />
      )}

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
          </div>
        </div>
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
              Those items are hidden rather than guessed at.
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
            title="This build lists no content packs"
            detail="The manifest on this site contains no pack of kind “content”. Nothing was invented to fill the gap."
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

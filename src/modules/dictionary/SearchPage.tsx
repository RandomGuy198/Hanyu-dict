/** Search screen. Live debounced search against the local index, shareable `?q=` URL
 *  state, honest empty states, display-script/pinyin toggles and a capped search history. */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  EmptyState,
  EntryLine,
  LoadingGate,
  PageHeader,
  Segmented,
} from '../../components';
import { useDebouncedValue, useQueryState } from '../../app/hooks';
import { useDictionary, usePreferences } from '../../app/providers';
import { IconSearch } from '../../app/icons';
import { bumpActivity, db, todayKey, type SearchHistoryRow } from '../../data/db';
import type { SearchOutcome } from '../../data/dictionary';
import { detectMode, normaliseQuery } from '../../domain/searchRanking';
import type { SearchResult, SearchMode } from '../../domain/types';
import './dictionary.css';

const FETCH_CAP = 120;
const PAGE = 40;
const HISTORY_CAP = 500;

function matchLabel(result: SearchResult): string {
  if (result.via === 'definition') return result.match === 'exact' ? 'exact meaning' : 'meaning';
  switch (result.match) {
    case 'exact':
      return result.via === 'pinyin' ? 'exact pinyin' : 'exact';
    case 'prefix':
      return result.via === 'pinyin' ? 'pinyin prefix' : 'prefix';
    case 'fuzzy':
      return 'near miss';
    default:
      return result.match;
  }
}

function modeLabel(mode: SearchMode): string {
  switch (mode) {
    case 'hans':
      return 'Chinese characters';
    case 'auto':
      return 'pinyin, Tiếng Việt / Hán-Việt or English';
    default:
      return mode;
  }
}

/** Deduplicate by text, append newest, trim the oldest rows past the cap. */
async function recordSearch(text: string, mode: SearchMode): Promise<void> {
  await db.transaction('rw', db.searchHistory, async () => {
    await db.searchHistory.where('text').equals(text).delete();
    await db.searchHistory.add({ text, mode, at: new Date().toISOString() });
    const total = await db.searchHistory.count();
    if (total > HISTORY_CAP) {
      const stale = await db.searchHistory.orderBy('id').limit(total - HISTORY_CAP).primaryKeys();
      await db.searchHistory.bulkDelete(stale as number[]);
    }
  });
  await bumpActivity(todayKey(), { searches: 1 });
}

export default function SearchPage() {
  const [q, setQ] = useQueryState('q');
  const { api } = useDictionary();
  const { prefs, update } = usePreferences();
  const [input, setInput] = useState(q);
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const [nonce, setNonce] = useState(0);
  const gen = useRef(0);
  const lastCommitted = useRef('');

  const term = useDebouncedValue(input.trim(), 200);
  const history = useLiveQuery(
    () => db.searchHistory.orderBy('id').reverse().limit(8).toArray(),
    [],
    [],
  );

  /* keep the box in sync when the URL changes from elsewhere (back nav, chips) */
  useEffect(() => {
    setInput((current) => (current.trim() === q ? current : q));
  }, [q]);

  /* shareable URL state */
  useEffect(() => {
    if (term !== q) setQ(term);
  }, [term, q, setQ]);

  /* debounced live search; stale responses are discarded by generation counter */
  useEffect(() => {
    const my = ++gen.current;
    let alive = true;
    if (!api || !term) {
      setOutcome(null);
      setBusy(false);
      setFailure(null);
      return;
    }
    setBusy(true);
    setFailure(null);
    api
      .search(term, { limit: FETCH_CAP })
      .then((result) => {
        if (alive && gen.current === my) {
          setOutcome(result);
          setBusy(false);
        }
      })
      .catch((error: unknown) => {
        if (alive && gen.current === my) {
          setBusy(false);
          setFailure(error instanceof Error ? error.message : 'The search could not run.');
        }
      });
    return () => {
      alive = false;
    };
  }, [api, term, nonce]);

  useEffect(() => setVisible(PAGE), [term]);

  /* once a typed query has settled and actually returned results, persist it */
  useEffect(() => {
    if (busy || !outcome || outcome.results.length === 0) return;
    if (term !== input.trim() || term === lastCommitted.current) return;
    lastCommitted.current = term;
    void recordSearch(term, detectMode(term));
  }, [busy, outcome, term, input]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const query = input.trim();
    if (!query) return;
    lastCommitted.current = query;
    setQ(query);
    void recordSearch(query, detectMode(query));
  };

  const results = outcome?.results ?? [];
  const shown = results.slice(0, visible);
  const interpreted = term ? detectMode(normaliseQuery(term)) : 'auto';

  return (
    <div className="dict-page stack">
      <LoadingGate>
        <PageHeader title="Search" subtitle="All lookups run locally against the installed index." />
        <div className="stack">
          <form className="field" role="search" onSubmit={submit}>
            <label htmlFor="dict-search-input">
              Tìm kiếm — Chữ Hán, Pinyin, Hán-Việt hoặc Tiếng Việt / Tiếng Anh
            </label>
            <div className="searchbar">
              <input
                id="dict-search-input"
                type="search"
                value={input}
                placeholder="汉语 · han yu · hán ngữ · thư viện · example"
                autoComplete="off"
                onChange={(event) => setInput(event.target.value)}
              />
              <button type="submit" className="btn btn-primary btn-icon" aria-label="Search">
                <IconSearch />
              </button>
            </div>
          </form>

          <section className="card card-tight dict-controls" aria-label="Display options">
            <div className="row-wrap">
              <span className="dict-control-label">Display script</span>
              <Segmented
                label="Display script"
                value={prefs.displayScript}
                options={[
                  { value: 'simplified', label: 'Simplified 简' },
                  { value: 'traditional', label: 'Traditional 繁' },
                  { value: 'both', label: 'Both' },
                ]}
                onChange={(displayScript) => update({ displayScript })}
              />
            </div>
            <div className="row-wrap">
              <span className="dict-control-label">Pinyin</span>
              <Segmented
                label="Pinyin style"
                value={prefs.pinyinStyle}
                options={[
                  { value: 'marks', label: 'Tone marks' },
                  { value: 'numbers', label: 'Digits' },
                  { value: 'none', label: 'Off' },
                ]}
                onChange={(pinyinStyle) => update({ pinyinStyle })}
              />
            </div>
          </section>

          <p className="dict-meta-row" role="status" aria-live="polite">
            {term ? (
              <>
                <span className="badge">read as: {modeLabel(interpreted)}</span>
                {busy ? (
                  <span>Searching…</span>
                ) : failure ? (
                  <span>The search failed: {failure}</span>
                ) : outcome ? (
                  <span>
                    {results.length === 1 ? '1 entry' : `${results.length} entries`} in{' '}
                    {outcome.tookMs} ms
                    {results.length >= FETCH_CAP ? ` (first ${FETCH_CAP} best matches)` : ''}
                  </span>
                ) : null}
              </>
            ) : (
              <span>Type above — results update as you type. Nothing leaves this device.</span>
            )}
          </p>

          {!term ? (
            <EmptyState
              icon={<IconSearch className="dict-ic" />}
              title="Type a word to begin"
              detail="Try Hanzi (中国), pinyin (zhongguo, zhong1 guo2), Hán-Việt (hán ngữ), Tiếng Việt (thư viện, bận), or an English meaning."
              action={
                history && history.length > 0 ? (
                  <ul className="dict-chiprow" aria-label="Recent searches">
                    {history.map((row: SearchHistoryRow) => (
                      <li key={row.id}>
                        <button type="button" className="chip" onClick={() => setInput(row.text)}>
                          {row.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null
              }
            />
          ) : failure ? (
            <div className="notice notice-danger" role="alert">
              <div>
                <strong>The search could not run</strong>
                <p>{failure}</p>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setFailure(null);
                    setNonce((n) => n + 1);
                  }}
                >
                  Retry
                </button>
              </div>
            </div>
          ) : !busy && outcome && results.length === 0 ? (
            <EmptyState
              title={`No entries match “${term}”`}
              detail={
                <>
                  The full installed index was searched. Try fewer characters, pinyin without
                  tone marks, or a shorter Vietnamese / English fragment — partial meaning matches count too.
                </>
              }
            />
          ) : shown.length > 0 ? (
            <>
              <ul className="list">
                {shown.map((result) => (
                  <EntryLine
                    key={result.entry.id}
                    entry={result.entry}
                    matchLabel={
                      result.entry.hanViet
                        ? `[HV: ${result.entry.hanViet}] · ${matchLabel(result)}`
                        : matchLabel(result)
                    }
                    trailing={
                      result.entry.definitionVi ? (
                        <span className="text-sm muted" lang="vi">
                          {result.entry.definitionVi.split('; ')[0]}
                        </span>
                      ) : null
                    }
                  />
                ))}
              </ul>
              {results.length > visible ? (
                <div className="dict-loadmore">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setVisible((v) => v + PAGE)}
                  >
                    Show {Math.min(PAGE, results.length - visible)} more
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </LoadingGate>
    </div>
  );
}

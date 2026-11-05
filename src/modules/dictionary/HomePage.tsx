/** Dictionary home: the search entry point, honest coverage state, resume history and a
 *  daily sample built only from installed dictionary data. */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ConfirmDialog,
  EmptyState,
  HanziText,
  LoadingGate,
  PageHeader,
  PinyinText,
} from '../../components';
import { useDebouncedValue } from '../../app/hooks';
import { useDictionary, usePreferences } from '../../app/providers';
import { IconSearch, IconSpark } from '../../app/icons';
import { db, todayKey, type SearchHistoryRow } from '../../data/db';
import { inspectSpeech, onVoicesChanged } from '../../data/speech';
import type { DictEntry } from '../../domain/types';
import './dictionary.css';

const SUGGEST_LIMIT = 6;

function pickDaily(chars: string[]): string | null {
  if (chars.length === 0) return null;
  let hash = 0;
  for (const ch of todayKey()) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return chars[hash % chars.length] ?? null;
}

export default function HomePage() {
  const navigate = useNavigate();
  const { api } = useDictionary();
  const { prefs } = usePreferences();
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<DictEntry[]>([]);
  const [coverage, setCoverage] = useState<{ entries: number; partial: boolean } | null>(null);
  const [sampleChars, setSampleChars] = useState<string[]>([]);
  const [sampleWords, setSampleWords] = useState<DictEntry[]>([]);
  const [askClear, setAskClear] = useState(false);
  const suggestGen = useRef(0);

  const term = useDebouncedValue(input.trim(), 220);
  const history = useLiveQuery(
    () => db.searchHistory.orderBy('id').reverse().limit(6).toArray(),
    [],
    [],
  );
  const dailyChar = useMemo(() => pickDaily(sampleChars), [sampleChars]);

  /* immediate suggestions while typing */
  useEffect(() => {
    const gen = ++suggestGen.current;
    if (!api || term.length === 0) {
      setSuggestions([]);
      return;
    }
    api
      .search(term, { limit: SUGGEST_LIMIT })
      .then((outcome) => {
        if (suggestGen.current === gen) setSuggestions(outcome.results.map((r) => r.entry));
      })
      .catch(() => {
        if (suggestGen.current === gen) setSuggestions([]);
      });
  }, [api, term]);

  /* one cheap probe to learn what this device actually holds */
  useEffect(() => {
    if (!api) return;
    let alive = true;
    api
      .search('的', { limit: 1 })
      .then((outcome) => {
        if (alive) setCoverage(outcome.coverage);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api]);

  /* daily sample: real characters from the installed index only */
  useEffect(() => {
    if (!api) return;
    let alive = true;
    api
      .sampleCharacters(60)
      .then((chars) => {
        if (alive) setSampleChars(chars);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api]);

  useEffect(() => {
    if (!api || !dailyChar) {
      setSampleWords([]);
      return;
    }
    let alive = true;
    api
      .search(dailyChar, { mode: 'hans', limit: 24 })
      .then((outcome) => {
        if (!alive) return;
        setSampleWords(
          outcome.results
            .map((r) => r.entry)
            .filter((e) => e.length >= 2 && e.length <= 4 && e.simplified.startsWith(dailyChar))
            .slice(0, 4),
        );
      })
      .catch(() => {
        if (alive) setSampleWords([]);
      });
    return () => {
      alive = false;
    };
  }, [api, dailyChar]);

  /* device speech status, re-read when the voice list changes */
  const [speech, setSpeech] = useState(() => inspectSpeech(prefs.ttsLang));
  useEffect(() => {
    const refresh = () => setSpeech(inspectSpeech(prefs.ttsLang));
    refresh();
    return onVoicesChanged(refresh);
  }, [prefs.ttsLang]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const query = input.trim();
    if (query) void navigate(`/search?q=${encodeURIComponent(query)}`);
  };

  const openEntry = (entry: DictEntry) =>
    void navigate(`/entry/${encodeURIComponent(entry.id)}`);

  return (
    <div className="dict-page stack">
      <LoadingGate>
        <PageHeader
          title="Hanyu Dictionary"
          subtitle={
            <>
              Free Chinese–English dictionary that runs offline on your device. Your searches,
              saved words and notes never leave it.
            </>
          }
        />
        <div className="stack">
          <section className="card dict-hero" aria-label="Dictionary search">
            <form onSubmit={submit} className="field" role="search">
              <label htmlFor="dict-home-search">
                Tìm kiếm — Chữ Hán, Pinyin, Hán-Việt hoặc Tiếng Việt / Tiếng Anh
              </label>
              <div className="searchbar">
                <input
                  id="dict-home-search"
                  type="search"
                  value={input}
                  placeholder="你好 · ni hao · hán ngữ · thư viện · to greet"
                  autoComplete="off"
                  aria-describedby="dict-home-search-help"
                  onChange={(event) => setInput(event.target.value)}
                />
                <button type="submit" className="btn btn-primary btn-icon" aria-label="Search">
                  <IconSearch />
                </button>
              </div>
              <span id="dict-home-search-help" className="help">
                Type Hanzi, pinyin with or without tones (zhongguo, zhong3 guo2), Hán-Việt, or
                Vietnamese / English meanings. Press Enter to see all results.
              </span>
            </form>
            <p className="visually-hidden" role="status" aria-live="polite">
              {term ? `${suggestions.length} suggestions for ${term}` : ''}
            </p>
            {suggestions.length > 0 ? (
              <ul className="dict-suggest">
                {suggestions.map((entry) => (
                  <li key={entry.id}>
                    <button type="button" className="item" onClick={() => openEntry(entry)}>
                      <span className="row">
                        <HanziText entry={entry} size="sm" />
                        <PinyinText entry={entry} />
                        {entry.hanViet ? <span className="badge">[HV: {entry.hanViet}]</span> : null}
                      </span>
                      <span className="dict-suggest-gloss text-sm faint">
                        {entry.definitionVi ? `${entry.definitionVi} · ${entry.definition}` : entry.definition}
                      </span>
                    </button>
                  </li>
                ))}
                <li>
                  <Link className="btn btn-ghost btn-sm" to={`/search?q=${encodeURIComponent(term)}`}>
                    All results for “{term}”
                  </Link>
                </li>
              </ul>
            ) : null}
          </section>

          <section className="card card-tight" aria-label="Data installed on this device">
            <div className="dict-chiprow">
              <span className="chip" aria-disabled="true">
                {coverage
                  ? `${coverage.entries.toLocaleString()} entries ${coverage.partial ? '(partial)' : '(complete)'}`
                  : 'Checking installed entries…'}
              </span>
              <span className="chip" aria-disabled="true">Character data: ready</span>
              <span className="chip" aria-disabled="true">Stroke order: auto-loaded</span>
              <span className="chip" aria-disabled="true">Example sentences: auto-loaded</span>
              <span className="chip" aria-disabled="true">Learning content: auto-loaded</span>
            </div>
          </section>

          <section aria-label="Recent searches">
            <div className="section-title">
              <h2>Resume where you left off</h2>
            </div>
            {history && history.length > 0 ? (
              <>
                <ul className="dict-chiprow">
                  {history.map((row: SearchHistoryRow) => (
                    <li key={row.id}>
                      <Link className="chip" to={`/search?q=${encodeURIComponent(row.text)}`}>
                        {row.text}
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="text-sm faint">
                  Most recent searches on this device.{' '}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAskClear(true)}>
                    Clear history
                  </button>
                </p>
              </>
            ) : (
              <p className="text-sm muted">No searches yet — your recent queries will appear here.</p>
            )}
          </section>

          <section className="card" aria-label="Character of the day">
            <div className="section-title">
              <h2>
                <IconSpark className="dict-ic" /> Character from your dictionary
              </h2>
            </div>
            {dailyChar ? (
              <div className="dict-wotd">
                <Link className="dict-wotd-char" to={`/character/${encodeURIComponent(dailyChar)}`}>
                  <span className="visually-hidden">Open character page for </span>
                  {dailyChar}
                </Link>
                <div className="dict-wotd-body">
                  <p className="text-sm muted">
                    Picked deterministically from the characters already installed on this device —
                    one per day, no network involved.
                  </p>
                  {sampleWords.length > 0 ? (
                    <ul className="dict-chiprow">
                      {sampleWords.map((entry) => (
                        <li key={entry.id}>
                          <button
                            type="button"
                            className="chip"
                            onClick={() => openEntry(entry)}
                            title={entry.definition}
                          >
                            {entry.simplified} · {entry.pinyinMarked}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm faint">No multi-character words starting with it yet.</p>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState
                title="No characters indexed yet"
                detail="Once the dictionary finishes indexing, a character from your own data appears here."
              />
            )}
          </section>

          <div className={`notice ${speech.chineseVoice ? 'notice-info' : 'notice-warn'}`} role="status">
            <div>
              <strong>Audio is your device’s speech synthesis</strong>
              <p>
                This app ships no recordings and never sends text anywhere. Audio buttons use the
                speech voice installed on your device.
              </p>
              {!speech.available ? (
                <p className="text-sm">{speech.reason}</p>
              ) : !speech.chineseVoice ? (
                <p className="text-sm">
                  No Chinese voice is installed on this device yet, so the speaker buttons will
                  report that honestly until you add one in system settings. Pinyin display works
                  regardless.
                </p>
              ) : null}
            </div>
          </div>

          <ConfirmDialog
            open={askClear}
            title="Clear search history?"
            body={<p>Removes the list of recent searches on this device. Saved words are not affected.</p>}
            confirmLabel="Clear history"
            danger
            onConfirm={() => {
              void db.searchHistory.clear();
              setAskClear(false);
            }}
            onCancel={() => setAskClear(false)}
          />
        </div>
      </LoadingGate>
    </div>
  );
}

/** Entry detail: /entry/:key. Resolves a stable entry id or a raw headword, shows the
 *  gloss data with attribution, links each Hanzi to its character page, and surfaces only
 *  examples/related words that actually exist on this device. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AttributionNote,
  DefinitionText,
  EmptyState,
  EntryLine,
  HanziText,
  LoadingGate,
  PageHeader,
  SaveButton,
  SpeakButton,
  parseEntryKey,
  preferredHeadword,
  preferredPinyin,
} from '../../components';
import { useDictionary, usePreferences, useSavedWords, useToast } from '../../app/providers';
import { db } from '../../data/db';
import { speak } from '../../data/speech';
import { isHanCharacter, numberedToMarks } from '../../domain/pinyin';
import { US } from '../../domain/types';
import type { DictEntry, ExampleSentence } from '../../domain/types';
import './dictionary.css';

type Status = 'loading' | 'ready' | 'missing' | 'error';

function uniqueChars(...texts: string[]): string[] {
  return [...new Set(texts.flatMap((text) => [...text]).filter(isHanCharacter))];
}

export default function EntryPage() {
  const { key = '' } = useParams<{ key: string }>();
  const { api } = useDictionary();
  const { prefs } = usePreferences();
  const { saved, save } = useSavedWords();
  const toast = useToast();

  const [status, setStatus] = useState<Status>('loading');
  const [entries, setEntries] = useState<DictEntry[]>([]);
  const [index, setIndex] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [examples, setExamples] = useState<ExampleSentence[] | null>(null);
  const [related, setRelated] = useState<DictEntry[]>([]);
  const [nonce, setNonce] = useState(0);
  const spokeFor = useRef('');

  const entry = status === 'ready' ? entries[index] : undefined;
  const wordLists = useLiveQuery(() => db.wordLists.orderBy('name').toArray(), [], []);
  const examplesPack = useLiveQuery(() => db.packs.get('examples'), []);
  const examplesInstalled = examplesPack?.status === 'ready';

  /* resolve the route key: full entry id first, raw headword as fallback */
  useEffect(() => {
    if (!api || !key) {
      setStatus('error');
      setFailure('The dictionary is not ready yet.');
      return;
    }
    let alive = true;
    setStatus('loading');
    setEntries([]);
    setIndex(0);
    setFailure(null);
    const parsed = parseEntryKey(key);
    const request: Promise<DictEntry[]> = parsed.pinyinNumbered
      ? api.entry(parsed.simplified + US + parsed.pinyinNumbered).then((found) => (found ? [found] : []))
      : api.headword(parsed.simplified);
    request
      .then(async (found) => {
        let list = found;
        if (list.length === 0 && parsed.pinyinNumbered) list = await api.headword(parsed.simplified);
        if (!alive) return;
        setEntries(list);
        setStatus(list.length > 0 ? 'ready' : 'missing');
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setStatus('error');
        setFailure(error instanceof Error ? error.message : 'The lookup was cancelled or failed.');
      });
    return () => {
      alive = false;
    };
  }, [api, key, nonce]);

  /* optional auto-read on entry open, using the device voice only */
  useEffect(() => {
    if (!entry || !prefs.autoSpeak || spokeFor.current === entry.id) return;
    spokeFor.current = entry.id;
    void speak(preferredHeadword(entry, prefs), { lang: prefs.ttsLang, rate: prefs.ttsRate });
  }, [entry, prefs]);

  /* examples from the optional pack, by simplified then traditional headword */
  useEffect(() => {
    if (!api || !entry || !prefs.showExamples) {
      setExamples([]);
      return;
    }
    let alive = true;
    setExamples(null);
    api
      .examples(entry.simplified, 5)
      .then(async (list) => {
        const fallback =
          list.length === 0 && entry.traditional !== entry.simplified
            ? await api.examples(entry.traditional, 5)
            : list;
        if (alive) setExamples(fallback);
      })
      .catch(() => {
        if (alive) setExamples([]);
      });
    return () => {
      alive = false;
    };
  }, [api, entry, prefs.showExamples]);

  /* related words: real same-length entries sharing a character, via the local index */
  useEffect(() => {
    if (!api || !entry || entry.length < 2) {
      setRelated([]);
      return;
    }
    let alive = true;
    const chars = uniqueChars(entry.simplified).slice(0, 4);
    Promise.all(chars.map((char) => api.search(char, { mode: 'hans', limit: 24 })))
      .then((outcomes) => {
        if (!alive) return;
        const seen = new Set([entry.id]);
        const out: DictEntry[] = [];
        for (const outcome of outcomes) {
          for (const result of outcome.results) {
            const candidate = result.entry;
            if (candidate.length !== entry.length || seen.has(candidate.id)) continue;
            seen.add(candidate.id);
            out.push(candidate);
          }
        }
        setRelated(out.sort((a, b) => a.length - b.length || (a.id < b.id ? -1 : 1)).slice(0, 8));
      })
      .catch(() => {
        if (alive) setRelated([]);
      });
    return () => {
      alive = false;
    };
  }, [api, entry]);

  const chars = useMemo(
    () => (entry ? uniqueChars(entry.simplified, prefs.displayScript === 'simplified' ? '' : entry.traditional) : []),
    [entry, prefs.displayScript],
  );
  const savedRow = entry ? saved.find((row) => row.id === entry.id) : undefined;

  if (!entry) {
    return (
      <div className="dict-page stack">
        <LoadingGate>
          <PageHeader title="Dictionary entry" back={{ label: 'Dictionary', to: '/' }} />
          <p className="visually-hidden" role="status" aria-live="polite">
            {status === 'loading' ? 'Loading this entry…' : ''}
          </p>
          {status === 'loading' ? (
            <div className="stack" aria-hidden="true">
              <div className="skeleton" style={{ height: 44, width: '45%' }} />
              <div className="skeleton" style={{ height: 20, width: '70%' }} />
              <div className="skeleton" style={{ height: 80 }} />
            </div>
          ) : status === 'missing' ? (
            <EmptyState
              title="No entry matches that address"
              detail={
                <>
                  Nothing on this device is filed under “{parseEntryKey(key).simplified || key}”.
                  The pack may have changed, or the link is from an older version.
                </>
              }
              action={
                <Link className="btn btn-sm btn-primary" to={`/search?q=${encodeURIComponent(parseEntryKey(key).simplified || key)}`}>
                  Search for it instead
                </Link>
              }
            />
          ) : (
            <div className="notice notice-danger" role="alert">
              <div>
                <strong>The entry could not be loaded</strong>
                <p>{failure}</p>
                <button type="button" className="btn btn-sm" onClick={() => setNonce((n) => n + 1)}>
                  Try again
                </button>
              </div>
            </div>
          )}
        </LoadingGate>
      </div>
    );
  }

  const headword = preferredHeadword(entry, prefs);
  const pinyin = prefs.showPinyin ? preferredPinyin(entry, prefs) : '';

  const copy = async () => {
    const text = `${headword}${pinyin ? ` ${pinyin}` : ''}\n${entry.definition}`;
    if (!navigator.clipboard) {
      toast.push({ message: 'This browser blocks clipboard access.', tone: 'warn' });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.push('Entry copied to the clipboard');
    } catch {
      toast.push({ message: 'Copying was refused by the browser.', tone: 'warn' });
    }
  };

  const share = async () => {
    if (typeof navigator.share !== 'function') {
      toast.push({ message: 'Sharing is not available on this device.', tone: 'warn' });
      return;
    }
    try {
      await navigator.share({ title: headword, text: `${headword} ${pinyin} — ${entry.definition}` });
    } catch {
      // a cancelled system share sheet is normal; nothing to report
    }
  };

  const pickList = (listId: string) => {
    if (!listId) return;
    const list = (wordLists ?? []).find((candidate) => candidate.id === listId);
    if (savedRow) {
      void db.savedWords.update(entry.id, { lists: [listId] });
      toast.push(list ? `Added to ${list.name}` : 'Updated the saved word’s list');
    } else {
      void save(entry, [listId]);
    }
  };

  return (
    <div className="dict-page stack">
      <LoadingGate>
        <PageHeader title={headword} subtitle="Dictionary entry · local data only" back={{ label: 'Dictionary', to: '/' }} />
        <p className="visually-hidden" role="status" aria-live="polite">
          Entry loaded: {headword}
        </p>

        {entries.length > 1 ? (
          <div className="dict-chiprow" role="group" aria-label="Choose a reading">
            {entries.map((candidate, i) => (
              <button
                key={candidate.id}
                type="button"
                className={`chip ${i === index ? 'is-active' : ''}`}
                aria-pressed={i === index}
                onClick={() => setIndex(i)}
              >
                {candidate.pinyinMarked || candidate.pinyinNumbered}
              </button>
            ))}
          </div>
        ) : null}

        <section className="card">
          <div className="dict-entry-head">
            <HanziText entry={entry} size="xl" />
            {pinyin ? <span className="pinyin dict-pinyin-lg">{pinyin}</span> : null}
          </div>
          <div className="definition dict-glosses">
            <DefinitionText entry={entry} />
          </div>
          <div className="row-wrap" style={{ marginTop: 'var(--sp-4)' }}>
            <SpeakButton text={headword} label={`Play ${headword} with the device voice`} />
            <SaveButton entry={entry} />
            <button type="button" className="btn btn-sm" onClick={() => void copy()}>
              Copy
            </button>
            {typeof navigator.share === 'function' ? (
              <button type="button" className="btn btn-sm" onClick={() => void share()}>
                Share
              </button>
            ) : null}
          </div>
          {(wordLists ?? []).length > 0 ? (
            <div className="field" style={{ marginTop: 'var(--sp-3)' }}>
              <label htmlFor="dict-list-pick">Save to a word list</label>
              <select
                id="dict-list-pick"
                className="select"
                value={savedRow?.lists[0] ?? ''}
                onChange={(event) => pickList(event.currentTarget.value)}
              >
                <option value="">Choose a list…</option>
                {(wordLists ?? []).map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
              <span className="help">
                Saved words and their list membership stay in this browser’s storage.
              </span>
            </div>
          ) : null}
        </section>

        {chars.length > 0 ? (
          <section aria-label="Characters in this word">
            <div className="section-title">
              <h2>Characters</h2>
            </div>
            <ul className="dict-chiprow">
              {chars.map((char) => (
                <li key={char}>
                  <Link className="dict-char-link" to={`/character/${encodeURIComponent(char)}`}>
                    <span className="visually-hidden">Character details for </span>
                    {char}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {prefs.showExamples ? (
          <section aria-label="Example sentences">
            <div className="section-title">
              <h2>Examples</h2>
            </div>
            {examples === null ? (
              <div className="skeleton" style={{ height: 60 }} aria-hidden="true" />
            ) : examples.length > 0 ? (
              <div className="dict-examples">
                {examples.map((example) => (
                  <ExampleCard key={`${example.simplified}-${example.english.slice(0, 16)}`} example={example} />
                ))}
                <AttributionNote attribution="Tatoeba community sentences" license="under CC BY 2.0 FR" />
              </div>
            ) : examplesInstalled ? (
              <p className="text-sm muted">
                No example sentences are installed for “{entry.simplified}” yet.
              </p>
            ) : (
              <div className="notice notice-info">
                <div>
                  <strong>Example sentences are an optional download</strong>
                  <p>
                    This device has the word, but no examples pack is installed — nothing is
                    invented here.
                  </p>
                  <Link className="btn btn-sm" to="/offline-data">
                    Install the examples pack
                  </Link>
                </div>
              </div>
            )}
          </section>
        ) : null}

        {related.length > 0 ? (
          <section aria-label="Related words">
            <div className="section-title">
              <h2>Related words</h2>
            </div>
            <p className="text-sm faint">
              Same-length entries from the installed index that share a character with this word.
            </p>
            <ul className="list">
              {related.map((candidate) => (
                <EntryLine key={candidate.id} entry={candidate} />
              ))}
            </ul>
          </section>
        ) : null}

        <AttributionNote attribution="CC-CEDICT dictionary data" license="under CC BY-SA 4.0" />
      </LoadingGate>
    </div>
  );
}

function ExampleCard({ example }: { example: ExampleSentence }) {
  const { prefs } = usePreferences();
  const zh = prefs.displayScript === 'traditional' ? example.traditional : example.simplified;
  const alt = prefs.displayScript === 'both' && example.traditional !== example.simplified ? example.traditional : '';
  const roman =
    prefs.pinyinStyle === 'none' || !example.pinyin
      ? ''
      : prefs.pinyinStyle === 'marks'
        ? numberedToMarks(example.pinyin)
        : example.pinyin;
  return (
    <div className="dict-example">
      <p className="dict-example-zh cjk" lang="zh">
        {zh}
        {alt ? <span className="faint" style={{ fontSize: '0.72em' }}> {alt}</span> : null}
      </p>
      {roman ? <p className="dict-example-py">{roman}</p> : null}
      <p className="dict-example-en">{example.english}</p>
    </div>
  );
}

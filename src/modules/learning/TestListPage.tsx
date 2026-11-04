/** Practice-test shelf. Every set here is either generated on this device from the licensed
 *  dictionary lines, built from the learner's own saved words, lists and notebooks, or made of
 *  passages this app wrote itself. No third-party exam paper, no official score, no ranking. */

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconAlert, IconBook, IconCards, IconSpark } from '../../app/icons';
import { useDictionary, usePreferences } from '../../app/providers';
import { db } from '../../data/db';
import { formatDate } from '../../app/hooks';
import { inspectSpeech } from '../../data/speech';
import type { Notebook, PracticeSession, WordList } from '../../domain/types';
import { EmptyState, LoadingGate, PageHeader } from '../../components';
import {
  SECTION_LABEL,
  TEST_CATALOG,
  buildTest,
  levelLabel,
  listTestId,
  loadOwnPool,
  loadSourcePool,
  minutesFor,
  notebookTestId,
  poolLabel,
  shortfall,
  specForList,
  specForNotebook,
  type BuildContext,
  type GeneratedTest,
  type PoolCounts,
  type QuestionSection,
  type TestSpec,
} from './questionBank';
import './learning.css';
import './learningTest.css';

/** A card on the shelf: the spec, what was built for it, and the honest reason if it cannot start. */
interface Entry {
  spec: TestSpec;
  result?: GeneratedTest;
  /** why the set cannot be built yet, in the learner's own numbers */
  note: string | null;
}

export default function TestListPage() {
  const { prefs, ready } = usePreferences();
  const { api } = useDictionary();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [params, setParams] = useSearchParams();

  const runs = useLiveQuery(
    async (): Promise<PracticeSession[]> =>
      (await db.sessions.where('kind').equals('test').toArray())
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 5),
    [],
    [],
  );
  const lists = useLiveQuery(async (): Promise<WordList[]> => {
    const rows = await db.wordLists.toArray();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [], []);
  const notebooks = useLiveQuery(async (): Promise<Notebook[]> => {
    const rows = await db.notebooks.toArray();
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }, [], []);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    setStatus('loading');

    const run = async () => {
      const own = await loadOwnPool();
      const context: BuildContext = {
        api,
        prefs,
        own,
        hasVoice: inspectSpeech(prefs.ttsLang).chineseVoice,
      };
      const counts: PoolCounts = {
        saved: own.saved.length,
        cards: own.cards.filter((card) => !card.suspended).length,
        source: 0,
      };

      // A test from each of the learner's own lists and notebooks, on top of the saved sets.
      const dynamic: { spec: TestSpec; source: BuildContext }[] = [];
      for (const list of lists) {
        const source = await loadSourcePool({ kind: 'list', id: list.id }, api);
        dynamic.push({ spec: specForList(list, source.words.length), source: { ...context, source } });
      }
      for (const notebook of notebooks) {
        const source = await loadSourcePool({ kind: 'notebook', id: notebook.id }, api);
        dynamic.push({ spec: specForNotebook(notebook, source.words.length), source: { ...context, source } });
      }

      const specs: { spec: TestSpec; ctx: BuildContext }[] = [
        ...TEST_CATALOG.map((spec) => ({ spec, ctx: context })),
        ...dynamic.map((row) => ({ spec: row.spec, ctx: row.source })),
      ];

      const built: Entry[] = [];
      for (const { spec, ctx } of specs) {
        const reason = shortfall(spec, { ...counts, source: ctx.source ? ctx.source.words.length : 0 });
        if (reason) {
          built.push({ spec, note: reason });
          continue;
        }
        const result = await buildTest(spec, ctx).catch((error: unknown) => {
          console.error('Could not build a practice test', spec.id, error);
          return undefined;
        });
        built.push({ spec, result, note: result ? null : 'This set could not be generated on this device.' });
      }
      if (!alive) return;
      setEntries(built);
      setStatus('ready');
    };

    run().catch((error: unknown) => {
      console.error('Test generation failed', error);
      if (alive) setStatus('error');
    });
    return () => {
      alive = false;
    };
  }, [api, lists, notebooks, prefs, ready]);

  const ownEntries = entries.filter((entry) => isOwn(entry.spec.pool));
  const dataEntries = entries.filter((entry) => !isOwn(entry.spec.pool));

  /** `?list=<id>` and `?notebook=<id>` deep-link one of your own sources: its set comes first. */
  const pinned = useMemo(() => {
    const listId = params.get('list');
    const notebookId = params.get('notebook');
    const wanted = listId ? listTestId(listId) : notebookId ? notebookTestId(notebookId) : null;
    if (!wanted) return null;
    const row = listId
      ? lists.find((item) => item.id === listId)
      : notebooks.find((item) => item.id === notebookId);
    return {
      id: wanted,
      raw: listId ?? notebookId ?? '',
      missing: !row,
      label: row ? row.name : 'this list or notebook',
      kind: listId ? ('list' as const) : ('notebook' as const),
    };
  }, [lists, notebooks, params]);

  const orderedOwn = useMemo(() => {
    if (!pinned) return ownEntries;
    const hit = ownEntries.filter((entry) => entry.spec.id === pinned.id);
    const rest = ownEntries.filter((entry) => entry.spec.id !== pinned.id);
    return [...hit, ...rest];
  }, [ownEntries, pinned]);

  const pickSource = (value: string) => {
    if (!value) {
      setParams({});
      return;
    }
    const [kind, ...rest] = value.split('|');
    const id = rest.join('|');
    setParams(kind === 'notebook' ? { notebook: id } : { list: id });
  };

  return (
    <div className="stack learn-flow">
      <PageHeader
        title="Practice tests"
        subtitle="Multiple-choice sets built from the dictionary data installed here and from your own words."
        back={{ label: 'Practice', to: '/practice' }}
      />

      <div className="notice notice-info" role="note">
        <IconAlert />
        <span>
          <strong>These are practice sets, not official HSK or HSKK exam papers.</strong> Every item
          is written for this app and generated at run time from open-licensed dictionary data
          (CC-CEDICT, CC BY-SA 4.0), from your own saved words, lists and notes, or from passages
          this project wrote. They contain no real test-bank questions and no text copied from an
          exam, and finishing one gives you a count of your own answers — not an official score,
          level or certificate — and nothing is sent anywhere.
        </span>
      </div>

      {status === 'error' ? (
        <div className="notice notice-danger" role="alert">
          <span>
            The questions could not be generated on this device. Your saved words, cards and grades
            are untouched — reloading the dictionary data usually fixes this.
          </span>
        </div>
      ) : null}

      <section aria-labelledby="learn-own-heading" className="stack">
        <div className="section-title">
          <h2 id="learn-own-heading">From your own words</h2>
        </div>

        <div className="test-picker">
          <div className="field test-picker-field">
            <label htmlFor="test-source">Make a test from one of your lists or notebooks</label>
            {lists.length + notebooks.length === 0 ? (
              <p className="help">
                Nothing to pick yet — a list or notebook needs at least four dictionary words in it.
                Create one in <Link to="/library">your library</Link> and come back.
              </p>
            ) : (
              <select
                id="test-source"
                className="select"
                value={pinned ? `${pinned.kind}|${pinned.raw}` : ''}
                onChange={(event) => pickSource(event.target.value)}
              >
                <option value="">All sources (show the whole shelf)</option>
                {lists.length > 0 ? (
                  <optgroup label="Your lists">
                    {lists.map((list) => (
                      <option key={list.id} value={`list|${list.id}`}>
                        {list.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {notebooks.length > 0 ? (
                  <optgroup label="Your notebooks">
                    {notebooks.map((notebook) => (
                      <option key={notebook.id} value={`notebook|${notebook.id}`}>
                        {notebook.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            )}
          </div>
          <p className="text-sm muted">
            The set is built on this device from the words in that source only, so its options and
            explanations stay inside your own data plus the licensed dictionary lines.
          </p>
        </div>

        {pinned ? (
          <p className="test-card-note" role="status">
            <span>
              Showing the set built from{' '}
              {pinned.kind === 'list' ? 'your list' : 'your notebook'} “{pinned.label}” first.
              {pinned.missing
                ? ' That source is not on this device any more, so there is nothing to build from it.'
                : ''}
            </span>
            <Link to="/test" className="btn btn-ghost" onClick={() => setParams({})}>
              Show all sets
            </Link>
          </p>
        ) : null}

        <ShelfGrid entries={orderedOwn} status={status} pinnedId={pinned?.id ?? null} />
      </section>

      <section aria-labelledby="learn-generated-heading" className="stack">
        <div className="section-title">
          <h2 id="learn-generated-heading">From the dictionary data and this app’s own passages</h2>
        </div>
        <LoadingGate>
          <ShelfGrid entries={dataEntries} status={status} pinnedId={null} />
        </LoadingGate>
      </section>

      {runs.length > 0 ? (
        <section className="card learn-panel" aria-labelledby="learn-runs-heading">
          <h2 id="learn-runs-heading" className="h3">Your last runs on this device</h2>
          <ul className="list">
            {runs.map((run) => (
              <li key={run.id} className="item">
                <span className="item-main">
                  <strong>{run.label}</strong>
                  <span className="text-sm muted">
                    {' '}
                    · {run.correct} of {run.total} correct · {formatDate(run.startedAt)}
                    {run.endedAt ? '' : ' · not finished'}
                  </span>
                </span>
                <span className="item-side">
                  <span className="badge">
                    <IconSpark /> {run.total > 0 ? Math.round((run.correct / run.total) * 100) : 0}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className="learn-footnote">
            These rows are your own answers, stored in this browser. There is no ranking and no way
            to compare them with anyone else.
          </p>
        </section>
      ) : null}

      <div className="row-wrap">
        <Link to="/practice" className="btn">
          <IconCards /> Flashcards and drills
        </Link>
        <Link to="/library" className="btn btn-ghost">
          <IconBook /> Your lists and notebooks
        </Link>
      </div>
    </div>
  );
}

function ShelfGrid({
  entries,
  status,
  pinnedId,
}: {
  entries: Entry[];
  status: 'loading' | 'ready' | 'error';
  pinnedId: string | null;
}) {
  if (status !== 'ready') {
    return (
      <div className="grid-cards">
        <div className="card learn-panel" role="status" aria-label="Building practice tests">
          <div className="skeleton" style={{ height: 20, width: '60%' }} />
          <div className="skeleton" style={{ height: 14, width: '80%' }} />
        </div>
        <div className="card learn-panel" aria-hidden="true">
          <div className="skeleton" style={{ height: 20, width: '55%' }} />
          <div className="skeleton" style={{ height: 14, width: '75%' }} />
        </div>
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <EmptyState
        title="Nothing to test yet"
        detail="Save a few words from a dictionary entry, or install the dictionary pack, and the sets below appear here."
      />
    );
  }
  return (
    <div className="grid-cards">
      {entries.map((entry) => (
        <TestCard key={entry.spec.id} entry={entry} pinned={entry.spec.id === pinnedId} />
      ))}
    </div>
  );
}

function TestCard({ entry, pinned }: { entry: Entry; pinned: boolean }) {
  const { spec, result, note } = entry;
  const questions = result?.questions ?? [];
  const count = questions.length;
  const ownData = spec.pool === 'saved' || spec.pool === 'cards' || spec.pool === 'source';
  return (
    <div className={`card learn-panel test-card ${pinned ? 'test-card-pinned' : ''}`}>
      <div className="test-card-head">
        <h3 className="h3">{spec.title}</h3>
        <span className="badge">{levelLabel(spec.level)}</span>
      </div>
      <p className="text-sm muted">{spec.note}</p>
      <p className="learn-test-meta">
        <span className="badge">
          {count > 0 ? `${count} question${count === 1 ? '' : 's'}` : 'no questions built'}
          {count > 0 && count < spec.planned ? ` of ${spec.planned} planned` : ''}
        </span>
        <span className="badge">about {minutesFor(Math.max(count, 1))} min</span>
        <span className="badge badge-ok">{poolLabel(spec.pool)}</span>
      </p>

      {count > 0 ? (
        <ul className="learn-legend">
          {sectionsOf(questions).map((section) => (
            <li key={section}>
              <span className="learn-swatch" />
              {SECTION_LABEL[section]}
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="test-needs">
        {spec.needs.map((need) => (
          <li key={need.label}>
            <span
              className={`test-needs-mark ${need.optional ? 'is-optional' : need.own ? 'is-own' : 'is-pack'}`}
              aria-hidden="true"
            />
            <span className="muted">
              {need.optional ? 'Optional: ' : need.own ? 'You need: ' : 'Uses: '}
              {need.label}
            </span>
          </li>
        ))}
      </ul>

      {result && result.skipped > 0 ? (
        <p className="learn-hint" role="status">
          {result.skipped} candidate item{result.skipped === 1 ? '' : 's'} could not be built from
          the data on this device, so this test is {count} question{count === 1 ? '' : 's'} long.
        </p>
      ) : null}
      {note ? (
        <div className="test-card-note" role="status">
          <span>
            <IconAlert /> {note}
          </span>
          {ownData ? (
            <Link
              to={spec.pool === 'cards' ? '/practice' : '/library'}
              className="btn btn-ghost"
            >
              {spec.pool === 'cards'
                ? 'Study cards so this set has words to use'
                : 'Save words and lists to build this set'}
            </Link>
          ) : (
            <Link to="/offline-data" className="btn btn-ghost">
              Install the dictionary data
            </Link>
          )}
        </div>
      ) : null}
      {result?.blocked ? (
        <p className="learn-hint">This set needs the dictionary pack, which is not installed here yet.</p>
      ) : null}

      {count > 0 ? (
        <Link to={`/test/${encodeURIComponent(spec.id)}`} className="btn btn-primary">
          Start test
        </Link>
      ) : (
        <p className="learn-footnote">
          {spec.pool === 'saved' || spec.pool === 'cards' || spec.pool === 'source'
            ? 'Add more words to this device and the set can be built.'
            : 'Nothing on this device supports these items yet.'}
        </p>
      )}
    </div>
  );
}

function isOwn(pool: TestSpec['pool']): boolean {
  return pool === 'saved' || pool === 'cards' || pool === 'source';
}

function sectionsOf(questions: GeneratedTest['questions']): QuestionSection[] {
  return [...new Set(questions.map((question) => question.section))];
}

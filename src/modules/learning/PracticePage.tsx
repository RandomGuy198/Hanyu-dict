/** Practice hub: pick what to study from your own saved words, lists and notebooks, open or
 *  create a deck for it, read the scheduler's real due numbers and start a review or a drill. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconBook, IconCards, IconPen, IconSpark } from '../../app/icons';
import { useDictionary, usePreferences, useToast } from '../../app/providers';
import { currentStreak, totals, weeklySummary } from '../../domain/achievements';
import { isDue } from '../../domain/scheduler';
import { LoadingGate, PageHeader, ProgressBar, Segmented, EmptyState } from '../../components';
import { db, todayKey } from '../../data/db';
import type { Deck } from '../../domain/types';
import DrillPanel from './DrillPanel';
import {
  deckIdFor,
  ensureDeck,
  loadSessionCap,
  loadSourceWords,
  parseSource,
  sourceToSearch,
  summarizeCards,
  updateDeck,
  type SourceWords,
} from './learningStore';
import './learning.css';

type PromptChoice = Deck['prompt'];

const PROMPT_OPTIONS: { value: PromptChoice; label: string }[] = [
  { value: 'zh2en', label: 'Chinese → meaning' },
  { value: 'en2zh', label: 'Meaning → Chinese' },
  { value: 'pinyin2zh', label: 'Pinyin → Chinese' },
];

export default function PracticePage() {
  const { prefs } = usePreferences();
  const { state, api } = useDictionary();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const source = parseSource(params.get('list') ?? '', params.get('notebook') ?? '');
  const sourceKey = `${source.kind}:${'id' in source ? source.id : ''}`;
  const dictionaryReady = state.phase === 'ready';

  const [sourceWords, setSourceWords] = useState<SourceWords | null>(null);
  const [wordsLoading, setWordsLoading] = useState(true);
  const [draftPrompt, setDraftPrompt] = useState<PromptChoice>('zh2en');
  const [draftNew, setDraftNew] = useState(prefs.dailyGoal);
  const [cap, setCap] = useState(20);
  const [busy, setBusy] = useState(false);
  const [drillOpen, setDrillOpen] = useState(false);

  const deckId = deckIdFor(source);
  const deck = useLiveQuery(() => db.decks.get(deckId), [deckId]);
  const cards = useLiveQuery(() => db.cards.where('deckId').equals(deckId).toArray(), [deckId], []);
  const allCards = useLiveQuery(() => db.cards.toArray(), [], []);
  const lists = useLiveQuery(() => db.wordLists.toArray(), [], []);
  const notebooks = useLiveQuery(() => db.notebooks.toArray(), [], []);
  const savedCounts = useLiveQuery(() => db.savedWords.toArray(), [], []);
  const days = useLiveQuery(() => db.activity.toArray(), [], []);
  const todayRow = useLiveQuery(() => db.activity.get(todayKey()), [], undefined);
  const allDecks = useLiveQuery(() => db.decks.toArray(), [], []);

  const globalSrsBreakdown = useMemo(() => {
    const now = new Date();
    const live = allCards.filter((card) => !card.suspended);
    const recognitionCards = live.filter((card) => card.kind !== 'writing');
    const writingCards = live.filter((card) => card.kind === 'writing');
    const recognitionDue = recognitionCards.filter((card) => isDue(card, now)).length;
    const writingDue = writingCards.filter((card) => isDue(card, now)).length;
    const dueChars = [...new Set(writingCards.filter((card) => isDue(card, now)).map((c) => c.simplified))].join('');
    return {
      recognitionTotal: recognitionCards.length,
      recognitionDue,
      writingTotal: writingCards.length,
      writingDue,
      dueChars,
      firstDeckId: allDecks[0]?.id ?? '',
    };
  }, [allCards, allDecks]);

  const courseDecks = useMemo(
    () => allDecks.filter((d) => d.id.startsWith('deck-book-')),
    [allDecks],
  );

  useEffect(() => {
    void loadSessionCap().then(setCap);
  }, []);

  const lookup = useCallback(
    (entryId: string) => (api ? api.entry(entryId) : Promise.resolve(undefined)),
    [api],
  );

  useEffect(() => {
    let alive = true;
    setWordsLoading(true);
    loadSourceWords(source, lookup)
      .then((rows) => {
        if (alive) {
          setSourceWords(rows);
          setWordsLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setWordsLoading(false);
        console.error('Could not read the study source', error);
        setSourceWords({ words: [], label: 'Could not be read on this device', missing: 0, exists: false });
      });
    return () => {
      alive = false;
    };
    // sourceKey re-runs the read when the picker changes; lookup tracks the dictionary api.
  }, [sourceKey, lookup, source]);

  const words = sourceWords?.words ?? [];
  const newPerDay = deck ? deck.newPerDay : draftNew;
  const prompt = deck ? deck.prompt : draftPrompt;
  const summary = useMemo(() => summarizeCards(cards, newPerDay), [cards, newPerDay]);
  const sums = useMemo(() => totals(days), [days]);
  const activeDays = useMemo(() => days.filter((day) => day.reviews + day.attempts > 0).map((day) => day.day), [days]);
  const goal = Math.max(1, Math.round(prefs.dailyGoal));
  const gradedToday = (todayRow?.reviews ?? 0) + (todayRow?.attempts ?? 0);
  const countFor = (listId: string) => savedCounts.filter((row) => row.lists.includes(listId)).length;

  const choose = (next: string) => {
    setDrillOpen(false);
    setParams(next ? new URLSearchParams(next) : new URLSearchParams(), { replace: true });
  };

  const changePrompt = (next: PromptChoice) => {
    setDraftPrompt(next);
    if (deck) void updateDeck(deck.id, { prompt: next });
  };

  const changeNewPerDay = (value: number) => {
    const next = Math.max(0, Math.min(200, Math.round(value || 0)));
    setDraftNew(next);
    if (deck) void updateDeck(deck.id, { newPerDay: next });
  };

  const startFlashcards = async () => {
    setBusy(true);
    try {
      const setup = await ensureDeck(source, words, sourceWords?.label ?? 'Practice', newPerDay);
      toast.push(
        setup.added > 0
          ? `Deck ready: ${setup.cards.length} cards, ${setup.added} added just now.`
          : `Deck ready: ${setup.cards.length} cards, schedule unchanged.`,
      );
      navigate(`/flashcards?deck=${encodeURIComponent(setup.deck.id)}&prompt=${setup.deck.prompt}`);
    } catch (error) {
      console.error('Could not prepare the deck', error);
      toast.push({ message: 'The deck could not be prepared. Your words are safe.', tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  const nothingSaved =
    !wordsLoading &&
    words.length === 0 &&
    source.kind === 'saved' &&
    savedCounts.length === 0 &&
    allDecks.length === 0;

  return (
    <div className="stack learn-flow">
      <PageHeader
        title="Practice"
        subtitle="Ôn tập SRS (Nhận biết & Tập viết chữ Hán), thẻ từ vựng và bài tập nhanh."
        actions={
          <Link to="/progress" className="btn btn-sm">
            <IconSpark /> Progress
          </Link>
        }
      />

      <section className="card learn-panel" aria-labelledby="study-srs-hub-heading">
        <h2 id="study-srs-hub-heading" className="h3">
          Lịch ôn tập SRS hôm nay
        </h2>
        <div className="learn-stats">
          <div className="learn-stat">
            <span className="learn-stat-value">{globalSrsBreakdown.recognitionDue}</span>
            <span className="learn-stat-label">
              Thẻ nhận biết (Recognition SRS) cần ôn ({globalSrsBreakdown.recognitionTotal} tổng)
            </span>
          </div>
          <div className="learn-stat">
            <span className="learn-stat-value">{globalSrsBreakdown.writingDue}</span>
            <span className="learn-stat-label">
              Thẻ tập viết chữ Hán (Writing SRS) cần ôn ({globalSrsBreakdown.writingTotal} tổng)
            </span>
          </div>
          <div className="learn-stat">
            <span className="learn-stat-value">{courseDecks.length}</span>
            <span className="learn-stat-label">Bộ thẻ khoá học đã mở</span>
          </div>
        </div>
        <div className="row-wrap">
          {globalSrsBreakdown.firstDeckId ? (
            <Link
              to={`/flashcards?deck=${encodeURIComponent(globalSrsBreakdown.firstDeckId)}`}
              className="btn btn-primary btn-sm"
            >
              <IconCards /> Ôn thẻ nhận biết ({globalSrsBreakdown.recognitionDue})
            </Link>
          ) : null}
          <Link
            to={
              globalSrsBreakdown.dueChars
                ? `/writing?chars=${encodeURIComponent(globalSrsBreakdown.dueChars.slice(0, 20))}`
                : '/writing'
            }
            className="btn btn-sm"
          >
            <IconPen /> Ôn tập viết chữ Hán ({globalSrsBreakdown.writingDue})
          </Link>
          <Link to="/books" className="btn btn-ghost btn-sm">
            <IconBook /> Học bài mới trong sách
          </Link>
        </div>
      </section>

      {nothingSaved ? (
        <EmptyState
          title="No saved words yet"
          detail="Save a word from any dictionary entry and it appears here as a flashcard."
          action={
            <Link to="/" className="btn btn-primary btn-sm">
              Look something up
            </Link>
          }
          icon={<IconCards />}
        />
      ) : null}

      <section className="card learn-panel" aria-labelledby="learn-source-heading">
        <h2 id="learn-source-heading" className="h3">What are you studying?</h2>
        <div className="field">
          <label htmlFor="learn-source">Study source</label>
          <select
            id="learn-source"
            className="select"
            value={sourceToSearch(source)}
            onChange={(event) => choose(event.target.value)}
          >
            <option value="">All saved words ({savedCounts.length})</option>
            {lists.length > 0 ? (
              <optgroup label="Word lists">
                {lists.map((list) => (
                  <option key={list.id} value={`list=${encodeURIComponent(list.id)}`}>
                    List: {list.name} ({countFor(list.id)})
                  </option>
                ))}
              </optgroup>
            ) : null}
            {notebooks.length > 0 ? (
              <optgroup label="Notebooks">
                {notebooks.map((notebook) => (
                  <option key={notebook.id} value={`notebook=${encodeURIComponent(notebook.id)}`}>
                    Notebook: {notebook.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <span className="help">
            Lists and notebooks come from your library. Choosing one here does not copy or delete
            anything.
          </span>
        </div>

        {sourceWords && !sourceWords.exists ? (
          <div className="notice notice-warn" role="status">
            <span>
              {sourceWords.label}: this source is not on the device any more. Pick another one
              above; cards you already made stay in their own deck.
            </span>
          </div>
        ) : null}

        {wordsLoading ? (
          <div className="skeleton" style={{ height: 40 }} />
        ) : source.kind === 'notebook' && !dictionaryReady ? (
          <LoadingGate>{null}</LoadingGate>
        ) : (
          <p className="text-sm muted">
            <strong>{words.length}</strong> word{words.length === 1 ? '' : 's'} available
            {deck ? ` in “${deck.name}”` : ' for a new deck'}.
            {sourceWords && sourceWords.missing > 0
              ? ` ${sourceWords.missing} note reference${sourceWords.missing === 1 ? '' : 's'} could not be resolved with the dictionary data installed here.`
              : ''}
          </p>
        )}
      </section>

      <section className="card learn-panel" aria-labelledby="learn-due-heading">
        <h2 id="learn-due-heading" className="h3">
          {deck ? deck.name : 'No deck yet'}
        </h2>
        <div className="learn-stats">
          <div className="learn-stat">
            <span className="learn-stat-value">{summary.reviewsDue}</span>
            <span className="learn-stat-label">due for review now</span>
          </div>
          <div className="learn-stat">
            <span className="learn-stat-value">{summary.newToday}</span>
            <span className="learn-stat-label">new cards today (of {summary.newAvailable} waiting)</span>
          </div>
          <div className="learn-stat">
            <span className="learn-stat-value">{summary.upcoming7}</span>
            <span className="learn-stat-label">coming up in the next 7 days</span>
          </div>
          <div className="learn-stat">
            <span className="learn-stat-value">{summary.total}</span>
            <span className="learn-stat-label">
              cards in this deck ({summary.suspended} suspended)
            </span>
          </div>
        </div>

        <div className="learn-inline">
          <div className="field learn-narrow-field">
            <label htmlFor="learn-new-per-day">New cards added per session</label>
            <input
              id="learn-new-per-day"
              className="input"
              type="number"
              min={0}
              max={200}
              inputMode="numeric"
              value={newPerDay}
              onChange={(event) => changeNewPerDay(event.currentTarget.valueAsNumber)}
            />
            <span className="help">A cap on introductions, not a limit on reviews.</span>
          </div>
          <div className="field">
            <label htmlFor="learn-prompt">Card prompt</label>
            <Segmented
              label="Card prompt"
              value={prompt}
              options={PROMPT_OPTIONS}
              onChange={(next) => void changePrompt(next)}
            />
            <span className="help" id="learn-prompt">
              Saved with the deck, so you can switch tomorrow.
            </span>
          </div>
        </div>

        <div className="row-wrap">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void startFlashcards()}
            disabled={busy || words.length === 0}
          >
            <IconCards /> {busy ? 'Preparing…' : deck ? 'Open flashcards' : 'Create deck and start'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setDrillOpen((open) => !open)}
            disabled={words.length < 4}
            aria-expanded={drillOpen}
          >
            <IconPen /> {drillOpen ? 'Close quick drill' : 'Quick drill'}
          </button>
          {words.length === 0 ? <span className="learn-hint">Nothing in this source yet.</span> : null}
          {words.length > 0 && words.length < 4 ? (
            <span className="learn-hint">A drill needs at least 4 words.</span>
          ) : null}
        </div>

        {drillOpen && words.length >= 4 ? (
          <DrillPanel
            words={words}
            label={sourceWords?.label ?? 'Practice'}
            deckId={deck ? deck.id : undefined}
            prefs={prefs}
          />
        ) : null}

        {summary.reviewsDue === 0 && summary.newToday === 0 && summary.total > 0 ? (
          <div className="notice notice-info" role="status">
            <span>
              Nothing is scheduled for right now in this deck. That is the interval maths working,
              not a penalty — come back when cards are due, or study another source.
            </span>
          </div>
        ) : null}
        <p className="learn-hint">
          A session fills up to your card limit (you set it when a session starts, currently{' '}
          {cap}). Nothing here is capped or locked: due cards and new cards both wait for you.
        </p>
      </section>

      <section className="card learn-panel" aria-labelledby="learn-goal-heading">
        <h2 id="learn-goal-heading" className="h3">Today, on this device</h2>
        <div className="learn-goal">
          <ProgressBar
            value={Math.min(gradedToday, goal)}
            total={goal}
            label={`${gradedToday} of ${goal} graded today`}
          />
          <p className="text-sm muted">
            {gradedToday} of {goal} graded ({todayRow?.reviews ?? 0} card reviews,{' '}
            {todayRow?.attempts ?? 0} answered questions). Your goal number is set in Settings.
            Nothing locks, resets or penalises you if a day goes by — the schedule just waits.
          </p>
          <p className="text-sm">{weeklySummary(days)}</p>
          <p className="text-sm faint">
            {currentStreak(activeDays)} day{currentStreak(activeDays) === 1 ? '' : 's'} in a row with
            at least one review or answer; {sums.activeDays} study days in total on this device.
          </p>
        </div>
      </section>

      {allDecks.length > 0 ? (
        <section className="card learn-panel" aria-labelledby="learn-decks-heading">
          <h2 id="learn-decks-heading" className="h3">Your decks &amp; Course decks</h2>
          <ul className="list">
            {allDecks.map((row) => (
              <li key={row.id}>
                <Link to={`/flashcards?deck=${encodeURIComponent(row.id)}`} className="item">
                  <span className="item-main">
                    <strong>{row.name}</strong>
                    <span className="text-sm muted">
                      {' · '}
                      {promptLabel(row.prompt)}
                    </span>
                  </span>
                  <span className="item-side">
                    <span className="badge">
                      {row.id.startsWith('deck-book-') ? 'khoá học' : 'deck'}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="learn-footnote">
            Decks are made from your own content and course lessons, synced automatically via GitHub.
          </p>
        </section>
      ) : null}

      <section className="card learn-panel" aria-labelledby="learn-more-heading">
        <h2 id="learn-more-heading" className="h3">Other ways to practise</h2>
        <div className="row-wrap">
          <Link to="/test" className="btn">
            Practice tests
          </Link>
          <Link to="/writing" className="btn">
            Character writing
          </Link>
          <Link to="/reader" className="btn">
            Reader
          </Link>
        </div>
      </section>
    </div>
  );
}

function promptLabel(prompt: Deck['prompt']): string {
  if (prompt === 'zh2en') return 'Chinese prompt';
  if (prompt === 'en2zh') return 'meaning prompt';
  return 'pinyin prompt';
}

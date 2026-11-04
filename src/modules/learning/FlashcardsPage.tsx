/** Flashcard review session. The queue comes from the scheduler's due/new functions, every
 *  grade is written through `schedule()` in one IndexedDB transaction, and leaving mid-session
 *  keeps the grades already made. */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { uid } from '../../app/hooks';
import { IconAlert, IconCards, IconSpeaker, IconChevronLeft } from '../../app/icons';
import { useDictionary, usePreferences, useToast } from '../../app/providers';
import { inspectSpeech, onVoicesChanged, speak } from '../../data/speech';
import { db } from '../../data/db';
import { previewInterval } from '../../domain/scheduler';
import type { Deck, ExampleSentence, Preferences, SrsCard, SrsRating } from '../../domain/types';
import { EmptyState, LoadingGate, PageHeader } from '../../components';
import {
  buildSessionQueue,
  closeSession,
  entryIdOfCard,
  glossList,
  hanziPrimary,
  hanziSecondary,
  loadSessionCap,
  persistRating,
  pinyinDisplay,
  RATINGS,
  saveSessionCap,
  summarizeCards,
  updateDeck,
} from './learningStore';
import './learning.css';

type Phase = 'setup' | 'running' | 'done';

interface Tally {
  graded: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
  newCount: number;
}

const EMPTY_TALLY: Tally = { graded: 0, again: 0, hard: 0, good: 0, easy: 0, newCount: 0 };

interface ExampleState {
  status: 'off' | 'loading' | 'none' | 'ready';
  rows: ExampleSentence[];
}

export default function FlashcardsPage() {
  const { prefs } = usePreferences();
  const { state, api } = useDictionary();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const decks = useLiveQuery(() => db.decks.toArray(), [], []);
  const requested = params.get('deck') ?? '';
  const deckId = requested || decks[0]?.id || '';
  const deck = useLiveQuery(
    async (): Promise<Deck | undefined> => (deckId ? await db.decks.get(deckId) : undefined),
    [deckId],
  );
  const cards = useLiveQuery(
    () => (deckId ? db.cards.where('deckId').equals(deckId).toArray() : Promise.resolve([] as SrsCard[])),
    [deckId],
    [],
  );

  const [phase, setPhase] = useState<Phase>('setup');
  const [queue, setQueue] = useState<SrsCard[]>([]);
  const [cursor, setCursor] = useState(0);
  const [tally, setTally] = useState<Tally>(EMPTY_TALLY);
  const [missed, setMissed] = useState<SrsCard[]>([]);
  const [cap, setCap] = useState(20);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState({ answer: false, pinyin: false });
  const [example, setExample] = useState<ExampleState>({ status: 'off', rows: [] });
  const [voiceTick, setVoiceTick] = useState(0);

  const sessionId = useRef('');
  const startedAt = useRef(new Date().toISOString());
  const questionStart = useRef(Date.now());
  const boxRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    void loadSessionCap().then(setCap);
  }, []);

  useEffect(() => onVoicesChanged(() => setVoiceTick((tick) => tick + 1)), []);

  const voice = useMemo(
    () => inspectSpeech(prefs.ttsLang),
    // re-read when the browser reports a different voice list
    // eslint-disable-next-line react-hooks/exhaustive-deps -- voiceTick is an invalidation signal, not an input to inspectSpeech
    [prefs.ttsLang, voiceTick],
  );

  useEffect(() => {
    if (phase !== 'running') return;
    boxRef.current?.focus({ preventScroll: true });
  }, [phase, cursor]);

  useEffect(() => {
    return () => {
      if (activeRef.current && sessionId.current) void closeSession(sessionId.current);
    };
  }, []);

  const card = queue[cursor];
  const summary = useMemo(() => summarizeCards(cards, deck?.newPerDay ?? prefs.dailyGoal), [cards, deck, prefs.dailyGoal]);

  const nextDueText = useMemo(() => {
    const future = cards
      .filter((row) => !row.suspended && new Date(row.due).getTime() > Date.now())
      .sort((a, b) => new Date(a.due).getTime() - new Date(b.due).getTime());
    const soonest = future[0];
    if (!soonest) return '';
    const hours = Math.max(1, Math.round((new Date(soonest.due).getTime() - Date.now()) / 3600000));
    return hours < 48 ? `in about ${hours} h` : `in about ${Math.round(hours / 24)} d`;
  }, [cards]);

  const start = (rows: SrsCard[], label: string) => {
    if (rows.length === 0) {
      toast.push({ message: `${label} is empty — nothing is due and no new cards are waiting.`, tone: 'warn' });
      return;
    }
    activeRef.current = true;
    sessionId.current = uid('flash-');
    startedAt.current = new Date().toISOString();
    questionStart.current = Date.now();
    setQueue(rows);
    setCursor(0);
    setTally(EMPTY_TALLY);
    setMissed([]);
    setRevealed({ answer: false, pinyin: false });
    setPhase('running');
  };

  const startSession = () => start(buildSessionQueue(cards, deck?.newPerDay ?? prefs.dailyGoal, cap), 'This deck');

  const retryMissed = () => {
    if (missed.length === 0) {
      toast.push('Nothing was rated “again” in the last session.');
      return;
    }
    start(missed, 'The missed cards');
  };

  const advance = (nextQueue: SrsCard[], nextCursor: number) => {
    setRevealed({ answer: false, pinyin: false });
    questionStart.current = Date.now();
    if (nextCursor >= nextQueue.length) {
      setPhase('done');
      if (sessionId.current) void closeSession(sessionId.current);
      activeRef.current = false;
      return;
    }
    setQueue(nextQueue);
    setCursor(nextCursor);
  };

  const grade = useCallback(
    async (rating: SrsRating) => {
      const current = queue[cursor];
      if (!current || busy || !deck) return;
      setBusy(true);
      const now = new Date();
      try {
        await persistRating({
          card: current,
          rating,
          sessionId: sessionId.current,
          sessionLabel: `Flashcards — ${deck.name}`,
          deckId: deck.id,
          startedAt: startedAt.current,
          question: `${deck.prompt}: ${current.simplified}`,
          ms: Math.max(0, now.getTime() - questionStart.current),
          now,
        });
        setTally((value) => ({
          graded: value.graded + 1,
          again: value.again + (rating === 'again' ? 1 : 0),
          hard: value.hard + (rating === 'hard' ? 1 : 0),
          good: value.good + (rating === 'good' ? 1 : 0),
          easy: value.easy + (rating === 'easy' ? 1 : 0),
          newCount: value.newCount + (current.repetitions === 0 && rating !== 'again' ? 1 : 0),
        }));
        if (rating === 'again' && !missed.some((row) => row.id === current.id)) setMissed((rows) => [...rows, current]);
        const nextQueue = [...queue];
        if (rating === 'again') {
          const position = Math.min(cursor + 3, nextQueue.length);
          nextQueue.splice(position, 0, current);
        }
        advance(nextQueue, cursor + 1);
      } catch (error) {
        console.error('Could not store that grade', error);
        toast.push({ message: 'That grade could not be stored. Nothing else changed.', tone: 'danger' });
      } finally {
        setBusy(false);
      }
    },
    [busy, cursor, deck, missed, queue, toast],
  );

  const pinyinText = card ? pinyinDisplay(card, prefs.pinyinStyle) : '';

  const showAnswer = () => {
    setRevealed((value) => ({ ...value, answer: true }));
    if (prefs.autoSpeak && voice.chineseVoice && card) void play(card, voice, prefs, toast);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (!revealed.answer) showAnswer();
      return;
    }
    const match = RATINGS.find((rating) => rating.shortcut === event.key);
    if (match) {
      event.preventDefault();
      void grade(match.value);
    }
  };

  useEffect(() => {
    if (phase !== 'running' || !card) {
      setExample({ status: 'off', rows: [] });
      return;
    }
    if (!api || state.phase !== 'ready' || !prefs.showExamples) {
      setExample({ status: 'off', rows: [] });
      return;
    }
    let alive = true;
    setExample({ status: 'loading', rows: [] });
    api
      .examples(card.simplified, 2)
      .then((rows) => {
        if (alive) setExample({ status: rows.length > 0 ? 'ready' : 'none', rows });
      })
      .catch((error: unknown) => {
        console.error('Example lookup failed', error);
        if (alive) setExample({ status: 'none', rows: [] });
      });
    return () => {
      alive = false;
    };
  }, [card, phase, api, state.phase, prefs.showExamples]);

  const front = useMemo(() => {
    if (!card || !deck) return null;
    if (deck.prompt === 'en2zh') return { kind: 'gloss' as const, text: card.definition };
    if (deck.prompt === 'pinyin2zh') {
      return {
        kind: 'pinyin' as const,
        text: pinyinDisplay(card, prefs.pinyinStyle === 'none' ? 'marks' : prefs.pinyinStyle),
      };
    }
    return { kind: 'hanzi' as const, text: hanziPrimary(card, prefs.displayScript) };
  }, [card, deck, prefs]);

  const changeCap = (value: number) => {
    const next = Math.max(1, Math.min(200, Math.round(value || 1)));
    setCap(next);
    void saveSessionCap(next);
  };

  if (decks.length === 0) {
    return (
      <div className="stack learn-flow">
        <PageHeader title="Flashcards" back={{ label: 'Practice', to: '/practice' }} />
        <EmptyState
          title="No deck on this device yet"
          detail="Pick a source in Practice and a deck is built from your saved words."
          action={
            <Link to="/practice" className="btn btn-primary btn-sm">
              Go to practice
            </Link>
          }
          icon={<IconCards />}
        />
      </div>
    );
  }

  return (
    <div className="stack learn-flow">
      <PageHeader
        title="Flashcards"
        subtitle={deck ? `Reviewing ${deck.name}` : 'Loading this deck'}
        back={{ label: 'Practice', to: '/practice' }}
      />

      {phase === 'setup' ? (
        <section className="card learn-panel" aria-labelledby="learn-setup-heading">
          <h2 id="learn-setup-heading" className="h3">This session</h2>
          <div className="learn-stats">
            <div className="learn-stat">
              <span className="learn-stat-value">{summary.reviewsDue}</span>
              <span className="learn-stat-label">due reviews</span>
            </div>
            <div className="learn-stat">
              <span className="learn-stat-value">{Math.min(summary.newAvailable, deck?.newPerDay ?? prefs.dailyGoal)}</span>
              <span className="learn-stat-label">new cards waiting ({summary.newAvailable} in the deck)</span>
            </div>
            <div className="learn-stat">
              <span className="learn-stat-value">{cap}</span>
              <span className="learn-stat-label">most cards per session</span>
            </div>
          </div>

          <div className="learn-inline">
            <div className="field">
              <label htmlFor="learn-deck">Deck</label>
              <select
                id="learn-deck"
                className="select"
                value={deckId}
                onChange={(event) => navigate(`/flashcards?deck=${encodeURIComponent(event.target.value)}`)}
              >
                {decks.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field learn-narrow-field">
              <label htmlFor="learn-cap">Cards per session</label>
              <input
                id="learn-cap"
                className="input"
                type="number"
                min={1}
                max={200}
                inputMode="numeric"
                value={cap}
                onChange={(event) => changeCap(event.currentTarget.valueAsNumber)}
              />
              <span className="help">A comfort limit only — nothing is locked if you go over.</span>
            </div>
            <div className="field learn-narrow-field">
              <label htmlFor="learn-new">New cards in this session</label>
              <input
                id="learn-new"
                className="input"
                type="number"
                min={0}
                max={200}
                inputMode="numeric"
                value={deck?.newPerDay ?? prefs.dailyGoal}
                onChange={(event) => {
                  const value = Math.max(0, Math.min(200, Math.round(event.currentTarget.valueAsNumber || 0)));
                  if (deck) void updateDeck(deck.id, { newPerDay: value });
                }}
              />
              <span className="help">Saved on the deck, used by the scheduler’s new-card pick.</span>
            </div>
          </div>

          <div className="row-wrap">
            <button type="button" className="btn btn-primary" onClick={startSession} disabled={!deck}>
              <IconCards /> Start review
            </button>
          </div>

          {summary.reviewsDue + summary.newAvailable === 0 ? (
            <p className="notice" role="status">
              Nothing is scheduled in this deck right now{nextDueText ? ` — the next card is due ${nextDueText}` : ''}.
              Your previous grades are already saved, so there is nothing to finish here.
            </p>
          ) : (
            <p className="learn-hint">
              Reviews fill the session first; new cards are introduced up to the number above. Every
              grade is stored the moment you tap it, so closing the tab keeps your work.
            </p>
          )}
        </section>
      ) : null}

      {phase === 'running' && card && deck ? (
        <section className="learn-flash" aria-label="Flashcard session">
          <div className="row-wrap" role="status" aria-live="polite">
            <span className="text-sm">
              Card {cursor + 1} of {queue.length} · {queue.length - cursor - 1} left · {tally.graded} graded
            </span>
            <span className="spacer" />
            <span className="badge">{deck.name}</span>
          </div>

          <div className="learn-flash-card" ref={boxRef} tabIndex={0} onKeyDown={onKeyDown} aria-label="Flashcard. Press space to reveal the answer, then 1 to 4 to grade.">
            <div className="learn-flash-meta">
              <span>{front?.kind === 'gloss' ? 'Meaning → Chinese' : front?.kind === 'pinyin' ? 'Pinyin → Chinese' : 'Chinese → meaning'}</span>
              <span>·</span>
              <span>{card.repetitions === 0 ? 'new card' : `interval ${card.interval} d · ${card.repetitions} reviews`}</span>
              {card.lapses > 0 ? (
                <>
                  <span>·</span>
                  <span>{card.lapses} time{card.lapses === 1 ? '' : 's'} missed before</span>
                </>
              ) : null}
            </div>

            <div className="learn-flash-front">
              {front?.kind === 'hanzi' ? (
                <span className={`hanzi hanzi-xl`} lang="zh">
                  <span className="hanzi-primary cjk">{front.text}</span>
                  {hanziSecondary(card, prefs.displayScript) ? (
                    <span className="hanzi-secondary cjk faint"> {hanziSecondary(card, prefs.displayScript)}</span>
                  ) : null}
                </span>
              ) : (
                <p className="learn-stem">{front?.text}</p>
              )}
              {front?.kind === 'pinyin' && prefs.pinyinStyle === 'none' ? (
                <p className="learn-hint">
                  Pinyin is hidden in your settings; this prompt needs it, so it is shown here.
                </p>
              ) : null}
            </div>

            <div className="learn-reveal-row">
              {!revealed.answer ? (
                <button type="button" className="btn btn-sm btn-primary" onClick={showAnswer}>
                  Show answer
                </button>
              ) : null}
              {revealed.answer && front?.kind !== 'pinyin' ? (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setRevealed((value) => ({ ...value, pinyin: !value.pinyin }))}
                  aria-pressed={revealed.pinyin}
                  disabled={prefs.pinyinStyle === 'none'}
                >
                  {revealed.pinyin ? 'Hide pinyin' : 'Show pinyin'}
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-sm btn-icon"
                onClick={() => void play(card, voice, prefs, toast)}
                disabled={!voice.chineseVoice}
                aria-label={`Play the pronunciation of ${hanziPrimary(card, prefs.displayScript)}`}
                title={voice.chineseVoice ? `Device voice: ${voice.voiceName ?? 'default'}` : 'No Chinese voice installed'}
              >
                <IconSpeaker />
              </button>
              <Link to={`/entry/${encodeURIComponent(entryIdOfCard(card))}`} className="btn btn-sm btn-ghost">
                Open entry
              </Link>
            </div>

            {!voice.available || !voice.chineseVoice ? (
              <p className="learn-hint" role="status">
                <IconAlert /> {voice.reason ?? 'No Chinese voice is installed on this device.'} Pinyin and
                the written form are here instead.
              </p>
            ) : null}

            {revealed.answer ? (
              <div className="learn-answer">
                {front?.kind !== 'hanzi' ? (
                  <span className="hanzi hanzi-lg" lang="zh">
                    <span className="hanzi-primary cjk">{hanziPrimary(card, prefs.displayScript)}</span>
                    {hanziSecondary(card, prefs.displayScript) ? (
                      <span className="hanzi-secondary cjk faint"> {hanziSecondary(card, prefs.displayScript)}</span>
                    ) : null}
                  </span>
                ) : null}
                {revealed.pinyin && pinyinText && front?.kind !== 'pinyin' ? (
                  <span className="pinyin">{pinyinText}</span>
                ) : null}
                {front?.kind !== 'gloss' ? (
                  <span className="definition">
                    {glossList(card.definition).length > 2 ? (
                      <ol className="gloss-list">
                        {glossList(card.definition).map((gloss, index) => (
                          <li key={`${index}-${gloss.slice(0, 12)}`}>{gloss}</li>
                        ))}
                      </ol>
                    ) : (
                      card.definition
                    )}
                  </span>
                ) : null}
                {example.status === 'ready' ? (
                  <div className="learn-example">
                    <strong className="text-sm">Example from the examples pack</strong>
                    {example.rows.map((row, index) => (
                      <div key={`${row.simplified}-${index}`}>
                        <span className="cjk" lang="zh">{row.simplified}</span>{' '}
                        <span className="pinyin">{row.pinyin}</span>
                        <div className="muted">{row.english}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {example.status === 'off' && (!api || state.phase !== 'ready') ? (
                  <LoadingGate>
                    <p className="learn-hint">Example sentences appear once the dictionary is ready.</p>
                  </LoadingGate>
                ) : null}
                {example.status === 'none' ? (
                  <p className="learn-hint">No example sentence for this word in the pack installed here.</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="learn-grade-grid" role="group" aria-label="Grade this card">
            {RATINGS.map((rating) => (
              <button
                key={rating.value}
                type="button"
                className="learn-grade-btn"
                onClick={() => void grade(rating.value)}
                disabled={busy}
                title={rating.meaning}
                aria-label={`${rating.label}. ${rating.meaning} Next review ${previewInterval(card, rating.value)}.`}
              >
                <span>{rating.label}</span>
                <span className="learn-grade-next">{previewInterval(card, rating.value)}</span>
                <span className="learn-grade-key">
                  <kbd>{rating.shortcut}</kbd>
                </span>
              </button>
            ))}
          </div>
          <p className="learn-hint">
            Keyboard: <kbd>space</kbd> reveals the answer, <kbd>1</kbd>–<kbd>4</kbd> grade it. Every
            button works by tap as well.
          </p>
        </section>
      ) : null}

      {phase === 'done' ? (
        <section className="card learn-panel" role="status" aria-live="polite" aria-labelledby="learn-done-heading">
          <h2 id="learn-done-heading" className="h3">Session finished</h2>
          <div className="learn-stats">
            <div className="learn-stat">
              <span className="learn-stat-value">{tally.graded}</span>
              <span className="learn-stat-label">cards graded</span>
            </div>
            <div className="learn-stat">
              <span className="learn-stat-value">{tally.hard + tally.good + tally.easy}</span>
              <span className="learn-stat-label">recalled (hard, good or easy)</span>
            </div>
            <div className="learn-stat">
              <span className="learn-stat-value">{tally.again}</span>
              <span className="learn-stat-label">rated “again”</span>
            </div>
            <div className="learn-stat">
              <span className="learn-stat-value">{tally.newCount}</span>
              <span className="learn-stat-label">new cards introduced</span>
            </div>
          </div>
          <p className="text-sm muted">
            Hard {tally.hard} · good {tally.good} · easy {tally.easy}. Each grade was written through
            the scheduler as you made it, so these intervals are already on the cards. Nothing is
            stored anywhere but this device.
          </p>
          <div className="row-wrap">
            <button type="button" className="btn btn-primary" onClick={retryMissed} disabled={missed.length === 0}>
              <IconChevronLeft /> Study the {missed.length} you missed
            </button>
            <button type="button" className="btn" onClick={() => setPhase('setup')}>
              Back to the session setup
            </button>
            <Link to="/practice" className="btn">
              Practice
            </Link>
            <Link to="/progress" className="btn btn-ghost">
              See progress
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}

async function play(
  card: SrsCard,
  voice: { chineseVoice: boolean },
  prefs: Preferences,
  toast: { push: (message: string) => unknown },
): Promise<void> {
  if (!voice.chineseVoice) return;
  const result = await speak(hanziPrimary(card, prefs.displayScript), { lang: prefs.ttsLang, rate: prefs.ttsRate });
  if (!result.ok) toast.push(result.reason ?? 'No audio available on this device.');
}

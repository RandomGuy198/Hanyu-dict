/** Learning storage: turn the user's own content into a deck, build a review queue with the
 *  scheduler, and write every rating/answer to IndexedDB in one transaction. Nothing here
 *  invents an algorithm — the interval maths lives in src/domain/scheduler.ts. */

import { uid } from '../../app/hooks';
import { bumpActivity, db, getMeta, setMeta, todayKey } from '../../data/db';
import { markDirty } from '../../data/syncEngine';
import { dueQueue, isDue, newCard, newCards, reviewDelta, schedule } from '../../domain/scheduler';
import { marksToNumbered } from '../../domain/pinyin';
import { entryId } from '../../domain/searchRanking';
import type {
  Deck,
  DictEntry,
  LessonVocabItem,
  PracticeAttempt,
  PracticeSession,
  Preferences,
  SavedWord,
  SrsCard,
  SrsRating,
} from '../../domain/types';

/** The schema declares `attempts` with `++id` (a numeric key) while `PracticeAttempt.id` is a
 *  string, so lookups by our own stable id go through a handle re-keyed to string. */
const attemptsByKey = db.table<PracticeAttempt, string>('attempts');

/* ------------------------------------------------------------------ sources */

export type SourceKind = 'saved' | 'list' | 'notebook';

export type SourceRef =
  | { kind: 'saved' }
  | { kind: 'list'; id: string }
  | { kind: 'notebook'; id: string };

export function parseSource(listId: string, notebookId: string): SourceRef {
  if (listId) return { kind: 'list', id: listId };
  if (notebookId) return { kind: 'notebook', id: notebookId };
  return { kind: 'saved' };
}

export function sourceToSearch(src: SourceRef): string {
  if (src.kind === 'list') return `?list=${encodeURIComponent(src.id)}`;
  if (src.kind === 'notebook') return `?notebook=${encodeURIComponent(src.id)}`;
  return '';
}

export function sourceKindLabel(src: SourceRef): string {
  return src.kind === 'saved' ? 'All saved words' : src.kind === 'list' ? 'Word list' : 'Notebook';
}

export function deckIdFor(src: SourceRef): string {
  if (src.kind === 'list') return `deck-list-${src.id}`;
  if (src.kind === 'notebook') return `deck-notebook-${src.id}`;
  return 'deck-saved';
}

/** One word a card can be built from: the cached fields every source row carries. */
export interface LearningWord {
  id: string;
  simplified: string;
  traditional: string;
  pinyinMarked: string;
  definition: string;
}

export interface SourceWords {
  words: LearningWord[];
  label: string;
  /** references the dictionary on this device could not resolve (pack removed, stale id). */
  missing: number;
  exists: boolean;
}

/** Resolve a source into words. Notebook references are dictionary entry ids, so they are
 *  looked up through the licensed index; a miss is counted, never invented. */
export async function loadSourceWords(
  src: SourceRef,
  lookup: (entryId: string) => Promise<DictEntry | undefined>,
): Promise<SourceWords> {
  if (src.kind === 'saved') {
    const rows = await db.savedWords.toArray();
    return { words: rows.map(toWord), label: 'All saved words', missing: 0, exists: true };
  }
  if (src.kind === 'list') {
    const list = await db.wordLists.get(src.id);
    const rows = await db.savedWords.where('lists').equals(src.id).toArray();
    return {
      words: rows.map(toWord),
      label: list ? list.name : 'This list no longer exists',
      missing: 0,
      exists: Boolean(list),
    };
  }
  const notebook = await db.notebooks.get(src.id);
  const notes = await db.notebookEntries.where('notebookId').equals(src.id).toArray();
  const ids = [...new Set(notes.flatMap((note) => note.entryIds))];
  const words: LearningWord[] = [];
  let missing = 0;
  for (const id of ids) {
    const found = await lookup(id);
    if (found) words.push(toWord(found));
    else missing += 1;
  }
  return {
    words,
    label: notebook ? notebook.name : 'This notebook no longer exists',
    missing,
    exists: Boolean(notebook),
  };
}

function toWord(row: {
  id: string;
  simplified: string;
  traditional: string;
  pinyinMarked: string;
  definition: string;
}): LearningWord {
  return {
    id: row.id,
    simplified: row.simplified,
    traditional: row.traditional,
    pinyinMarked: row.pinyinMarked,
    definition: row.definition,
  };
}

/* ------------------------------------------------------------------ decks */

export interface DeckSetup {
  deck: Deck;
  cards: SrsCard[];
  added: number;
}

/** Open the deck for this source, creating it on first use, and add a card for every word
 *  that does not have one yet. Existing cards (and their schedules) are never rewritten. */
export async function ensureDeck(
  src: SourceRef,
  words: LearningWord[],
  label: string,
  newPerDay: number,
  now = new Date(),
): Promise<DeckSetup> {
  const id = deckIdFor(src);
  const iso = now.toISOString();
  const setup = await db.transaction('rw', db.decks, db.cards, async () => {
    const existing = await db.decks.get(id);
    const deck: Deck = existing ?? {
      id,
      name: label,
      createdAt: iso,
      updatedAt: iso,
      prompt: 'zh2en',
      newPerDay: Math.max(1, Math.round(newPerDay)),
    };
    if (!existing) await db.decks.add(deck);
    const cards = await db.cards.where('deckId').equals(id).toArray();
    const have = new Set(cards.map((card) => card.id));
    const stamped = deck.id + '|';
    const additions = words
      .filter((word) => !have.has(stamped + word.id))
      .map((word) => ({
        ...newCard(deck.id, word, now),
        kind: 'recognition' as const,
        updatedAt: iso,
      }));
    if (additions.length > 0) await db.cards.bulkPut(additions);
    return { deck, cards: [...cards, ...additions], added: additions.length };
  });
  markDirty();
  return setup;
}

/** `Deck` carries `updatedAt` for deterministic cross-device sync. */
export async function updateDeck(id: string, patch: Partial<Omit<Deck, 'id' | 'createdAt'>>): Promise<void> {
  const iso = new Date().toISOString();
  await db.transaction('rw', db.decks, async () => {
    const deck = await db.decks.get(id);
    if (deck) await db.decks.put({ ...deck, ...patch, updatedAt: iso });
  });
  markDirty();
}

export interface CourseDeckResult {
  deck: Deck;
  addedRecognition: number;
  addedWriting: number;
  totalCards: number;
}

/**
 * Creates or updates the course deck `deck-book-${bookId}` ("Khoá học Hán ngữ — Quyển ${volumeNumber}")
 * with recognition cards for vocabulary items and writing cards for single characters, plus saves
 * vocabulary into `savedWords` if requested.
 */
export async function ensureCourseLessonDeckAndCards(
  bookId: string,
  volumeNumber: number,
  vocab: LessonVocabItem[],
  writingTargets: string[],
  options?: {
    lessonId?: string;
    saveToLibrary?: boolean;
    scheduleInitialReview?: boolean;
    now?: Date;
  },
): Promise<CourseDeckResult> {
  const now = options?.now ?? new Date();
  const iso = now.toISOString();
  const deckId = `deck-book-${bookId}`;
  const deckName = `Khoá học Hán ngữ — Quyển ${volumeNumber}`;
  const lessonId = options?.lessonId;

  const result = await db.transaction('rw', db.decks, db.cards, db.savedWords, async () => {
    const existingDeck = await db.decks.get(deckId);
    const deck: Deck = existingDeck
      ? { ...existingDeck, name: deckName, updatedAt: iso }
      : {
          id: deckId,
          name: deckName,
          createdAt: iso,
          updatedAt: iso,
          prompt: 'zh2en',
          newPerDay: 20,
        };
    await db.decks.put(deck);

    const existingCards = await db.cards.where('deckId').equals(deckId).toArray();
    const byId = new Map<string, SrsCard>(existingCards.map((c) => [c.id, c]));
    const cardsToPut: SrsCard[] = [];
    let addedRecognition = 0;
    let addedWriting = 0;

    if (options?.saveToLibrary) {
      const existingSaved = await db.savedWords.toArray();
      const savedById = new Map<string, SavedWord>(existingSaved.map((w) => [w.id, w]));
      const savedToPut: SavedWord[] = [];

      for (const item of vocab) {
        const wordId = entryId(item.hanzi, item.pinyinNumbered || marksToNumbered(item.pinyin));
        if (!savedById.has(wordId)) {
          savedToPut.push({
            id: wordId,
            addedAt: iso,
            updatedAt: iso,
            lists: [],
            simplified: item.hanzi,
            traditional: item.traditional || item.hanzi,
            pinyinMarked: item.pinyin,
            definition: item.meaningVi ? `${item.meaningVi}; ${item.meaningEn}` : item.meaningEn,
            definitionVi: item.meaningVi,
            hanViet: item.hanViet,
          });
        }
      }
      if (savedToPut.length > 0) {
        await db.savedWords.bulkPut(savedToPut);
      }
    }

    for (const item of vocab) {
      const wordId = entryId(item.hanzi, item.pinyinNumbered || marksToNumbered(item.pinyin));
      const baseCard = newCard(
        deckId,
        {
          id: wordId,
          simplified: item.hanzi,
          traditional: item.traditional || item.hanzi,
          pinyinMarked: item.pinyin,
          definition: item.meaningVi
            ? `${item.meaningVi}${item.meaningEn ? ` — ${item.meaningEn}` : ''}`
            : item.meaningEn,
        },
        now,
      );
      const existing = byId.get(baseCard.id);
      if (!existing) {
        const enriched: SrsCard = {
          ...baseCard,
          kind: 'recognition',
          pinyinNumbered: item.pinyinNumbered,
          hanViet: item.hanViet,
          definitionVi: item.meaningVi,
          ...(lessonId ? { lessonId } : {}),
          updatedAt: iso,
        };
        const finalCard = options?.scheduleInitialReview
          ? { ...schedule(enriched, 'good', now), updatedAt: iso }
          : enriched;
        cardsToPut.push(finalCard);
        byId.set(finalCard.id, finalCard);
        addedRecognition += 1;
      } else if (options?.scheduleInitialReview && existing.repetitions === 0) {
        const scheduled = { ...schedule(existing, 'good', now), updatedAt: iso };
        cardsToPut.push(scheduled);
        byId.set(scheduled.id, scheduled);
      }
    }

    for (const char of writingTargets) {
      const trimmed = char.trim();
      if (!trimmed) continue;
      // Find matching vocab item containing this character for reading/meaning context
      const sourceVocab =
        vocab.find((v) => v.hanzi === trimmed) ?? vocab.find((v) => v.hanzi.includes(trimmed));
      const charCardEntryId = `write:${trimmed}`;
      const baseWrite = newCard(
        deckId,
        {
          id: charCardEntryId,
          simplified: trimmed,
          traditional: sourceVocab?.traditional && sourceVocab.hanzi === trimmed ? sourceVocab.traditional : trimmed,
          pinyinMarked: sourceVocab?.pinyin ?? '',
          definition: sourceVocab
            ? `Tập viết chữ ${trimmed} (từ: ${sourceVocab.hanzi} — ${sourceVocab.meaningVi || sourceVocab.meaningEn})`
            : `Tập viết chữ Hán: ${trimmed}`,
        },
        now,
      );
      const existingWrite = byId.get(baseWrite.id);
      if (!existingWrite) {
        const enrichedWrite: SrsCard = {
          ...baseWrite,
          kind: 'writing',
          pinyinNumbered: sourceVocab?.pinyinNumbered,
          hanViet: sourceVocab?.hanViet,
          definitionVi: sourceVocab?.meaningVi,
          ...(lessonId ? { lessonId } : {}),
          updatedAt: iso,
        };
        const finalWrite = options?.scheduleInitialReview
          ? { ...schedule(enrichedWrite, 'good', now), updatedAt: iso }
          : enrichedWrite;
        cardsToPut.push(finalWrite);
        byId.set(finalWrite.id, finalWrite);
        addedWriting += 1;
      } else if (options?.scheduleInitialReview && existingWrite.repetitions === 0) {
        const scheduledWrite = { ...schedule(existingWrite, 'good', now), updatedAt: iso };
        cardsToPut.push(scheduledWrite);
        byId.set(scheduledWrite.id, scheduledWrite);
      }
    }

    if (cardsToPut.length > 0) {
      await db.cards.bulkPut(cardsToPut);
    }

    return {
      deck,
      addedRecognition,
      addedWriting,
      totalCards: byId.size,
    };
  });

  markDirty();
  return result;
}

export const ensureLessonCourseSrsCards = ensureCourseLessonDeckAndCards;

export function entryIdOfCard(card: SrsCard): string {
  const prefix = `${card.deckId}|`;
  return card.id.startsWith(prefix) ? card.id.slice(prefix.length) : card.id;
}

/* ------------------------------------------------------------------ queue */

/** Reviews get the room first, then up to `newLimit` brand-new cards; total never passes
 *  `maxCards`. Order is deterministic so a session replays the same way. */
export function buildSessionQueue(
  cards: SrsCard[],
  newLimit: number,
  maxCards: number,
  now = new Date(),
): SrsCard[] {
  const cap = Math.max(1, Math.round(maxCards));
  const reviews = dueQueue(cards.filter((card) => card.repetitions > 0 && !card.suspended), now);
  const fresh = newCards(cards, { newPerDay: Math.max(0, Math.round(newLimit)) });
  const newTake = fresh.slice(0, Math.min(fresh.length, cap));
  const reviewTake = reviews.slice(0, Math.max(0, cap - newTake.length));
  return spread(reviewTake, newTake);
}

function spread(reviews: SrsCard[], fresh: SrsCard[]): SrsCard[] {
  if (fresh.length === 0) return reviews;
  if (reviews.length === 0) return fresh;
  const gap = Math.max(1, Math.floor(reviews.length / fresh.length));
  const out: SrsCard[] = [];
  let sinceNew = 0;
  let newCursor = 0;
  for (const card of reviews) {
    out.push(card);
    sinceNew += 1;
    if (sinceNew >= gap && newCursor < fresh.length) {
      out.push(fresh[newCursor]);
      newCursor += 1;
      sinceNew = 0;
    }
  }
  while (newCursor < fresh.length) out.push(fresh[newCursor++]);
  return out;
}

export interface DueSummary {
  total: number;
  reviewsDue: number;
  newAvailable: number;
  newToday: number;
  upcoming7: number;
  suspended: number;
  inReview: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function summarizeCards(cards: SrsCard[], newLimit: number, now = new Date()): DueSummary {
  const live = cards.filter((card) => !card.suspended);
  const reviews = live.filter((card) => card.repetitions > 0);
  const fresh = live.filter((card) => card.repetitions === 0);
  const soon = new Date(now.getTime() + WEEK_MS);
  return {
    total: cards.length,
    reviewsDue: reviews.filter((card) => isDue(card, now)).length,
    newAvailable: fresh.length,
    newToday: Math.min(fresh.length, Math.max(0, Math.round(newLimit))),
    upcoming7: reviews.filter((card) => !isDue(card, now) && new Date(card.due) < soon).length,
    suspended: cards.length - live.length,
    inReview: reviews.length,
  };
}

/* ------------------------------------------------------------------ writing */

export interface ReviewWrite {
  card: SrsCard;
  rating: SrsRating;
  sessionId: string;
  sessionLabel: string;
  deckId: string;
  startedAt: string;
  question: string;
  ms: number;
  now?: Date;
}

/** Persist one grade: next schedule, an attempt row, the running session, today's activity. */
export async function persistRating(write: ReviewWrite): Promise<SrsCard> {
  const now = write.now ?? new Date();
  const next: SrsCard = {
    ...schedule(write.card, write.rating, now),
    updatedAt: now.toISOString(),
  };
  const delta = reviewDelta(write.card, write.rating);
  await db.transaction('rw', db.cards, db.attempts, db.sessions, db.activity, async () => {
    await db.cards.put(next);
    await db.attempts.add({
      id: uid('att-'),
      sessionId: write.sessionId,
      kind: 'flashcard',
      entryId: entryIdOfCard(write.card),
      question: write.question,
      given: write.rating,
      expected: 'hard, good or easy',
      correct: write.rating !== 'again',
      ms: write.ms,
      at: now.toISOString(),
    });
    await upsertSession(
      {
        id: write.sessionId,
        kind: 'flashcard',
        label: write.sessionLabel,
        startedAt: write.startedAt,
        deckId: write.deckId,
      },
      write.rating === 'again' ? 0 : 1,
    );
    await bumpActivity(todayKey(now), { reviews: delta.reviews, newCards: delta.newCards });
  });
  markDirty();
  return next;
}

export interface AnswerWrite {
  kind: 'quiz' | 'test';
  sessionId: string;
  sessionLabel: string;
  startedAt: string;
  question: string;
  given: string;
  expected: string;
  correct: boolean;
  ms: number;
  entryId?: string;
  deckId?: string;
  testId?: string;
  /** stable key so re-answering one question updates it instead of adding a second attempt */
  attemptId?: string;
}

/** One answered question from a drill or a practice test. */
export async function persistAnswer(write: AnswerWrite): Promise<void> {
  const now = new Date();
  const row: PracticeAttempt = {
    id: write.attemptId ?? uid('att-'),
    sessionId: write.sessionId,
    kind: write.kind,
    entryId: write.entryId,
    question: write.question,
    given: write.given,
    expected: write.expected,
    correct: write.correct,
    ms: write.ms,
    at: now.toISOString(),
  };
  await db.transaction('rw', db.attempts, db.sessions, db.activity, async () => {
    const previous = write.attemptId ? await attemptsByKey.get(write.attemptId) : undefined;
    if (previous) await attemptsByKey.put(row);
    else await db.attempts.add(row);
    const attemptsDelta = previous ? 0 : 1;
    const correctDelta = Number(row.correct) - Number(previous?.correct ?? false);
    await upsertSession(
      {
        id: write.sessionId,
        kind: write.kind,
        label: write.sessionLabel,
        startedAt: write.startedAt,
        deckId: write.deckId,
        testId: write.testId,
      },
      correctDelta,
      attemptsDelta,
    );
    await bumpActivity(todayKey(now), { attempts: attemptsDelta, correct: correctDelta });
  });
}

async function upsertSession(
  init: Omit<PracticeSession, 'total' | 'correct'>,
  correctDelta: number,
  attemptsDelta = 1,
): Promise<void> {
  const existing = await db.sessions.get(init.id);
  if (existing) {
    await db.sessions.put({
      ...existing,
      total: Math.max(0, existing.total + attemptsDelta),
      correct: Math.max(0, existing.correct + correctDelta),
    });
    return;
  }
  await db.sessions.add({
    ...init,
    total: Math.max(0, attemptsDelta),
    correct: Math.max(0, correctDelta),
  });
}

/** Called when a session is left mid-way: keeps the ratings already made, closes the record. */
export async function closeSession(sessionId: string, endedAt = new Date()): Promise<void> {
  await db.transaction('rw', db.sessions, async () => {
    const session = await db.sessions.get(sessionId);
    if (session && !session.endedAt) await db.sessions.put({ ...session, endedAt: endedAt.toISOString() });
  });
}

/** Retry a test run: drop its attempt rows and their activity contribution, nothing else. */
export async function discardRun(sessionId: string): Promise<number> {
  const rows = await db.attempts.where('sessionId').equals(sessionId).toArray();
  const correct = rows.filter((row) => row.correct).length;
  await db.transaction('rw', db.attempts, db.sessions, db.activity, async () => {
    await db.attempts.where('sessionId').equals(sessionId).delete();
    await db.sessions.delete(sessionId);
    if (rows.length > 0) await bumpActivity(todayKey(), { attempts: -rows.length, correct: -correct });
  });
  return rows.length;
}

/* ------------------------------------------------------------------ session cap */

const CAP_KEY = 'learning.max-per-session';
const DEFAULT_CAP = 20;

export async function loadSessionCap(): Promise<number> {
  const stored = await getMeta<number>(CAP_KEY);
  return typeof stored === 'number' && Number.isFinite(stored) ? Math.round(stored) : DEFAULT_CAP;
}

export async function saveSessionCap(value: number): Promise<void> {
  await setMeta(CAP_KEY, Math.max(1, Math.min(500, Math.round(value))));
}

export const RATINGS: {
  value: SrsRating;
  shortcut: string;
  label: string;
  meaning: string;
}[] = [
  { value: 'again', shortcut: '1', label: 'Again', meaning: 'I did not get it — show it to me again in this session.' },
  { value: 'hard', shortcut: '2', label: 'Hard', meaning: 'I got it, but only after real effort.' },
  { value: 'good', shortcut: '3', label: 'Good', meaning: 'I got it with normal effort.' },
  { value: 'easy', shortcut: '4', label: 'Easy', meaning: 'Recall felt automatic.' },
];

/* ------------------------------------------------------------------ display helpers */

/** Pinyin for a cached card row in the style the learner chose. Rows only store the tone-marked
 *  form, so the digit style is derived with the project's own pinyin converter. */
export function pinyinDisplay(row: { pinyinMarked: string }, style: Preferences['pinyinStyle']): string {
  if (style === 'none') return '';
  return style === 'numbers' ? marksToNumbered(row.pinyinMarked) : row.pinyinMarked;
}

export function hanziPrimary(row: { simplified: string; traditional: string }, script: Preferences['displayScript']): string {
  if (script === 'traditional') return row.traditional || row.simplified;
  return row.simplified;
}

/** The other script, shown beside the primary one only in the "both" preference. */
export function hanziSecondary(
  row: { simplified: string; traditional: string },
  script: Preferences['displayScript'],
): string {
  if (script !== 'both') return '';
  return row.traditional && row.traditional !== row.simplified ? row.traditional : '';
}

export function glossList(definition: string): string[] {
  return definition.split('; ').filter(Boolean);
}

/** Spaced repetition: an independently designed interval-repetition scheduler.
 *
 *  This is not a reimplementation of any proprietary algorithm. The rules are deliberately
 *  short, visible and testable:
 *
 *  - A card is `new` until its first successful review, then it enters review.
 *  - Intervals grow multiplicatively by an ease factor (floor 1.3, ceiling 3.0, starts 2.5).
 *  - `again` sends the card back to a 10-minute step and shaves 0.20 off ease; the lapse
 *    counter is what the statistics and achievements read.
 *  - `hard` grows the interval by only 1.2x and shaves 0.15 off ease.
 *  - `good` uses the ease factor; the first two successes are pinned to 1 and 3 days so new
 *    material is not thrown weeks away.
 *  - `easy` adds 0.05 ease (max 3.0) and multiplies by 1.3.
 *  - Intervals are capped at 365 days. Nothing is random, so a review session replays the
 *    same way in tests, and no card is ever hidden behind a payment or a daily paywall. */

import type { Deck, SrsCard, SrsRating } from './types';

export const EASE_FLOOR = 1.3;
export const EASE_CEILING = 3.0;
export const EASE_DEFAULT = 2.5;
export const INTERVAL_CAP_DAYS = 365;
export const AGAIN_STEP_MINUTES = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

export function addMinutes(from: Date, minutes: number): Date {
  return new Date(from.getTime() + minutes * 60 * 1000);
}

export function clampEase(ease: number): number {
  return Math.min(EASE_CEILING, Math.max(EASE_FLOOR, ease));
}

function roundInterval(days: number): number {
  return days < 1 ? Math.round(days * 1440) / 1440 : Math.round(days * 10) / 10;
}

export function newCard(deckId: string, entry: {
  id: string;
  simplified: string;
  traditional: string;
  pinyinMarked: string;
  definition: string;
}, now = new Date()): SrsCard {
  return {
    id: `${deckId}|${entry.id}`,
    deckId,
    simplified: entry.simplified,
    traditional: entry.traditional,
    pinyinMarked: entry.pinyinMarked,
    definition: entry.definition,
    interval: 0,
    ease: EASE_DEFAULT,
    repetitions: 0,
    lapses: 0,
    due: now.toISOString(),
    createdAt: now.toISOString(),
  };
}

/** Pure transition: given a card and a rating, return the next state. */
export function schedule(card: SrsCard, rating: SrsRating, now = new Date()): SrsCard {
  const ease = clampEase(card.ease ?? EASE_DEFAULT);
  const base: SrsCard = { ...card, lastReviewed: now.toISOString() };

  if (rating === 'again') {
    return {
      ...base,
      repetitions: 0,
      lapses: card.lapses + 1,
      interval: 0,
      ease: clampEase(ease - 0.2),
      due: addMinutes(now, AGAIN_STEP_MINUTES).toISOString(),
    };
  }

  const repetitions = card.repetitions + 1;
  let interval: number;
  if (card.repetitions === 0) {
    interval = rating === 'easy' ? 4 : 1;
  } else if (card.repetitions === 1 && rating === 'good') {
    interval = 3;
  } else if (rating === 'hard') {
    interval = Math.max(0.35, card.interval * 1.2);
  } else if (rating === 'easy') {
    interval = Math.max(1, (card.interval || 1) * ease * 1.3);
  } else {
    interval = Math.max(1, card.interval * ease);
  }
  interval = roundInterval(Math.min(INTERVAL_CAP_DAYS, interval));

  return {
    ...base,
    repetitions,
    interval,
    ease: rating === 'easy' ? clampEase(ease + 0.05) : rating === 'hard' ? clampEase(ease - 0.15) : ease,
    due: addDays(now, interval).toISOString(),
  };
}

export function isDue(card: SrsCard, now = new Date()): boolean {
  if (card.suspended) return false;
  return new Date(card.due).getTime() <= now.getTime();
}

/** Queue order: overdue first (oldest due), then by interval length, then id for stability. */
export function dueQueue(cards: SrsCard[], now = new Date(), limit?: number): SrsCard[] {
  const queue = cards.filter((card) => isDue(card, now));
  queue.sort((a, b) => {
    const dueDiff = new Date(a.due).getTime() - new Date(b.due).getTime();
    if (dueDiff !== 0) return dueDiff;
    if (a.repetitions !== b.repetitions) return a.repetitions - b.repetitions;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return limit === undefined ? queue : queue.slice(0, limit);
}

/** New cards are introduced a deck-sized amount at a time, never a surprise avalanche. */
export function newCards(cards: SrsCard[], deck: Pick<Deck, 'newPerDay'>): SrsCard[] {
  return cards.filter((card) => card.repetitions === 0 && !card.suspended).slice(0, deck.newPerDay);
}

export function previewInterval(card: SrsCard, rating: SrsRating, now = new Date()): string {
  const next = schedule({ ...card, due: now.toISOString() }, rating, now);
  if (rating === 'again') return `${AGAIN_STEP_MINUTES} min`;
  const days = next.interval;
  if (days < 1) return `${Math.round(days * 24 * 60)} min`;
  if (days < 30) return `${days % 1 === 0 ? days : days.toFixed(1)} d`;
  return `${(days / 30).toFixed(days < 90 ? 1 : 0)} mo`;
}

/** A single review is counted once, so a day's number cannot double-count a re-tap. */
export function reviewDelta(card: SrsCard, rating: SrsRating): { reviews: number; newCards: number } {
  return { reviews: 1, newCards: card.repetitions === 0 && rating !== 'again' ? 1 : 0 };
}

/**
 * Scheduler tests: the interval contract documented at the top of src/domain/scheduler.ts.
 *
 * The rules under test (ease floor/ceiling, the AGAIN short delay, the 365-day cap, queue order,
 * purity of `schedule` and the review counters) are the ones the flashcard and progress modules
 * promise to the learner, so they are asserted directly rather than through a UI.
 */
import { describe, expect, it } from 'vitest';
import {
  AGAIN_STEP_MINUTES,
  EASE_CEILING,
  EASE_DEFAULT,
  EASE_FLOOR,
  INTERVAL_CAP_DAYS,
  addDays,
  addMinutes,
  clampEase,
  dueQueue,
  isDue,
  newCard,
  newCards,
  previewInterval,
  reviewDelta,
  schedule,
} from '@/domain/scheduler';
import type { SrsCard, SrsRating } from '@/domain/types';

const NOW = new Date('2026-03-04T09:00:00.000Z');
const RATINGS: SrsRating[] = ['again', 'hard', 'good', 'easy'];

/** A deterministic pseudo-random generator: the sweeps must replay identically every run. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function card(overrides: Partial<SrsCard> = {}): SrsCard {
  return {
    id: 'deck|中\u001Ezhong1',
    deckId: 'deck',
    simplified: '中',
    traditional: '中',
    pinyinMarked: 'zhōng',
    definition: 'middle',
    interval: 0,
    ease: EASE_DEFAULT,
    repetitions: 0,
    lapses: 0,
    due: NOW.toISOString(),
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

function snapshot(cardValue: SrsCard): string {
  return JSON.stringify(cardValue);
}

describe('newCard', () => {
  it('starts a card as new, due now, at the default ease', () => {
    const created = newCard('deck', {
      id: 'x\u001Ezhong1',
      simplified: '中',
      traditional: '中',
      pinyinMarked: 'zhōng',
      definition: 'middle',
    }, NOW);
    expect(created.id).toBe('deck|x\u001Ezhong1');
    expect(created.deckId).toBe('deck');
    expect(created.interval).toBe(0);
    expect(created.repetitions).toBe(0);
    expect(created.lapses).toBe(0);
    expect(created.ease).toBe(EASE_DEFAULT);
    expect(created.due).toBe(NOW.toISOString());
    expect(created.createdAt).toBe(NOW.toISOString());
    expect(isDue(created, NOW)).toBe(true);
  });
});

describe('schedule: documented transitions', () => {
  it('AGAIN uses the documented short delay and resets the card', () => {
    const reviewed = schedule(card({ interval: 12, repetitions: 5, ease: 2.6 }), 'again', NOW);
    expect(AGAIN_STEP_MINUTES).toBe(10);
    expect(reviewed.interval).toBe(0);
    expect(reviewed.repetitions).toBe(0);
    expect(reviewed.lapses).toBe(1);
    expect(reviewed.due).toBe(addMinutes(NOW, 10).toISOString());
    expect(reviewed.ease).toBeCloseTo(2.4, 10);
    expect(reviewed.lastReviewed).toBe(NOW.toISOString());
  });

  it('AGAIN keeps counting lapses across repeated failures', () => {
    let current = card();
    for (let round = 0; round < 4; round++) {
      current = schedule(current, 'again', NOW);
    }
    expect(current.lapses).toBe(4);
    expect(current.repetitions).toBe(0);
    expect(current.interval).toBe(0);
  });

  it('pins the first two successes to 1 and 3 days', () => {
    const first = schedule(card(), 'good', NOW);
    expect(first.interval).toBe(1);
    expect(first.repetitions).toBe(1);
    const second = schedule(first, 'good', NOW);
    expect(second.interval).toBe(3);
    expect(second.repetitions).toBe(2);
    expect(second.due).toBe(addDays(NOW, 3).toISOString());
  });

  it('hard grows by 1.2x and shaves ease by 0.15', () => {
    const base = card({ interval: 10, repetitions: 3 });
    const next = schedule(base, 'hard', NOW);
    expect(next.interval).toBe(12);
    expect(next.ease).toBeCloseTo(EASE_DEFAULT - 0.15, 10);
    expect(next.due).toBe(addDays(NOW, 12).toISOString());
  });

  it('easy grows by ease x 1.3 and adds 0.05 ease', () => {
    const base = card({ interval: 10, repetitions: 3, ease: 2.4 });
    const next = schedule(base, 'easy', NOW);
    expect(next.interval).toBeCloseTo(10 * 2.4 * 1.3, 10);
    expect(next.ease).toBeCloseTo(2.45, 10);
  });

  it('good multiplies the interval by the ease factor', () => {
    const base = card({ interval: 10, repetitions: 4, ease: 2.5 });
    expect(schedule(base, 'good', NOW).interval).toBe(25);
  });

  it('does not change the lapse counter for anything but AGAIN', () => {
    for (const rating of ['hard', 'good', 'easy'] as SrsRating[]) {
      const next = schedule(card({ lapses: 3, interval: 5, repetitions: 2 }), rating, NOW);
      expect(next.lapses).toBe(3);
    }
  });
});

describe('schedule: documented bounds', () => {
  it('keeps ease inside the floor and ceiling under any rating sequence', () => {
    const random = lcg(1234);
    for (let trial = 0; trial < 200; trial++) {
      let current = card({ ease: EASE_DEFAULT });
      for (let step = 0; step < 60; step++) {
        const rating = RATINGS[Math.floor(random() * RATINGS.length)];
        current = schedule(current, rating, NOW);
        expect(current.ease).toBeGreaterThanOrEqual(EASE_FLOOR);
        expect(current.ease).toBeLessThanOrEqual(EASE_CEILING);
        expect(current.interval).toBeGreaterThanOrEqual(0);
        expect(current.lapses).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('saturates ease at both ends', () => {
    let low = card({ ease: 1.35, repetitions: 2, interval: 4 });
    for (let step = 0; step < 20; step++) low = schedule(low, 'hard', NOW);
    expect(low.ease).toBeCloseTo(EASE_FLOOR, 10);

    let high = card({ ease: 2.98, repetitions: 2, interval: 4 });
    for (let step = 0; step < 20; step++) high = schedule(high, 'easy', NOW);
    expect(high.ease).toBe(EASE_CEILING);
  });

  it('clamps intervals at INTERVAL_CAP_DAYS and never exceeds it', () => {
    expect(INTERVAL_CAP_DAYS).toBe(365);
    let current = card({ interval: 300, repetitions: 5 });
    const seen: number[] = [];
    for (let step = 0; step < 12; step++) {
      current = schedule(current, 'good', NOW);
      seen.push(current.interval);
      expect(current.interval).toBeLessThanOrEqual(INTERVAL_CAP_DAYS);
    }
    expect(current.interval).toBe(INTERVAL_CAP_DAYS);
    expect(seen).toContain(365);
  });

  it('is monotonic per rating below the cap', () => {
    const ratings: SrsRating[] = ['good', 'easy', 'hard'];
    for (const rating of ratings) {
      let current = card({ repetitions: 2, interval: 1 });
      const intervals: number[] = [];
      for (let step = 0; step < 20 && current.interval < INTERVAL_CAP_DAYS; step++) {
        current = schedule(current, rating, NOW);
        intervals.push(current.interval);
      }
      for (let i = 1; i < intervals.length; i++) {
        expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
      }
    }
  });

  it('orders the growth factor of the three passing ratings', () => {
    const base = { repetitions: 4, interval: 20, ease: EASE_DEFAULT };
    const hard = schedule(card(base), 'hard', NOW).interval;
    const good = schedule(card(base), 'good', NOW).interval;
    const easy = schedule(card(base), 'easy', NOW).interval;
    expect(hard).toBeLessThan(good);
    expect(good).toBeLessThan(easy);
  });

  it('never schedules a passing rating before `now`', () => {
    for (const rating of RATINGS) {
      const next = schedule(card({ repetitions: 3, interval: 10 }), rating, NOW);
      expect(new Date(next.due).getTime()).toBeGreaterThanOrEqual(NOW.getTime());
    }
  });
});

describe('schedule: purity', () => {
  it('does not mutate the card it was given', () => {
    for (const rating of RATINGS) {
      const input = card({ interval: 7, repetitions: 3, ease: 2.2, lapses: 1 });
      const before = snapshot(input);
      const output = schedule(input, rating, NOW);
      expect(snapshot(input)).toBe(before);
      expect(output).not.toBe(input);
      expect(output.id).toBe(input.id);
    }
  });

  it('is deterministic: the same card and rating replay to the same result', () => {
    const input = card({ interval: 4, repetitions: 2 });
    for (const rating of RATINGS) {
      expect(schedule(input, rating, NOW)).toEqual(schedule(input, rating, NOW));
    }
  });

  it('preserves every other field of the card', () => {
    const input = card({ interval: 4, repetitions: 2, suspended: true, lastReviewed: 'older' });
    const output = schedule(input, 'good', NOW);
    expect(output.deckId).toBe(input.deckId);
    expect(output.simplified).toBe(input.simplified);
    expect(output.traditional).toBe(input.traditional);
    expect(output.pinyinMarked).toBe(input.pinyinMarked);
    expect(output.definition).toBe(input.definition);
    expect(output.createdAt).toBe(input.createdAt);
    expect(output.suspended).toBe(true);
  });

  it('treats a missing ease as the default instead of producing NaN', () => {
    const loose = { ...card(), ease: undefined as unknown as number };
    const output = schedule(loose, 'good', NOW);
    expect(Number.isFinite(output.ease)).toBe(true);
    expect(output.ease).toBeGreaterThanOrEqual(EASE_FLOOR);
  });
});

describe('isDue, dueQueue and newCards', () => {
  const earlier = addDays(NOW, -2).toISOString();
  const later = addDays(NOW, 2).toISOString();

  it('reads the due date and honours suspension', () => {
    expect(isDue(card({ due: earlier }), NOW)).toBe(true);
    expect(isDue(card({ due: NOW.toISOString() }), NOW)).toBe(true);
    expect(isDue(card({ due: later }), NOW)).toBe(false);
    expect(isDue(card({ due: earlier, suspended: true }), NOW)).toBe(false);
  });

  it('queues overdue cards oldest-first, then by repetitions, then by id', () => {
    const queue = dueQueue(
      [
        card({ id: 'b', due: NOW.toISOString(), repetitions: 2 }),
        card({ id: 'a', due: NOW.toISOString(), repetitions: 2 }),
        card({ id: 'c', due: NOW.toISOString(), repetitions: 1 }),
        card({ id: 'd', due: earlier, repetitions: 9 }),
        card({ id: 'e', due: addDays(NOW, -5).toISOString(), repetitions: 0 }),
        card({ id: 'f', due: later, repetitions: 0 }),
        card({ id: 'g', due: earlier, suspended: true, repetitions: 0 }),
      ],
      NOW,
    );
    expect(queue.map((row) => row.id)).toEqual(['e', 'd', 'c', 'a', 'b']);
  });

  it('applies the limit after ordering, never before', () => {
    const cards = [
      card({ id: 'x', due: addDays(NOW, -9).toISOString() }),
      card({ id: 'y', due: addDays(NOW, -1).toISOString() }),
      card({ id: 'z', due: NOW.toISOString() }),
    ];
    expect(dueQueue(cards, NOW, 2).map((row) => row.id)).toEqual(['x', 'y']);
    expect(dueQueue(cards, NOW, 0)).toEqual([]);
    expect(dueQueue(cards, NOW)).toHaveLength(3);
  });

  it('sorts the same multiset the same way regardless of input order', () => {
    const base = RATINGS.flatMap((rating, i) => [
      card({ id: `${rating}-${i}`, due: addDays(NOW, i - 2).toISOString(), repetitions: i }),
    ]);
    const sorted = dueQueue(base, NOW).map((row) => row.id);
    const random = lcg(99);
    for (let round = 0; round < 25; round++) {
      const shuffled = [...base];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      expect(dueQueue(shuffled, NOW).map((row) => row.id)).toEqual(sorted);
    }
  });

  it('introduces at most newPerDay unsuspended new cards', () => {
    const cards = [
      card({ id: 'n1' }),
      card({ id: 'n2' }),
      card({ id: 'n3' }),
      card({ id: 's', suspended: true }),
      card({ id: 'learned', repetitions: 1 }),
    ];
    expect(newCards(cards, { newPerDay: 2 }).map((row) => row.id)).toEqual(['n1', 'n2']);
    expect(newCards(cards, { newPerDay: 0 })).toEqual([]);
    expect(newCards(cards, { newPerDay: 10 }).map((row) => row.id)).toEqual(['n1', 'n2', 'n3']);
  });
});

describe('previewInterval and reviewDelta', () => {
  it('shows the short delay for AGAIN and days for a passing rating', () => {
    const fresh = card();
    expect(previewInterval(fresh, 'again', NOW)).toBe(`${AGAIN_STEP_MINUTES} min`);
    expect(previewInterval(fresh, 'good', NOW)).toBe('1 d');
    expect(previewInterval(card({ repetitions: 1 }), 'good', NOW)).toBe('3 d');
    expect(previewInterval(card({ repetitions: 3, interval: 60 }), 'good', NOW)).toContain('mo');
  });

  it('renders a sub-day interval in minutes', () => {
    const preview = previewInterval(card({ repetitions: 3, interval: 0.01 }), 'hard', NOW);
    expect(preview).toMatch(/min$/);
  });

  it('counts exactly one review and one new card only on a first success', () => {
    expect(reviewDelta(card(), 'good')).toEqual({ reviews: 1, newCards: 1 });
    expect(reviewDelta(card(), 'easy')).toEqual({ reviews: 1, newCards: 1 });
    expect(reviewDelta(card(), 'hard')).toEqual({ reviews: 1, newCards: 1 });
    expect(reviewDelta(card(), 'again')).toEqual({ reviews: 1, newCards: 0 });
    expect(reviewDelta(card({ repetitions: 3 }), 'good')).toEqual({ reviews: 1, newCards: 0 });
  });

  it('never double counts a re-tapped review', () => {
    const totals = RATINGS.map((rating) => reviewDelta(card({ repetitions: 1 }), rating));
    expect(totals.reduce((sum, row) => sum + row.reviews, 0)).toBe(RATINGS.length);
    expect(totals.reduce((sum, row) => sum + row.newCards, 0)).toBe(0);
  });
});

describe('date helpers', () => {
  it('addDays and addMinutes are exact and sign-symmetric', () => {
    expect(addDays(NOW, 1).getTime() - NOW.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(addDays(NOW, -1).getTime()).toBe(NOW.getTime() - 24 * 60 * 60 * 1000);
    expect(addMinutes(NOW, 10).getTime()).toBe(NOW.getTime() + 10 * 60 * 1000);
    expect(addDays(NOW, 0.5).getTime()).toBe(NOW.getTime() + 12 * 60 * 60 * 1000);
  });

  it('clampEase pins to the documented band', () => {
    expect(clampEase(0)).toBe(EASE_FLOOR);
    expect(clampEase(99)).toBe(EASE_CEILING);
    expect(clampEase(2.34)).toBe(2.34);
  });
});

/**
 * Domain rules that are not search or scheduling: the achievement catalogue and its thresholds,
 * the streak/weekly arithmetic, and the entry-key plus display-preference helpers the shared
 * components expose. These are the promises the profile screen makes to a learner, so they are
 * tested against the shipped catalogue rather than a copy of it.
 */
import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  currentStreak,
  dateKey,
  evaluateAchievements,
  metricValue,
  totals,
  weeklySummary,
  type ActivityTotals,
} from '@/domain/achievements';
import { entryId } from '@/domain/searchRanking';
import { tatoebaSentenceIds } from '@/domain/sourceRefs';
import {
  entryKey,
  parseEntryKey,
  preferredHeadword,
  preferredPinyin,
  secondaryHeadword,
} from '@/components';
import { DEFAULT_PREFERENCES, US, type ActivityDay, type DictEntry, type Preferences } from '@/domain/types';

const NOW = new Date(2026, 10, 4, 12, 0, 0); // Tue 4 Nov 2026, local time

function day(key: string, overrides: Partial<ActivityDay> = {}): ActivityDay {
  return {
    day: key,
    searches: 0,
    entriesSaved: 0,
    reviews: 0,
    newCards: 0,
    correct: 0,
    attempts: 0,
    characters: 0,
    readings: 0,
    ...overrides,
  };
}

function zeroTotals(): ActivityTotals {
  return {
    searches: 0,
    entriesSaved: 0,
    reviews: 0,
    newCards: 0,
    correct: 0,
    attempts: 0,
    characters: 0,
    readings: 0,
    writingStrokes: 0,
    activeDays: 0,
    accuracy: null,
    today: 0,
    streak: 0,
  };
}

/** A totals object whose only non-zero figure is the metric under test. */
function totalsWith(metric: (typeof ACHIEVEMENTS)[number]['metric'], value: number): ActivityTotals {
  const base = zeroTotals();
  if (metric === 'days') base.activeDays = value;
  else base[metric] = value;
  return base;
}

function prefs(overrides: Partial<Preferences> = {}): Preferences {
  return { ...DEFAULT_PREFERENCES, ...overrides };
}

const entry: DictEntry = {
  id: entryId('中国', 'zhong1 guo2'),
  simplified: '中国',
  traditional: '中國',
  pinyinNumbered: 'zhong1 guo2',
  pinyinMarked: 'zhōngguó',
  pinyinPlain: 'zhongguo',
  definition: 'China; the Middle Kingdom',
  length: 2,
};

/* ------------------------------------------------------------------ achievements */

describe('the achievement catalogue', () => {
  it('is a stable set of unique, well-formed goals', () => {
    const ids = ACHIEVEMENTS.map((achievement) => achievement.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.goal).toBeGreaterThan(0);
      expect(Number.isInteger(achievement.goal)).toBe(true);
      expect(achievement.title.length).toBeGreaterThan(2);
      expect(achievement.description.length).toBeGreaterThan(8);
      expect(['reviews', 'entriesSaved', 'searches', 'correct', 'characters', 'readings', 'days']).toContain(
        achievement.metric,
      );
      // no unlockedAt on the catalog: unlocking is data, not definition
      expect(achievement).not.toHaveProperty('unlockedAt');
    }
  });

  it('never implies an online account, a purchase or another learner', () => {
    const words = ACHIEVEMENTS.map((a) => `${a.title} ${a.description}`).join(' ').toLowerCase();
    expect(words).not.toMatch(/leaderboard|rank|buy|purchase|premium|friend|other users|online/);
  });

  it('metricValue reads exactly the field each metric names', () => {
    const filled = {
      ...zeroTotals(),
      searches: 1,
      entriesSaved: 2,
      reviews: 3,
      correct: 4,
      characters: 5,
      readings: 6,
      activeDays: 7,
    };
    expect(metricValue('searches', filled)).toBe(1);
    expect(metricValue('entriesSaved', filled)).toBe(2);
    expect(metricValue('reviews', filled)).toBe(3);
    expect(metricValue('correct', filled)).toBe(4);
    expect(metricValue('characters', filled)).toBe(5);
    expect(metricValue('readings', filled)).toBe(6);
    expect(metricValue('days', filled)).toBe(7);
  });
});

describe('evaluateAchievements', () => {
  it('unlocks a goal exactly when the threshold is reached, never before', () => {
    for (const achievement of ACHIEVEMENTS) {
      const below = evaluateAchievements(totalsWith(achievement.metric, achievement.goal - 1), [], NOW);
      expect(below.newly.map((row) => row.id), `${achievement.id} unlocked below its goal`).not.toContain(
        achievement.id,
      );
      expect(below.rows.find((row) => row.id === achievement.id)?.unlockedAt).toBeUndefined();

      const at = evaluateAchievements(totalsWith(achievement.metric, achievement.goal), [], NOW);
      expect(at.rows.find((row) => row.id === achievement.id)?.unlockedAt).toBe(NOW.toISOString());
      expect(at.newly.map((row) => row.id)).toContain(achievement.id);

      const above = evaluateAchievements(totalsWith(achievement.metric, achievement.goal * 3 + 1), [], NOW);
      expect(above.newly.map((row) => row.id)).toContain(achievement.id);
    }
  });

  it('does not unlock anything a learner has not really done', () => {
    const oneSearch = evaluateAchievements(totalsWith('searches', 1), [], NOW);
    expect(oneSearch.newly.map((row) => row.id)).toEqual(['first-search']);
    expect(oneSearch.rows.filter((row) => row.unlockedAt)).toHaveLength(1);
    expect(oneSearch.rows).toHaveLength(ACHIEVEMENTS.length); // locked rows stay listed
  });

  it('reports several goals at once when one session crosses them', () => {
    const value = { ...zeroTotals(), searches: 25, activeDays: 3 };
    const { newly } = evaluateAchievements(value, [], NOW);
    expect(newly.map((row) => row.id).sort()).toEqual(['curious-25', 'days-3', 'first-search']);
  });

  it('keeps an earlier unlock stamp instead of re-awarding it', () => {
    const earlier = new Date(2026, 8, 1, 9, 0, 0);
    const unlocked = { ...ACHIEVEMENTS[0]!, unlockedAt: earlier.toISOString() };
    const { rows, newly } = evaluateAchievements(totalsWith('searches', 99), [unlocked], NOW);
    expect(newly.map((row) => row.id)).not.toContain(unlocked.id);
    expect(rows.find((row) => row.id === unlocked.id)?.unlockedAt).toBe(earlier.toISOString());
  });

  it('leaves a revoked-looking row (no stamp) re-earnable', () => {
    const unStamped = { ...ACHIEVEMENTS[0]! };
    const { newly } = evaluateAchievements(totalsWith('searches', 1), [unStamped], NOW);
    expect(newly.map((row) => row.id)).toEqual(['first-search']);
  });

  it('ignores stored rows that are no longer in the catalogue', () => {
    const stale = { id: 'old-goal', title: 'Retired', description: 'Gone.', goal: 5, metric: 'reviews' as const, unlockedAt: 'x' };
    const { rows, newly } = evaluateAchievements(totalsWith('reviews', 500), [stale], NOW);
    expect(rows.map((row) => row.id)).not.toContain('old-goal');
    // 500 reviews clears the 50 and the 500 goal at once
    expect(newly.map((row) => row.id)).toEqual(['review-50', 'review-500']);
  });

  it('is deterministic for the same inputs', () => {
    const value = totals([day('2026-11-01', { reviews: 50, searches: 25 }), day('2026-11-02', { correct: 100 })], NOW);
    const first = evaluateAchievements(value, [], NOW);
    const second = evaluateAchievements(value, [], NOW);
    expect(second).toEqual(first);
  });
});

describe('totals', () => {
  it('sums every metric across the supplied days', () => {
    const rows = [
      day('2026-11-01', { searches: 2, entriesSaved: 1, reviews: 5, newCards: 3, correct: 4, attempts: 6, characters: 7, readings: 1, writingStrokes: 20 }),
      day('2026-11-02', { searches: 3, reviews: 10, correct: 2, attempts: 4, characters: 1 }),
      day('2026-11-03', { readings: 2, entriesSaved: 4 }),
    ];
    expect(totals(rows, NOW)).toMatchObject({
      searches: 5,
      entriesSaved: 5,
      reviews: 15,
      newCards: 3,
      correct: 6,
      attempts: 10,
      characters: 8,
      readings: 3,
      writingStrokes: 20,
      activeDays: 3,
      accuracy: 0.6,
    });
  });

  it('does not invent an accuracy figure when nothing was attempted', () => {
    expect(totals([day('2026-11-01', { searches: 1 })], NOW).accuracy).toBeNull();
    expect(totals([], NOW)).toEqual({ ...zeroTotals(), today: 0, streak: 0 });
  });

  it('counts a day as active only when something was really done', () => {
    const rows = [day('2026-11-01'), day('2026-11-02', { newCards: 4 }), day('2026-11-03', { reviews: 1 })];
    // newCards alone is not study evidence: the day only counts through its reviews
    expect(totals(rows, NOW).activeDays).toBe(1);
    expect(totals([day('2026-11-03', { attempts: 1 })], NOW).activeDays).toBe(1);
  });

  it('treats a missing or non-numeric figure as zero instead of NaN', () => {
    const loose = { day: '2026-11-03', searches: undefined, reviews: 2 } as unknown as ActivityDay;
    const value = totals([loose], NOW);
    expect(value.searches).toBe(0);
    expect(value.reviews).toBe(2);
    expect(Number.isNaN(value.correct)).toBe(false);
  });

  it('reports today through the clock it is given', () => {
    const rows = [
      day(dateKey(NOW), { reviews: 2, searches: 3, entriesSaved: 1, attempts: 9 }),
      day('2026-11-03', { reviews: 100 }),
    ];
    expect(totals(rows, NOW).today).toBe(6); // reviews + searches + saved, never attempts
    expect(totals(rows, new Date(2026, 10, 3)).today).toBe(100);
    expect(totals(rows, new Date(2026, 9, 1)).today).toBe(0);
  });
});

describe('currentStreak', () => {
  const today = dateKey(NOW);
  const yesterday = dateKey(new Date(NOW.getTime() - 86400000));

  it('counts consecutive days back from today', () => {
    expect(currentStreak([today, yesterday, dateKey(new Date(NOW.getTime() - 2 * 86400000))], NOW)).toBe(3);
  });

  it('still counts when today has no activity yet', () => {
    expect(currentStreak([yesterday], NOW)).toBe(1);
    expect(currentStreak([yesterday, dateKey(new Date(NOW.getTime() - 2 * 86400000))], NOW)).toBe(2);
  });

  it('breaks on a gap rather than skipping over it', () => {
    const twoAgo = dateKey(new Date(NOW.getTime() - 2 * 86400000));
    const fourAgo = dateKey(new Date(NOW.getTime() - 4 * 86400000));
    expect(currentStreak([today, twoAgo, fourAgo], NOW)).toBe(1); // yesterday missing -> today only
    expect(currentStreak([yesterday, twoAgo, fourAgo], NOW)).toBe(2);
    expect(currentStreak([fourAgo], NOW)).toBe(0);
  });

  it('is zero with no activity at all', () => {
    expect(currentStreak([], NOW)).toBe(0);
    expect(currentStreak(['2020-01-01'], NOW)).toBe(0);
  });

  it('counts each day once however many rows mention it', () => {
    expect(currentStreak([today, today, today, yesterday], NOW)).toBe(2);
  });

  it('crosses month and year boundaries by real days', () => {
    const endOfFebruary = new Date(2026, 2, 1, 8); // 1 Mar 2026 (2026 is not a leap year)
    const keys = ['2026-03-01', '2026-02-28', '2026-02-27'];
    expect(currentStreak(keys, endOfFebruary)).toBe(3);
    expect(currentStreak(['2026-03-01', '2026-02-27'], endOfFebruary)).toBe(1);
    const newYear = new Date(2027, 0, 1, 0, 30);
    expect(currentStreak(['2027-01-01', '2026-12-31', '2026-12-30'], newYear)).toBe(3);
  });

  it('dateKey uses the local calendar day, zero padded', () => {
    expect(dateKey(new Date(2026, 0, 1))).toBe('2026-01-01');
    expect(dateKey(new Date(2026, 8, 9, 23, 59))).toBe('2026-09-09');
    expect(dateKey(new Date(2026, 10, 4, 0, 1))).toBe('2026-11-04');
  });
});

describe('weeklySummary', () => {
  /** The window is seven calendar days ending at `now`, so the clock time of `now` is irrelevant. */
  const midnight = new Date(2026, 10, 4, 0, 0, 0);
  const back = (days: number, from: Date) => dateKey(new Date(from.getTime() - days * 86400000));
  const weekRows = (from: Date) => [
    day(back(0, from), { reviews: 2, entriesSaved: 1 }),
    day(back(3, from), { reviews: 3, entriesSaved: 2 }),
    day(back(6, from), { reviews: 1, entriesSaved: 4 }),
    day(back(7, from), { reviews: 99, entriesSaved: 99 }), // outside any seven-day window
  ];

  it('sums the seven days ending at midnight', () => {
    expect(weeklySummary(weekRows(midnight), midnight)).toBe(
      '6 reviews and 7 saved words on this device in the last seven days.',
    );
  });

  it('counts the same seven calendar days whatever the time of day', () => {
    // The window is held to day keys, not instants: comparing a `YYYY-MM-DD` row against
    // `now - 6 days` as a timestamp dropped the oldest day for every `now` past midnight.
    expect(weeklySummary(weekRows(NOW), NOW)).toBe(
      '6 reviews and 7 saved words on this device in the last seven days.',
    );
  });

  it('says plainly when nothing was logged', () => {
    expect(weeklySummary([], NOW)).toBe('Nothing logged on this device in the last seven days.');
    expect(weeklySummary([day('2020-01-01', { reviews: 40 })], NOW)).toBe(
      'Nothing logged on this device in the last seven days.',
    );
    expect(weeklySummary([day(dateKey(NOW))], NOW)).toBe(
      'Nothing logged on this device in the last seven days.',
    );
  });

  it('uses singular wording for one review or one word', () => {
    expect(weeklySummary([day(dateKey(NOW), { reviews: 1 })], NOW)).toBe(
      '1 review and 0 saved words on this device in the last seven days.',
    );
    expect(weeklySummary([day(dateKey(NOW), { entriesSaved: 1 })], NOW)).toBe(
      '0 reviews and 1 saved word on this device in the last seven days.',
    );
  });

  it('never promises a comparison with other learners', () => {
    const text = weeklySummary([day(dateKey(NOW), { reviews: 4, entriesSaved: 2 })], NOW);
    expect(text).toContain('on this device');
    expect(text.toLowerCase()).not.toMatch(/top|best|rank|percentile|friends/);
  });
});

/* ------------------------------------------------------------------ entry keys */

describe('entry keys', () => {
  it('joins headword and numbered reading with the unit separator', () => {
    expect(entryKey(entry)).toBe(`中国${US}zhong1 guo2`);
    expect(entryKey(entry)).toBe(entry.id);
    expect(entryKey(entry)).not.toContain('\u001e');
  });

  it('round-trips every documented headword shape', () => {
    const cases: { simplified: string; pinyinNumbered: string }[] = [
      { simplified: '中', pinyinNumbered: 'zhong1' },
      { simplified: '中国', pinyinNumbered: 'zhong1 guo2' },
      { simplified: '女士', pinyinNumbered: 'nu3 shi4' },
      { simplified: ' Lü ', pinyinNumbered: 'lüu2' }, // surrounding spaces are data, not separators
      { simplified: '110', pinyinNumbered: 'yao1 yao1 ling2' },
      { simplified: '龘', pinyinNumbered: 'da2' },
    ];
    for (const testCase of cases) {
      const key = entryKey({ ...entry, ...testCase });
      expect(parseEntryKey(key)).toEqual(testCase);
    }
  });

  it('splits on the first separator only, so a reading with a space survives', () => {
    const parsed = parseEntryKey(`学习${US}xue2 xi2`);
    expect(parsed).toEqual({ simplified: '学习', pinyinNumbered: 'xue2 xi2' });
    expect(parseEntryKey(`a${US}b${US}c`)).toEqual({ simplified: 'a', pinyinNumbered: 'b\u001fc' });
  });

  it('reads a legacy key without a separator as a bare headword', () => {
    expect(parseEntryKey('中国')).toEqual({ simplified: '中国', pinyinNumbered: '' });
    expect(parseEntryKey('')).toEqual({ simplified: '', pinyinNumbered: '' });
  });

  it('never loses a surrogate-pair character through the separator', () => {
    const rare = String.fromCodePoint(0x2a6b2); // 𪚲, CJK Extension B: one code point, two UTF-16 units
    const key = entryKey({ ...entry, simplified: rare, pinyinNumbered: 'he2' });
    expect(parseEntryKey(key)).toEqual({ simplified: rare, pinyinNumbered: 'he2' });
    expect([...key]).toHaveLength(5); // rare + separator + h + e + 2
    expect(key.length).toBe(6); // the UTF-16 length counts each surrogate half
  });
});

/* ------------------------------------------------------------------ display preferences */

describe('preferredHeadword and preferredPinyin', () => {
  it('honours displayScript', () => {
    expect(preferredHeadword(entry, prefs({ displayScript: 'simplified' }))).toBe('中国');
    expect(preferredHeadword(entry, prefs({ displayScript: 'traditional' }))).toBe('中國');
    expect(preferredHeadword(entry, prefs({ displayScript: 'both' }))).toBe('中国');
  });

  it('offers the other script only when both are shown and they differ', () => {
    expect(secondaryHeadword(entry, prefs({ displayScript: 'both' }))).toBe('中國');
    expect(secondaryHeadword(entry, prefs({ displayScript: 'simplified' }))).toBeNull();
    expect(secondaryHeadword(entry, prefs({ displayScript: 'traditional' }))).toBeNull();
    const identical: DictEntry = { ...entry, traditional: '中国' };
    expect(secondaryHeadword(identical, prefs({ displayScript: 'both' }))).toBeNull();
  });

  it('honours pinyinStyle', () => {
    expect(preferredPinyin(entry, prefs({ pinyinStyle: 'marks' }))).toBe('zhōngguó');
    expect(preferredPinyin(entry, prefs({ pinyinStyle: 'numbers' }))).toBe('zhong1 guo2');
    expect(preferredPinyin(entry, prefs({ pinyinStyle: 'none' }))).toBe('');
  });

  it('defaults to marks and both scripts, matching DEFAULT_PREFERENCES', () => {
    expect(preferredHeadword(entry, DEFAULT_PREFERENCES)).toBe('中国');
    expect(preferredPinyin(entry, DEFAULT_PREFERENCES)).toBe('zhōngguó');
    expect(secondaryHeadword(entry, DEFAULT_PREFERENCES)).toBe('中國');
  });

  it('keeps the definition verbatim for every preference combination', () => {
    for (const displayScript of ['simplified', 'traditional', 'both'] as const) {
      for (const pinyinStyle of ['marks', 'numbers', 'none'] as const) {
        const chosen = prefs({ displayScript, pinyinStyle });
        expect(entry.definition).toBe('China; the Middle Kingdom');
        expect(preferredHeadword(entry, chosen).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('tatoebaSentenceIds', () => {
  // The examples pack credits contributors by sentence id only (the pinned export names nobody),
  // and that id is the whole attribution mechanism, so its parsing is a licence concern.
  it('reads both refs of a linked pair in order', () => {
    expect(tatoebaSentenceIds(['tatoeba:7891:unknown', 'tatoeba:456:unknown'])).toEqual(['7891', '456']);
  });

  it('drops malformed and non-Tatoeba refs instead of guessing a link', () => {
    expect(tatoebaSentenceIds(['tatoeba:unknown:1', 'tatoeba:abc', 'original:note-3', '', 'tatoeba:12:unknown'])).toEqual(['12']);
  });

  it('collapses the repeated ids a headword can carry', () => {
    expect(tatoebaSentenceIds(['tatoeba:33:a', 'tatoeba:33:b', 'tatoeba:44:c'])).toEqual(['33', '44']);
  });

  it('yields nothing for a record without refs', () => {
    expect(tatoebaSentenceIds([])).toEqual([]);
  });
});

/** Local achievements and activity summaries. Everything is computed from this device's own
 *  records: no streak-freeze purchases, no recovered streaks, no comparison with other users. */

import type { Achievement, ActivityDay } from './types';

export const ACHIEVEMENTS: Omit<Achievement, 'unlockedAt'>[] = [
  { id: 'first-search', title: 'First lookup', description: 'Search the dictionary once.', goal: 1, metric: 'searches' },
  { id: 'curious-25', title: 'Curious', description: 'Search 25 different times.', goal: 25, metric: 'searches' },
  { id: 'collector-10', title: 'Collector', description: 'Save 10 words.', goal: 10, metric: 'entriesSaved' },
  { id: 'collector-100', title: 'Shelf builder', description: 'Save 100 words.', goal: 100, metric: 'entriesSaved' },
  { id: 'review-50', title: 'Repetition starter', description: 'Review 50 flashcards.', goal: 50, metric: 'reviews' },
  { id: 'review-500', title: 'Steady reviewer', description: 'Review 500 flashcards.', goal: 500, metric: 'reviews' },
  { id: 'correct-100', title: 'Getting it right', description: 'Answer 100 questions correctly.', goal: 100, metric: 'correct' },
  { id: 'chars-20', title: 'Character student', description: 'Open 20 character pages.', goal: 20, metric: 'characters' },
  { id: 'read-5', title: 'Reader', description: 'Read 5 texts or stories.', goal: 5, metric: 'readings' },
  { id: 'days-3', title: 'Three days running', description: 'Study on three separate days.', goal: 3, metric: 'days' },
  { id: 'days-14', title: 'Two weeks of practice', description: 'Study on fourteen separate days.', goal: 14, metric: 'days' },
];

export interface ActivityTotals {
  searches: number;
  entriesSaved: number;
  reviews: number;
  newCards: number;
  correct: number;
  attempts: number;
  characters: number;
  readings: number;
  writingStrokes: number;
  activeDays: number;
  accuracy: number | null;
  today: number;
  streak: number;
}

export function totals(days: ActivityDay[], now = new Date()): ActivityTotals {
  const sum = (pick: (day: ActivityDay) => number) => days.reduce((acc, day) => acc + (pick(day) || 0), 0);
  const attempts = sum((day) => day.attempts);
  const correct = sum((day) => day.correct);
  const active = days.filter((day) => dayIsActive(day));
  return {
    searches: sum((day) => day.searches),
    entriesSaved: sum((day) => day.entriesSaved),
    reviews: sum((day) => day.reviews),
    newCards: sum((day) => day.newCards),
    correct,
    attempts,
    characters: sum((day) => day.characters),
    readings: sum((day) => day.readings),
    writingStrokes: sum((day) => day.writingStrokes ?? 0),
    activeDays: active.length,
    accuracy: attempts > 0 ? correct / attempts : null,
    today: sum((day) => (day.day === dateKey(now) ? day.reviews + day.searches + day.entriesSaved : 0)),
    streak: currentStreak(active.map((day) => day.day), now),
  };
}

function dayIsActive(day: ActivityDay): boolean {
  return (
    day.searches + day.entriesSaved + day.reviews + day.attempts + day.characters + day.readings > 0
  );
}

export function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Consecutive days up to today (or yesterday, if today has no activity yet). */
export function currentStreak(activeDayKeys: string[], now = new Date()): number {
  const set = new Set(activeDayKeys);
  let cursor = new Date(now);
  if (!set.has(dateKey(cursor))) {
    cursor = new Date(cursor.getTime() - 86400000);
    if (!set.has(dateKey(cursor))) return 0;
  }
  let streak = 0;
  while (set.has(dateKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 86400000);
  }
  return streak;
}

export function metricValue(metric: Achievement['metric'], totalsValue: ActivityTotals): number {
  switch (metric) {
    case 'searches':
      return totalsValue.searches;
    case 'entriesSaved':
      return totalsValue.entriesSaved;
    case 'reviews':
      return totalsValue.reviews;
    case 'correct':
      return totalsValue.correct;
    case 'characters':
      return totalsValue.characters;
    case 'readings':
      return totalsValue.readings;
    case 'days':
      return totalsValue.activeDays;
  }
}

/** Merge the catalog with whatever is already unlocked; first time a goal holds, stamp it. */
export function evaluateAchievements(
  totalsValue: ActivityTotals,
  alreadyUnlocked: Achievement[],
  now = new Date(),
): { rows: Achievement[]; newly: Achievement[] } {
  const stamp = now.toISOString();
  const existing = new Map(alreadyUnlocked.map((row) => [row.id, row]));
  const newly: Achievement[] = [];
  const rows = ACHIEVEMENTS.map<Achievement>((definition) => {
    const previous = existing.get(definition.id);
    const reached = metricValue(definition.metric, totalsValue) >= definition.goal;
    if (previous?.unlockedAt) return previous;
    if (!reached) return { ...definition };
    const unlocked: Achievement = { ...definition, unlockedAt: stamp };
    newly.push(unlocked);
    return unlocked;
  });
  return { rows, newly };
}

/** A plain-language summary that never implies an online account or a leaderboard. */
export function weeklySummary(days: ActivityDay[], now = new Date()): string {
  // Calendar days, not timestamps: comparing a day key against `now - 6 days` as instants would
  // drop the first day of the window whenever `now` is past midnight.
  const firstDay = dateKey(new Date(now.getTime() - 6 * 86400000));
  const inWeek = days.filter((day) => day.day >= firstDay);
  const reviews = inWeek.reduce((acc, day) => acc + day.reviews, 0);
  const saved = inWeek.reduce((acc, day) => acc + day.entriesSaved, 0);
  if (reviews === 0 && saved === 0) return 'Nothing logged on this device in the last seven days.';
  return `${reviews} review${reviews === 1 ? '' : 's'} and ${saved} saved word${saved === 1 ? '' : 's'} on this device in the last seven days.`;
}

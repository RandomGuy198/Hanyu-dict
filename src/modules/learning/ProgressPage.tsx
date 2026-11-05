/** Progress: what this device has actually recorded, read live from its own IndexedDB.
 *  No accounts, no uploads, no leaderboards, no comparisons — every number below is counted
 *  on this machine from the user's rows and labelled as such. A zero always reads as zero. */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { IconAlert, IconBook, IconCards, IconPen, IconSpark } from '../../app/icons';
import { usePreferences } from '../../app/providers';
import { currentStreak, totals, weeklySummary } from '../../domain/achievements';
import { isDue } from '../../domain/scheduler';
import type { ActivityDay } from '../../domain/types';
import { db, todayKey } from '../../data/db';
import { EmptyState, PageHeader, ProgressBar } from '../../components';
import { DayBars, MonthGrid, type DayPoint } from './ProgressCharts';
import './learning.css';

const DAY_MS = 86400000;

/** Same activity rule `totals()`/`currentStreak()` use to call a day active. */
function isActiveDay(day: ActivityDay): boolean {
  return (
    day.searches + day.entriesSaved + day.reviews + day.attempts + day.characters + day.readings > 0
  );
}

/** Everything logged on one day; the month grid reads this. */
function dayTally(day: ActivityDay): number {
  return (
    day.searches +
    day.entriesSaved +
    day.reviews +
    day.newCards +
    day.attempts +
    day.characters +
    day.readings
  );
}

function lastDayKeys(count: number, now = new Date()): string[] {
  const keys: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    keys.push(todayKey(new Date(now.getTime() - back * DAY_MS)));
  }
  return keys;
}

function weekdayLabel(key: string): string {
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
}

export default function ProgressPage() {
  const { prefs } = usePreferences();

  const days = useLiveQuery(() => db.activity.toArray(), [], []);
  const todayRow = useLiveQuery(() => db.activity.get(todayKey()), [], undefined);
  const cards = useLiveQuery(() => db.cards.toArray(), [], []);
  const savedRows = useLiveQuery(() => db.savedWords.toArray(), [], []);
  const lists = useLiveQuery(() => db.wordLists.toArray(), [], []);
  const notebooks = useLiveQuery(() => db.notebooks.toArray(), [], []);

  const sums = useMemo(() => totals(days), [days]);
  const activeKeys = useMemo(() => days.filter(isActiveDay).map((day) => day.day), [days]);
  const streak = useMemo(() => currentStreak(activeKeys), [activeKeys]);
  const byDay = useMemo(() => new Map(days.map((day) => [day.day, day])), [days]);
  const tallyByDay = useMemo(
    () => new Map(days.map((day) => [day.day, dayTally(day)])),
    [days],
  );
  const dueNow = useMemo(() => cards.filter((card) => isDue(card)).length, [cards]);

  const goal = Math.max(1, Math.round(prefs.dailyGoal));
  const reviewsToday = todayRow?.reviews ?? 0;
  const answersToday = todayRow?.attempts ?? 0;
  const gradedToday = reviewsToday + answersToday;

  const sevenPoints = useMemo<DayPoint[]>(
    () =>
      lastDayKeys(7).map((key) => ({
        key,
        label: weekdayLabel(key),
        value: byDay.get(key)?.reviews ?? 0,
      })),
    [byDay],
  );

  const thirtyPoints = useMemo<DayPoint[]>(() => {
    const keys = lastDayKeys(30);
    return keys.map((key, index) => {
      const day = Number(key.slice(8));
      const show = day === 1 || day % 5 === 0 || index === keys.length - 1;
      return { key, label: show ? `${day}` : '', value: byDay.get(key)?.reviews ?? 0 };
    });
  }, [byDay]);

  const noDataAtAll =
    activeKeys.length === 0 &&
    cards.length === 0 &&
    savedRows.length === 0 &&
    lists.length === 0 &&
    notebooks.length === 0;

  return (
    <div className="stack learn-flow">
      <PageHeader
        title="Progress"
        subtitle="Every number here is counted on this device, from its own IndexedDB records. Nothing is uploaded, and nothing is compared with other users."
        actions={
          <Link to="/data" className="btn btn-sm">
            Export or clear
          </Link>
        }
      />

      <div className="notice notice-info" role="note">
        <IconAlert />
        <span>
          <strong>Local only — never synced.</strong> These figures come from this browser’s
          storage and stay on this device. There is no account, no upload and no leaderboard.
        </span>
      </div>

      {noDataAtAll ? (
        <EmptyState
          title="Nothing recorded on this device yet"
          detail="Every count below reads zero because nothing has happened here yet. To start: look a word up and save it, build a deck from your saved words, then grade a flashcard."
          icon={<IconSpark />}
          action={
            <div className="row-wrap">
              <Link to="/flashcards" className="btn btn-sm">
                <IconCards /> Flashcards
              </Link>
              <Link to="/practice" className="btn btn-primary btn-sm">
                <IconPen /> Practice
              </Link>
              <Link to="/library" className="btn btn-sm">
                <IconBook /> Library
              </Link>
            </div>
          }
        />
      ) : null}

      <section className="card learn-panel" aria-labelledby="learn-today-heading">
        <h2 id="learn-today-heading" className="h3">
          Streak and today
        </h2>
        <p className="learn-section-lead">
          You are on a <strong>{streak}</strong> day streak ({sums.activeDays} study day
          {sums.activeDays === 1 ? '' : 's'} recorded in total). A streak only counts days this
          device recorded; miss a day and it starts again — nothing is lost, frozen or bought back.
        </p>
        <div className="learn-stats">
          <Stat value={gradedToday} label={`graded today (goal ${goal})`} />
          <Stat value={reviewsToday} label="card reviews today" />
          <Stat value={answersToday} label="answered questions today" />
        </div>
        <div className="learn-goal">
          <ProgressBar
            value={Math.min(gradedToday, goal)}
            total={goal}
            label={`${gradedToday} of ${goal} graded today`}
          />
          <p className="text-sm muted">
            {gradedToday >= goal ? (
              <>Goal met today: {gradedToday} of {goal} graded. Anything more still counts, but it
              is never required.</>
            ) : (
              <>{gradedToday} of {goal} graded so far today — {goal - gradedToday} short of the goal
              you set in Settings. Nothing locks or resets; the schedule simply waits for you.</>
            )}
          </p>
          <p className="learn-rule">{weeklySummary(days)}</p>
        </div>
      </section>

      <section className="card learn-panel" aria-labelledby="learn-totals-heading">
        <h2 id="learn-totals-heading" className="h3">
          Totals on this device
        </h2>
        <div className="learn-stats">
          <Stat value={sums.reviews} label="flashcards reviewed" to="/flashcards" />
          <Stat value={dueNow} label="cards due now" to="/practice" live />
          <Stat value={sums.newCards} label="new cards seen" />
          <Stat
            value={sums.accuracy === null ? '—' : `${Math.round(sums.accuracy * 100)}%`}
            label={
              sums.accuracy === null
                ? 'accuracy · no answers yet'
                : `accuracy over ${sums.attempts} answers`
            }
          />
          <Stat value={savedRows.length} label="words saved" to="/library" />
          <Stat
            value={lists.length + notebooks.length}
            label={`${lists.length} lists, ${notebooks.length} notebooks`}
            to="/library"
          />
        </div>
        <p className="learn-footnote">
          “New cards seen” counts days on which a first successful review introduced a card, so it
          reads the activity log rather than the card table. Accuracy covers answered drills/tests
          only — flashcard grades are never counted as right or wrong — and a dash means there are
          no answers yet, not zero.
        </p>
      </section>

      <section className="card learn-panel" aria-labelledby="learn-charts-heading">
        <h2 id="learn-charts-heading" className="h3">
          Reviews: 7 days, 30 days and this month
        </h2>
        <DayBars
          title="Reviews per day — last 7 days"
          caption={`Card reviews logged on this device, ${sevenPoints[0]?.key ?? ''} to ${todayKey()}.`}
          points={sevenPoints}
          valueNoun="reviews"
        />
        <DayBars
          title="Reviews per day — last 30 days"
          caption="Card reviews logged each day over thirty days. The plot scrolls sideways on narrow screens; every bar prints its number."
          points={thirtyPoints}
          valueNoun="reviews"
          compact
        />
        <MonthGrid monthOf={new Date()} counts={tallyByDay} valueNoun="logged" />
        <p className="learn-footnote">
          Charts are plain CSS and HTML drawn on this device — no chart library, no network request.
          Colour never carries meaning alone: each bar and cell also prints its number.
        </p>
      </section>

      <p className="learn-local-line">
        Everything above is computed and stored locally on this device. Clearing your data removes
        these records — <Link to="/data">manage local data</Link>.
      </p>
    </div>
  );
}

function Stat({
  value,
  label,
  to,
  live,
}: {
  value: number | string;
  label: string;
  to?: string;
  live?: boolean;
}) {
  const inner = (
    <>
      <span className="learn-stat-value">{value}</span>
      <span className="learn-stat-label">{label}</span>
    </>
  );
  if (to) {
    return (
      <Link to={to} className="learn-stat learn-stat-link">
        {inner}
      </Link>
    );
  }
  return (
    <div className="learn-stat" aria-live={live ? 'polite' : undefined}>
      {inner}
    </div>
  );
}

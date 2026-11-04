/** Original charts for the progress screen — plain CSS bars and a real table for the
 *  month grid. No chart library, no network: every value arrives as props computed from
 *  this device's IndexedDB rows. Colour never carries meaning alone: bars print their
 *  number, month cells print day-of-month and count as text. */

import { dateKey } from '../../domain/achievements';
import './progress.css';

export interface DayPoint {
  key: string;
  label: string;
  value: number;
}

export function DayBars({
  title,
  caption,
  points,
  valueNoun,
  compact,
}: {
  title: string;
  caption: string;
  points: DayPoint[];
  /** noun printed next to every number, e.g. "reviews" */
  valueNoun: string;
  /** narrower columns for long ranges; the plot scrolls sideways below ~40 rem */
  compact?: boolean;
}) {
  const max = Math.max(1, ...points.map((point) => point.value));
  const total = points.reduce((acc, point) => acc + point.value, 0);
  const activeDays = points.filter((point) => point.value > 0).length;
  const spoken = points.map((point) => `${point.key}: ${point.value} ${valueNoun}`).join('; ');
  return (
    <figure className="learn-chart">
      <figcaption className="prog-caption">
        <strong>{title}</strong>
        <span className="text-sm muted">{caption}</span>
      </figcaption>
      <div
        className={`prog-plot ${compact ? 'prog-plot-compact' : ''}`}
        role="img"
        aria-label={`${title}. ${spoken}.`}
      >
        {points.map((point) => {
          const ratio = point.value / max;
          const percent = Math.max(1, Math.round(ratio * 100));
          return (
            <div className="prog-col" key={point.key}>
              <span className="prog-col-value" aria-hidden="true">
                {point.value}
              </span>
              <span
                className={`prog-col-bar ${point.value === 0 ? 'prog-col-bar-zero' : ''}`}
                style={{ height: `calc(var(--prog-plot-h) * ${(percent / 100).toFixed(3)})` }}
                aria-hidden="true"
              />
              <span className="prog-col-label" aria-hidden="true">
                {point.label}
              </span>
            </div>
          );
        })}
      </div>
      <p className="prog-chart-note">
        {total} {valueNoun} across {activeDays} active day{activeDays === 1 ? '' : 's'} in this
        window. Every bar prints its number — the fill colour is decoration, not information.
      </p>
    </figure>
  );
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function levelOf(count: number): string {
  if (count <= 0) return 'none';
  if (count >= 15) return 'high';
  if (count >= 5) return 'mid';
  return 'low';
}

/** Calendar of the current month, one cell per day, counts as text. */
export function MonthGrid({
  monthOf,
  counts,
  valueNoun,
}: {
  monthOf: Date;
  counts: Map<string, number>;
  valueNoun: string;
}) {
  const year = monthOf.getFullYear();
  const month = monthOf.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = (new Date(year, month, 1).getDay() + 6) % 7;
  const today = dateKey(new Date());
  const monthLabel = monthOf.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const cells: (number | null)[] = [];
  for (let i = 0; i < leading; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const activeCells = counts.size;
  return (
    <figure className="learn-chart">
      <figcaption className="prog-caption">
        <strong>{monthLabel} at a glance</strong>
        <span className="text-sm muted">
          Each cell shows the day of the month; days with recorded activity also show their{' '}
          {valueNoun} count as text. Shading only repeats what the number says.
        </span>
      </figcaption>
      <table className="prog-month">
        <caption className="visually-hidden">
          {`Activity per day in ${monthLabel}, counted on this device. ${activeCells} day${
            activeCells === 1 ? '' : 's'
          } have entries.`}
        </caption>
        <thead>
          <tr>
            {WEEKDAYS.map((day) => (
              <th key={day} scope="col">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={`week-${weekIndex}`}>
              {week.map((day, dayIndex) => {
                if (day === null) {
                  return <td key={`pad-${dayIndex}`} className="prog-cell prog-cell-pad" />;
                }
                const key = dateKey(new Date(year, month, day));
                const count = counts.get(key) ?? 0;
                const isToday = key === today;
                const isFuture = key > today;
                const classes = ['prog-cell', `prog-cell-${isFuture ? 'future' : levelOf(count)}`];
                if (isToday) classes.push('prog-cell-today');
                return (
                  <td key={key} className={classes.join(' ')} aria-current={isToday ? 'date' : undefined}>
                    <span className="prog-cell-day">{day}</span>
                    {count > 0 ? (
                      <span className="prog-cell-count">
                        {count} {valueNoun}
                      </span>
                    ) : (
                      <span className="prog-cell-count prog-cell-count-empty">
                        {isFuture ? '' : '0'}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="prog-legend" aria-hidden="true">
        <li>
          <span className="prog-swatch prog-swatch-none" /> no entry
        </li>
        <li>
          <span className="prog-swatch prog-swatch-low" /> 1–4
        </li>
        <li>
          <span className="prog-swatch prog-swatch-mid" /> 5–14
        </li>
        <li>
          <span className="prog-swatch prog-swatch-high" /> 15+
        </li>
      </ul>
    </figure>
  );
}

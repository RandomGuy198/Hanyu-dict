/** /writing — a standalone practice desk. Choose (or sample) one character, watch the
 *  shared Hanzi Writer animation / quiz panel fed purely from the locally installed
 *  stroke pack, then trace strokes on a 米字格-style grid with mouse, touch or stylus
 *  via Pointer Events. Free-hand grading reports only how much of each median guide
 *  line a stroke covered, and is labelled as an approximation — never official scoring. */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, LoadingGate, PageHeader, SpeakButton } from '../../components';
import { IconPen, IconSpark, IconTrash } from '../../app/icons';
import { useQueryState } from '../../app/hooks';
import { useDictionary, useToast } from '../../app/providers';
import { bumpActivity, todayKey } from '../../data/db';
import { isHanCharacter } from '../../domain/pinyin';
import type { CharRecord } from '../../domain/service';
import type { StrokeData } from '../../domain/types';
import { pairMedians, StrokePanel } from './StrokePanel';
import './characters.css';

/** Tolerance in 1024-unit write-box coordinates (about 10 % of the cell). */
const COVERAGE_TOLERANCE = 110;

type DrawPoint = { x: number; y: number };

function toPath(points: DrawPoint[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

/** Fraction of the median guide polyline that lies near the drawn stroke. */
function coverageOf(median: number[][], user: DrawPoint[]): number {
  if (median.length === 0 || user.length === 0) return 0;
  let hits = 0;
  for (const [x, y] of median) {
    if (user.some((p) => Math.hypot(p.x - x, p.y - y) <= COVERAGE_TOLERANCE)) hits += 1;
  }
  return hits / median.length;
}

function PracticeDesk({ char, sd }: { char: string; sd: StrokeData | null | undefined }) {
  const guides = useMemo(() => (sd ? pairMedians(sd.medians) : []), [sd]);
  const total = guides.length;
  const [userStrokes, setUserStrokes] = useState<DrawPoint[][]>([]);
  const [results, setResults] = useState<number[]>([]);
  const [current, setCurrent] = useState<DrawPoint[]>([]);
  const [announce, setAnnounce] = useState('');
  const drawingRef = useRef(false);
  const awaitingData = sd === undefined;

  useEffect(() => {
    setUserStrokes([]);
    setResults([]);
    setCurrent([]);
    drawingRef.current = false;
    setAnnounce(
      awaitingData
        ? 'Checking guide data on this device…'
        : total > 0
          ? `Trace the dashed guide: stroke 1 of ${total}. Lift the pointer to check each stroke.`
          : 'Free drawing — there is no median guide for this character, so nothing is scored.',
    );
  }, [awaitingData, char, total]);

  const step = Math.min(userStrokes.length, total);
  const guide = step < total ? guides[step] : null;

  function pointFromEvent(event: ReactPointerEvent<SVGSVGElement>): DrawPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * 1024,
      y: ((event.clientY - rect.top) / rect.height) * 1024,
    };
  }

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    setCurrent([pointFromEvent(event)]);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>): void {
    if (!drawingRef.current) return;
    const point = pointFromEvent(event);
    setCurrent((pts) => {
      const last = pts[pts.length - 1];
      if (last && Math.hypot(point.x - last.x, point.y - last.y) < 6) return pts;
      return [...pts, point];
    });
  }

  function cancelStroke(): void {
    drawingRef.current = false;
    setCurrent([]);
  }

  function finishStroke(): void {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const pts = current;
    setCurrent([]);
    if (pts.length < 2) return;
    const index = userStrokes.length;
    setUserStrokes((strokes) => [...strokes, pts]);
    if (total === 0) {
      setAnnounce(`Stroke ${index + 1} drawn (unscored — no guide data).`);
      return;
    }
    if (index >= total) {
      setAnnounce(`All ${total} guided strokes are done. Extra strokes are drawn unscored — use Clear to start again.`);
      return;
    }
    const coverage = coverageOf(guides[index], pts);
    const percent = Math.round(coverage * 100);
    const verdict = coverage >= 0.75 ? 'good coverage' : coverage >= 0.45 ? 'partial coverage' : 'little overlap';
    setResults((older) => [...older, coverage]);
    void bumpActivity(todayKey(), { writingStrokes: 1 }).catch((error: unknown) => {
      console.error('[characters] activity log failed', error);
    });
    const complete = index + 1 === total ? ' Guided set complete.' : '';
    setAnnounce(
      `Stroke ${index + 1} of ${total}: ${percent}% ${verdict} of the median guide line — ` +
        `an approximation, not official stroke-order scoring.${complete}`,
    );
  }

  function undoStroke(): void {
    if (userStrokes.length === 0) return;
    setUserStrokes((strokes) => strokes.slice(0, -1));
    setResults((older) => older.slice(0, -1));
    setAnnounce(`Removed stroke ${userStrokes.length}.`);
  }

  function clearDesk(): void {
    setUserStrokes([]);
    setResults([]);
    setCurrent([]);
    setAnnounce(
      total > 0 ? `Grid cleared. Trace stroke 1 of ${total} again.` : 'Grid cleared.',
    );
  }

  const badge =
    sd === undefined
      ? 'checking data…'
      : sd === null
        ? 'no guide data'
        : total > 0
          ? `stroke ${Math.min(step + 1, total)} of ${total}`
          : 'outline only, no medians';

  return (
    <section className="card" aria-label={`Practice grid for ${char}`}>
      <div className="section-title">
        <h2>Trace the strokes</h2>
        <span className="spacer" />
        <span className="badge">{badge}</span>
      </div>
      <svg
        className="char-desk-svg"
        viewBox="0 0 1024 1024"
        role="img"
        aria-label={`Practice grid for ${char}. Draw with a mouse, finger or stylus.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={cancelStroke}
      >
        <rect className="char-grid-line" x={10} y={10} width={1004} height={1004} />
        <line className="char-grid-line char-grid-dashed" x1={512} y1={10} x2={512} y2={1014} />
        <line className="char-grid-line char-grid-dashed" x1={10} y1={512} x2={1014} y2={512} />
        <line className="char-grid-line char-grid-dashed" x1={10} y1={10} x2={1014} y2={1014} />
        <line className="char-grid-line char-grid-dashed" x1={1014} y1={10} x2={10} y2={1014} />
        {sd
          ? sd.strokes.map((d, i) => <path key={`outline-${i}`} className="char-desk-outline" d={d} />)
          : null}
        {!sd && char ? (
          <text className="char-desk-glyph" x={512} y={512}>
            {char}
          </text>
        ) : null}
        {guide ? (
          <polyline className="char-desk-guide" points={guide.map(([x, y]) => `${x},${y}`).join(' ')} />
        ) : null}
        {guide && guide[0] ? (
          <g className="char-num-badge">
            <circle cx={guide[0][0]} cy={guide[0][1]} r={34} />
            <text x={guide[0][0]} y={guide[0][1]}>{step + 1}</text>
          </g>
        ) : null}
        {userStrokes.map((pts, i) => (
          <path key={`user-${i}`} className="char-desk-user" d={toPath(pts)} />
        ))}
        {current.length > 0 ? <path className="char-desk-user" d={toPath(current)} /> : null}
      </svg>
      <p className="char-live" role="status" aria-live="polite">
        {announce}
      </p>
      <div className="char-controls">
        <button type="button" className="btn" onClick={undoStroke} disabled={userStrokes.length === 0}>
          Undo
        </button>
        <button
          type="button"
          className="btn"
          onClick={clearDesk}
          disabled={userStrokes.length === 0}
        >
          <IconTrash /> Clear
        </button>
      </div>
      {results.length > 0 ? (
        <div className="char-desk-results" aria-label="Coverage per stroke, approximate">
          {results.map((coverage, i) => (
            <span className="badge" key={i}>
              {i + 1}: {Math.round(coverage * 100)}%
            </span>
          ))}
        </div>
      ) : null}
      <p className="text-sm faint">
        {total > 0
          ? 'Percentages say how much of the stored median guide line your stroke covered. That is an approximation, not official stroke-order scoring. Drawing needs a pointer (mouse, touch or stylus); the static numbered list in the panel above shows the same order without drawing.'
          : 'Drawing works with no stroke data installed, but nothing is graded. Install the stroke pack above for the outline, guides and coverage feedback.'}
      </p>
    </section>
  );
}

export default function WritingPage() {
  const { api } = useDictionary();
  const toast = useToast();
  const [raw, setRaw] = useQueryState('c', '');
  const char = [...raw.trim()][0] ?? '';
  const valid = char !== '' && isHanCharacter(char);
  const [sd, setSd] = useState<StrokeData | null | undefined>(undefined);
  const [rec, setRec] = useState<CharRecord | null | undefined>(undefined);
  const [busyRandom, setBusyRandom] = useState(false);

  useEffect(() => {
    if (!api || !valid) {
      setSd(undefined);
      setRec(undefined);
      return;
    }
    let alive = true;
    setSd(undefined);
    setRec(undefined);
    api
      .strokes(char)
      .then((result) => {
        if (alive) setSd(result);
      })
      .catch((error: unknown) => {
        console.error('[characters] writing desk stroke lookup failed', error);
        if (alive) setSd(null);
      });
    api
      .character(char)
      .then((record) => {
        if (alive) setRec(record);
      })
      .catch((error: unknown) => {
        console.error('[characters] writing desk character lookup failed', error);
        if (alive) setRec(null);
      });
    return () => {
      alive = false;
    };
  }, [api, char, valid]);

  async function pickRandom(): Promise<void> {
    if (!api) return;
    setBusyRandom(true);
    try {
      const sample = await api.sampleCharacters(24);
      if (sample.length === 0) {
        toast.push({ message: 'No characters are available to sample yet.', tone: 'warn' });
        return;
      }
      setRaw(sample[Math.floor(Math.random() * sample.length)]);
    } catch (error) {
      console.error('[characters] random sample failed', error);
      toast.push({ message: 'The sample list could not be read.', tone: 'danger' });
    } finally {
      setBusyRandom(false);
    }
  }

  return (
    <div className="stack">
      <PageHeader
        title="Writing practice"
        subtitle="Stroke animation, quiz and tracing grid built only on locally installed data — nothing here needs a connection once the optional stroke pack is downloaded."
        back={{ label: 'Back to dictionary', to: '/' }}
        actions={
          <Link className="btn btn-sm" to="/offline-data">
            Data packs
          </Link>
        }
      />
      <div className="field">
        <label htmlFor="writing-char-input">Practice character</label>
        <div className="row row-wrap">
          <input
            id="writing-char-input"
            className="input char-input"
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            placeholder="中"
            autoComplete="off"
            spellCheck={false}
            maxLength={4}
          />
          <button
            type="button"
            className="btn"
            onClick={() => void pickRandom()}
            disabled={!api || busyRandom}
          >
            <IconSpark /> Random character
          </button>
        </div>
        <span className="help" role="status" aria-live="polite">
          {raw.length > 0 && !valid
            ? 'Enter exactly one Chinese character, e.g. 中 or 学. Invalid text is only kept in the address bar.'
            : 'One Hanzi at a time — the panel and grid below follow it.'}
        </span>
      </div>

      <LoadingGate>
        {valid ? (
          <div className="stack">
            {rec ? (
              <div className="card card-tight row row-wrap">
                <span className="char-head-mini cjk" lang="zh">
                  {rec.char}
                </span>
                <span className="pinyin">{rec.mandarin.join(' / ') || 'Mandarin not recorded'}</span>
                <span className="muted text-sm">
                  {rec.strokeCount ? `${rec.strokeCount} strokes` : 'stroke count not recorded'}
                </span>
                <span className="spacer" />
                <SpeakButton text={rec.char} label={`Speak ${rec.char}`} compact />
                <Link className="btn btn-sm" to={`/character/${encodeURIComponent(char)}`}>
                  Character page
                </Link>
              </div>
            ) : rec === null ? (
              <div className="notice notice-warn" role="status">
                This character has no record in the installed characters pack; readings and
                definitions cannot be shown, and they are not invented here.
              </div>
            ) : (
              <div className="skeleton" style={{ height: 44 }} />
            )}
            <StrokePanel char={char} />
            <PracticeDesk char={char} sd={sd} />
            <div className="char-links">
              <Link className="btn btn-sm" to={`/search?q=${encodeURIComponent(char)}`}>
                Search words containing {char}
              </Link>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={<IconPen />}
            title="Pick a character to practise"
            detail={
              raw.trim()
                ? `“${[...raw.trim()][0]}” is not a Chinese character, so there is nothing to show. The grid needs exactly one Hanzi.`
                : 'Type one Hanzi above, or press Random character. All data stays on this device.'
            }
            action={
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void pickRandom()}
                disabled={!api || busyRandom}
              >
                <IconSpark /> Random character
              </button>
            }
          />
        )}
      </LoadingGate>
    </div>
  );
}

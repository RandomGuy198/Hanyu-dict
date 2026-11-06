/** StrokePanel: the shared animation + practice feature for the character page and the
 *  writing desk. Geometry comes from the `strokes` pack through `api.strokes(char)` (which
 *  auto-installs and caches the pack on demand) and is handed to Hanzi Writer via
 *  `charDataLoader`. */

import { useEffect, useMemo, useRef, useState } from 'react';
import HanziWriter, { type CharDataLoaderFn, type CharacterJson } from 'hanzi-writer';
import { AttributionNote, EmptyState, Segmented } from '../../components';
import { IconAlert } from '../../app/icons';
import { sleep } from '../../app/hooks';
import { useDictionary, usePreferences } from '../../app/providers';
import { packOverview } from '../../data/packs';
import type { PackOverview } from '../../data/packs';
import type { StrokeData } from '../../domain/types';

/* ------------------------------------------------------------------ data mapping */

/** Flattened median arrays `[x0,y0,x1,y1,…]` back into `[x, y]` point lists. */
export function pairMedians(medians: number[][]): number[][][] {
  const out: number[][][] = [];
  for (const flat of medians) {
    const points: number[][] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) points.push([flat[i], flat[i + 1]]);
    out.push(points);
  }
  return out;
}

/** Map the pack's StrokeData into the shape Hanzi Writer expects; null when the geometry
 *  is not usable — never a fabricated fallback. */
export function toCharacterJson(sd: StrokeData | null | undefined): CharacterJson | null {
  if (!sd || sd.strokes.length === 0) return null;
  const medians = pairMedians(sd.medians);
  if (medians.length !== sd.strokes.length) return null;
  if (medians.some((points) => points.length < 2)) return null;
  return { strokes: sd.strokes, medians };
}

/** First point of an outline path; every pack path starts with an absolute `M`. */
export function pathStartPoint(d: string): [number, number] | null {
  const match = /^M\s*([\d.]+)[ ,]+([\d.]+)/.exec(d.trim());
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/* Hanzi Writer parses hex colour strings; values come from the design tokens and the
 * fallbacks only mirror the library's documented defaults (boundary demand, rule 6). */
export function cssColor(token: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback;
}

type PanelMode = 'animation' | 'quiz' | 'static';
type AnimSpeed = 'slow' | 'normal' | 'fast';
type Phase = 'loading' | 'no-geometry' | 'incomplete' | 'ready';

const SPEEDS: Record<AnimSpeed, number> = { slow: 0.5, normal: 1, fast: 2.5 };
const MODE_OPTIONS: { value: PanelMode; label: string }[] = [
  { value: 'animation', label: 'Animation' },
  { value: 'quiz', label: 'Quiz' },
  { value: 'static', label: 'Static' },
];
const SPEED_OPTIONS: { value: AnimSpeed; label: string }[] = [
  { value: 'slow', label: 'Slow' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
];

export function StrokePanel({ char }: { char: string }) {
  const { api } = useDictionary();
  const { prefs } = usePreferences();

  const [packRows, setPackRows] = useState<PackOverview[] | null>(null);
  const [sd, setSd] = useState<StrokeData | null | undefined>(undefined);
  const [mode, setMode] = useState<PanelMode>(prefs.reduceMotion ? 'static' : 'animation');
  const [speed, setSpeed] = useState<AnimSpeed>('normal');
  const [status, setStatus] = useState('');
  const [quizNonce, setQuizNonce] = useState(0);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const writerRef = useRef<HanziWriter | null>(null);
  const runRef = useRef(0);

  const strokePack = packRows ? packRows.find((row) => row.pack.id === 'strokes') ?? null : null;
  const json = useMemo(() => toCharacterJson(sd), [sd]);
  const phase: Phase =
    !api || sd === undefined
      ? 'loading'
      : !sd
        ? 'no-geometry'
        : !json
          ? 'incomplete'
          : 'ready';

  useEffect(() => {
    let alive = true;
    packOverview()
      .then((rows) => alive && setPackRows(rows))
      .catch(() => {
        if (alive) setPackRows([]);
      });
    return () => {
      alive = false;
    };
  }, [sd]);

  /* This character's geometry, via the dictionary API (auto-installs strokes pack if needed). */
  useEffect(() => {
    if (!api) return;
    let alive = true;
    setSd(undefined);
    api
      .strokes(char)
      .then((result) => alive && setSd(result))
      .catch((error: unknown) => {
        console.error('[characters] stroke lookup failed', error);
        if (alive) setSd(null);
      });
    return () => {
      alive = false;
    };
  }, [api, char]);

  async function runAnimation(): Promise<void> {
    const writer = writerRef.current;
    if (!writer || !json) return;
    const total = json.strokes.length;
    const run = ++runRef.current;
    setRunning(true);
    setPaused(false);
    try {
      const hidden = await writer.hideCharacter({ duration: 0 });
      if (hidden) await hidden;
      if (run !== runRef.current) return;
      for (let i = 0; i < total; i += 1) {
        setStatus(`Stroke ${i + 1} of ${total}`);
        const pending = await writer.animateStroke(i);
        if (pending) {
          const result = await pending;
          if (result.canceled || run !== runRef.current) return;
        }
        if (i < total - 1) await sleep(200);
      }
      setStatus(`Animation complete — ${total} strokes in writing order`);
    } catch (error) {
      console.error('[characters] stroke animation failed', error);
      setStatus('The animation could not start. Try the Static view.');
    } finally {
      if (run === runRef.current) {
        setRunning(false);
        setPaused(false);
      }
    }
  }

  function togglePause(): void {
    const writer = writerRef.current;
    if (!writer || !running) return;
    if (paused) void writer.resumeAnimation();
    else void writer.pauseAnimation();
    setPaused(!paused);
  }

  /* Create the writer only when data is ready; the loader answers purely from api.strokes. */
  useEffect(() => {
    const el = containerRef.current;
    if (!api || phase !== 'ready' || mode === 'static' || !el) return;
    el.innerHTML = '';
    runRef.current += 1;
    setRunning(false);
    setPaused(false);
    const loader: CharDataLoaderFn = (requested, onLoad, onError) => {
      void api
        .strokes(requested)
        .then((result) => {
          const data = toCharacterJson(result);
          if (data) onLoad(data);
          else onError(new Error(`No usable stroke geometry for ${requested} in the installed data`));
        })
        .catch((error: unknown) => onError(error instanceof Error ? error : new Error(String(error))));
    };
    const writer = HanziWriter.create(el, char, {
      charDataLoader: loader,
      strokeAnimationSpeed: SPEEDS[speed],
      delayBetweenStrokes: 320,
      showCharacter: false,
      showOutline: true,
      strokeColor: cssColor('--text', '#555555'),
      outlineColor: cssColor('--border', '#dddddd'),
      drawingColor: cssColor('--secondary', '#333333'),
      highlightColor: cssColor('--primary', '#2b8871'),
    });
    writerRef.current = writer;
    if (mode === 'quiz') {
      const total = json ? json.strokes.length : 0;
      setStatus(`Quiz started — draw stroke 1 of ${total} inside the box`);
      void writer.quiz({
        showHintAfterMisses: 2,
        onCorrectStroke: (d) =>
          setStatus(`Stroke ${d.strokeNum + 1} of ${total} correct — ${d.strokesRemaining} remaining`),
        onMistake: (d) => setStatus(`Not that stroke — try stroke ${d.strokeNum + 1} of ${total} again`),
        onComplete: (summary) =>
          setStatus(
            `Quiz complete with ${summary.totalMistakes} missed attempt(s). Hanzi Writer matches ` +
              'each stroke against the stored median paths — a heuristic check, not an official score.',
          ),
      });
    } else {
      setStatus('');
      void runAnimation();
    }
    return () => {
      runRef.current += 1;
      writer.cancelQuiz();
      writerRef.current = null;
      el.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runAnimation reads fresh refs/state when called
  }, [api, phase, mode, char, speed, json, quizNonce]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const writer = writerRef.current;
      const rect = el.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height);
      if (writer && size > 8) writer.updateDimensions({ width: size, height: size });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [phase, mode]);

  if (phase === 'loading') {
    return (
      <section className="char-panel card" aria-label="Stroke order">
        <p className="muted text-sm" role="status" aria-live="polite">
          Loading stroke data…
        </p>
        <div className="skeleton" style={{ height: 180 }} />
      </section>
    );
  }

  return (
    <section className="char-panel card" aria-label="Stroke order and animation">
      <div className="section-title">
        <h2>Stroke order</h2>
        <span className="spacer" />
        {sd ? <span className="badge">{sd.strokes.length} strokes</span> : null}
      </div>

      {phase === 'no-geometry' ? (
        <EmptyState
          title={`No stroke data for ${char}`}
          detail="The stroke pack does not contain this character, so no animation is shown. Nothing is invented to fill the gap."
        />
      ) : null}

      {phase === 'incomplete' ? (
        <div className="notice notice-warn">
          <IconAlert />
          <div>The pack stores outline paths for {char} but no median lines, so an animation or
            quiz would not be reliable. The static numbered outline is shown instead.</div>
        </div>
      ) : null}
      {phase === 'incomplete' && sd ? <StaticOutline sd={sd} /> : null}

      {phase === 'ready' ? (
        <>
          <Segmented label="Stroke display mode" value={mode} options={MODE_OPTIONS} onChange={setMode} />
          {mode === 'static' && sd ? <StaticOutline sd={sd} /> : null}
          {mode !== 'static' ? <div className="char-stage" ref={containerRef} /> : null}
          {mode !== 'static' ? (
            <>
              <div className="char-controls">
                {mode === 'animation' ? (
                  <>
                    <button type="button" className="btn" onClick={() => void runAnimation()} disabled={running}>
                      {running ? 'Playing…' : 'Play'}
                    </button>
                    <button type="button" className="btn" onClick={togglePause} disabled={!running}>
                      {paused ? 'Resume' : 'Pause'}
                    </button>
                    <button type="button" className="btn" onClick={() => void runAnimation()}>Replay</button>
                    <Segmented label="Animation speed" value={speed} options={SPEED_OPTIONS} onChange={setSpeed} />
                  </>
                ) : (
                  <button type="button" className="btn" onClick={() => setQuizNonce((n) => n + 1)}>Restart quiz</button>
                )}
              </div>
              <p className="char-live" role="status" aria-live="polite">{status}</p>
              {mode === 'quiz' ? (
                <p className="text-sm faint">
                  Draw each stroke inside the box in order; the outline is the guide. Feedback is
                  Hanzi Writer&rsquo;s own matching against the median paths — not official scoring.
                </p>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      {strokePack ? (
        <AttributionNote
          attribution={strokePack.pack.attribution}
          license={strokePack.pack.license}
          version={strokePack.pack.version}
        />
      ) : null}
    </section>
  );
}

/** Accessible non-animated alternative: outline + numbered stroke starts + chip list. */
function StaticOutline({ sd }: { sd: StrokeData }) {
  const [lit, setLit] = useState<number | null>(null);
  return (
    <div className="char-static">
      <svg
        className="char-stage char-static-svg"
        viewBox="0 0 1024 1024"
        role="img"
        aria-label={`Static outline of ${sd.char} with numbered stroke start points`}
      >
        {/* Stroke data uses a y-up grid (makemeahanzi / Hanzi Writer); SVG is y-down, so flip the
            outlines into screen space. Hanzi Writer does this internally for the animation, which is
            why only this raw static render was upside down. */}
        <g transform="translate(0 1024) scale(1 -1)">
          {sd.strokes.map((d, i) => (
            <path
              key={`p-${i}`}
              className={`char-static-path ${lit === i ? 'is-lit' : lit !== null ? 'is-dim' : ''}`}
              d={d}
            />
          ))}
        </g>
        {sd.strokes.map((d, i) => {
          const start = pathStartPoint(d) ?? [120, 120];
          const x = Math.max(44, Math.min(980, start[0]));
          const y = Math.max(60, Math.min(980, 1024 - start[1]));
          return (
            <g key={`n-${i}`} className="char-num-badge">
              <circle cx={x} cy={y} r={32} />
              <text x={x} y={y}>{i + 1}</text>
            </g>
          );
        })}
      </svg>
      <ol className="char-stroke-list" aria-label={`Writing order for ${sd.char}`}>
        {sd.strokes.map((_, i) => (
          <li key={i}>
            <button
              type="button"
              className={`chip ${lit === i ? 'is-active' : ''}`}
              aria-pressed={lit === i}
              onClick={() => setLit(lit === i ? null : i)}
            >
              Stroke {i + 1}
            </button>
          </li>
        ))}
      </ol>
      <p className="text-sm faint">
        Numbers mark where each stroke starts; the order shown is the writing order. Nothing
        animates in this view.
      </p>
    </div>
  );
}

/** StrokeQuiz: the reusable Hanzi Writer practice box used by the course writing step and by the
 *  writing cards in the study hub.
 *
 *  `guided` keeps the character outline visible and hints after two missed strokes; `recall` hides
 *  the outline so the learner has to produce the character from memory. Geometry always comes from
 *  the locally installed strokes pack through `api.strokes()` — nothing is fetched from a CDN and
 *  nothing is invented when the pack has no geometry for a character. */

import { useEffect, useMemo, useRef, useState } from 'react';
import HanziWriter, { type CharDataLoaderFn } from 'hanzi-writer';
import { IconAlert } from '../../app/icons';
import { useDictionary } from '../../app/providers';
import { cssColor, toCharacterJson } from './StrokePanel';
import type { StrokeData } from '../../domain/types';
import './characters.css';

export type StrokeQuizRound = 'guided' | 'recall';

export interface StrokeQuizSummary {
  strokes: number;
  totalMistakes: number;
}

interface StrokeQuizProps {
  char: string;
  /** `animate` loops the stroke order as a preview; `quiz` grades the learner's own strokes. */
  mode?: 'animate' | 'quiz';
  round?: StrokeQuizRound;
  /** Bumps to restart the same character without remounting the page. */
  restartKey?: number;
  onComplete?: (summary: StrokeQuizSummary) => void;
  onMistake?: (strokeNum: number) => void;
}

export default function StrokeQuiz({
  char,
  mode = 'quiz',
  round = 'guided',
  restartKey = 0,
  onComplete,
  onMistake,
}: StrokeQuizProps) {
  const { api } = useDictionary();
  const [sd, setSd] = useState<StrokeData | null | undefined>(undefined);
  const [status, setStatus] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  /* Callbacks are read through refs so a new callback identity never restarts the quiz. */
  const onCompleteRef = useRef(onComplete);
  const onMistakeRef = useRef(onMistake);

  useEffect(() => {
    onCompleteRef.current = onComplete;
    onMistakeRef.current = onMistake;
  }, [onComplete, onMistake]);

  const json = useMemo(() => toCharacterJson(sd), [sd]);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    setSd(undefined);
    api
      .strokes(char)
      .then((result) => {
        if (alive) setSd(result);
      })
      .catch((error: unknown) => {
        console.error('[writing] stroke lookup failed', error);
        if (alive) setSd(null);
      });
    return () => {
      alive = false;
    };
  }, [api, char]);

  useEffect(() => {
    const el = containerRef.current;
    if (!api || !json || !el) return;
    el.innerHTML = '';

    const loader: CharDataLoaderFn = (requested, onLoad, onError) => {
      void api
        .strokes(requested)
        .then((result) => {
          const data = toCharacterJson(result);
          if (data) onLoad(data);
          else onError(new Error(`No usable stroke geometry for ${requested} on this device`));
        })
        .catch((error: unknown) => onError(error instanceof Error ? error : new Error(String(error))));
    };

    let writer: HanziWriter;
    try {
      writer = HanziWriter.create(el, char, {
        charDataLoader: loader,
        showCharacter: mode === 'animate',
        showOutline: mode === 'quiz' && round === 'guided',
        strokeAnimationSpeed: 1,
        delayBetweenStrokes: 300,
        strokeColor: cssColor('--text', '#555555'),
        outlineColor: cssColor('--border', '#dddddd'),
        drawingColor: cssColor('--secondary', '#333333'),
        highlightColor: cssColor('--primary', '#2b8871'),
      });
    } catch (error) {
      console.error('[writing] the practice box could not start', error);
      setStatus('The practice box could not start in this browser.');
      return;
    }

    const total = json.strokes.length;

    if (mode === 'animate') {
      setStatus(`Thứ tự nét của ${char} — ${total} nét.`);
      writer.loopCharacterAnimation();
      return () => {
        void writer.pauseAnimation();
        el.innerHTML = '';
      };
    }

    setStatus(
      round === 'guided'
        ? `Viết theo nét thứ tự — ${total} nét. Gợi ý hiện sau 2 nét sai.`
        : `Nhớ lại và viết ${total} nét — không có nét mờ.`,
    );

    writer.quiz({
      showHintAfterMisses: round === 'guided' ? 2 : 3,
      onCorrectStroke: (detail) =>
        setStatus(`Nét ${detail.strokeNum + 1}/${total} đúng — còn ${detail.strokesRemaining} nét`),
      onMistake: (detail) => {
        setStatus(`Không phải nét đó — thử lại nét ${detail.strokeNum + 1}/${total}`);
        onMistakeRef.current?.(detail.strokeNum);
      },
      onComplete: (summary) => {
        const mistakes = summary.totalMistakes ?? 0;
        setStatus(
          mistakes === 0
            ? `Hoàn thành ${total} nét, không sai nét nào.`
            : `Hoàn thành ${total} nét với ${mistakes} nét sai.`,
        );
        onCompleteRef.current?.({ strokes: total, totalMistakes: mistakes });
      },
    });

    return () => {
      writer.cancelQuiz();
      el.innerHTML = '';
    };
  }, [api, char, mode, json, round, restartKey]);

  if (!api || sd === undefined) {
    return (
      <div className="stroke-quiz">
        <div className="stroke-quiz-box" aria-live="polite">
          <span className="muted text-sm">Đang tải nét…</span>
        </div>
      </div>
    );
  }

  if (!json) {
    return (
      <div className="stroke-quiz">
        <div className="stroke-quiz-box stroke-quiz-empty" role="status">
          <IconAlert />
          <span className="text-sm muted">
            Chữ <strong>{char}</strong> chưa có dữ liệu nét trên máy này, nên không chấm được.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="stroke-quiz">
      <div className="stroke-quiz-box" ref={containerRef} aria-label={`Ôn tập viết chữ ${char}`} />
      {status ? (
        <p className="stroke-quiz-status text-sm muted" role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </div>
  );
}

/** WritingReviewPanel: the due writing cards of the study hub, drawn on a Hanzi Writer canvas and
 *  graded into the SRS schedule by how many strokes were wrong (`04_EXECUTION_PHASES.md` Phase 7.2).
 *
 *  The desk at `/writing` practises characters freely and never touches a schedule; this queue is the
 *  review half — one card at a time, the prompt coming from the card itself, and the grade persisted
 *  with the same helper the flashcard session uses so intervals, activity and sync move together.
 *  The queue is snapshotted when it starts, because grading a card makes it stop being due and the
 *  live query behind it would otherwise drop the next card out from under the learner. */

import { useRef, useState } from 'react';
import { IconPen, IconSpeaker } from '../../app/icons';
import { uid } from '../../app/hooks';
import { playWordAudio } from '../../data/audioPlayer';
import { marksToNumbered } from '../../domain/pinyin';
import type { SrsCard, SrsRating } from '../../domain/types';
import StrokeQuiz from '../characters/StrokeQuiz';
import { persistRating } from './learningStore';

/** Stroke mistakes decide the grade: a flawless recall on a card already in the long tail counts as
 *  `easy`, a shaky one as `hard`, and a canvas full of mistakes starts over. */
export function ratingFromMistakes(mistakes: number, repetitions: number): SrsRating {
  if (mistakes === 0) return repetitions >= 3 ? 'easy' : 'good';
  if (mistakes <= 2) return 'good';
  if (mistakes <= 5) return 'hard';
  return 'again';
}

const RATING_LABELS: Record<SrsRating, string> = {
  easy: 'Rất tốt — viết đúng mọi nét',
  good: 'Ổn — lệch vài nét nhưng nhớ được chữ',
  hard: 'Khó — sai vài nét, sẽ nhắc lại sớm',
  again: 'Quên rồi — quay lại sớm hơn',
};

export function writingRatingLabel(rating: SrsRating): string {
  return RATING_LABELS[rating];
}

interface WritingReviewPanelProps {
  /** Due `kind: 'writing'` cards, as the hub filtered them right before the queue starts. */
  cards: SrsCard[];
  sessionLabel: string;
  onGraded?: (card: SrsCard, rating: SrsRating) => void;
}

export default function WritingReviewPanel({
  cards,
  sessionLabel,
  onGraded,
}: WritingReviewPanelProps) {
  const [queue, setQueue] = useState<SrsCard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [grades, setGrades] = useState<SrsRating[]>([]);
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(new Date().toISOString());
  const sessionId = useRef(uid('write-'));
  const cardStartedAt = useRef(Date.now());

  const current = queue?.[index];

  const start = () => {
    setQueue(cards);
    setIndex(0);
    setGrades([]);
    cardStartedAt.current = Date.now();
  };

  const grade = async (card: SrsCard, rating: SrsRating) => {
    if (busy) return;
    setBusy(true);
    try {
      await persistRating({
        card,
        rating,
        sessionId: sessionId.current,
        sessionLabel,
        deckId: card.deckId,
        startedAt: startedAt.current,
        question: `Tập viết ${card.simplified}`,
        ms: Math.max(0, Date.now() - cardStartedAt.current),
      });
      setGrades((rows) => [...rows, rating]);
      onGraded?.(card, rating);
      setIndex((position) => position + 1);
      cardStartedAt.current = Date.now();
    } catch (error) {
      console.error('[writing] the grade could not be saved', error);
    } finally {
      setBusy(false);
    }
  };

  if (queue === null) {
    return (
      <div className="row-wrap">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={start}
          disabled={cards.length === 0}
        >
          <IconPen /> Ôn {cards.length} thẻ tập viết đang đến hạn
        </button>
        {cards.length === 0 ? (
          <span className="learn-hint">
            Chưa có thẻ tập viết nào đến hạn. Học bước 5 của một bài để tạo thẻ.
          </span>
        ) : null}
      </div>
    );
  }

  if (!current) {
    return (
      <div className="notice notice-info" role="status">
        <span>Đã ôn {grades.length}/{queue.length} thẻ tập viết.</span>
      </div>
    );
  }

  const lastRating = grades[grades.length - 1];

  return (
    <div className="stack write-review-queue">
      <p className="text-sm muted">
        Thẻ {index + 1}/{queue.length} · viết lại chữ theo nghĩa và phiên âm, không có nét mờ.
      </p>
      <div className="write-review-prompt">
        <span className="write-review-meaning">{current.definitionVi || current.definition}</span>
        {current.pinyinMarked ? (
          <span className="muted text-sm">{current.pinyinMarked}</span>
        ) : null}
        {current.hanViet ? <span className="badge">HÁN VIỆT: {current.hanViet}</span> : null}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-label={`Nghe phát âm ${current.simplified}`}
          onClick={() =>
            void playWordAudio(
              current.simplified,
              current.pinyinNumbered || marksToNumbered(current.pinyinMarked),
            )
          }
        >
          <IconSpeaker />
        </button>
      </div>

      <StrokeQuiz
        key={`${current.id}-${index}`}
        char={current.simplified}
        mode="quiz"
        round="recall"
        onComplete={(summary) =>
          void grade(current, ratingFromMistakes(summary.totalMistakes, current.repetitions))
        }
      />
      {lastRating ? (
        <p className="text-sm muted" role="status">
          Vừa chấm: {writingRatingLabel(lastRating)}
        </p>
      ) : null}

      <div className="row-wrap">
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => void grade(current, 'again')}
        >
          <IconPen /> Không nhớ chữ này
        </button>
      </div>
    </div>
  );
}

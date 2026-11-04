/** Quick drill: multiple-choice practice over the words in the current source. It answers the
 *  question "can I recognise this?" without touching the flashcard schedule, and every answer is
 *  stored as a real attempt row with its own activity count. */

import { useMemo, useRef, useState } from 'react';
import { IconCheck, IconAlert } from '../../app/icons';
import { useToast } from '../../app/providers';
import type { Preferences } from '../../domain/types';
import { persistAnswer, pinyinDisplay, type LearningWord } from './learningStore';

type Direction = 'meaning' | 'word';

interface Round {
  key: string;
  direction: Direction;
  stem: string;
  options: string[];
  answer: number;
  cjkOptions: boolean;
  word: LearningWord;
}

const OPTION_COUNT = 4;

function firstGloss(definition: string): string {
  const gloss = definition.split('; ')[0] ?? definition;
  return gloss.length > 60 ? `${gloss.slice(0, 57).trimEnd()}…` : gloss;
}

function wordLabel(word: LearningWord, prefs: Preferences): string {
  return prefs.displayScript === 'traditional' ? word.traditional || word.simplified : word.simplified;
}

function order<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

function unique(words: LearningWord[]): LearningWord[] {
  const seen = new Set<string>();
  const out: LearningWord[] = [];
  for (const word of words) {
    if (seen.has(word.id)) continue;
    seen.add(word.id);
    out.push(word);
  }
  return out;
}

function buildRound(word: LearningWord, pool: LearningWord[], index: number, prefs: Preferences): Round | null {
  const direction: Direction = index % 2 === 0 ? 'meaning' : 'word';
  const correct = direction === 'meaning' ? wordLabel(word, prefs) : firstGloss(word.definition);
  const labels = new Set<string>([correct]);
  const distractors: string[] = [];
  for (const other of order(pool)) {
    if (other.id === word.id) continue;
    const label = direction === 'meaning' ? wordLabel(other, prefs) : firstGloss(other.definition);
    if (!label.trim() || labels.has(label)) continue;
    labels.add(label);
    distractors.push(label);
    if (distractors.length === OPTION_COUNT - 1) break;
  }
  if (distractors.length < OPTION_COUNT - 1) return null;
  const options = order([correct, ...distractors]);
  return {
    key: word.id,
    direction,
    stem:
      direction === 'meaning'
        ? `Which of these means “${firstGloss(word.definition)}”?`
        : `What does “${wordLabel(word, prefs)}” mean?`,
    options,
    answer: options.indexOf(correct),
    cjkOptions: direction === 'meaning',
    word,
  };
}

export default function DrillPanel({
  words,
  label,
  deckId,
  prefs,
}: {
  words: LearningWord[];
  label: string;
  deckId?: string;
  prefs: Preferences;
}) {
  const toast = useToast();
  const sessionId = useRef(`drill-${Date.now().toString(36)}`);
  const startedAt = useRef(new Date().toISOString());
  const questionStart = useRef(Date.now());
  const [stopped, setStopped] = useState(false);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [answered, setAnswered] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [restartAt, setRestartAt] = useState(0);

  const rounds = useMemo(() => {
    const pool = unique(words);
    const built: Round[] = [];
    pool.forEach((word, position) => {
      const round = buildRound(word, pool, position, prefs);
      if (round) built.push(round);
    });
    return built;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restartAt reshuffles on demand: a signal, not an input
  }, [words, prefs, restartAt]);

  const round = rounds[Math.min(index, Math.max(0, rounds.length - 1))];

  if (rounds.length === 0) {
    return (
      <div className="notice" role="status">
        <span>
          These words do not have four distinct options yet, so a multiple-choice drill cannot be
          built from them. Add a few more words and try again.
        </span>
      </div>
    );
  }

  const choose = async (position: number) => {
    if (picked !== null || !round) return;
    setPicked(position);
    const correct = position === round.answer;
    setAnswered((value) => value + 1);
    if (correct) setCorrectCount((value) => value + 1);
    try {
      await persistAnswer({
        kind: 'quiz',
        sessionId: sessionId.current,
        sessionLabel: `Quick drill — ${label}`,
        startedAt: startedAt.current,
        deckId,
        attemptId: `${sessionId.current}|${index}`,
        question: `${round.direction}: ${round.stem}`,
        given: round.options[position] ?? '',
        expected: round.options[round.answer] ?? '',
        correct,
        ms: Math.max(0, Date.now() - questionStart.current),
        entryId: round.key,
      });
    } catch (error) {
      console.error('Could not store the drill answer', error);
      toast.push({ message: 'That answer could not be stored on this device.', tone: 'warn' });
    }
  };

  const advance = () => {
    setPicked(null);
    questionStart.current = Date.now();
    setIndex((value) => (value + 1) % rounds.length);
  };

  if (stopped) {
    return (
      <div className="card card-tight learn-panel" role="status">
        <strong>Drill stopped</strong>
        <p className="text-sm muted">
          {answered} question{answered === 1 ? '' : 's'} answered, {correctCount} correct. They are
          in your attempt history and today’s counts. The flashcard schedule was not changed.
        </p>
        <div className="row-wrap">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => {
              sessionId.current = `drill-${Date.now().toString(36)}`;
              startedAt.current = new Date().toISOString();
              setIndex(0);
              setAnswered(0);
              setCorrectCount(0);
              setPicked(null);
              setStopped(false);
              setRestartAt((value) => value + 1);
            }}
          >
            Start another drill
          </button>
        </div>
      </div>
    );
  }

  const finished = answered >= rounds.length;

  return (
    <div className="card card-tight learn-panel" aria-labelledby="learn-drill-heading">
      <div className="row-wrap">
        <h3 id="learn-drill-heading">Quick drill</h3>
        <span className="spacer" />
        <span className="badge">{label}</span>
      </div>
      <p className="learn-hint" role="status" aria-live="polite">
        Word {index + 1} of {rounds.length} · {answered} answered · {correctCount} correct. Quick
        drills do not change your flashcard schedule.
      </p>

      {round ? (
        <>
          <p className="learn-stem">{round.stem}</p>
          <fieldset className="learn-options">
            <legend className="visually-hidden">{round.stem}</legend>
            {round.options.map((option, position) => {
              const showVerdict = picked !== null;
              const isAnswer = position === round.answer;
              const isPicked = position === picked;
              return (
                <label
                  key={`${round.key}-${position}`}
                  className={`learn-option ${isPicked ? 'is-picked' : ''}`}
                >
                  <input
                    type="radio"
                    name="learn-drill-option"
                    value={String(position)}
                    checked={isPicked}
                    disabled={showVerdict}
                    onChange={() => void choose(position)}
                  />
                  <span className={round.cjkOptions ? 'learn-option-cjk' : ''} lang={round.cjkOptions ? 'zh' : undefined}>
                    {option}
                  </span>
                  {showVerdict && isAnswer ? (
                    <span className="badge badge-ok">
                      <IconCheck /> correct answer
                    </span>
                  ) : null}
                  {showVerdict && isPicked && !isAnswer ? (
                    <span className="badge badge-warn">
                      <IconAlert /> your answer
                    </span>
                  ) : null}
                </label>
              );
            })}
          </fieldset>
          {picked !== null ? (
            <div className="learn-answer">
              <p className="text-sm">
                <span className="cjk" lang="zh">{round.word.simplified}</span>
                {round.word.traditional && round.word.traditional !== round.word.simplified ? (
                  <span className="faint"> / {round.word.traditional}</span>
                ) : null}{' '}
                {pinyinDisplay(round.word, prefs.pinyinStyle) ? (
                  <span className="pinyin">{pinyinDisplay(round.word, prefs.pinyinStyle)}</span>
                ) : null}
              </p>
              <p className="text-sm muted">Full gloss in the data: {round.word.definition}</p>
              <div className="row-wrap">
                <button type="button" className="btn btn-sm btn-primary" onClick={advance}>
                  {finished ? 'Back to the first word' : 'Next word'}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setStopped(true)}>
                  Stop drill
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-sm" onClick={() => setStopped(true)}>
              Stop drill
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}

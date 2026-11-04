/** One practice test, taken question by question. Answers are stored as they are made, the
 *  review pass lets one be changed (the stored attempt is updated, not doubled), and the score
 *  is only ever a count of the learner's own responses. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { uid, formatDate } from '../../app/hooks';
import { IconAlert, IconChevronLeft, IconCheck, IconSpeaker, IconStar } from '../../app/icons';
import { useDictionary, usePreferences, useToast } from '../../app/providers';
import { inspectSpeech, onVoicesChanged, speak } from '../../data/speech';
import { db } from '../../data/db';
import type { SourceRef } from './learningStore';
import { closeSession, discardRun, persistAnswer } from './learningStore';
import {
  AttributionNote,
  ConfirmDialog,
  EmptyState,
  LoadingGate,
  PageHeader,
  ProgressBar,
} from '../../components';
import {
  SECTION_LABEL,
  buildTest,
  levelLabel,
  loadOwnPool,
  loadSourcePool,
  minutesFor,
  parseTestId,
  poolLabel,
  specById,
  specForList,
  specForNotebook,
  type BuildContext,
  type GeneratedTest,
  type TestQuestion,
  type TestSpec,
} from './questionBank';
import './learning.css';
import './learningTest.css';

type Step = 'intro' | 'running' | 'review' | 'results';

interface Stored {
  position: number;
  correct: boolean;
}

export default function TestPage() {
  const { id = '' } = useParams();
  const { prefs, ready } = usePreferences();
  const { api } = useDictionary();
  const toast = useToast();

  const [spec, setSpec] = useState<TestSpec | null>(null);
  const [built, setBuilt] = useState<GeneratedTest | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [step, setStep] = useState<Step>('intro');
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Stored>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState(false);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [voiceTick, setVoiceTick] = useState(0);

  const sessionId = useRef('');
  const startedAt = useRef(new Date().toISOString());
  const questionStart = useRef(Date.now());
  const stepRef = useRef<Step>('intro');
  stepRef.current = step;

  // voiceTick is bumped when the device reports its voice list, which is the only moment
  // inspectSpeech can return a different answer, so it belongs in this dependency array.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- voiceTick is an invalidation signal, not an input to inspectSpeech
  const voice = useMemo(() => inspectSpeech(prefs.ttsLang), [prefs.ttsLang, voiceTick]);
  useEffect(() => onVoicesChanged(() => setVoiceTick((tick) => tick + 1)), []);

  useEffect(() => {
    const route = parseTestId(id);
    if (route.kind === 'unknown') {
      setSpec(null);
      setBuilt(null);
      setStatus('ready');
      return;
    }
    if (!ready) return;
    if (stepRef.current !== 'intro') return;
    let alive = true;
    setStatus('loading');

    const run = async () => {
      const own = await loadOwnPool();
      const base: BuildContext = {
        api,
        prefs,
        own,
        hasVoice: inspectSpeech(prefs.ttsLang).chineseVoice,
      };
      let chosen: TestSpec;
      let context: BuildContext = base;

      if (route.kind === 'catalog') {
        const found = specById(route.id);
        if (!found) {
          if (alive) {
            setSpec(null);
            setStatus('ready');
          }
          return;
        }
        chosen = found;
      } else {
        const src: SourceRef =
          route.kind === 'list' ? { kind: 'list', id: route.id } : { kind: 'notebook', id: route.id };
        const row =
          route.kind === 'list' ? await db.wordLists.get(route.id) : await db.notebooks.get(route.id);
        if (!row) {
          if (alive) {
            setSpec(null);
            setStatus('ready');
          }
          return;
        }
        const source = await loadSourcePool(src, api);
        chosen =
          route.kind === 'list'
            ? specForList(row, source.words.length)
            : specForNotebook(row, source.words.length);
        context = { ...base, source };
      }

      const result = await buildTest(chosen, context);
      if (!alive) return;
      setSpec(chosen);
      setBuilt(result);
      setStatus('ready');
    };

    run().catch((error: unknown) => {
      console.error('Could not generate this test', error);
      if (alive) setStatus('error');
    });
    return () => {
      alive = false;
    };
  }, [api, id, prefs, ready]);

  useEffect(() => {
    return () => {
      if (stepRef.current === 'results' && sessionId.current) void closeSession(sessionId.current);
    };
  }, []);

  const questions = useMemo(() => built?.questions ?? [], [built]);
  const question: TestQuestion | undefined = questions[index];
  const answeredCount = Object.keys(answers).length;
  const flagged = useMemo(
    () =>
      questions
        .map((row, position) => ({ row, position }))
        .filter((entry) => flags[entry.row.id]),
    [flags, questions],
  );
  const score = useMemo(
    () => questions.reduce((total, row) => total + (answers[row.id]?.correct ? 1 : 0), 0),
    [answers, questions],
  );

  const begin = () => {
    if (questions.length === 0) return;
    sessionId.current = uid('test-');
    startedAt.current = new Date().toISOString();
    questionStart.current = Date.now();
    setAnswers({});
    setFlags({});
    setIndex(0);
    setRevealed(false);
    setStep('running');
  };

  const toggleFlag = (questionId: string) => {
    setFlags((value) => ({ ...value, [questionId]: !value[questionId] }));
  };

  const answer = useCallback(
    async (row: TestQuestion, position: number) => {
      if (answers[row.id]?.position === position) return;
      const correct = position === row.answer;
      setAnswers((value) => ({ ...value, [row.id]: { position, correct } }));
      try {
        await persistAnswer({
          kind: 'test',
          sessionId: sessionId.current,
          sessionLabel: spec ? spec.title : 'Practice test',
          startedAt: startedAt.current,
          testId: spec?.id,
          entryId: row.entryId,
          attemptId: `${sessionId.current}|${row.id}`,
          question: `${SECTION_LABEL[row.section]}: ${row.stem}`,
          given: row.options[position]?.label ?? '',
          expected: row.options[row.answer]?.label ?? '',
          correct,
          ms: Math.max(0, Date.now() - questionStart.current),
        });
      } catch (error) {
        console.error('Could not store that answer', error);
        toast.push({ message: 'That answer could not be stored on this device.', tone: 'warn' });
      }
    },
    [answers, spec, toast],
  );

  const next = () => {
    questionStart.current = Date.now();
    setRevealed(false);
    if (index + 1 >= questions.length) setStep('review');
    else setIndex(index + 1);
  };

  const finish = () => {
    setStep('results');
    if (sessionId.current) void closeSession(sessionId.current);
  };

  const retry = async () => {
    const previous = sessionId.current;
    if (previous) {
      try {
        const removed = await discardRun(previous);
        toast.push(
          removed > 0
            ? `Previous run cleared: ${removed} answer${removed === 1 ? '' : 's'} removed from today’s counts.`
            : 'Previous run cleared.',
        );
      } catch (error) {
        console.error('Could not clear the previous run', error);
        toast.push({ message: 'The previous run could not be cleared.', tone: 'danger' });
        return;
      }
    }
    setConfirmRetry(false);
    begin();
  };

  if (!spec) {
    return (
      <div className="stack learn-flow">
        <PageHeader title="Practice test" back={{ label: 'All tests', to: '/test' }} />
        <EmptyState
          title="There is no test at this address"
          detail={
            status === 'loading'
              ? 'Still checking this device for the words behind this link.'
              : 'The list, notebook or set this link points at is not here any more. The test shelf lists what is available now.'
          }
          action={
            <Link to="/test" className="btn btn-primary">
              Back to the tests
            </Link>
          }
          icon={<IconAlert />}
        />
      </div>
    );
  }

  const fromOwnData = spec.pool === 'saved' || spec.pool === 'cards';

  const content = (
    <div className="stack learn-flow">
      <PageHeader
        title={spec.title}
        subtitle={`${levelLabel(spec.level)} · ${poolLabel(spec.pool)}`}
        back={{ label: 'All tests', to: '/test' }}
      />

      {status === 'loading' ? (
        <div className="stack" role="status" aria-live="polite">
          <p className="muted text-sm">Building the questions from the data installed here…</p>
          <div className="skeleton" style={{ height: 90 }} />
          <div className="skeleton" style={{ height: 60 }} />
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="notice notice-danger" role="alert">
          <span>
            These questions could not be generated. Nothing of yours was changed — the dictionary
            data may need reloading from the offline-data screen.
          </span>
        </div>
      ) : null}

      {status === 'ready' && questions.length === 0 ? (
        <EmptyState
          title={
            built?.blocked === 'dictionary'
              ? 'The dictionary is not installed on this device'
              : 'Not enough data to build this test'
          }
          detail={
            built?.blocked === 'dictionary'
              ? 'Every question in this set is generated from the licensed dictionary lines, and that data pack is not installed here yet — so there is nothing to write questions from. Install it and this page builds the same set again, with the same seed.'
              : fromOwnData
                ? 'A multiple-choice item needs four different real words to choose between, and this device does not have enough of your own words for it yet. Save a few more from an entry, then come back.'
                : 'The dictionary lines on this device did not produce four distinct options for these items. Reinstall the dictionary pack, then try again.'
          }
          action={
            built?.blocked === 'dictionary' ? (
              <Link to="/offline-data" className="btn btn-primary">
                Install the dictionary data
              </Link>
            ) : (
              <Link to={fromOwnData ? '/library' : '/test'} className="btn btn-primary">
                {fromOwnData ? 'Your saved words and lists' : 'Back to the tests'}
              </Link>
            )
          }
        />
      ) : null}

      {status === 'ready' && questions.length > 0 && step === 'intro' ? (
        <section className="card learn-panel" aria-labelledby="learn-intro-heading">
          <h2 id="learn-intro-heading" className="h3">Before you start</h2>
          <p className="text-sm">{spec.note}</p>
          <p className="learn-test-meta">
            <span className="badge">{questions.length} question{questions.length === 1 ? '' : 's'}</span>
            <span className="badge">about {minutesFor(questions.length)} min</span>
            <span className="badge">one answer each</span>
            <span className="badge">no timer</span>
          </p>
          <ul className="learn-legend">
            {sectionsOf(questions).map((section) => (
              <li key={section}>
                <span className="learn-swatch" />
                {SECTION_LABEL[section]}
              </li>
            ))}
          </ul>
          {built && built.skipped > 0 ? (
            <p className="learn-hint">
              {built.skipped} item{built.skipped === 1 ? '' : 's'} could not be supported by the data
              on this device, so they are not in this set.
            </p>
          ) : null}
          <p className="learn-hint">
            There is no timer and nothing counts down — take as long as you like. Your answers are
            stored as you go, so closing the page does not lose them. The score is a count of your
            own responses — not an official result.
          </p>
          <button type="button" className="btn btn-primary" onClick={begin}>
            Start
          </button>
        </section>
      ) : null}

      {step === 'running' && question ? (
        <QuestionPanel
          question={question}
          stored={answers[question.id]}
          flagged={Boolean(flags[question.id])}
          flaggedCount={flagged.length}
          position={index}
          total={questions.length}
          voice={voice.chineseVoice}
          voiceReason={voice.reason}
          revealed={revealed}
          onReveal={() => setRevealed((value) => !value)}
          onFlag={() => toggleFlag(question.id)}
          ttsLang={prefs.ttsLang}
          ttsRate={prefs.ttsRate}
          onAnswer={(position) => void answer(question, position)}
          onBack={() => setIndex(Math.max(0, index - 1))}
          onNext={next}
          toast={toast}
        />
      ) : null}

      {step === 'review' ? (
        <section className="card learn-panel" aria-labelledby="learn-review-heading">
          <h2 id="learn-review-heading" className="h3">Review before you finish</h2>
          <p className="text-sm muted">
            {answeredCount} of {questions.length} answered
            {flagged.length > 0 ? `, ${flagged.length} flagged for a second look` : ''}. Nothing is
            marked right or wrong yet — that happens after you finish, so a second thought stays
            honest.
          </p>

          {flagged.length > 0 ? (
            <div className="test-review-group">
              <h3 className="text-sm">Flagged for review</h3>
              <ol className="learn-review-list">
                {flagged.map(({ row, position }) => (
                  <ReviewRow
                    key={row.id}
                    row={row}
                    position={position}
                    stored={answers[row.id]}
                    flagged
                    onGo={() => {
                      setIndex(position);
                      setStep('running');
                    }}
                  />
                ))}
              </ol>
            </div>
          ) : null}

          <div className="test-review-group">
            <h3 className="text-sm">All questions</h3>
            <ol className="learn-review-list">
              {questions.map((row, position) => (
                <ReviewRow
                  key={row.id}
                  row={row}
                  position={position}
                  stored={answers[row.id]}
                  flagged={Boolean(flags[row.id])}
                  onGo={() => {
                    setIndex(position);
                    setStep('running');
                  }}
                />
              ))}
            </ol>
          </div>

          <div className="test-results-actions">
            <button type="button" className="btn btn-primary" onClick={finish}>
              Finish and see the score
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setIndex(flagged.length > 0 ? flagged[0].position : 0);
                setStep('running');
              }}
            >
              {flagged.length > 0 ? 'Back to the flagged ones' : 'Keep answering'}
            </button>
          </div>
        </section>
      ) : null}

      {step === 'results' ? (
        <section className="card learn-panel" role="status" aria-live="polite" aria-labelledby="learn-result-heading">
          <h2 id="learn-result-heading" className="h3">Your result</h2>
          <div className="learn-stats">
            <div className="learn-stat">
              <span className="learn-stat-value">
                {score} / {answeredCount}
              </span>
              <span className="learn-stat-label">answered correctly</span>
            </div>
            <div className="learn-stat">
              <span className="learn-stat-value">{answeredCount}</span>
              <span className="learn-stat-label">of {questions.length} questions answered</span>
            </div>
            <div className="learn-stat">
              <span className="learn-stat-value">
                {answeredCount === 0 ? '—' : `${Math.round((score / answeredCount) * 100)}%`}
              </span>
              <span className="learn-stat-label">of your own answers</span>
            </div>
          </div>
          <p className="notice" role="note">
            This is a practice count from your answers on {formatDate(startedAt.current)}. It is not
            an official score, level or certificate, and nothing was sent anywhere.
          </p>
          {answeredCount < questions.length ? (
            <p className="learn-hint">
              You left {questions.length - answeredCount} question
              {questions.length - answeredCount === 1 ? '' : 's'} unanswered; they are not counted
              either way.
            </p>
          ) : null}
          <ol className="learn-review-list">
            {questions.map((row, position) => {
              const stored = answers[row.id];
              return (
                <li key={row.id} className="learn-result-line">
                  <span className="text-sm faint">
                    {position + 1}. {SECTION_LABEL[row.section]} · {poolLabel(wordPoolOf(row))}
                    {flags[row.id] ? (
                      <span className="test-flag-chip">
                        <IconStar /> flagged by you
                      </span>
                    ) : null}
                  </span>
                  <span className="text-sm">{row.stem}</span>
                  {stored ? (
                    <span className="row-wrap test-review-answer">
                      <span className={`badge ${stored.correct ? 'badge-ok' : 'badge-warn'}`}>
                        {stored.correct ? <IconCheck /> : <IconAlert />}
                        {stored.correct ? 'Correct' : 'Not correct'}
                      </span>
                      <span className="text-sm">
                        You chose “{row.options[stored.position]?.label}”. The data gives “
                        {row.options[row.answer]?.label}”.
                      </span>
                    </span>
                  ) : (
                    <span className="text-sm muted">Not answered.</span>
                  )}
                  <span className="test-explanation">{row.explanation}</span>
                  {row.entryId ? (
                    <Link to={`/entry/${encodeURIComponent(row.entryId)}`} className="btn btn-ghost">
                      Open the dictionary entry
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ol>
          <div className="test-results-actions">
            <button type="button" className="btn" onClick={() => setConfirmRetry(true)}>
              Take it again
            </button>
            <Link to="/test" className="btn btn-ghost">
              Other tests
            </Link>
            <Link to="/progress" className="btn btn-ghost">
              See progress
            </Link>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={confirmRetry}
        title="Start this test again?"
        body={
          <p>
            This clears the {answeredCount} answer{answeredCount === 1 ? '' : 's'} from the run you
            just did, including their contribution to today’s counts, so they are not counted twice.
            Your saved words, cards and flashcard schedule are not touched.
          </p>
        }
        confirmLabel="Clear and restart"
        cancelLabel="Keep my result"
        onConfirm={() => void retry()}
        onCancel={() => setConfirmRetry(false)}
      />

      <p className="test-legal">
        <span>
          Generated on this device from open-licensed dictionary data and your own saved words — a
          practice set written for this app, not an official HSK or HSKK paper, and it implies no
          official score.
        </span>
        <AttributionNote attribution="CC-CEDICT dictionary data" license="under CC BY-SA 4.0" />
      </p>
    </div>
  );

  if (fromOwnData) return content;
  return <LoadingGate>{content}</LoadingGate>;
}

function QuestionPanel({
  question,
  stored,
  flagged,
  flaggedCount,
  position,
  total,
  voice,
  voiceReason,
  revealed,
  onReveal,
  onFlag,
  ttsLang,
  ttsRate,
  onAnswer,
  onBack,
  onNext,
  toast,
}: {
  question: TestQuestion;
  stored: Stored | undefined;
  flagged: boolean;
  flaggedCount: number;
  position: number;
  total: number;
  voice: boolean;
  voiceReason?: string;
  revealed: boolean;
  onReveal: () => void;
  onFlag: () => void;
  ttsLang: string;
  ttsRate: number;
  onAnswer: (position: number) => void;
  onBack: () => void;
  onNext: () => void;
  toast: ReturnType<typeof useToast>;
}) {
  const last = position + 1 >= total;
  const heard = question.kind === 'listen-to-meaning';
  return (
    <section className="card learn-panel" aria-labelledby="learn-q-heading">
      <div className="test-progress">
        <p className="test-progress-line" role="status" aria-live="polite">
          <strong>{`Question ${position + 1} of ${total}`}</strong>
          <span>{SECTION_LABEL[question.section]}</span>
          {flaggedCount > 0 ? <span>{`${flaggedCount} flagged for review`}</span> : null}
        </p>
        <ProgressBar
          value={position + 1}
          total={total}
          label={`Question ${position + 1} of ${total}`}
        />
      </div>

      <div className="test-body">
        {question.passage ? (
          <div className="learn-passage">
            <strong className="text-sm">{question.passage.title}</strong>
            {question.passage.lines.map((line, slot) => (
              <p key={`${line.zh}-${slot}`} className="learn-passage-line">
                <span className="cjk" lang="zh">{line.zh}</span>
                <span className="pinyin">{line.pinyin}</span>
                <span className="muted text-sm">{line.en}</span>
              </p>
            ))}
          </div>
        ) : null}

        {question.prompt && !question.passage ? (
          <p className={`test-stem ${isCjk(question.prompt) ? 'test-stem-cjk' : ''}`} lang={isCjk(question.prompt) ? 'zh' : undefined}>
            {question.prompt}
          </p>
        ) : null}

        <h2 id="learn-q-heading" className="test-stem">
          {question.stem}
        </h2>

        {question.spoken ? (
          <div className="test-voice">
            <p className="test-voice-note">
              <IconSpeaker />
              <span>
                {heard
                  ? 'This is your device’s own speech synthesiser — a synthetic voice, not a human recording. Nothing was downloaded for it.'
                  : 'The reading below is spoken by your device’s synthesiser.'}
              </span>
            </p>
            <div className="test-voice-row">
              <button
                type="button"
                className="btn"
                disabled={!voice}
                onClick={() => void playSpoken(question.spoken ?? '', ttsLang, ttsRate, toast)}
              >
                <IconSpeaker /> {voice ? 'Play the word' : 'No Chinese voice here'}
              </button>
              {!voice || revealed ? null : (
                <button type="button" className="btn btn-ghost" onClick={onReveal} aria-pressed={revealed}>
                  Show the written word instead
                </button>
              )}
              {revealed && voice ? (
                <button type="button" className="btn btn-ghost" onClick={onReveal} aria-pressed={revealed}>
                  Hide the written word
                </button>
              ) : null}
            </div>
            {revealed && voice ? (
              <p className="test-voice-note" role="status">
                The hearing part is given away: the word is{' '}
                <strong className="test-voice-word" lang="zh">{question.spoken}</strong>.
              </p>
            ) : null}
            {!voice ? (
              <p className="test-voice-note" role="status">
                <IconAlert /> {voiceReason ?? 'No Chinese voice is installed on this device.'} So this
                is a written question instead of a hearing one — the word is shown below and the
                answer is the same.
              </p>
            ) : null}
            {!voice ? (
              <p className="test-stem test-stem-cjk" lang="zh">
                {question.prompt ?? question.spoken}
              </p>
            ) : null}
          </div>
        ) : null}

        <fieldset className="learn-options">
          <legend className="visually-hidden">{`${question.stem} — choose one answer`}</legend>
          {question.options.map((option, slot) => (
            <label
              key={`${question.id}-${slot}`}
              className={`learn-option ${stored?.position === slot ? 'is-picked' : ''}`}
            >
              <input
                type="radio"
                name={`test-question-${question.id}`}
                checked={stored?.position === slot}
                onChange={() => onAnswer(slot)}
              />
              <span className="faint text-sm" aria-hidden="true">
                {String.fromCharCode(65 + slot)}
              </span>
              <span className={option.cjk ? 'learn-option-cjk' : ''} lang={option.cjk ? 'zh' : undefined}>
                {option.label}
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="test-tools">
        <button type="button" className="test-flag" onClick={onFlag} aria-pressed={flagged}>
          <IconStar /> {flagged ? 'Flagged for review' : 'Flag for review'}
        </button>
        <span className="spacer" />
        <button type="button" className="btn" onClick={onBack} disabled={position === 0}>
          <IconChevronLeft /> Previous
        </button>
        <button type="button" className="btn btn-primary" onClick={onNext} disabled={!stored}>
          {last ? 'Review my answers' : 'Next question'}
        </button>
        {!stored ? <span className="learn-hint">Choose one option to continue.</span> : null}
      </div>
    </section>
  );
}

/** One line of the review pass: what was asked, what was chosen, and a way back to it. */
function ReviewRow({
  row,
  position,
  stored,
  flagged,
  onGo,
}: {
  row: TestQuestion;
  position: number;
  stored: Stored | undefined;
  flagged: boolean;
  onGo: () => void;
}) {
  const chosen = stored ? row.options[stored.position]?.label : undefined;
  return (
    <li className="learn-result-line">
      <span className="text-sm faint">
        {position + 1}. {SECTION_LABEL[row.section]}
        {flagged ? (
          <span className="test-flag-chip">
            <IconStar /> flagged
          </span>
        ) : null}
      </span>
      <span className="text-sm">{row.stem}</span>
      <span className="text-sm test-review-answer">
        Your answer:{' '}
        <strong lang={row.options[stored?.position ?? 0]?.cjk ? 'zh' : undefined}>
          {chosen ?? 'not answered'}
        </strong>
      </span>
      <div className="row-wrap">
        <button type="button" className="btn" onClick={onGo}>
          Change this one
        </button>
        {!stored ? <span className="badge badge-warn">unanswered</span> : null}
      </div>
    </li>
  );
}

function isCjk(text: string): boolean {
  return /[㐀-鿿]/.test(text);
}

function sectionsOf(questions: TestQuestion[]): TestQuestion['section'][] {
  return [...new Set(questions.map((row) => row.section))];
}

/** Which words one item was made from, for the honest source line in the results. */
function wordPoolOf(question: TestQuestion): TestSpec['pool'] {
  switch (question.origin) {
    case 'saved':
      return 'saved';
    case 'card':
      return 'cards';
    case 'list':
    case 'notebook':
      return 'source';
    default:
      return 'dictionary';
  }
}

async function playSpoken(text: string, lang: string, rate: number, toast: ReturnType<typeof useToast>) {
  const result = await speak(text, { lang, rate });
  if (!result.ok) toast.push({ message: result.reason ?? 'No audio available on this device.', tone: 'warn' });
}

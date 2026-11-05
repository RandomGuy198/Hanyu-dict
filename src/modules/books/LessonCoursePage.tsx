/** `#/courses/:bookId/:lessonId` — the five-step guided course for one lesson (`07_UI_SPEC.md` §2.4).
 *
 *  The learner moves through `Từ mới → Bài khoá → Ngữ pháp → Nhận biết → Tập viết`. Every word,
 *  sentence, note and drill question is read from the lesson JSON in the private `Hanyu-data`
 *  repository, so nothing from the textbook ships in this bundle. Step completion is stored per
 *  lesson in `courseProgress`, seeds the book's SRS deck, and is pushed through the sync engine. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components';
import {
  IconBook,
  IconCards,
  IconCheck,
  IconChevronLeft,
  IconGear,
  IconPen,
  IconSpeaker,
} from '../../app/icons';
import { useToast } from '../../app/providers';
import {
  playLessonSlice,
  playSentenceAudio,
  playWordAudio,
  stopAudio,
} from '../../data/audioPlayer';
import { getCourseProgress, saveCourseProgress } from '../../data/db';
import { getLessonDocument } from '../../data/privateData';
import { markDirty } from '../../data/syncEngine';
import { marksToNumbered } from '../../domain/pinyin';
import type {
  CourseLessonProgress,
  CourseStepId,
  LessonDocument,
  LessonSentence,
  LessonVocabItem,
  SentenceToken,
} from '../../domain/types';
import StrokeQuiz from '../characters/StrokeQuiz';
import { ensureCourseLessonDeckAndCards } from '../learning/learningStore';
import { AudioBar } from './AudioBar';
import { findVolume } from './bookCatalog';
import { buildLessonDrill, drillPassMark, isDrillPassed, type DrillQuestion } from './courseDrill';
import { WordPopover } from './WordPopover';
import './books.css';

const STEP_ORDER: CourseStepId[] = ['vocab', 'dialogue', 'grammar', 'drill', 'writing'];

const STEP_TITLES: Record<CourseStepId, string> = {
  vocab: 'Từ mới',
  dialogue: 'Bài khoá',
  grammar: 'Ngữ pháp',
  drill: 'Nhận biết',
  writing: 'Tập viết',
};

interface PopoverState {
  vocab?: LessonVocabItem;
  token?: SentenceToken;
  sentence?: LessonSentence;
}

/** Shadowing waits 1.5 × the sentence length after playing, so the learner has room to repeat. */
const SHADOW_GAP_MULTIPLIER = 1.5;
const TTS_FALLBACK_MS = 2500;

function sentenceSliceMs(sentence: LessonSentence): number {
  const slice = sentence.lessonAudioSlice;
  if (slice && slice.endMs > slice.startMs) {
    return Math.round((slice.endMs - slice.startMs) * SHADOW_GAP_MULTIPLIER);
  }
  return Math.round(TTS_FALLBACK_MS * SHADOW_GAP_MULTIPLIER);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export default function LessonCoursePage() {
  const { bookId, lessonId } = useParams<{ bookId?: string; lessonId?: string }>();
  const toast = useToast();
  const catalogBook = findVolume(bookId);

  const [lesson, setLesson] = useState<LessonDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<CourseLessonProgress | null>(null);
  const [step, setStep] = useState<CourseStepId>('vocab');

  const [expandedVocabId, setExpandedVocabId] = useState<string | null>(null);
  const [vocabBusy, setVocabBusy] = useState(false);
  const [playingAll, setPlayingAll] = useState(false);

  const [showHanzi, setShowHanzi] = useState(true);
  const [showPinyin, setShowPinyin] = useState(true);
  const [showVi, setShowVi] = useState(true);
  const [shadowing, setShadowing] = useState(false);
  const [activeSentenceId, setActiveSentenceId] = useState<string | null>(null);
  const [audioMode, setAudioMode] = useState<'context' | 'tts'>('context');
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [loopSentence, setLoopSentence] = useState(false);

  const [viewedNoteIds, setViewedNoteIds] = useState<string[]>([]);

  const [questions, setQuestions] = useState<DrillQuestion[] | null>(null);
  const [drillIndex, setDrillIndex] = useState(0);
  const [drillPicks, setDrillPicks] = useState<Record<string, number>>({});
  const [drillShowResult, setDrillShowResult] = useState(false);

  const [writingIndex, setWritingIndex] = useState(0);
  const [writingRound, setWritingRound] = useState<'guided' | 'recall'>('guided');
  const [writingDone, setWritingDone] = useState<string[]>([]);
  const [writingRestart, setWritingRestart] = useState(0);

  const [popover, setPopover] = useState<PopoverState | null>(null);

  const shadowRunRef = useRef(0);
  const playAllRunRef = useRef(0);

  const resolvedLessonId = lessonId ?? '';

  useEffect(() => {
    if (!bookId || !resolvedLessonId) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setLesson(null);
    setProgress(null);
    setViewedNoteIds([]);
    setQuestions(null);
    setDrillIndex(0);
    setDrillPicks({});
    setWritingIndex(0);
    setWritingRound('guided');
    setWritingDone([]);
    setExpandedVocabId(null);

    void Promise.all([
      getLessonDocument(bookId, resolvedLessonId),
      getCourseProgress(resolvedLessonId),
    ]).then(([doc, saved]) => {
      if (!alive) return;
      setLesson(doc);
      setProgress(saved ?? null);
      if (saved) {
        const nextIncomplete = STEP_ORDER.find((id) => !saved.completedSteps.includes(id));
        setStep(nextIncomplete ?? 'vocab');
      }
      setLoading(false);
    });

    return () => {
      alive = false;
      shadowRunRef.current += 1;
      playAllRunRef.current += 1;
      stopAudio();
    };
  }, [bookId, resolvedLessonId]);

  /** Records one finished step and keeps `completedAt` honest for the whole lesson. */
  const completeStep = useCallback(
    async (done: CourseStepId, patch?: Partial<CourseLessonProgress>) => {
      if (!bookId || !resolvedLessonId) return;
      const now = new Date().toISOString();
      const current = (await getCourseProgress(resolvedLessonId)) ?? progress ?? {
        lessonId: resolvedLessonId,
        bookId,
        completedSteps: [] as CourseStepId[],
        writingCompletedChars: [] as string[],
        lastStudiedAt: now,
        updatedAt: now,
      };
      const completedSteps = current.completedSteps.includes(done)
        ? current.completedSteps
        : [...current.completedSteps, done];
      const merged: CourseLessonProgress = {
        ...current,
        ...patch,
        lessonId: resolvedLessonId,
        bookId,
        completedSteps,
        lastStudiedAt: now,
        updatedAt: now,
      };
      const allDone = STEP_ORDER.every((id) => merged.completedSteps.includes(id));
      merged.completedAt = allDone ? (merged.completedAt ?? now) : undefined;
      await saveCourseProgress(merged);
      setProgress(merged);
      markDirty();
    },
    [bookId, progress, resolvedLessonId],
  );

  const sentences = useMemo<LessonSentence[]>(
    () => (lesson ? lesson.dialogues.flatMap((block) => block.sentences) : []),
    [lesson],
  );

  const grammarCards = useMemo(() => {
    if (!lesson) return [] as { id: string; heading: string; body: string; examples: LessonSentence[] }[];
    return [
      ...lesson.notes.map((note) => ({
        id: note.id,
        heading: note.heading,
        body: note.bodyVi || note.bodyEn || '',
        examples: note.examples,
      })),
      ...lesson.grammar.map((item) => ({
        id: item.id,
        heading: item.heading,
        body: item.explanationVi || item.explanationEn || '',
        examples: item.examples,
      })),
    ];
  }, [lesson]);

  const drill = useMemo(() => questions ?? [], [questions]);

  useEffect(() => {
    if (lesson) setQuestions(buildLessonDrill(lesson));
  }, [lesson]);

  const drillCorrect = useMemo(() => {
    let count = 0;
    for (const question of drill) {
      if (drillPicks[question.id] === question.answer) count += 1;
    }
    return count;
  }, [drill, drillPicks]);

  const drillAnswered = Object.keys(drillPicks).length;
  const passMark = drillPassMark(drill.length);

  const writingTargets = useMemo(
    () => (lesson ? lesson.writingTargets.filter((char) => char.trim().length > 0) : []),
    [lesson],
  );

  const completedSteps = progress?.completedSteps ?? [];

  /* ------------------------------------------------------------------ step 1 */

  const playAllVocab = async () => {
    if (!lesson) return;
    const run = ++playAllRunRef.current;
    setPlayingAll(true);
    for (const item of lesson.vocabulary) {
      if (run !== playAllRunRef.current) return;
      await playWordAudio(item.hanzi, item.pinyinNumbered || marksToNumbered(item.pinyin));
      if (run !== playAllRunRef.current) return;
      await sleep(1200);
    }
    if (run === playAllRunRef.current) setPlayingAll(false);
  };

  const addAllToSrs = async () => {
    if (!lesson || !catalogBook || vocabBusy) return;
    setVocabBusy(true);
    try {
      const result = await ensureCourseLessonDeckAndCards(
        lesson.bookId,
        catalogBook.volume,
        lesson.vocabulary,
        lesson.writingTargets,
        { lessonId: lesson.lessonId },
      );
      await completeStep('vocab');
      toast.push(
        `Đã thêm ${result.addedRecognition} thẻ nhận biết và ${result.addedWriting} thẻ tập viết vào bộ “${result.deck.name}”.`,
      );
    } catch (error) {
      console.error('[course] the SRS deck could not be prepared', error);
      toast.push({ message: 'Không tạo được thẻ ôn tập. Từ vựng của bài vẫn nguyên.', tone: 'warn' });
    } finally {
      setVocabBusy(false);
    }
  };

  /* ------------------------------------------------------------------ step 2 */

  const playSentence = async (sentence: LessonSentence) => {
    setActiveSentenceId(sentence.id);
    await playSentenceAudio(sentence, audioMode, playbackRate);
  };

  /** Steps through the dialogue, leaving a pause after each sentence for the learner to repeat. */
  const runShadowing = async () => {
    if (!lesson || sentences.length === 0) return;
    const run = ++shadowRunRef.current;
    setShadowing(true);
    for (const sentence of sentences) {
      if (run !== shadowRunRef.current) return;
      setActiveSentenceId(sentence.id);
      await playSentenceAudio(sentence, audioMode, playbackRate);
      if (run !== shadowRunRef.current) return;
      await sleep(sentenceSliceMs(sentence));
    }
    if (run === shadowRunRef.current) {
      setShadowing(false);
      await completeStep('dialogue');
    }
  };

  const stopShadowing = () => {
    shadowRunRef.current += 1;
    setShadowing(false);
    stopAudio();
  };

  /* ------------------------------------------------------------------ step 4 */

  const answerDrill = (question: DrillQuestion, choice: number) => {
    if (drillPicks[question.id] !== undefined) return;
    const picks = { ...drillPicks, [question.id]: choice };
    setDrillPicks(picks);
    if (Object.keys(picks).length === drill.length && lesson) {
      const correct = drill.reduce(
        (count, item) => (picks[item.id] === item.answer ? count + 1 : count),
        0,
      );
      if (isDrillPassed(correct, drill.length)) {
        void completeStep('drill', { bestDrillScore: correct });
        toast.push(`Đạt ${correct}/${drill.length} — bước Nhận biết hoàn thành.`);
      } else {
        toast.push(`Đạt ${correct}/${drill.length} — cần ${passMark} để hoàn thành bước này.`);
      }
    }
  };

  /** The seeded generator keeps the set, so a retry clears answers rather than reshuffling. */
  const retryDrill = () => {
    setDrillPicks({});
    setDrillIndex(0);
    setDrillShowResult(false);
  };

  /** Answering keeps the question on screen so the pick stays visible; this moves on. */
  const nextDrillQuestion = () => {
    if (drillAnswered === drill.length) {
      setDrillShowResult(true);
      return;
    }
    setDrillIndex((index) => Math.min(index + 1, drill.length - 1));
  };

  const replayDrillAudio = (question: DrillQuestion) => {
    const audio = question.audio;
    if (!audio) return;
    if (audio.lessonAudioSlice) {
      void playLessonSlice(audio.lessonAudioSlice);
      return;
    }
    void playWordAudio(audio.hanzi, audio.pinyinNumbered);
  };

  /* ------------------------------------------------------------------ step 5 */

  const finishWritingChar = async (mistakes: number) => {
    const char = writingTargets[writingIndex];
    if (!char) return;
    if (writingRound === 'guided') {
      if (mistakes > 2) {
        setWritingRestart((nonce) => nonce + 1);
        toast.push(`Còn ${mistakes} nét sai — viết lại lượt có nét mờ cho chắc tay.`);
        return;
      }
      setWritingRound('recall');
      setWritingRestart((nonce) => nonce + 1);
      return;
    }
    if (mistakes > 3) {
      setWritingRound('guided');
      setWritingRestart((nonce) => nonce + 1);
      toast.push(`Còn ${mistakes} nét sai — mình tập lại với nét mờ trước.`);
      return;
    }
    const done = writingDone.includes(char) ? writingDone : [...writingDone, char];
    setWritingDone(done);
    if (writingIndex + 1 < writingTargets.length) {
      setWritingIndex((index) => index + 1);
      setWritingRound('guided');
      setWritingRestart((nonce) => nonce + 1);
      return;
    }
    if (!lesson || !catalogBook) return;
    await ensureCourseLessonDeckAndCards(
      lesson.bookId,
      catalogBook.volume,
      lesson.vocabulary,
      lesson.writingTargets,
      { lessonId: lesson.lessonId, scheduleInitialReview: true },
    );
    await completeStep('writing', { writingCompletedChars: done });
    toast.push('Hoàn thành bước Tập viết — thẻ SRS đã vào lịch ôn.');
  };

  /* ------------------------------------------------------------------ render */

  if (!catalogBook) {
    return (
      <div className="stack">
        <PageHeader title="Không tìm thấy bài học" />
        <p className="muted">Địa chỉ không khớp quyển nào trong bộ sáu tập.</p>
        <Link className="btn btn-primary" to="/books">
          <IconChevronLeft /> Về kệ sách
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="stack books-course">
        <PageHeader title="Đang tải bài học…" subtitle="Bài học đọc từ kho dữ liệu riêng tư của bạn." />
        <div className="skeleton" style={{ height: 160 }} />
      </div>
    );
  }

  if (!lesson) {
    return (
      <div className="stack books-course">
        <PageHeader title={`Bài ${resolvedLessonId} — 5 bước`} />
        <section className="card" aria-labelledby="course-need-data">
          <h2 id="course-need-data">Chưa có nội dung bài này trên máy</h2>
          <p className="muted">
            Từ vựng, hội thoại, chú thích ngữ pháp và âm thanh của bài nằm trong repository riêng
            tư <code>RandomGuy198/Hanyu-data</code>. Sau khi kết nối, bài học tải về và lưu trong
            IndexedDB để dùng offline.
          </p>
          <div className="row-wrap">
            <Link className="btn btn-primary" to="/settings">
              <IconGear /> Kết nối kho Hanyu-data
            </Link>
            <Link className="btn" to="/data">
              Xem dữ liệu đã tải
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="stack books-course">
      <nav className="books-reader-bar" aria-label="Điều hướng bài học">
        <Link className="btn btn-sm" to={`/books/${lesson.bookId}`}>
          <IconChevronLeft /> Quyển {catalogBook.volume}
        </Link>
        <span className="books-reader-title">
          <IconBook /> Bài {lesson.lessonNumber}: {lesson.titleZh}
        </span>
        <span className="spacer" />
        <Link className="btn btn-sm" to={`/books/${lesson.bookId}/page/${lesson.startPage}`}>
          <IconBook /> Trang sách
        </Link>
      </nav>

      <PageHeader
        title={`Bài ${lesson.lessonNumber}: ${lesson.titleZh}`}
        subtitle={`${lesson.titleVi} · ${lesson.vocabulary.length} từ mới · ${sentences.length} câu · trang ${lesson.startPage}–${lesson.endPage}`}
      />

      <ol className="books-course-stepper" aria-label="Năm bước của bài học">
        {STEP_ORDER.map((id, index) => {
          const done = completedSteps.includes(id);
          return (
            <li key={id}>
              <button
                type="button"
                className={`books-course-tab ${step === id ? 'is-active' : ''} ${done ? 'is-done' : ''}`}
                aria-current={step === id ? 'step' : undefined}
                onClick={() => setStep(id)}
              >
                <span className="books-course-tab-number" aria-hidden="true">
                  {done ? <IconCheck /> : index + 1}
                </span>
                <span>{STEP_TITLES[id]}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {step === 'vocab' ? (
        <section className="card books-course-step" aria-labelledby="course-step-vocab">
          <h2 id="course-step-vocab" className="h3">
            Bước 1 — Từ mới
          </h2>
          <div className="row-wrap">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                if (playingAll) {
                  playAllRunRef.current += 1;
                  stopAudio();
                  setPlayingAll(false);
                  return;
                }
                void playAllVocab();
              }}
            >
              <IconSpeaker /> {playingAll ? 'Dừng phát' : '▶ Nghe toàn bộ từ mới'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void addAllToSrs()}
              disabled={vocabBusy}
            >
              <IconCards /> {vocabBusy ? 'Đang tạo thẻ…' : '➕ Thêm tất cả vào Ôn tập SRS'}
            </button>
            {completedSteps.includes('vocab') ? (
              <span className="badge badge-ok">Đã vào bộ thẻ ôn</span>
            ) : null}
          </div>

          <ul className="books-vocab-list">
            {lesson.vocabulary.map((item) => (
              <li key={item.id} className="books-course-vocab-item">
                <div
                  className="books-vocab-row"
                  role="button"
                  tabIndex={0}
                  aria-expanded={expandedVocabId === item.id}
                  onClick={() =>
                    setExpandedVocabId((current) => (current === item.id ? null : item.id))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setExpandedVocabId((current) => (current === item.id ? null : item.id));
                    }
                  }}
                >
                  <span className="books-vocab-hanzi" lang="zh-Hans">
                    {item.hanzi}
                  </span>
                  <span className="muted text-sm">{item.pinyin}</span>
                  {item.hanViet ? <span className="badge">HÁN VIỆT: {item.hanViet}</span> : null}
                  {item.pos ? <span className="muted text-sm">{item.pos}</span> : null}
                  <span className="books-vocab-meaning">{item.meaningVi || item.meaningEn}</span>
                </div>
                <div className="row-wrap">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      void playWordAudio(item.hanzi, item.pinyinNumbered || marksToNumbered(item.pinyin))
                    }
                    aria-label={`Nghe phát âm ${item.hanzi}`}
                  >
                    <IconSpeaker />
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPopover({ vocab: item })}>
                    Chi tiết
                  </button>
                </div>
                {expandedVocabId === item.id ? (
                  <div className="books-vocab-stroke">
                    <StrokeQuiz char={item.hanzi} mode="animate" />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {step === 'dialogue' ? (
        <section className="card books-course-step" aria-labelledby="course-step-dialogue">
          <h2 id="course-step-dialogue" className="h3">
            Bước 2 — Bài khoá
          </h2>
          <div className="row-wrap">
            <button
              type="button"
              className={`btn btn-sm ${shadowing ? 'btn-primary' : ''}`}
              onClick={() => (shadowing ? stopShadowing() : void runShadowing())}
            >
              <IconSpeaker /> {shadowing ? 'Dừng chế độ nhại' : ' Đọc đuổi / Shadowing'}
            </button>
            <button
              type="button"
              className={`chip ${showHanzi ? 'is-active' : ''}`}
              aria-pressed={showHanzi}
              onClick={() => setShowHanzi((value) => !value)}
            >
              Ẩn chữ Hán
            </button>
            <button
              type="button"
              className={`chip ${showPinyin ? 'is-active' : ''}`}
              aria-pressed={showPinyin}
              onClick={() => setShowPinyin((value) => !value)}
            >
              Ẩn Pinyin
            </button>
            <button
              type="button"
              className={`chip ${showVi ? 'is-active' : ''}`}
              aria-pressed={showVi}
              onClick={() => setShowVi((value) => !value)}
            >
              Ẩn nghĩa Việt
            </button>
            {completedSteps.includes('dialogue') ? <span className="badge badge-ok">Đã học xong</span> : null}
          </div>

          <ol className="books-sentence-list">
            {sentences.map((sentence, index) => (
              <li
                key={sentence.id}
                className={`books-sentence-card ${activeSentenceId === sentence.id ? 'is-active' : ''}`}
              >
                <div className="books-sentence-head">
                  <span className="badge">{index + 1}</span>
                  {sentence.speaker ? <strong className="text-sm">{sentence.speaker}</strong> : null}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void playSentence(sentence)}
                    aria-label={`Nghe câu ${index + 1}`}
                  >
                    <IconSpeaker /> Nghe câu
                  </button>
                </div>
                {showHanzi ? (
                  <p className="books-sentence-zh">
                    {sentence.tokens.length > 0
                      ? sentence.tokens.map((token, position) => (
                          <span
                            key={`${sentence.id}-${position}`}
                            role="button"
                            tabIndex={0}
                            className={`zh-token ${
                              token.citationPinyin && token.citationPinyin !== token.pinyin
                                ? 'has-sandhi'
                                : ''
                            }`}
                            onClick={() =>
                              setPopover({ token, sentence })
                            }
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setPopover({ token, sentence });
                              }
                            }}
                          >
                            {token.surface}
                          </span>
                        ))
                      : sentence.zh}
                  </p>
                ) : null}
                {showPinyin && sentence.pinyin ? (
                  <p className="books-sentence-pinyin text-sm muted">{sentence.pinyin}</p>
                ) : null}
                {showVi && sentence.vi ? <p className="books-sentence-vi text-sm">{sentence.vi}</p> : null}
                {sentence.sandhiNotes && sentence.sandhiNotes.length > 0 ? (
                  <p className="books-sentence-sandhi text-sm">
                    {sentence.sandhiNotes.map((note) => (
                      <span key={note} className="badge badge-warn">
                        {note}
                      </span>
                    ))}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>

          <AudioBar
            sentences={sentences}
            activeSentenceId={activeSentenceId}
            onActiveSentenceChange={setActiveSentenceId}
            audioMode={audioMode}
            onAudioModeChange={setAudioMode}
            playbackRate={playbackRate}
            onPlaybackRateChange={setPlaybackRate}
            loopSentence={loopSentence}
            onLoopSentenceChange={setLoopSentence}
          />
        </section>
      ) : null}

      {step === 'grammar' ? (
        <section className="card books-course-step" aria-labelledby="course-step-grammar">
          <h2 id="course-step-grammar" className="h3">
            Bước 3 — Chú thích &amp; Ngữ pháp
          </h2>
          <p className="text-sm muted">
            Mở hết {grammarCards.length} mục để đánh dấu bước này. Mỗi ví dụ đều bấm được để nghe.
          </p>
          {grammarCards.length === 0 ? (
            <p className="muted">Bài này không có mục chú thích nào.</p>
          ) : (
            <ul className="books-grammar-list">
              {grammarCards.map((card) => {
                const open = viewedNoteIds.includes(card.id);
                return (
                  <li key={card.id} className="card books-grammar-card">
                    <button
                      type="button"
                      className="books-grammar-head"
                      aria-expanded={open}
                      onClick={() => {
                        if (viewedNoteIds.includes(card.id)) return;
                        const next = [...viewedNoteIds, card.id];
                        setViewedNoteIds(next);
                        if (next.length === grammarCards.length) void completeStep('grammar');
                      }}
                    >
                      <strong>{card.heading}</strong>
                      <span className="badge">{open ? 'Đã mở' : 'Chưa mở'}</span>
                    </button>
                    {open ? (
                      <>
                        <p className="text-sm">{card.body}</p>
                        <ul className="books-example-list">
                          {card.examples.map((example) => (
                            <li key={example.id}>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => void playSentenceAudio(example, audioMode, playbackRate)}
                                aria-label={`Nghe ví dụ ${example.zh}`}
                              >
                                <IconSpeaker />
                              </button>
                              <span className="zh-token-static">{example.zh}</span>
                              {example.pinyin ? (
                                <span className="text-sm muted"> {example.pinyin}</span>
                              ) : null}
                              {example.vi ? <span className="text-sm"> — {example.vi}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {completedSteps.includes('grammar') ? <span className="badge badge-ok">Đã xong</span> : null}
        </section>
      ) : null}

      {step === 'drill' ? (
        <section className="card books-course-step" aria-labelledby="course-step-drill">
          <h2 id="course-step-drill" className="h3">
            Bước 4 — Luyện nhận biết
          </h2>
          {drill.length === 0 ? (
            <p className="muted">
              Bài này chưa đủ từ vựng để tự tạo 12 câu hỏi (cần ít nhất 4 từ có phương án khác
              nhau). Học bước khác, hoặc thử lại sau khi dữ liệu bài được cập nhật.
            </p>
          ) : (
            <>
              <p className="text-sm muted">
                Câu {Math.min(drillIndex + 1, drill.length)}/{drill.length} · cần {passMark} câu
                đúng để hoàn thành bước.
              </p>
              {(() => {
                const question = drill[Math.min(drillIndex, drill.length - 1)];
                const picked = drillPicks[question.id];
                const isLast = drillAnswered === drill.length && drillShowResult;
                if (isLast) {
                  return (
                    <div className="books-drill-result" role="status">
                      <strong>
                        {drillCorrect}/{drill.length} câu đúng
                      </strong>
                      <p className="text-sm muted">
                        {isDrillPassed(drillCorrect, drill.length)
                          ? 'Bước Nhận biết đã hoàn thành.'
                          : `Chưa đạt ${passMark} câu — làm lại bộ câu hỏi.`}
                      </p>
                      <button type="button" className="btn btn-sm" onClick={retryDrill}>
                        Làm lại
                      </button>
                    </div>
                  );
                }
                return (
                  <div className="books-drill-question">
                    <p className="books-drill-label text-sm muted">{question.labelVi}</p>
                    {question.audio ? (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => replayDrillAudio(question)}
                      >
                        <IconSpeaker /> Phát lại
                      </button>
                    ) : null}
                    {question.stem ? (
                      <p className="books-drill-stem" lang="zh-Hans">
                        {question.stem}
                      </p>
                    ) : null}
                    <div className="books-drill-options" role="group" aria-label={question.labelVi}>
                      {question.options.map((option, position) => {
                        const chosen = picked === position;
                        const state =
                          picked === undefined
                            ? ''
                            : position === question.answer
                              ? ' is-correct'
                              : chosen
                                ? ' is-wrong'
                                : '';
                        return (
                          <button
                            key={`${question.id}-${position}`}
                            type="button"
                            className={`books-drill-option${state}`}
                            disabled={picked !== undefined}
                            onClick={() => answerDrill(question, position)}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>
                    {picked !== undefined && question.reveal ? (
                      <p className="text-sm muted">Gợi ý: {question.reveal}</p>
                    ) : null}
                    {picked !== undefined ? (
                      <div className="row-wrap">
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={nextDrillQuestion}
                        >
                          {drillAnswered === drill.length ? 'Xem kết quả' : 'Câu tiếp theo'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })()}
            </>
          )}
          {completedSteps.includes('drill') ? (
            <span className="badge badge-ok">
              Đạt {progress?.bestDrillScore ?? drillCorrect}/{drill.length}
            </span>
          ) : null}
        </section>
      ) : null}

      {step === 'writing' ? (
        <section className="card books-course-step" aria-labelledby="course-step-writing">
          <h2 id="course-step-writing" className="h3">
            Bước 5 — Tập viết chữ Hán
          </h2>
          {writingTargets.length === 0 ? (
            <p className="muted">Bài này không có chữ mới cần tập viết.</p>
          ) : (
            (() => {
              const char = writingTargets[Math.min(writingIndex, writingTargets.length - 1)];
              const source =
                lesson.vocabulary.find((item) => item.hanzi === char) ??
                lesson.vocabulary.find((item) => item.hanzi.includes(char));
              const finished = writingDone.length >= writingTargets.length;
              return (
                <>
                  <p className="text-sm muted">
                    Chữ {Math.min(writingIndex + 1, writingTargets.length)}/{writingTargets.length} ·{' '}
                    {writingRound === 'guided' ? 'Lượt có nét mờ' : 'Lượt nhớ lại'}
                  </p>
                  <div className="books-writing-head">
                    <span className="books-writing-char" lang="zh-Hans">
                      {char}
                    </span>
                    <div>
                      <p className="text-sm">
                        {source ? (
                          <>
                            <span className="muted">{source.pinyin}</span> ·{' '}
                            {source.meaningVi || source.meaningEn}
                            {source.hanViet ? (
                              <>
                                {' '}
                                <span className="badge">HÁN VIỆT: {source.hanViet}</span>
                              </>
                            ) : null}
                          </>
                        ) : (
                          <span className="muted">Không tìm thấy từ chứa chữ này trong bài.</span>
                        )}
                      </p>
                      <div className="row-wrap">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() =>
                            source
                              ? void playWordAudio(
                                  source.hanzi,
                                  source.pinyinNumbered || marksToNumbered(source.pinyin),
                                )
                              : void playWordAudio(char)
                          }
                        >
                          <IconSpeaker /> Nghe
                        </button>
                        <Link
                          className="btn btn-ghost btn-sm"
                          to={`/writing?chars=${encodeURIComponent(char)}`}
                        >
                          <IconPen /> Mở bàn viết
                        </Link>
                      </div>
                    </div>
                  </div>
                  {finished ? (
                    <p className="notice notice-info" role="status">
                      <span>Đã viết xong {writingTargets.length} chữ của bài này.</span>
                    </p>
                  ) : (
                    <StrokeQuiz
                      char={char}
                      mode="quiz"
                      round={writingRound}
                      restartKey={writingRestart}
                      onComplete={(summary) => void finishWritingChar(summary.totalMistakes)}
                    />
                  )}
                  <ul className="books-writing-progress">
                    {writingTargets.map((target) => (
                      <li key={target} className={writingDone.includes(target) ? 'is-done' : ''}>
                        <span lang="zh-Hans">{target}</span>
                        {writingDone.includes(target) ? <IconCheck /> : null}
                      </li>
                    ))}
                  </ul>
                </>
              );
            })()
          )}
          {completedSteps.includes('writing') ? <span className="badge badge-ok">Đã xong</span> : null}
        </section>
      ) : null}

      {popover ? (
        <WordPopover
          vocab={popover.vocab}
          token={popover.token}
          sentence={popover.sentence}
          vocabulary={lesson.vocabulary}
          bookId={lesson.bookId}
          lessonId={lesson.lessonId}
          onClose={() => setPopover(null)}
        />
      ) : null}
    </div>
  );
}

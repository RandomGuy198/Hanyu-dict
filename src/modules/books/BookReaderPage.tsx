/**
 * `#/books/:bookId` and `#/books/:bookId/page/:pageNum` — Interactive Dual-Mode Book Reader (`07_UI_SPEC.md` §2.2).
 *
 * Supports:
 * - `📄 Trang sách` (`page`): Rendered textbook page (`1224×1584` WebP) with interactive `<button className="page-hotspot">` overlays.
 * - `📝 Văn bản` (`text`): Structured dialogues, vocabulary, grammar, and notes with clickable segmented word tokens (`zh-token`).
 * - `Song song` (`split`): Page Scan on the left, Clean Interactive Text on the right.
 * - Synchronized `<AudioBar />` at the bottom and `<WordPopover />` on word/vocab click.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader, Segmented } from '../../components';
import { IconBook, IconChevronLeft, IconGear } from '../../app/icons';
import {
  playLessonSlice,
  playSentenceAudio,
  playWordAudio,
} from '../../data/audioPlayer';
import { getBookBookmark, saveBookBookmark } from '../../data/db';
import {
  getBookDetail,
  getLessonDocument,
  getPageImageBlobUrl,
} from '../../data/privateData';
import { markDirty } from '../../data/syncEngine';
import { marksToNumbered } from '../../domain/pinyin';
import type {
  BookSummary,
  LessonDocument,
  LessonSentence,
  LessonSummary,
  LessonVocabItem,
  PageHotspot,
  SentenceToken,
} from '../../domain/types';
import { AudioBar } from './AudioBar';
import { findVolume } from './bookCatalog';
import { WordPopover } from './WordPopover';
import './books.css';

type ReaderViewMode = 'page' | 'text' | 'split';

interface PopoverState {
  vocab?: LessonVocabItem;
  token?: SentenceToken;
  sentence?: LessonSentence;
}

function defaultViewMode(): ReaderViewMode {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      if (window.matchMedia('(min-width: 1024px)').matches) {
        return 'split';
      }
    } catch {
      // Ignore matchMedia errors
    }
  }
  return 'page';
}

function padPageNumber(pageNum: number): string {
  return String(Math.max(1, pageNum)).padStart(3, '0');
}

function resolveLessonForPage(lessons: LessonSummary[], page: number): LessonSummary | undefined {
  if (lessons.length === 0) return undefined;
  const exact = lessons.find((l) => page >= l.startPage && page <= l.endPage);
  if (exact) return exact;
  const before = [...lessons].reverse().find((l) => page >= l.startPage);
  if (before) return before;
  return lessons[0];
}

export default function BookReaderPage() {
  const { bookId, pageNum } = useParams<{ bookId?: string; pageNum?: string }>();
  const navigate = useNavigate();
  const catalogBook = findVolume(bookId);

  const [bookDetail, setBookDetail] = useState<BookSummary | null>(null);
  const [lessonDoc, setLessonDoc] = useState<LessonDocument | null>(null);
  const [pageImageUrl, setPageImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentPage, setCurrentPage] = useState<number>(() => {
    const parsed = Number(pageNum);
    return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
  });
  const [pageJumpInput, setPageJumpInput] = useState<string>(() => String(currentPage));
  const [viewMode, setViewMode] = useState<ReaderViewMode>(defaultViewMode);
  const [bookmarkInitialized, setBookmarkInitialized] = useState(false);

  const [showPinyin, setShowPinyin] = useState(true);
  const [showVi, setShowVi] = useState(true);

  const [activeSentenceId, setActiveSentenceId] = useState<string | null>(null);
  const [activeHotspotId, setActiveHotspotId] = useState<string | null>(null);
  const [floatingSentence, setFloatingSentence] = useState<LessonSentence | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);

  const [audioMode, setAudioMode] = useState<'context' | 'tts'>('context');
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [loopSentence, setLoopSentence] = useState<boolean>(false);

  const maxPages = bookDetail?.pageCount ?? catalogBook?.pageCount ?? 177;

  // Sync URL `:pageNum` or load bookmark when `:pageNum` is omitted
  useEffect(() => {
    if (!bookId || !catalogBook) return;
    let alive = true;

    async function initBookAndBookmark() {
      const [detail, savedBookmark] = await Promise.all([
        getBookDetail(bookId!),
        getBookBookmark(bookId!),
      ]);
      if (!alive) return;
      if (detail) setBookDetail(detail);
      if (savedBookmark?.viewMode) {
        setViewMode(savedBookmark.viewMode);
      }

      if (pageNum !== undefined) {
        const parsed = Number(pageNum);
        const clamped = Number.isInteger(parsed)
          ? Math.max(1, Math.min(detail?.pageCount ?? catalogBook!.pageCount, parsed))
          : 1;
        setCurrentPage(clamped);
        setPageJumpInput(String(clamped));
      } else {
        const fallbackPage =
          savedBookmark?.lastPageNumber ??
          detail?.lessons[0]?.startPage ??
          (bookId === 'b1' ? 19 : 1);
        setCurrentPage(fallbackPage);
        setPageJumpInput(String(fallbackPage));
      }
      setBookmarkInitialized(true);
    }

    void initBookAndBookmark();
    return () => {
      alive = false;
    };
  }, [bookId, catalogBook, pageNum]);

  const currentLessonSummary = useMemo(() => {
    if (!bookDetail?.lessons?.length) return undefined;
    return resolveLessonForPage(bookDetail.lessons, currentPage);
  }, [bookDetail, currentPage]);

  const activeLessonId =
    currentLessonSummary?.lessonId ??
    lessonDoc?.lessonId ??
    (bookId ? `${bookId}-l01` : 'b1-l01');

  // Load LessonDocument and Page WebP whenever bookId, currentPage, or lessonId changes
  useEffect(() => {
    if (!bookId || !catalogBook || !bookmarkInitialized) return;
    let alive = true;
    setLoading(true);

    async function loadPageAndLesson() {
      const targetLessonId =
        currentLessonSummary?.lessonId ?? `${bookId}-l01`;
      const [loadedLesson, blobUrl] = await Promise.all([
        getLessonDocument(bookId!, targetLessonId),
        getPageImageBlobUrl(`books/${bookId}/pages/p${padPageNumber(currentPage)}.webp`),
      ]);
      if (!alive) return;
      setLessonDoc(loadedLesson);
      setPageImageUrl(blobUrl);
      setLoading(false);
    }

    void loadPageAndLesson();
    return () => {
      alive = false;
    };
  }, [
    bookId,
    bookmarkInitialized,
    catalogBook,
    currentLessonSummary?.lessonId,
    currentPage,
  ]);

  // Save BookBookmark whenever currentPage, activeLessonId, or viewMode changes
  useEffect(() => {
    if (!bookId || !bookmarkInitialized) return;
    const now = new Date().toISOString();
    void saveBookBookmark({
      bookId,
      lastPageNumber: currentPage,
      lastLessonId: activeLessonId,
      viewMode,
      updatedAt: now,
    }).then(() => {
      markDirty();
    });
  }, [activeLessonId, bookId, bookmarkInitialized, currentPage, viewMode]);

  const allLessonSentences = useMemo<LessonSentence[]>(() => {
    if (!lessonDoc) return [];
    const list: LessonSentence[] = [];
    for (const block of lessonDoc.dialogues) {
      for (const sentence of block.sentences) {
        list.push(sentence);
      }
    }
    return list;
  }, [lessonDoc]);

  const sentenceById = useMemo(() => {
    const map = new Map<string, LessonSentence>();
    for (const s of allLessonSentences) {
      map.set(s.id, s);
    }
    return map;
  }, [allLessonSentences]);

  const vocabById = useMemo(() => {
    const map = new Map<string, LessonVocabItem>();
    for (const v of lessonDoc?.vocabulary ?? []) {
      map.set(v.id, v);
    }
    return map;
  }, [lessonDoc]);

  const pageMap = useMemo(() => {
    if (!lessonDoc) return undefined;
    return (
      lessonDoc.pages.find((p) => p.pageNumber === currentPage) ?? lessonDoc.pages[0]
    );
  }, [currentPage, lessonDoc]);

  const goToPage = useCallback(
    (nextPage: number) => {
      if (!bookId) return;
      const clamped = Math.max(1, Math.min(maxPages, Math.round(nextPage)));
      setCurrentPage(clamped);
      setPageJumpInput(String(clamped));
      setFloatingSentence(null);
      setActiveHotspotId(null);
      navigate(`/books/${bookId}/page/${clamped}`);
    },
    [bookId, maxPages, navigate],
  );

  const handlePageJumpSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = Number(pageJumpInput);
    if (Number.isFinite(parsed) && parsed >= 1) {
      goToPage(parsed);
    }
  };

  const handleLessonSelect = (lessonId: string) => {
    const found = bookDetail?.lessons.find((l) => l.lessonId === lessonId);
    if (found) {
      goToPage(found.startPage);
    }
  };

  const handleHotspotClick = async (hotspot: PageHotspot) => {
    setActiveHotspotId(hotspot.id);

    if (hotspot.kind === 'sentence') {
      const matchedSentence =
        (hotspot.refId ? sentenceById.get(hotspot.refId) : undefined) ??
        allLessonSentences.find((s) => s.zh === hotspot.zhText);

      if (matchedSentence) {
        setActiveSentenceId(matchedSentence.id);
        setFloatingSentence(matchedSentence);
        await playSentenceAudio(matchedSentence, audioMode, playbackRate);
        return;
      }

      if (hotspot.audioSlice) {
        await playLessonSlice(hotspot.audioSlice, playbackRate);
        return;
      }

      const fallbackSentence: LessonSentence = {
        id: hotspot.id,
        zh: hotspot.zhText,
        pinyin: hotspot.pinyin ?? '',
        vi: hotspot.viText,
        pageNumber: currentPage,
        ttsAudioPath: hotspot.ttsAudioPath ?? '',
        lessonAudioSlice: hotspot.audioSlice,
        tokens: [...hotspot.zhText].map((ch) => ({
          surface: ch,
          pinyin: '',
        })),
      };
      setActiveSentenceId(fallbackSentence.id);
      setFloatingSentence(fallbackSentence);
      await playSentenceAudio(fallbackSentence, audioMode, playbackRate);
      return;
    }

    if (hotspot.kind === 'vocab') {
      const matchedVocab =
        (hotspot.refId ? vocabById.get(hotspot.refId) : undefined) ??
        lessonDoc?.vocabulary.find((v) => v.hanzi === hotspot.zhText);

      if (matchedVocab) {
        setPopover({ vocab: matchedVocab });
        await playWordAudio(
          matchedVocab.hanzi,
          matchedVocab.pinyinNumbered,
          matchedVocab.lessonAudioSlice,
          { rate: playbackRate },
        );
        return;
      }

      const fallbackVocab: LessonVocabItem = {
        id: hotspot.id,
        index: 1,
        hanzi: hotspot.zhText,
        pos: '',
        pinyin: hotspot.pinyin ?? '',
        pinyinNumbered: hotspot.pinyin ? marksToNumbered(hotspot.pinyin) : '',
        hanViet: '',
        meaningEn: '',
        meaningVi: hotspot.viText ?? '',
        pageNumber: currentPage,
        lessonAudioSlice: hotspot.audioSlice,
        ttsAudioPath: hotspot.ttsAudioPath ?? '',
      };
      setPopover({ vocab: fallbackVocab });
      await playWordAudio(
        fallbackVocab.hanzi,
        fallbackVocab.pinyinNumbered || undefined,
        fallbackVocab.lessonAudioSlice,
        { rate: playbackRate },
      );
      return;
    }

    if (hotspot.audioSlice) {
      await playLessonSlice(hotspot.audioSlice, playbackRate);
    } else if (hotspot.zhText) {
      await playWordAudio(hotspot.zhText, undefined, undefined, { rate: playbackRate });
    }
  };

  const handleTokenClick = (token: SentenceToken, sentence: LessonSentence) => {
    setActiveSentenceId(sentence.id);
    setPopover({ token, sentence });

    const matchedVocab =
      (token.vocabId ? vocabById.get(token.vocabId) : undefined) ??
      lessonDoc?.vocabulary.find((v) => v.hanzi === token.surface);
    const pyNumbered =
      matchedVocab?.pinyinNumbered ||
      (token.citationPinyin
        ? marksToNumbered(token.citationPinyin)
        : token.pinyin
          ? marksToNumbered(token.pinyin)
          : undefined);

    void playWordAudio(token.surface, pyNumbered, undefined, { rate: playbackRate });
  };

  const handleVocabRowClick = (vocabItem: LessonVocabItem) => {
    setPopover({ vocab: vocabItem });
    void playWordAudio(vocabItem.hanzi, vocabItem.pinyinNumbered, undefined, {
      rate: playbackRate,
    });
  };

  if (!catalogBook || !bookId) {
    return (
      <div className="stack">
        <PageHeader title="Không tìm thấy quyển sách" />
        <p className="muted">Địa chỉ không khớp quyển nào trong bộ 6 quyển.</p>
        <Link className="btn btn-primary" to="/books">
          <IconChevronLeft /> Về kệ sách
        </Link>
      </div>
    );
  }

  const lessonTitleLabel = lessonDoc
    ? `Bài ${lessonDoc.lessonNumber}: ${lessonDoc.titleZh}${lessonDoc.titleVi ? ` — ${lessonDoc.titleVi}` : ''}`
    : currentLessonSummary
      ? `Bài ${currentLessonSummary.lessonNumber}: ${currentLessonSummary.titleZh}`
      : `Quyển ${catalogBook.volume}`;

  const renderPageScanPane = () => (
    <section className="books-pane books-pane-scan" aria-label="Trang sách tương tác">
      <div className="books-page-canvas">
        {pageImageUrl ? (
          <img
            src={pageImageUrl}
            alt={`Trang ${currentPage} — ${catalogBook.series}`}
            loading="eager"
          />
        ) : (
          <div className="books-page-placeholder">
            <p className="text-sm muted">
              {loading
                ? `Đang tải trang ${currentPage}...`
                : `Trang ${currentPage} — Nhấn vào các vùng tương tác bên dưới để nghe âm thanh hoặc tra từ.`}
            </p>
          </div>
        )}

        {(pageMap?.hotspots ?? []).map((hotspot) => {
          const [xPct, yPct, wPct, hPct] = hotspot.bboxPct;
          const isSentenceActive =
            hotspot.refId && hotspot.refId === activeSentenceId;
          const isHotspotSelected =
            hotspot.id === activeHotspotId || Boolean(isSentenceActive);

          return (
            <button
              key={hotspot.id}
              type="button"
              className={`page-hotspot page-hotspot-${hotspot.kind} ${
                isHotspotSelected ? 'is-active' : ''
              }`}
              style={{
                left: `${xPct * 100}%`,
                top: `${yPct * 100}%`,
                width: `${wPct * 100}%`,
                height: `${hPct * 100}%`,
              }}
              aria-label={`${
                hotspot.kind === 'sentence'
                  ? 'Câu thoại'
                  : hotspot.kind === 'vocab'
                    ? 'Từ mới'
                    : 'Mục sách'
              }: ${hotspot.zhText}`}
              title={`${hotspot.zhText}${hotspot.pinyin ? ` (${hotspot.pinyin})` : ''}`}
              onClick={() => void handleHotspotClick(hotspot)}
            >
              <span className="visually-hidden">{hotspot.zhText}</span>
            </button>
          );
        })}
      </div>

      {floatingSentence ? (
        <div
          className="card books-floating-sentence"
          role="region"
          aria-label="Thanh phân tích câu đang chọn"
        >
          <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
            <div className="row-wrap">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() =>
                  void playSentenceAudio(floatingSentence, 'context', playbackRate)
                }
              >
                ▶ Nghe câu
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  void playSentenceAudio(floatingSentence, 'context', 0.75)
                }
              >
                🐢 0.75×
              </button>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setFloatingSentence(null)}
            >
              Đóng
            </button>
          </div>

          <div className="books-token-line" style={{ marginTop: 'var(--sp-2)' }}>
            {floatingSentence.tokens.length > 0 ? (
              floatingSentence.tokens.map((tok, idx) => {
                const hasSandhi = Boolean(
                  tok.citationPinyin &&
                    tok.citationPinyin.toLowerCase() !== tok.pinyin.toLowerCase(),
                );
                return (
                  <span
                    key={`${floatingSentence.id}-float-tok-${idx}`}
                    role="button"
                    tabIndex={0}
                    className={`zh-token cjk ${hasSandhi ? 'has-sandhi' : ''}`}
                    lang="zh"
                    onClick={() => handleTokenClick(tok, floatingSentence)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleTokenClick(tok, floatingSentence);
                      }
                    }}
                  >
                    <span className="zh-token-surface">{tok.surface}</span>
                    {showPinyin && tok.pinyin ? (
                      <span className="zh-token-pinyin">{tok.pinyin}</span>
                    ) : null}
                  </span>
                );
              })
            ) : (
              <span className="cjk text-lg" lang="zh">
                {floatingSentence.zh}
              </span>
            )}
          </div>

          {showPinyin && floatingSentence.pinyin ? (
            <div className="pinyin text-sm">{floatingSentence.pinyin}</div>
          ) : null}
          {showVi && floatingSentence.vi ? (
            <div className="text-sm muted">{floatingSentence.vi}</div>
          ) : null}
          {floatingSentence.sandhiNotes && floatingSentence.sandhiNotes.length > 0 ? (
            <div className="badge badge-warn" style={{ marginTop: 'var(--sp-1)' }}>
              {floatingSentence.sandhiNotes.join(' · ')}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );

  const renderCleanTextPane = () => (
    <section className="books-pane books-pane-text stack" aria-label="Văn bản tương tác">
      {lessonDoc ? (
        <>
          <div className="card books-text-header">
            <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ margin: 0 }}>
                  Bài {lessonDoc.lessonNumber}:{' '}
                  <span className="cjk" lang="zh">
                    {lessonDoc.titleZh}
                  </span>
                </h2>
                <p className="text-sm muted" style={{ margin: 0 }}>
                  {lessonDoc.titlePinyin}
                  {lessonDoc.titleVi ? ` · ${lessonDoc.titleVi}` : ''}
                </p>
              </div>
              <div className="row-wrap">
                <button
                  type="button"
                  className={`chip ${showPinyin ? 'is-active' : ''}`}
                  aria-pressed={showPinyin}
                  onClick={() => setShowPinyin((v) => !v)}
                >
                  Hiện Pinyin
                </button>
                <button
                  type="button"
                  className={`chip ${showVi ? 'is-active' : ''}`}
                  aria-pressed={showVi}
                  onClick={() => setShowVi((v) => !v)}
                >
                  Hiện nghĩa TV
                </button>
              </div>
            </div>
          </div>

          {lessonDoc.dialogues.map((block) => (
            <section
              key={block.id}
              className="card stack"
              aria-label={block.title || 'Bài khóa'}
            >
              <h3 style={{ margin: 0 }}>
                Bài khóa{block.title ? ` — ${block.title}` : ''}
              </h3>
              <p className="text-sm faint" style={{ margin: 0 }}>
                Nhấn <strong>▶ Nghe câu</strong> để nghe băng gốc cả câu. Nhấn vào từng từ tiếng
                Trung để nghe phát âm từ đơn (TTS) và xem biến điệu / nghĩa chi tiết.
              </p>

              <div className="books-sentence-list">
                {block.sentences.map((sentence) => {
                  const isActive = sentence.id === activeSentenceId;
                  return (
                    <div
                      key={sentence.id}
                      className={`books-sentence-card ${isActive ? 'is-active' : ''}`}
                    >
                      <div className="books-sentence-actions">
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => {
                            setActiveSentenceId(sentence.id);
                            void playSentenceAudio(sentence, 'context', playbackRate);
                          }}
                        >
                          ▶ Nghe câu
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => {
                            setActiveSentenceId(sentence.id);
                            void playSentenceAudio(sentence, 'context', 0.75);
                          }}
                        >
                          🐢 0.75×
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${
                            loopSentence && isActive ? 'is-active' : ''
                          }`}
                          aria-pressed={loopSentence && isActive}
                          onClick={() => {
                            setActiveSentenceId(sentence.id);
                            setLoopSentence((v) => !v);
                          }}
                        >
                          🔁 Lặp
                        </button>
                      </div>

                      <div className="books-sentence-body">
                        <div className="books-token-line">
                          {sentence.speaker ? (
                            <span className="books-speaker badge">{sentence.speaker}:</span>
                          ) : null}
                          {sentence.tokens.map((tok, idx) => {
                            const hasSandhi = Boolean(
                              tok.citationPinyin &&
                                tok.citationPinyin.toLowerCase() !== tok.pinyin.toLowerCase(),
                            );
                            return (
                              <span
                                key={`${sentence.id}-tok-${idx}`}
                                role="button"
                                tabIndex={0}
                                className={`zh-token cjk ${hasSandhi ? 'has-sandhi' : ''}`}
                                lang="zh"
                                onClick={() => handleTokenClick(tok, sentence)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleTokenClick(tok, sentence);
                                  }
                                }}
                              >
                                <span className="zh-token-surface">{tok.surface}</span>
                                {showPinyin && tok.pinyin ? (
                                  <span className="zh-token-pinyin">{tok.pinyin}</span>
                                ) : null}
                              </span>
                            );
                          })}
                        </div>

                        {showPinyin && sentence.pinyin ? (
                          <div className="pinyin text-sm">{sentence.pinyin}</div>
                        ) : null}
                        {showVi && sentence.vi ? (
                          <div className="text-sm muted">{sentence.vi}</div>
                        ) : null}
                        {sentence.sandhiNotes && sentence.sandhiNotes.length > 0 ? (
                          <div className="badge badge-warn">
                            {sentence.sandhiNotes.join(' · ')}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {lessonDoc.vocabulary.length > 0 ? (
            <section className="card stack" aria-label="Từ mới trong bài">
              <h3 style={{ margin: 0 }}>
                Từ mới ({lessonDoc.vocabulary.length} từ)
              </h3>
              <div className="books-vocab-list">
                {lessonDoc.vocabulary.map((vocabItem) => (
                  <div
                    key={vocabItem.id}
                    className="books-vocab-row"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleVocabRowClick(vocabItem)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleVocabRowClick(vocabItem);
                      }
                    }}
                  >
                    <span className="badge">{vocabItem.index}</span>
                    <span className="books-vocab-hanzi cjk" lang="zh">
                      {vocabItem.hanzi}
                    </span>
                    {showPinyin ? (
                      <span className="pinyin">{vocabItem.pinyin}</span>
                    ) : null}
                    {vocabItem.hanViet ? (
                      <span className="badge badge-info">[HV: {vocabItem.hanViet}]</span>
                    ) : null}
                    {vocabItem.pos ? (
                      <span className="text-sm faint">({vocabItem.pos})</span>
                    ) : null}
                    {showVi ? (
                      <span className="books-vocab-meaning">
                        <strong>{vocabItem.meaningVi}</strong>
                        {vocabItem.meaningEn ? (
                          <span className="muted"> — {vocabItem.meaningEn}</span>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {lessonDoc.notes.length > 0 || lessonDoc.grammar.length > 0 ? (
            <section className="card stack" aria-label="Chú thích và ngữ pháp">
              <h3 style={{ margin: 0 }}>Chú thích &amp; Ngữ pháp</h3>
              {lessonDoc.notes.map((note) => (
                <div key={note.id} className="books-note-card">
                  <h4 style={{ margin: '0 0 0.25rem' }}>{note.heading}</h4>
                  <p className="text-sm" style={{ whiteSpace: 'pre-line' }}>
                    {note.bodyVi}
                  </p>
                </div>
              ))}
              {lessonDoc.grammar.map((gram) => (
                <div key={gram.id} className="books-note-card">
                  <h4 style={{ margin: '0 0 0.25rem' }}>{gram.heading}</h4>
                  <p className="text-sm" style={{ whiteSpace: 'pre-line' }}>
                    {gram.explanationVi}
                  </p>
                </div>
              ))}
            </section>
          ) : null}
        </>
      ) : (
        <section className="card" aria-labelledby="reader-need-data">
          <h2 id="reader-need-data">Chưa tải được dữ liệu bài học</h2>
          <p className="muted">
            Trang sách, văn bản tương tác và âm thanh được tải từ kho dữ liệu riêng tư{' '}
            <code>RandomGuy198/Hanyu-data</code>. Hãy kết nối Fine-Grained PAT để xem toàn bộ nội
            dung.
          </p>
          <div className="row-wrap">
            <Link className="btn btn-primary btn-sm" to="/books">
              <IconBook /> Về kệ sách để kết nối nhanh
            </Link>
            <Link className="btn btn-sm" to="/settings">
              <IconGear /> Mở Cài đặt
            </Link>
          </div>
        </section>
      )}
    </section>
  );

  return (
    <div className="stack books-reader">
      <nav className="card books-reader-toolbar" aria-label="Điều hướng trong sách">
        <div className="books-reader-toolbar-row">
          <Link className="btn btn-sm" to="/books">
            <IconChevronLeft /> Kệ sách
          </Link>

          <h1 className="books-reader-title">
            <IconBook /> Quyển {catalogBook.volume} — {catalogBook.series}
          </h1>

          {bookDetail && bookDetail.lessons.length > 0 ? (
            <select
              className="select books-lesson-select"
              aria-label="Chọn bài học"
              value={activeLessonId}
              onChange={(e) => handleLessonSelect(e.target.value)}
            >
              {bookDetail.lessons.map((l) => (
                <option key={l.lessonId} value={l.lessonId}>
                  Bài {l.lessonNumber}: {l.titleZh} (Tr.{l.startPage})
                </option>
              ))}
            </select>
          ) : (
            <span className="badge">{lessonTitleLabel}</span>
          )}

          <div className="books-page-stepper">
            <button
              type="button"
              className="btn btn-sm"
              disabled={currentPage <= 1}
              onClick={() => goToPage(currentPage - 1)}
              aria-label="Trang trước"
            >
              ◀
            </button>
            <form
              className="books-page-jump-form"
              onSubmit={handlePageJumpSubmit}
            >
              <label htmlFor="reader-page-input" className="text-sm nowrap">
                Trang
              </label>
              <input
                id="reader-page-input"
                type="number"
                min={1}
                max={maxPages}
                className="input books-page-input"
                value={pageJumpInput}
                onChange={(e) => setPageJumpInput(e.target.value)}
                aria-label="Số trang"
              />
              <span className="text-sm nowrap">/ {maxPages}</span>
            </form>
            <button
              type="button"
              className="btn btn-sm"
              disabled={currentPage >= maxPages}
              onClick={() => goToPage(currentPage + 1)}
              aria-label="Trang sau"
            >
              ▶
            </button>
          </div>

          <Segmented<ReaderViewMode>
            label="Chế độ xem"
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: 'page', label: '📄 Trang sách' },
              { value: 'text', label: '📝 Văn bản' },
              { value: 'split', label: 'Song song' },
            ]}
          />

          <Link
            className="btn btn-primary btn-sm"
            to={`/courses/${bookId}/${activeLessonId}`}
          >
            🎓 Luyện bài này (5 bước)
          </Link>
        </div>
      </nav>

      <div className={`books-reader-layout books-reader-mode-${viewMode}`}>
        {viewMode === 'page' && renderPageScanPane()}
        {viewMode === 'text' && renderCleanTextPane()}
        {viewMode === 'split' && (
          <>
            {renderPageScanPane()}
            {renderCleanTextPane()}
          </>
        )}
      </div>

      <AudioBar
        sentences={allLessonSentences}
        activeSentenceId={activeSentenceId}
        onActiveSentenceChange={setActiveSentenceId}
        audioMode={audioMode}
        onAudioModeChange={setAudioMode}
        playbackRate={playbackRate}
        onPlaybackRateChange={setPlaybackRate}
        loopSentence={loopSentence}
        onLoopSentenceChange={setLoopSentence}
      />

      {popover ? (
        <WordPopover
          vocab={popover.vocab}
          token={popover.token}
          sentence={popover.sentence}
          vocabulary={lessonDoc?.vocabulary}
          bookId={bookId}
          lessonId={activeLessonId}
          onClose={() => setPopover(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * `#/books/:bookId` and `#/books/:bookId/page/:pageNum` — Minimal PDF-like Book Reader (`07_UI_SPEC.md` §2.2).
 *
 * Presents the rendered textbook page (`1224×1584` WebP) as a clean, chrome-free sheet with the
 * structured interactive text stacked below it (dialogues, vocabulary, grammar, notes). Clicking a
 * word token (`zh-token`) or a vocabulary row opens `<WordPopover />` with the dictionary entry —
 * no autoplay and no overlay hotspot boxes.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../components';
import { IconBook, IconChevronLeft, IconGear } from '../../app/icons';
import { getBookBookmark, saveBookBookmark } from '../../data/db';
import {
  getBookDetail,
  getLessonDocument,
  getPageImageBlobUrl,
} from '../../data/privateData';
import { markDirty } from '../../data/syncEngine';
import type {
  BookSummary,
  LessonDocument,
  LessonSentence,
  LessonSummary,
  LessonVocabItem,
  SentenceToken,
} from '../../domain/types';
import { findVolume } from './bookCatalog';
import { WordPopover } from './WordPopover';
import './books.css';

interface PopoverState {
  vocab?: LessonVocabItem;
  token?: SentenceToken;
  sentence?: LessonSentence;
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
  const [bookmarkInitialized, setBookmarkInitialized] = useState(false);

  const [showPinyin, setShowPinyin] = useState(true);
  const [showVi, setShowVi] = useState(true);

  const [activeSentenceId, setActiveSentenceId] = useState<string | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);

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

  // Save BookBookmark whenever currentPage or activeLessonId changes
  useEffect(() => {
    if (!bookId || !bookmarkInitialized) return;
    const now = new Date().toISOString();
    void saveBookBookmark({
      bookId,
      lastPageNumber: currentPage,
      lastLessonId: activeLessonId,
      viewMode: 'split',
      updatedAt: now,
    }).then(() => {
      markDirty();
    });
  }, [activeLessonId, bookId, bookmarkInitialized, currentPage]);

  const goToPage = useCallback(
    (nextPage: number) => {
      if (!bookId) return;
      const clamped = Math.max(1, Math.min(maxPages, Math.round(nextPage)));
      setCurrentPage(clamped);
      setPageJumpInput(String(clamped));
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

  const handleTokenClick = (token: SentenceToken, sentence: LessonSentence) => {
    setActiveSentenceId(sentence.id);
    setPopover({ token, sentence });
  };

  const handleVocabRowClick = (vocabItem: LessonVocabItem) => {
    setPopover({ vocab: vocabItem });
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

  const renderPageScanPane = () => (
    <section className="books-pane books-pane-scan" aria-label="Trang sách">
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
                : `Chưa tải được ảnh trang ${currentPage}.`}
            </p>
          </div>
        )}
      </div>
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

              <div className="books-sentence-list">
                {block.sentences.map((sentence) => {
                  const isActive = sentence.id === activeSentenceId;
                  return (
                    <div
                      key={sentence.id}
                      className={`books-sentence-card ${isActive ? 'is-active' : ''}`}
                    >
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
        </div>
      </nav>

      <div className="books-reader-layout">
        {renderPageScanPane()}
        {renderCleanTextPane()}
      </div>

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

/**
 * `#/books` — 6-volume Mandarin course shelf, 76-lesson roadmap, and short reading tab (`07_UI_SPEC.md` §2.1).
 *
 * Calls `getBooksManifest()` from `src/data/privateData.ts`, `getAllCourseProgress()` and
 * `getAllBookBookmarks()` from `src/data/db.ts`.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, ProgressBar, Segmented } from '../../components';
import { IconBook, IconChevronLeft, IconGear } from '../../app/icons';
import { useToast } from '../../app/providers';
import { getAllBookBookmarks, getAllCourseProgress } from '../../data/db';
import { setGitHubConfig, verifyConnection } from '../../data/githubClient';
import { getBooksManifest } from '../../data/privateData';
import {
  getSyncStatus,
  subscribeSyncStatus,
  syncNow,
  type SyncStatus,
} from '../../data/syncEngine';
import type {
  BookBookmark,
  BookSummary,
  BooksManifest,
  CourseLessonProgress,
  CourseStepId,
  LessonSummary,
} from '../../domain/types';
import LearnPage from '../content/LearnPage';
import {
  BOOK_VOLUMES,
  TOTAL_LESSONS,
  TOTAL_PAGES,
} from './bookCatalog';
import './books.css';

type ShelfTab = 'course' | 'reading';

const TAB_LABEL: Record<ShelfTab, string> = {
  course: 'Bộ sách Hán ngữ 6 quyển',
  reading: 'Bài đọc ngắn & Mẹo học',
};

const STEP_DEFS: { id: CourseStepId; label: string }[] = [
  { id: 'vocab', label: 'Từ mới' },
  { id: 'dialogue', label: 'Bài khóa' },
  { id: 'grammar', label: 'Ngữ pháp' },
  { id: 'drill', label: 'Nhận biết' },
  { id: 'writing', label: 'Tập viết' },
];

const FALLBACK_TITLE_ZH: Record<string, string> = {
  b1: '第一册 上',
  b2: '第一册 下',
  b3: '第二册 上',
  b4: '第二册 下',
  b5: '第三册 上',
  b6: '第三册 下',
};

function buildFallbackBooks(): BookSummary[] {
  return BOOK_VOLUMES.map((vol) => {
    const count = vol.lessonCount;
    const startLessonNum = vol.id === 'b2' ? 16 : vol.id === 'b4' ? 11 : vol.id === 'b6' ? 14 : 1;
    const lessonNumbers = Array.from({ length: count }, (_, idx) => startLessonNum + idx);
    const lessons: LessonSummary[] = lessonNumbers.map((num, idx) => {
      const globalNum = vol.globalLessonFrom + idx;
      const padded = String(num).padStart(2, '0');
      const isB1L2 = vol.id === 'b1' && num === 2;
      const isB1L1 = vol.id === 'b1' && num === 1;
      return {
        lessonId: `${vol.id}-l${padded}`,
        bookId: vol.id,
        lessonNumber: num,
        globalLessonNumber: globalNum,
        titleZh: isB1L2 ? '汉语不太难' : isB1L1 ? '你好' : `第${num}课`,
        titlePinyin: isB1L2 ? 'Hànyǔ bú tài nán' : isB1L1 ? 'Nǐ hǎo' : `Dì ${num} kè`,
        titleVi: isB1L2
          ? 'Tiếng Hán không khó lắm'
          : isB1L1
            ? 'Xin chào'
            : `Bài ${num} (Quyển ${vol.volume})`,
        startPage: isB1L2 ? 31 : isB1L1 ? 19 : Math.max(1, idx * 12 + 10),
        endPage: isB1L2 ? 36 : isB1L1 ? 30 : Math.min(vol.pageCount, (idx + 1) * 12 + 9),
        vocabCount: 15,
        sentenceCount: 8,
        lessonAudioPath: `audio/lessons/${vol.id}/l${padded}.mp3`,
      };
    });

    return {
      bookId: vol.id,
      volumeNumber: vol.volume as 1 | 2 | 3 | 4 | 5 | 6,
      titleVi: `Quyển ${vol.volume} — ${vol.series}`,
      titleZh: FALLBACK_TITLE_ZH[vol.id] ?? `第${vol.volume}册`,
      pageCount: vol.pageCount,
      lessonNumbers,
      globalLessonRange: [vol.globalLessonFrom, vol.globalLessonTo],
      lessons,
    };
  });
}

export default function BooksHomePage() {
  const toast = useToast();
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus);
  const [tab, setTab] = useState<ShelfTab>('course');
  const [manifest, setManifest] = useState<BooksManifest | null>(null);
  const [loadingManifest, setLoadingManifest] = useState(true);
  const [progressList, setProgressList] = useState<CourseLessonProgress[]>([]);
  const [bookmarks, setBookmarks] = useState<BookBookmark[]>([]);
  const [expandedBooks, setExpandedBooks] = useState<Record<string, boolean>>({ b1: true });

  const [patInput, setPatInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const loadData = useCallback(async (force = false) => {
    setLoadingManifest(true);
    try {
      const [loadedManifest, loadedProgress, loadedBookmarks] = await Promise.all([
        getBooksManifest(force),
        getAllCourseProgress(),
        getAllBookBookmarks(),
      ]);
      setManifest(loadedManifest);
      setProgressList(loadedProgress);
      setBookmarks(loadedBookmarks);
    } finally {
      setLoadingManifest(false);
    }
  }, []);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  useEffect(() => {
    return subscribeSyncStatus((next) => {
      setStatus(next);
      if (next.phase === 'synced') {
        void loadData(false);
      }
    });
  }, [loadData]);

  const progressMap = useMemo(() => {
    const map: Record<string, CourseLessonProgress> = {};
    for (const row of progressList) {
      map[row.lessonId] = row;
    }
    return map;
  }, [progressList]);

  const books: BookSummary[] = useMemo(() => {
    return manifest?.books?.length ? manifest.books : buildFallbackBooks();
  }, [manifest]);

  const continueTarget = useMemo(() => {
    const allLessons = new Map<string, { book: BookSummary; lesson: LessonSummary }>();
    for (const book of books) {
      for (const lesson of book.lessons) {
        allLessons.set(lesson.lessonId, { book, lesson });
      }
    }

    const sortedBookmarks = [...bookmarks].sort(
      (a, b) => Date.parse(b.updatedAt || '') - Date.parse(a.updatedAt || ''),
    );
    const sortedProgress = [...progressList].sort(
      (a, b) =>
        Date.parse(b.lastStudiedAt || b.updatedAt || '') -
        Date.parse(a.lastStudiedAt || a.updatedAt || ''),
    );

    const latestBookmark = sortedBookmarks[0];
    const latestProgress = sortedProgress[0];

    const bmTime = latestBookmark ? Date.parse(latestBookmark.updatedAt || '') || 0 : 0;
    const prTime = latestProgress
      ? Date.parse(latestProgress.lastStudiedAt || latestProgress.updatedAt || '') || 0
      : 0;

    if (latestBookmark && bmTime >= prTime) {
      const found = allLessons.get(latestBookmark.lastLessonId);
      const book =
        found?.book ??
        books.find((b) => b.bookId === latestBookmark.bookId) ??
        books[0];
      const lesson = found?.lesson ?? book?.lessons[0];
      if (book && lesson) {
        return {
          bookId: book.bookId,
          volumeNumber: book.volumeNumber,
          lessonId: lesson.lessonId,
          lessonNumber: lesson.lessonNumber,
          titleZh: lesson.titleZh,
          titleVi: lesson.titleVi,
          pageNumber: latestBookmark.lastPageNumber || lesson.startPage,
        };
      }
    }

    if (latestProgress) {
      const found = allLessons.get(latestProgress.lessonId);
      if (found) {
        const bmForBook = bookmarks.find((b) => b.bookId === found.book.bookId);
        return {
          bookId: found.book.bookId,
          volumeNumber: found.book.volumeNumber,
          lessonId: found.lesson.lessonId,
          lessonNumber: found.lesson.lessonNumber,
          titleZh: found.lesson.titleZh,
          titleVi: found.lesson.titleVi,
          pageNumber: bmForBook?.lastPageNumber || found.lesson.startPage,
        };
      }
    }

    const defaultBook = books[0];
    const defaultLesson =
      defaultBook?.lessons.find((l) => l.lessonNumber === 2) ?? defaultBook?.lessons[0];
    return {
      bookId: defaultBook?.bookId ?? 'b1',
      volumeNumber: defaultBook?.volumeNumber ?? 1,
      lessonId: defaultLesson?.lessonId ?? 'b1-l02',
      lessonNumber: defaultLesson?.lessonNumber ?? 2,
      titleZh: defaultLesson?.titleZh ?? '汉语不太难',
      titleVi: defaultLesson?.titleVi ?? 'Tiếng Hán không khó lắm',
      pageNumber: defaultLesson?.startPage ?? 31,
    };
  }, [bookmarks, books, progressList]);

  const handleConnectSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = patInput.trim();
    if (!trimmed) {
      setConnectError('Vui lòng dán Fine-Grained Personal Access Token.');
      return;
    }
    setConnecting(true);
    setConnectError(null);
    try {
      setGitHubConfig({
        owner: 'RandomGuy198',
        repo: 'Hanyu-data',
        branch: 'main',
        pat: trimmed,
      });
      const verified = await verifyConnection();
      if (!verified.ok) {
        setConnectError(verified.reason ?? 'Không thể xác thực kết nối GitHub.');
        return;
      }
      await syncNow().catch(() => undefined);
      await loadData(true);
      setPatInput('');
      toast.push('Đã kết nối kho dữ liệu Hanyu-data thành công!');
    } catch (error) {
      setConnectError(
        error instanceof Error ? error.message : 'Lỗi kết nối kho dữ liệu Hanyu-data.',
      );
    } finally {
      setConnecting(false);
    }
  };

  const toggleExpand = (bookId: string) => {
    setExpandedBooks((prev) => ({
      ...prev,
      [bookId]: !prev[bookId],
    }));
  };

  return (
    <div className="stack books-page">
      <PageHeader
        title="Sách & Khóa học"
        subtitle={`Bộ sách Hán ngữ 6 quyển — ${BOOK_VOLUMES.length} quyển, ${TOTAL_LESSONS} bài, ${TOTAL_PAGES.toLocaleString('vi-VN')} trang.`}
      />

      <Segmented<ShelfTab>
        label="Nội dung sách"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'course', label: TAB_LABEL.course },
          { value: 'reading', label: TAB_LABEL.reading },
        ]}
      />

      {tab === 'course' ? (
        <div className="stack">
          {!manifest && !loadingManifest ? (
            <section className="card books-connection" aria-labelledby="books-connect-title">
              <div className="books-connection-body">
                <IconBook />
                <div className="stack" style={{ gap: '0.5rem', flex: 1 }}>
                  <h2 id="books-connect-title">
                    Kết nối kho dữ liệu sách &amp; âm thanh (<code>RandomGuy198/Hanyu-data</code>)
                  </h2>
                  <p className="text-sm muted">
                    Trang sách, bài khóa và âm thanh nằm trong kho riêng tư{' '}
                    <code>RandomGuy198/Hanyu-data</code>. Dán Fine-Grained Personal Access Token
                    (quyền Read &amp; Write Contents) một lần trên thiết bị này để tải tự động.
                  </p>
                  <form className="books-connect-form" onSubmit={(e) => void handleConnectSubmit(e)}>
                    <input
                      type="password"
                      className="input"
                      placeholder="Dán Fine-Grained PAT vào đây..."
                      aria-label="Fine-Grained Personal Access Token"
                      value={patInput}
                      onChange={(e) => setPatInput(e.target.value)}
                      autoComplete="off"
                    />
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm"
                      disabled={connecting}
                    >
                      {connecting ? 'Đang kết nối...' : 'Kết nối ngay'}
                    </button>
                    <Link className="btn btn-sm" to="/settings">
                      <IconGear /> Cài đặt chi tiết
                    </Link>
                  </form>
                  {connectError ? (
                    <p className="text-sm" style={{ color: 'var(--danger-600)' }} role="alert">
                      {connectError}
                    </p>
                  ) : null}
                </div>
              </div>
            </section>
          ) : (
            <section className="card books-continue" aria-labelledby="books-continue-title">
              <div style={{ flex: 1 }}>
                <div className="row-wrap" style={{ marginBottom: '0.25rem' }}>
                  <h2 id="books-continue-title" style={{ margin: 0 }}>
                    Tiếp tục học
                  </h2>
                  {status.phase === 'synced' ? (
                    <span className="badge badge-ok">Đã kết nối Hanyu-data</span>
                  ) : null}
                </div>
                <p className="text-sm">
                  <strong>
                    Quyển {continueTarget.volumeNumber} · Bài {continueTarget.lessonNumber}:{' '}
                    <span className="cjk" lang="zh">
                      {continueTarget.titleZh}
                    </span>
                  </strong>{' '}
                  {continueTarget.titleVi ? `(${continueTarget.titleVi})` : ''} — Trang{' '}
                  {continueTarget.pageNumber}
                </p>
              </div>
              <div className="row-wrap">
                <Link
                  className="btn btn-primary btn-sm"
                  to={`/books/${continueTarget.bookId}/page/${continueTarget.pageNumber}`}
                >
                  📖 Mở trang sách (Trang {continueTarget.pageNumber})
                </Link>
                <Link
                  className="btn btn-sm"
                  to={`/courses/${continueTarget.bookId}/${continueTarget.lessonId}`}
                >
                  🎓 Học theo bài (5 bước)
                </Link>
              </div>
            </section>
          )}

          <div className="books-grid">
            {books.map((book) => {
              const totalInBook = book.lessons.length;
              const completedInBook = book.lessons.filter((lesson) => {
                const prog = progressMap[lesson.lessonId];
                return Boolean(
                  prog?.completedAt || (prog?.completedSteps && prog.completedSteps.length >= 5),
                );
              }).length;
              const firstNum = book.lessonNumbers[0] ?? 1;
              const lastNum = book.lessonNumbers[book.lessonNumbers.length - 1] ?? totalInBook;
              const isExpanded = Boolean(expandedBooks[book.bookId]);
              const firstStartPage = book.lessons[0]?.startPage ?? 1;

              return (
                <article
                  key={book.bookId}
                  className="card books-volume"
                  aria-labelledby={`book-${book.bookId}`}
                >
                  <header className="books-volume-head">
                    <span className="books-volume-number" aria-hidden="true">
                      {book.volumeNumber}
                    </span>
                    <div>
                      <h3 id={`book-${book.bookId}`}>{book.titleVi}</h3>
                      <p className="text-sm faint">
                        <span className="cjk" lang="zh">
                          {book.titleZh}
                        </span>{' '}
                        · Bài {firstNum}–{lastNum} · {book.pageCount} trang
                      </p>
                    </div>
                    <span className="spacer" />
                    <span className="badge">
                      {completedInBook} / {totalInBook} bài hoàn thành
                    </span>
                  </header>

                  <ProgressBar
                    value={completedInBook}
                    total={totalInBook}
                    label={`Tiến độ ${book.titleVi}: ${completedInBook}/${totalInBook} bài`}
                  />

                  <div className="row-wrap">
                    <Link
                      className="btn btn-primary btn-sm"
                      to={`/books/${book.bookId}/page/${firstStartPage}`}
                    >
                      📖 Đọc sách
                    </Link>
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-expanded={isExpanded}
                      onClick={() => toggleExpand(book.bookId)}
                    >
                      {isExpanded
                        ? `Ẩn danh sách (${totalInBook} bài)`
                        : `Danh sách bài (${totalInBook} bài)`}
                    </button>
                  </div>

                  {isExpanded ? (
                    <ul className="books-lesson-list" aria-label={`Danh sách bài ${book.titleVi}`}>
                      {book.lessons.map((lesson) => {
                        const prog = progressMap[lesson.lessonId];
                        const doneSteps = new Set<CourseStepId>(prog?.completedSteps ?? []);
                        return (
                          <li key={lesson.lessonId} className="books-lesson-row">
                            <div className="books-lesson-info">
                              <div className="books-lesson-title">
                                <strong>Bài {lesson.lessonNumber}:</strong>{' '}
                                <span className="cjk" lang="zh">
                                  {lesson.titleZh}
                                </span>
                                {lesson.titleVi ? (
                                  <span className="muted"> — {lesson.titleVi}</span>
                                ) : null}
                              </div>
                              <div className="books-lesson-meta text-sm faint">
                                <span>
                                  Trang {lesson.startPage}–{lesson.endPage}
                                </span>
                                <span>·</span>
                                <span
                                  className="books-step-dots"
                                  aria-label={`Hoàn thành ${doneSteps.size}/5 bước`}
                                >
                                  {STEP_DEFS.map((step) => {
                                    const done = doneSteps.has(step.id);
                                    return (
                                      <span
                                        key={step.id}
                                        className={`books-step-dot ${done ? 'is-done' : ''}`}
                                        title={`${step.label}: ${done ? 'Đã hoàn thành' : 'Chưa hoàn thành'}`}
                                      >
                                        {step.label}
                                      </span>
                                    );
                                  })}
                                </span>
                              </div>
                            </div>
                            <div className="books-lesson-actions">
                              <Link
                                className="btn btn-sm"
                                to={`/books/${book.bookId}/page/${lesson.startPage}`}
                              >
                                Đọc sách
                              </Link>
                              <Link
                                className="btn btn-primary btn-sm"
                                to={`/courses/${book.bookId}/${lesson.lessonId}`}
                              >
                                Vào bài học
                              </Link>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="books-reading">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setTab('course')}
          >
            <IconChevronLeft /> Về kệ sách 6 quyển
          </button>
          <LearnPage compact />
        </div>
      )}
    </div>
  );
}

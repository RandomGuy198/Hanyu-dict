/** `#/books` — the shelf of *Giáo trình Hán ngữ* plus the owner-authored reading index.
 *
 *  What ships in this bundle is only the bibliography (volume, series, lesson range, page count).
 *  Pages, lesson text and audio are fetched from the private `Hanyu-data` repository through the
 *  GitHub client in `src/data/githubClient.ts`; until the owner connects a token (or the dev bridge
 *  is present) the cards say so instead of pretending content exists. */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, ProgressBar, Segmented } from '../../components';
import { IconBook, IconChevronLeft, IconGear } from '../../app/icons';
import { getSyncStatus, subscribeSyncStatus, type SyncStatus } from '../../data/syncStatus';
import LearnPage from '../content/LearnPage';
import {
  BOOK_VOLUMES,
  TOTAL_LESSONS,
  TOTAL_PAGES,
  type BookVolume,
} from './bookCatalog';
import './books.css';

type ShelfTab = 'course' | 'reading';

const TAB_LABEL: Record<ShelfTab, string> = {
  course: 'Giáo trình',
  reading: 'Bài đọc ngắn & Mẹo học',
};

function ConnectionCard({ status }: { status: SyncStatus }) {
  if (status.phase !== 'disconnected') {
    return (
      <div className="notice notice-info books-connection" role="status">
        <div>
          <strong>Đã kết nối kho Hanyu-data</strong>
          <p className="text-sm">
            {status.lastSyncedAt
              ? `Lần đồng bộ gần nhất: ${new Date(status.lastSyncedAt).toLocaleString('vi-VN')}.`
              : 'Sẵn sàng tải trang sách, bài khoá và âm thanh khi bạn mở một quyển.'}
          </p>
          <Link className="btn btn-sm" to="/data">
            Xem trạng thái đồng bộ
          </Link>
        </div>
      </div>
    );
  }
  return (
    <section className="card books-connection" aria-labelledby="books-connect-title">
      <div className="books-connection-body">
        <IconBook />
        <div className="stack" style={{ gap: '0.35rem' }}>
          <h2 id="books-connect-title">Kết nối kho dữ liệu sách &amp; âm thanh</h2>
          <p className="text-sm muted">
            Trang sách, bài khoá và bản thu nằm trong repository riêng tư{' '}
            <code>RandomGuy198/Hanyu-data</code> nên không được đóng gói vào bản công khai. Dán
            Fine-Grained PAT ở màn cài đặt để tải chúng về máy này.
          </p>
          <div className="row-wrap">
            <Link className="btn btn-primary btn-sm" to="/settings">
              <IconGear /> Mở cài đặt kết nối
            </Link>
            <Link className="btn btn-sm" to="/data">
              Dữ liệu &amp; đồng bộ
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function VolumeCard({ book, ready }: { book: BookVolume; ready: boolean }) {
  return (
    <article className="card books-volume" aria-labelledby={`book-${book.id}`}>
      <header className="books-volume-head">
        <span className="books-volume-number" aria-hidden="true">
          {book.volume}
        </span>
        <div>
          <h3 id={`book-${book.id}`}>Quyển {book.volume}</h3>
          <p className="text-sm faint">
            {book.series} · {book.lessons}
          </p>
        </div>
        <span className="spacer" />
        <span className={`badge ${ready ? 'badge-ok' : 'badge-warn'}`}>
          {ready ? 'Đã đồng bộ' : 'Chưa đồng bộ'}
        </span>
      </header>

      <dl className="books-facts">
        <div>
          <dt>Bài học</dt>
          <dd>{book.lessonCount}</dd>
        </div>
        <div>
          <dt>Trang</dt>
          <dd>{book.pageCount}</dd>
        </div>
        <div>
          <dt>Bài toàn cục</dt>
          <dd>
            {book.globalLessonFrom}–{book.globalLessonTo}
          </dd>
        </div>
      </dl>

      <ProgressBar
        value={ready ? 1 : 0}
        total={1}
        label={ready ? 'Đã tải nội dung quyển này' : 'Chưa tải nội dung quyển này'}
      />

      <div className="row-wrap">
        <Link className="btn btn-sm" to={`/books/${book.id}`} aria-disabled={!ready}>
          <IconBook /> Đọc sách
        </Link>
        <Link className="btn btn-sm" to={`/books/${book.id}`} aria-disabled={!ready}>
          Danh sách bài
        </Link>
      </div>
      {!ready ? (
        <p className="text-sm faint">
          Nhấn “Đọc sách” để xem hướng dẫn đồng bộ nội dung của quyển này.
        </p>
      ) : null}
    </article>
  );
}

export default function BooksHomePage() {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus);
  const [tab, setTab] = useState<ShelfTab>('course');

  useEffect(() => subscribeSyncStatus(setStatus), []);

  // Phase 6 replaces this with a per-volume manifest lookup; until the private repo is synced no
  // volume can honestly claim to be on the device.
  const ready = status.phase === 'idle' || status.phase === 'synced';

  return (
    <div className="stack books-page">
      <PageHeader
        title="Sách & Khóa học"
        subtitle={`Giáo trình Hán ngữ — ${BOOK_VOLUMES.length} quyển, ${TOTAL_LESSONS} bài, ${TOTAL_PAGES.toLocaleString('vi-VN')} trang.`}
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
          <ConnectionCard status={status} />

          {ready ? (
            <section className="card books-continue" aria-labelledby="books-continue-title">
              <div>
                <h2 id="books-continue-title">Tiếp tục học</h2>
                <p className="text-sm muted">
                  Mở lại đúng trang và bài bạn đang học dở. Vị trí được lưu trong IndexedDB của
                  máy này.
                </p>
              </div>
              <Link className="btn btn-sm" to="/data">
                Xem dữ liệu đã tải
              </Link>
            </section>
          ) : null}

          <div className="books-grid">
            {BOOK_VOLUMES.map((book) => (
              <VolumeCard key={book.id} book={book} ready={ready} />
            ))}
          </div>

          <div className="notice notice-info">
            <div>
              <strong>Về bản quyền</strong>
              <p className="text-sm">
                Nội dung giáo trình chỉ tải về máy cho mục đích học cá nhân và không nằm trong
                repository công khai. Xem{' '}
                <Link to="/about">giới thiệu &amp; giấy phép</Link> để biết ranh giới sử dụng.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="books-reading">
          <Link className="btn btn-sm btn-ghost" to="/books">
            <IconChevronLeft /> Về kệ sách
          </Link>
          <LearnPage compact />
        </div>
      )}
    </div>
  );
}

/** `#/books/:bookId[/page/:pageNum]` — interactive reader.
 *
 *  The page raster and its hotspots come from the private `Hanyu-data` repository. Until that data
 *  is synced this screen states the book, page and lesson honestly and links to the connection
 *  settings instead of rendering a blank canvas. */

import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components';
import { IconBook, IconChevronLeft, IconGear } from '../../app/icons';
import { findVolume } from './bookCatalog';
import './books.css';

export default function BookReaderPage() {
  const { bookId, pageNum } = useParams<{ bookId?: string; pageNum?: string }>();
  const book = findVolume(bookId);

  if (!book) {
    return (
      <div className="stack">
        <PageHeader title="Không tìm thấy quyển" />
        <p className="muted">Địa chỉ không khớp quyển nào trong bộ sáu tập.</p>
        <Link className="btn btn-primary" to="/books">
          <IconChevronLeft /> Về kệ sách
        </Link>
      </div>
    );
  }

  const page = Number(pageNum ?? 1);
  const validPage = Number.isInteger(page) && page >= 1 && page <= book.pageCount;

  return (
    <div className="stack books-reader">
      <nav className="books-reader-bar" aria-label="Điều hướng trong sách">
        <Link className="btn btn-sm" to="/books">
          <IconChevronLeft /> Kệ sách
        </Link>
        <span className="books-reader-title">
          <IconBook /> Quyển {book.volume} — {book.series}
        </span>
        <span className="spacer" />
        <span className="badge">
          Trang {validPage ? page : '—'} / {book.pageCount}
        </span>
      </nav>

      {!validPage ? (
        <div className="notice notice-warn" role="alert">
          <div>
            <strong>Trang ngoài phạm vi</strong>
            <p className="text-sm">
              Quyển {book.volume} có {book.pageCount} trang (1–{book.pageCount}). Hãy chọn một
              trang trong khoảng đó.
            </p>
          </div>
        </div>
      ) : null}

      <section className="card" aria-labelledby="reader-need-data">
        <h2 id="reader-need-data">Chưa có trang sách trên máy này</h2>
        <p className="muted">
          Ảnh trang, lớp chạm từng câu và bản thu bài khoá được tải từ repository riêng tư{' '}
          <code>RandomGuy198/Hanyu-data</code>. Chúng không được đóng gói vào bản công khai để tôn
          trọng bản quyền.
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

      <section className="card" aria-labelledby="reader-book-facts">
        <h2 id="reader-book-facts">Thông tin quyển</h2>
        <dl className="books-facts">
          <div>
            <dt>Bài học</dt>
            <dd>{book.lessons}</dd>
          </div>
          <div>
            <dt>Số bài</dt>
            <dd>{book.lessonCount}</dd>
          </div>
          <div>
            <dt>Tổng trang</dt>
            <dd>{book.pageCount}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

/** `#/courses/:bookId/:lessonId` — the five-step course for one lesson.
 *
 *  Steps, vocabulary, dialogues and drills all come from the lesson JSON in the private
 *  `Hanyu-data` repository. This screen renders the step map up front so the learner can see what
 *  a lesson contains, and explains how to sync the data when it is not on the device yet. */

import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../../components';
import { IconBook, IconChevronLeft, IconGear } from '../../app/icons';
import { findVolume } from './bookCatalog';
import './books.css';

const STEPS = [
  { id: 'vocab', label: 'Từ mới', detail: 'Nghe và xem thứ tự nét từng từ.' },
  { id: 'dialogue', label: 'Bài khoá', detail: 'Phát cả bài, làm nổi câu đang đọc, chế độ nhại.' },
  { id: 'grammar', label: 'Ngữ pháp', detail: 'Chú thích và mẫu câu kèm âm thanh.' },
  { id: 'drill', label: 'Nhận biết', detail: 'Mười hai câu hỏi nghe, nghĩa, phiên âm và điền từ.' },
  { id: 'writing', label: 'Tập viết', detail: 'Tập viết từng chữ mới theo thứ tự nét.' },
] as const;

export default function LessonCoursePage() {
  const { bookId, lessonId } = useParams<{ bookId?: string; lessonId?: string }>();
  const book = findVolume(bookId);

  if (!book) {
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

  const lessonLabel = lessonId ?? '—';

  return (
    <div className="stack books-course">
      <nav className="books-reader-bar" aria-label="Điều hướng bài học">
        <Link className="btn btn-sm" to={`/books/${book.id}`}>
          <IconChevronLeft /> Quyển {book.volume}
        </Link>
        <span className="books-reader-title">
          <IconBook /> Bài {lessonLabel}
        </span>
        <span className="spacer" />
        <span className="badge">{book.lessons}</span>
      </nav>

      <PageHeader
        title={`Bài ${lessonLabel} — 5 bước`}
        subtitle="Mỗi bài đi theo cùng một lộ trình: từ mới → bài khoá → ngữ pháp → nhận biết → tập viết."
      />

      <section className="card" aria-labelledby="course-need-data">
        <h2 id="course-need-data">Chưa có nội dung bài này trên máy</h2>
        <p className="muted">
          Từ vựng, hội thoại, chú thích ngữ pháp và âm thanh của bài nằm trong repository riêng tư{' '}
          <code>RandomGuy198/Hanyu-data</code>. Sau khi kết nối, bài học tải về và lưu trong
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

      <ol className="books-steps">
        {STEPS.map((step, index) => (
          <li key={step.id} className="card books-step">
            <span className="books-step-number" aria-hidden="true">
              {index + 1}
            </span>
            <div>
              <h3>{step.label}</h3>
              <p className="text-sm muted">{step.detail}</p>
            </div>
            <span className="badge badge-warn">Chờ dữ liệu</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

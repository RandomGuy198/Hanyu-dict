/** Component tests for the five-step guided course (`07_UI_SPEC.md` §2.4).
 *  The lesson comes from `tests/fixtures/courseLesson.ts`, which is big enough to produce a full
 *  twelve-question drill, so the drill tests can reuse the same generator to find the answers. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PreferencesProvider, SavedWordsProvider, ToastProvider } from '@/app/providers';
import * as audioPlayer from '@/data/audioPlayer';
import { db, getCourseProgress } from '@/data/db';
import { clearGitHubConfig } from '@/data/githubClient';
import LessonCoursePage from '@/modules/books/LessonCoursePage';
import { buildLessonDrill } from '@/modules/books/courseDrill';
import { COURSE_LESSON, seedCourseFixtures } from '../fixtures/courseLesson';

function renderCourse(entry: string) {
  return render(
    <PreferencesProvider>
      <ToastProvider>
        <SavedWordsProvider>
          <MemoryRouter initialEntries={[entry]}>
            <Routes>
              <Route path="/courses/:bookId/:lessonId" element={<LessonCoursePage />} />
            </Routes>
          </MemoryRouter>
        </SavedWordsProvider>
      </ToastProvider>
    </PreferencesProvider>,
  );
}

async function openCourse() {
  renderCourse('/courses/b1/b1-l03');
  await screen.findByRole('heading', { name: /Bước 1 — Từ mới/i });
}

async function goToStep(tabName: RegExp) {
  fireEvent.click(await screen.findByRole('button', { name: tabName }));
}

/** Clicks through all twelve questions, choosing `offset` positions away from the right answer. */
async function answerWholeDrill(offset: number) {
  const questions = buildLessonDrill(COURSE_LESSON);
  expect(questions.length).toBeGreaterThan(0);

  for (const question of questions) {
    const group = await screen.findByRole('group', { name: question.labelVi });
    const choice = (question.answer + offset) % question.options.length;
    fireEvent.click(within(group).getByRole('button', { name: question.options[choice] }));
    fireEvent.click(await screen.findByRole('button', { name: /Câu tiếp theo|Xem kết quả/i }));
  }
  return questions.length;
}

describe('LessonCoursePage (07 §2.4)', () => {
  beforeEach(async () => {
    clearGitHubConfig();
    vi.spyOn(audioPlayer, 'playWordAudio').mockResolvedValue({ ok: true, source: 'tts-file' });
    vi.spyOn(audioPlayer, 'playSentenceAudio').mockResolvedValue({
      ok: true,
      source: 'lesson-slice',
    });
    await seedCourseFixtures();
  });

  it('renders the five steps in order and opens on Từ mới', async () => {
    await openCourse();

    const stepper = await screen.findByRole('list', { name: /Năm bước của bài học/i });
    expect(
      within(stepper)
        .getAllByRole('button')
        .map((tab) => tab.textContent?.replace(/^\d+/, '')),
    ).toEqual(['Từ mới', 'Bài khoá', 'Ngữ pháp', 'Nhận biết', 'Tập viết']);

    expect(screen.getByRole('heading', { name: /Bước 1 — Từ mới/i })).toBeInTheDocument();
    expect(
      within(stepper).getByRole('button', { name: /Từ mới/i }),
    ).toHaveAttribute('aria-current', 'step');

    // One detail button per vocabulary row
    expect(screen.getAllByRole('button', { name: /Chi tiết/i })).toHaveLength(5);
    expect(screen.getAllByText('汉语').length).toBeGreaterThanOrEqual(1);
  });

  it('Bước 1: adding all words seeds the book deck with recognition and writing cards, then records the step', async () => {
    await openCourse();

    fireEvent.click(
      await screen.findByRole('button', { name: /Thêm tất cả vào Ôn tập SRS/i }),
    );

    await waitFor(async () => {
      const saved = await getCourseProgress('b1-l03');
      expect(saved?.completedSteps).toContain('vocab');
      expect(saved?.bookId).toBe('b1');
      // Completing a step is a local mutation, so the sync engine has to be told.
      expect((await db.meta.get('sync.dirty'))?.value).toBe(true);
    });

    const deck = await db.decks.get('deck-book-b1');
    expect(deck?.name).toBe('Khoá học Hán ngữ — Quyển 1');

    const cards = await db.cards.where('deckId').equals('deck-book-b1').toArray();
    expect(cards.filter((card) => card.kind === 'recognition')).toHaveLength(5);
    expect(cards.filter((card) => card.kind === 'writing')).toHaveLength(3);
    expect(cards.every((card) => card.lessonId === 'b1-l03')).toBe(true);

    expect(await screen.findByText(/Đã vào bộ thẻ ôn/i)).toBeInTheDocument();
  });

  it('Bước 2: shows the dialogue with segmented tokens and the Vietnamese translation', async () => {
    await openCourse();
    await goToStep(/Bài khoá/i);

    const sentences = COURSE_LESSON.dialogues[0].sentences;
    for (const sentence of sentences) {
      expect(screen.getByText(sentence.vi ?? '')).toBeInTheDocument();
    }

    const zhTokens = await screen.findAllByRole('button', { name: /^汉语$/ });
    expect(zhTokens.length).toBeGreaterThan(0);

    fireEvent.click(zhTokens[0]);
    expect(
      await screen.findByRole('dialog', { name: /Chi tiết từ 汉语/i }),
    ).toBeInTheDocument();

    // The sandhi token marks 不 with its contextual reading
    expect(document.querySelector('.zh-token.has-sandhi')).not.toBeNull();
  });

  it('Bước 3: opening every note completes the grammar step', async () => {
    await openCourse();
    await goToStep(/Ngữ pháp/i);

    expect(
      await screen.findByRole('heading', { name: /Bước 3 — Chú thích/i }),
    ).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: /Biến điệu của 不/i }));
    expect(screen.getByText('Đã mở')).toBeInTheDocument();
    expect(screen.getByText('Chưa mở')).toBeInTheDocument();
    expect((await getCourseProgress('b1-l03'))?.completedSteps ?? []).not.toContain('grammar');

    fireEvent.click(screen.getByRole('button', { name: /太 … 了/i }));

    await waitFor(async () => {
      expect((await getCourseProgress('b1-l03'))?.completedSteps).toContain('grammar');
    });
  });

  it('Bước 4: a full set of correct answers completes the drill and stores the score', async () => {
    await openCourse();
    await goToStep(/Nhận biết/i);

    const total = await answerWholeDrill(0);
    expect(total).toBe(12);

    expect(await screen.findByText(`${total}/${total} câu đúng`)).toBeInTheDocument();

    await waitFor(async () => {
      const saved = await getCourseProgress('b1-l03');
      expect(saved?.completedSteps).toContain('drill');
      expect(saved?.bestDrillScore).toBe(total);
    });
  });

  it('Bước 4: below the 80% pass mark the step stays open and the drill can be redone', async () => {
    await openCourse();
    await goToStep(/Nhận biết/i);

    await answerWholeDrill(1);

    expect(await screen.findByText(/Chưa đạt 10 câu/i)).toBeInTheDocument();
    expect((await getCourseProgress('b1-l03'))?.completedSteps ?? []).not.toContain('drill');

    fireEvent.click(screen.getByRole('button', { name: /Làm lại/i }));
    expect(screen.getByRole('group', { name: buildLessonDrill(COURSE_LESSON)[0].labelVi })).toBeInTheDocument();
  });

  it('Bước 5: lists the writing targets and reports the two-round practice for the first character', async () => {
    await openCourse();
    await goToStep(/Tập viết/i);

    expect(
      await screen.findByRole('heading', { name: /Bước 5 — Tập viết chữ Hán/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Chữ 1\/3/i)).toBeInTheDocument();
    expect(screen.getByText(/Lượt có nét mờ/i)).toBeInTheDocument();
    // No dictionary api is mounted in this harness, so the box waits on geometry instead of inventing it.
    expect(await screen.findByText(/Đang tải nét/i)).toBeInTheDocument();
  });

  it('keeps the lesson progress out of the way when the URL points at an unknown volume', async () => {
    renderCourse('/courses/b9/b9-l01');
    expect(
      await screen.findByRole('heading', { name: /Không tìm thấy bài học/i }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Về kệ sách/i })).toBeInTheDocument();
  });
});

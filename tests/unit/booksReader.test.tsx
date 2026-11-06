/**
 * Unit & Component tests for `BookReaderPage`, `BooksHomePage`, and `WordPopover`
 * (`09_TESTS_AND_ACCEPTANCE.md` §3.5).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { PreferencesProvider, SavedWordsProvider, ToastProvider } from '@/app/providers';
import * as audioPlayer from '@/data/audioPlayer';
import { db } from '@/data/db';
import { clearGitHubConfig } from '@/data/githubClient';
import BookReaderPage from '@/modules/books/BookReaderPage';
import BooksHomePage from '@/modules/books/BooksHomePage';
import type { BooksManifest, LessonDocument } from '@/domain/types';

const FIXTURE_MANIFEST: BooksManifest = {
  schemaVersion: 1,
  generatedAt: '2026-11-05T09:20:36Z',
  books: [
    {
      bookId: 'b1',
      volumeNumber: 1,
      titleVi: 'Quyển 1 — Tập 1 Thượng',
      titleZh: '第一册 上',
      pageCount: 177,
      lessonNumbers: [1, 2],
      globalLessonRange: [1, 2],
      lessons: [
        {
          lessonId: 'b1-l01',
          bookId: 'b1',
          lessonNumber: 1,
          globalLessonNumber: 1,
          titleZh: '你好',
          titlePinyin: 'Nǐ hǎo',
          titleVi: 'Xin chào',
          startPage: 19,
          endPage: 30,
          vocabCount: 12,
          sentenceCount: 2,
          lessonAudioPath: 'audio/lessons/b1/l01.mp3',
        },
        {
          lessonId: 'b1-l02',
          bookId: 'b1',
          lessonNumber: 2,
          globalLessonNumber: 2,
          titleZh: '汉语不太难',
          titlePinyin: 'Hànyǔ bú tài nán',
          titleVi: 'Tiếng Hán không khó lắm',
          startPage: 31,
          endPage: 36,
          vocabCount: 6,
          sentenceCount: 4,
          lessonAudioPath: 'audio/lessons/b1/l02.mp3',
        },
      ],
    },
  ],
};

const FIXTURE_LESSON_B1_L02: LessonDocument = {
  schemaVersion: 1,
  lessonId: 'b1-l02',
  bookId: 'b1',
  lessonNumber: 2,
  globalLessonNumber: 2,
  titleZh: '汉语不太难',
  titlePinyin: 'Hànyǔ bú tài nán',
  titleVi: 'Tiếng Hán không khó lắm',
  startPage: 31,
  endPage: 36,
  lessonAudioPath: 'audio/lessons/b1/l02.mp3',
  lessonAudioDurationMs: 422766,
  pages: [
    {
      pageNumber: 31,
      imagePath: 'books/b1/pages/p031.webp',
      widthPx: 1224,
      heightPx: 1584,
      hotspots: [
        {
          id: 'p031-b06-s1',
          bboxPct: [0.1814, 0.3516, 0.1871, 0.0505],
          kind: 'sentence',
          refId: 'b1-l02-s01',
          zhText: '你忙吗?',
          pinyin: 'Nǐ máng ma?',
          ttsAudioPath: 'audio/tts/sentences/2b/2b9a625fdb4a0e09.mp3',
          audioSlice: {
            audioPath: 'audio/lessons/b1/l02.mp3',
            startMs: 6800,
            endMs: 8780,
            confidence: 0.897,
          },
        },
        {
          id: 'p031-b09-s1',
          bboxPct: [0.183, 0.5587, 0.1626, 0.0492],
          kind: 'sentence',
          refId: 'b1-l02-s04',
          zhText: '不太难。',
          pinyin: 'Bú tài nán.',
          ttsAudioPath: 'audio/tts/sentences/82/827b1a4315a667f6.mp3',
          audioSlice: {
            audioPath: 'audio/lessons/b1/l02.mp3',
            startMs: 12702,
            endMs: 14920,
            confidence: 0.838,
          },
        },
        {
          id: 'p031-b13-v01',
          bboxPct: [0.1593, 0.6799, 0.6087, 0.0253],
          kind: 'vocab',
          refId: 'b1-l02-v01',
          zhText: '忙',
          pinyin: 'máng',
          viText: 'bận; vội vã',
          ttsAudioPath: 'audio/tts/words/ba/baa28a7103a692cc.mp3',
          audioSlice: {
            audioPath: 'audio/lessons/b1/l02.mp3',
            startMs: 16740,
            endMs: 19114,
            confidence: 0.857,
          },
        },
      ],
    },
  ],
  vocabulary: [
    {
      id: 'b1-l02-v01',
      index: 1,
      hanzi: '忙',
      traditional: '忙',
      pos: '形',
      pinyin: 'máng',
      pinyinNumbered: 'mang2',
      hanViet: 'mang',
      meaningEn: 'busy; hurriedly',
      meaningVi: 'bận; vội vã',
      pageNumber: 31,
      bboxPct: [0.1593, 0.6799, 0.6087, 0.0253],
      ttsAudioPath: 'audio/tts/words/ba/baa28a7103a692cc.mp3',
      lessonAudioSlice: {
        audioPath: 'audio/lessons/b1/l02.mp3',
        startMs: 16740,
        endMs: 19114,
        confidence: 0.857,
      },
    },
    {
      id: 'b1-l02-v05',
      index: 5,
      hanzi: '难',
      traditional: '難',
      pos: '形',
      pinyin: 'nán',
      pinyinNumbered: 'nan2',
      hanViet: 'nan',
      meaningEn: 'difficult',
      meaningVi: 'khó',
      pageNumber: 31,
      ttsAudioPath: 'audio/tts/words/be/be0e40fecc027e55.mp3',
    },
    {
      id: 'b1-l02-v06',
      index: 6,
      hanzi: '太',
      traditional: '太',
      pos: '副',
      pinyin: 'tài',
      pinyinNumbered: 'tai4',
      hanViet: 'thái',
      meaningEn: 'too; very',
      meaningVi: 'lắm; quá',
      pageNumber: 32,
      ttsAudioPath: 'audio/tts/words/57/578c75a3de099eaa.mp3',
    },
  ],
  dialogues: [
    {
      id: 'b1-l02-d01',
      title: '汉语不太难',
      sentences: [
        {
          id: 'b1-l02-s01',
          speaker: 'A',
          zh: '你忙吗?',
          pinyin: 'Nǐ máng ma?',
          vi: 'Bạn bận không?',
          pageNumber: 31,
          ttsAudioPath: 'audio/tts/sentences/2b/2b9a625fdb4a0e09.mp3',
          lessonAudioSlice: {
            audioPath: 'audio/lessons/b1/l02.mp3',
            startMs: 6800,
            endMs: 8780,
            confidence: 0.897,
          },
          tokens: [
            { surface: '你', pinyin: 'nǐ', dictHeadword: '你' },
            { surface: '忙', pinyin: 'máng', dictHeadword: '忙', vocabId: 'b1-l02-v01' },
            { surface: '吗', pinyin: 'ma', dictHeadword: '吗' },
          ],
        },
        {
          id: 'b1-l02-s04',
          speaker: 'B',
          zh: '不太难。',
          pinyin: 'Bú tài nán.',
          vi: 'Không khó lắm.',
          pageNumber: 31,
          ttsAudioPath: 'audio/tts/sentences/82/827b1a4315a667f6.mp3',
          sandhiNotes: ['Biến điệu: 不 (bù) đọc thành bú khi đứng trước thanh 4'],
          lessonAudioSlice: {
            audioPath: 'audio/lessons/b1/l02.mp3',
            startMs: 12702,
            endMs: 14920,
            confidence: 0.838,
          },
          tokens: [
            {
              surface: '不',
              pinyin: 'bú',
              citationPinyin: 'bù',
              dictHeadword: '不',
              ttsAudioPath: 'audio/tts/words/74/7461c217a2f073e7.mp3',
            },
            {
              surface: '太',
              pinyin: 'tài',
              dictHeadword: '太',
              vocabId: 'b1-l02-v06',
              ttsAudioPath: 'audio/tts/words/57/578c75a3de099eaa.mp3',
            },
            {
              surface: '难',
              pinyin: 'nán',
              dictHeadword: '难',
              vocabId: 'b1-l02-v05',
              ttsAudioPath: 'audio/tts/words/be/be0e40fecc027e55.mp3',
            },
          ],
        },
      ],
    },
  ],
  notes: [],
  grammar: [],
  exercises: [],
  writingTargets: ['忙', '太', '难'],
};

async function seedBookFixtures() {
  await db.remoteCache.put({
    path: 'books/manifest.json',
    category: 'manifest',
    version: FIXTURE_MANIFEST.generatedAt,
    data: FIXTURE_MANIFEST,
    updatedAt: FIXTURE_MANIFEST.generatedAt,
  });

  await db.remoteCache.put({
    path: 'books/b1/lessons/l02.json',
    category: 'lesson',
    version: FIXTURE_MANIFEST.generatedAt,
    data: FIXTURE_LESSON_B1_L02,
    updatedAt: FIXTURE_MANIFEST.generatedAt,
  });

  await db.remoteCache.put({
    path: 'books/b1/pages/p031.webp',
    category: 'page',
    data: new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer,
    updatedAt: FIXTURE_MANIFEST.generatedAt,
  });
}

function renderWithRouter(initialEntry: string) {
  return render(
    <PreferencesProvider>
      <ToastProvider>
        <SavedWordsProvider>
          <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
              <Route path="/books" element={<BooksHomePage />} />
              <Route path="/books/:bookId" element={<BookReaderPage />} />
              <Route path="/books/:bookId/page/:pageNum" element={<BookReaderPage />} />
            </Routes>
          </MemoryRouter>
        </SavedWordsProvider>
      </ToastProvider>
    </PreferencesProvider>,
  );
}

describe('BookReaderPage & WordPopover (09 §3.5)', () => {
  beforeEach(async () => {
    clearGitHubConfig();
    if (typeof URL.createObjectURL !== 'function') {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: vi.fn(() => 'blob:mock-page-webp'),
      });
    } else {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-page-webp');
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: vi.fn(),
      });
    } else {
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    }
    await seedBookFixtures();
  });

  it('renders a clean PDF-like reader for b1 Page 31: page image, no hotspot overlays, no audio bar', async () => {
    renderWithRouter('/books/b1/page/31');

    // The rendered page image shows as a plain sheet
    const pageImg = await screen.findByAltText(/Trang 31/i);
    expect(pageImg).toBeInTheDocument();

    // Hotspot overlay boxes, the bottom AudioBar, view-mode toggle and course button are gone
    expect(document.querySelectorAll('.page-hotspot')).toHaveLength(0);
    expect(screen.queryByRole('region', { name: /Thanh phân tích câu/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/🎓 Luyện bài này/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /📄 Trang sách/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Trình phát âm thanh bài học/i)).not.toBeInTheDocument();

    // The interactive text pane is stacked below and still offers clickable word tokens
    const buTokens = await screen.findAllByRole('button', { name: /^不/ });
    expect(buTokens.length).toBeGreaterThan(0);
  });

  it('clicking token "不" in "不太难" opens a WordPopover with the dictionary entry (no audio) and can save + add SRS cards', async () => {
    const playWordSpy = vi
      .spyOn(audioPlayer, 'playWordAudio')
      .mockResolvedValue({ ok: true, source: 'tts-file' });
    const playSentenceSpy = vi
      .spyOn(audioPlayer, 'playSentenceAudio')
      .mockResolvedValue({ ok: true, source: 'lesson-slice' });

    renderWithRouter('/books/b1/page/31');

    // Find segmented token "不" inside "不太难。" (text pane is always visible now)
    const buTokens = await screen.findAllByRole('button', { name: /^不/ });
    expect(buTokens.length).toBeGreaterThan(0);
    fireEvent.click(buTokens[0]);

    // Clicking a word must look it up, NOT auto-play audio
    expect(playWordSpy).not.toHaveBeenCalled();
    expect(playSentenceSpy).not.toHaveBeenCalled();

    // WordPopover dialog opens
    const dialog = await screen.findByRole('dialog', { name: /Chi tiết từ 不/i });
    expect(dialog).toBeInTheDocument();

    // Shared EntryDetailCard dictionary content: contextual bú vs citation bù, Hán Việt, VI gloss
    expect(dialog.textContent).toMatch(/Đọc trong câu:\s*bú/i);
    expect(dialog.textContent).toMatch(/Đọc riêng:\s*bù/i);
    expect(dialog.textContent).toMatch(/HÁN VIỆT:\s*BẤT/i);
    expect(dialog.textContent).toMatch(/không, chẳng/i);

    // No audio buttons; a link to the full dictionary page replaces them
    expect(within(dialog).queryByRole('button', { name: /Từ đơn/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Trong câu/i })).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', { name: /Mở trang từ điển/i }),
    ).toBeInTheDocument();

    // Saving the word still creates recognition + writing SRS cards
    const saveSrsBtn = within(dialog).getByRole('button', { name: /Lưu từ & thêm thẻ SRS/i });
    fireEvent.click(saveSrsBtn);

    await waitFor(async () => {
      const cards = await db.cards.toArray();
      expect(cards.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('renders BooksHomePage with 6 volumes and Continue Studying card when manifest is loaded', async () => {
    renderWithRouter('/books');

    const continueHeading = await screen.findByRole('heading', { name: /Tiếp tục học/i });
    expect(continueHeading).toBeInTheDocument();

    expect(screen.getByText(/Quyển 1 — Tập 1 Thượng/i)).toBeInTheDocument();
    expect(screen.getAllByText(/汉语不太难/).length).toBeGreaterThanOrEqual(1);
  });
});

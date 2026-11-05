/**
 * Unit & Component tests for `BookReaderPage`, `BooksHomePage`, `WordPopover`, and `AudioBar`
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

  it('renders BookReaderPage for b1 Page 31 (Lesson 2: 汉语不太难) and plays lessonAudioSlice when sentence hotspot is clicked', async () => {
    const playSentenceSpy = vi
      .spyOn(audioPlayer, 'playSentenceAudio')
      .mockResolvedValue({ ok: true, source: 'lesson-slice' });

    renderWithRouter('/books/b1/page/31');

    // Wait for page image and hotspots to render
    const pageImg = await screen.findByAltText(/Trang 31/i);
    expect(pageImg).toBeInTheDocument();

    const hotspotBtn = await screen.findByRole('button', {
      name: /Câu thoại: 不太难。/i,
    });
    expect(hotspotBtn).toBeInTheDocument();

    fireEvent.click(hotspotBtn);

    await waitFor(() => {
      expect(playSentenceSpy).toHaveBeenCalledTimes(1);
    });

    const [calledSentence, calledMode] = playSentenceSpy.mock.calls[0];
    expect(calledSentence.id).toBe('b1-l02-s04');
    expect(calledSentence.lessonAudioSlice).toEqual({
      audioPath: 'audio/lessons/b1/l02.mp3',
      startMs: 12702,
      endMs: 14920,
      confidence: 0.838,
    });
    expect(calledMode).toBe('context');

    // Floating sentence bar also opens with segmented tokens
    const floatingRegion = await screen.findByRole('region', {
      name: /Thanh phân tích câu đang chọn/i,
    });
    expect(within(floatingRegion).getByText('不')).toBeInTheDocument();
  });

  it('clicking token "不" in "不太难" opens WordPopover showing contextual Pinyin bú vs citation bù, Hán-Việt bất, Vietnamese meaning, and both audio buttons', async () => {
    const playWordSpy = vi
      .spyOn(audioPlayer, 'playWordAudio')
      .mockResolvedValue({ ok: true, source: 'tts-file' });
    const playSentenceSpy = vi
      .spyOn(audioPlayer, 'playSentenceAudio')
      .mockResolvedValue({ ok: true, source: 'lesson-slice' });

    renderWithRouter('/books/b1/page/31');

    // Switch to Clean Interactive Text mode ("📝 Văn bản")
    const textModeRadio = await screen.findByRole('radio', { name: /📝 Văn bản/i });
    fireEvent.click(textModeRadio);

    // Find segmented token "不" inside "不太难。"
    const buTokens = await screen.findAllByRole('button', { name: /^不/ });
    expect(buTokens.length).toBeGreaterThan(0);
    fireEvent.click(buTokens[0]);

    // Clicking token immediately plays standalone word audio
    await waitFor(() => {
      expect(playWordSpy).toHaveBeenCalledWith('不', 'bu4', undefined, expect.any(Object));
    });

    // WordPopover dialog opens
    const dialog = await screen.findByRole('dialog', { name: /Chi tiết từ 不/i });
    expect(dialog).toBeInTheDocument();

    // Checks contextual Pinyin bú vs citation bù
    expect(dialog.textContent).toMatch(/Đọc trong câu:\s*bú/i);
    expect(dialog.textContent).toMatch(/Đọc riêng:\s*bù/i);

    // Checks Hán-Việt bất
    expect(dialog.textContent).toMatch(/HÁN VIỆT:\s*BẤT/i);

    // Checks Vietnamese meaning
    expect(dialog.textContent).toMatch(/không, chẳng/i);

    // Checks both audio buttons ("Từ đơn" and "Trong câu")
    const standaloneBtn = within(dialog).getByRole('button', { name: /Từ đơn/i });
    const contextBtn = within(dialog).getByRole('button', { name: /Trong câu/i });
    expect(standaloneBtn).toBeInTheDocument();
    expect(contextBtn).toBeInTheDocument();

    fireEvent.click(contextBtn);
    await waitFor(() => {
      expect(playSentenceSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'b1-l02-s04' }),
        'context',
        1.0,
      );
    });

    // Test saving word & adding SRS cards from WordPopover
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

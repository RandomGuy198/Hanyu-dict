/** One synthetic lesson big enough to drive the five-step course: five distinct vocabulary items
 *  and three dialogue sentences, which is what the twelve-question drill (`courseDrill.ts`) needs.
 *  `booksReader.test.tsx` keeps its own smaller fixture because the reader only shows hotspots. */

import { db } from '@/data/db';
import type { BooksManifest, LessonDocument } from '@/domain/types';

export const COURSE_FIXTURE_GENERATED_AT = '2026-11-05T09:20:36Z';

export const COURSE_LESSON: LessonDocument = {
  schemaVersion: 1,
  lessonId: 'b1-l03',
  bookId: 'b1',
  lessonNumber: 3,
  globalLessonNumber: 3,
  titleZh: '汉语不太难',
  titlePinyin: 'Hànyǔ bú tài nán',
  titleVi: 'Tiếng Hán không khó lắm',
  startPage: 40,
  endPage: 44,
  lessonAudioPath: 'audio/lessons/b1/l03.mp3',
  lessonAudioDurationMs: 180000,
  pages: [],
  vocabulary: [
    {
      id: 'b1-l03-v01',
      index: 1,
      hanzi: '忙',
      traditional: '忙',
      pos: '形',
      pinyin: 'máng',
      pinyinNumbered: 'mang2',
      hanViet: 'mang',
      meaningEn: 'busy',
      meaningVi: 'bận; vội vã',
      pageNumber: 40,
      ttsAudioPath: 'audio/tts/words/ba/baa28a7103a692cc.mp3',
      lessonAudioSlice: {
        audioPath: 'audio/lessons/b1/l03.mp3',
        startMs: 16740,
        endMs: 19114,
        confidence: 0.857,
      },
    },
    {
      id: 'b1-l03-v02',
      index: 2,
      hanzi: '难',
      traditional: '難',
      pos: '形',
      pinyin: 'nán',
      pinyinNumbered: 'nan2',
      hanViet: 'nan',
      meaningEn: 'difficult',
      meaningVi: 'khó',
      pageNumber: 40,
      ttsAudioPath: 'audio/tts/words/be/be0e40fecc027e55.mp3',
    },
    {
      id: 'b1-l03-v03',
      index: 3,
      hanzi: '太',
      traditional: '太',
      pos: '副',
      pinyin: 'tài',
      pinyinNumbered: 'tai4',
      hanViet: 'thái',
      meaningEn: 'too; very',
      meaningVi: 'lắm; quá',
      pageNumber: 41,
      ttsAudioPath: 'audio/tts/words/57/578c75a3de099eaa.mp3',
    },
    {
      id: 'b1-l03-v04',
      index: 4,
      hanzi: '汉语',
      traditional: '漢語',
      pos: '名',
      pinyin: 'hàn yǔ',
      pinyinNumbered: 'han4 yu3',
      hanViet: 'hán ngữ',
      meaningEn: 'Chinese language',
      meaningVi: 'tiếng Hán',
      pageNumber: 41,
      ttsAudioPath: 'audio/tts/words/11/1130b6d16b5a0a11.mp3',
    },
    {
      id: 'b1-l03-v05',
      index: 5,
      hanzi: '不',
      traditional: '不',
      pos: '副',
      pinyin: 'bù',
      pinyinNumbered: 'bu4',
      hanViet: 'bất',
      meaningEn: 'not',
      meaningVi: 'không, chẳng',
      pageNumber: 42,
      ttsAudioPath: 'audio/tts/words/74/7461c217a2f073e7.mp3',
    },
  ],
  dialogues: [
    {
      id: 'b1-l03-d01',
      title: '汉语不太难',
      sentences: [
        {
          id: 'b1-l03-s01',
          speaker: 'A',
          zh: '汉语不太难。',
          pinyin: 'Hànyǔ bú tài nán.',
          vi: 'Tiếng Hán không khó lắm.',
          pageNumber: 40,
          ttsAudioPath: 'audio/tts/sentences/82/827b1a4315a667f6.mp3',
          lessonAudioSlice: {
            audioPath: 'audio/lessons/b1/l03.mp3',
            startMs: 12702,
            endMs: 14920,
            confidence: 0.838,
          },
          tokens: [
            { surface: '汉语', pinyin: 'hàn yǔ', dictHeadword: '汉语', vocabId: 'b1-l03-v04' },
            {
              surface: '不',
              pinyin: 'bú',
              citationPinyin: 'bù',
              dictHeadword: '不',
              vocabId: 'b1-l03-v05',
            },
            { surface: '太', pinyin: 'tài', dictHeadword: '太', vocabId: 'b1-l03-v03' },
            { surface: '难', pinyin: 'nán', dictHeadword: '难', vocabId: 'b1-l03-v02' },
          ],
        },
        {
          id: 'b1-l03-s02',
          speaker: 'B',
          zh: '你忙吗?',
          pinyin: 'Nǐ máng ma?',
          vi: 'Bạn bận không?',
          pageNumber: 40,
          ttsAudioPath: 'audio/tts/sentences/2b/2b9a625fdb4a0e09.mp3',
          lessonAudioSlice: {
            audioPath: 'audio/lessons/b1/l03.mp3',
            startMs: 6800,
            endMs: 8780,
            confidence: 0.897,
          },
          tokens: [
            { surface: '你', pinyin: 'nǐ', dictHeadword: '你' },
            { surface: '忙', pinyin: 'máng', dictHeadword: '忙', vocabId: 'b1-l03-v01' },
            { surface: '吗', pinyin: 'ma', dictHeadword: '吗' },
          ],
        },
        {
          id: 'b1-l03-s03',
          speaker: 'A',
          zh: '他很忙。',
          pinyin: 'Tā hěn máng.',
          vi: 'Anh ấy rất bận.',
          pageNumber: 41,
          ttsAudioPath: 'audio/tts/sentences/3c/3cc0a8e3e8e7b4d1.mp3',
          tokens: [
            { surface: '他', pinyin: 'tā', dictHeadword: '他' },
            { surface: '很', pinyin: 'hěn', dictHeadword: '很' },
            { surface: '忙', pinyin: 'máng', dictHeadword: '忙', vocabId: 'b1-l03-v01' },
          ],
        },
      ],
    },
  ],
  notes: [
    {
      id: 'b1-l03-n01',
      heading: 'Biến điệu của 不',
      bodyVi: '不 (bù) đọc thành bú khi đứng trước một âm thanh 4.',
      examples: [],
    },
  ],
  grammar: [
    {
      id: 'b1-l03-g01',
      heading: '太 … 了',
      explanationVi: 'Mức độ cao, dịch là "quá / lắm".',
      examples: [
        {
          id: 'b1-l03-g01-ex1',
          zh: '汉语不太难。',
          pinyin: 'Hànyǔ bú tài nán.',
          vi: 'Tiếng Hán không khó lắm.',
          pageNumber: 40,
          ttsAudioPath: 'audio/tts/sentences/82/827b1a4315a667f6.mp3',
          tokens: [],
        },
      ],
    },
  ],
  exercises: [],
  writingTargets: ['忙', '太', '难'],
};

export const COURSE_MANIFEST: BooksManifest = {
  schemaVersion: 1,
  generatedAt: COURSE_FIXTURE_GENERATED_AT,
  books: [
    {
      bookId: 'b1',
      volumeNumber: 1,
      titleVi: 'Quyển 1 — Tập 1 Thượng',
      titleZh: '第一册 上',
      pageCount: 177,
      lessonNumbers: [3],
      globalLessonRange: [3, 3],
      lessons: [
        {
          lessonId: 'b1-l03',
          bookId: 'b1',
          lessonNumber: 3,
          globalLessonNumber: 3,
          titleZh: '汉语不太难',
          titlePinyin: 'Hànyǔ bú tài nán',
          titleVi: 'Tiếng Hán không khó lắm',
          startPage: 40,
          endPage: 44,
          vocabCount: 5,
          sentenceCount: 3,
          lessonAudioPath: 'audio/lessons/b1/l03.mp3',
        },
      ],
    },
  ],
};

/** Writes the lesson the way the private-data loader expects to find it in `remoteCache`. */
export async function seedCourseFixtures(): Promise<void> {
  await db.remoteCache.put({
    path: 'books/manifest.json',
    category: 'manifest',
    version: COURSE_FIXTURE_GENERATED_AT,
    data: COURSE_MANIFEST,
    updatedAt: COURSE_FIXTURE_GENERATED_AT,
  });
  await db.remoteCache.put({
    path: 'books/b1/lessons/l03.json',
    category: 'lesson',
    version: COURSE_FIXTURE_GENERATED_AT,
    data: COURSE_LESSON,
    updatedAt: COURSE_FIXTURE_GENERATED_AT,
  });
}

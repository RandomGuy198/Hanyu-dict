/** Boundary validation for anything that crosses into the app from disk: the pack manifest,
 *  imported backup files and restored user data. Nothing unvalidated reaches storage. */

import { z } from 'zod';

export const packFileRefSchema = z.object({
  path: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'sha256 must be 64 lowercase hex characters'),
  bytes: z.number().int().nonnegative(),
  records: z.number().int().nonnegative().optional(),
});

export const packKindSchema = z.enum([
  'dictionary',
  'characters',
  'strokes',
  'examples',
  'content',
]);

export const packDescriptorSchema = z
  .object({
    id: z.string().min(1),
    kind: packKindSchema,
    label: z.string().min(1),
    version: z.string().min(1),
    required: z.boolean(),
    license: z.string().min(1),
    sourceUrl: z.string().url().optional(),
    attribution: z.string().min(1),
    modifications: z.string().optional(),
    coverage: z.record(z.unknown()).optional(),
    bytes: z.number().int().nonnegative(),
    files: z.array(packFileRefSchema).min(1),
  })
  .superRefine((pack, ctx) => {
    // Third-party data must be attributable; original content is allowed to omit sourceUrl.
    const thirdParty = !/^CC-BY-4\.0$/.test(pack.license) && pack.attribution.indexOf('Original content') !== 0;
    if (thirdParty && !pack.sourceUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceUrl'],
        message: `pack ${pack.id} is third-party and needs a sourceUrl`,
      });
    }
  });

export const packManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string().min(1),
    minAppVersion: z.string().min(1),
    packs: z.array(packDescriptorSchema).min(1),
  })
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    for (const pack of manifest.packs) {
      if (seen.has(pack.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate pack id ${pack.id}` });
      }
      seen.add(pack.id);
      const paths = new Set<string>();
      for (const file of pack.files) {
        if (paths.has(file.path)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate file ${file.path} in pack ${pack.id}`,
          });
        }
        paths.add(file.path);
        if (file.path.startsWith('/') || file.path.includes('..')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `unsafe path ${file.path} in pack ${pack.id}`,
          });
        }
      }
    }
  });

export type ValidatedManifest = z.infer<typeof packManifestSchema>;

export const contentBlockSchema = z.union([
  z.object({ type: z.literal('text'), body: z.string() }),
  z.object({
    type: z.literal('list'),
    title: z.string().optional(),
    body: z.array(z.string()),
  }),
  z.object({
    type: z.literal('dialogue'),
    title: z.string().optional(),
    body: z.array(
      z.object({ speaker: z.string(), zh: z.string(), py: z.string(), en: z.string() }),
    ),
  }),
  z.object({ type: z.literal('note'), body: z.string() }),
]);

export const contentItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['tip', 'lesson', 'story', 'article']),
  title: z.string().min(1),
  summary: z.string().min(1),
  level: z.enum(['beginner', 'elementary', 'intermediate']),
  license: z.string().min(1),
  attribution: z.string().min(1),
  tags: z.array(z.string()).default([]),
  blocks: z.array(contentBlockSchema).min(1),
});

/** Exported backups are versioned; importing an unknown version is refused, not guessed. */
export const EXPORT_VERSION = 1;

/** One store inside a backup: `store` is the IndexedDB table name, `rows` its records. */
export const exportedStoreSchema = z.object({
  store: z.string().min(1),
  rows: z.array(z.unknown()),
});

export const backupFileSchema = z.object({
  app: z.literal('hanyu-web'),
  exportVersion: z.number().int().positive(),
  exportedAt: z.string(),
  counts: z.record(z.number().int().nonnegative()).optional(),
  data: z.record(z.array(z.unknown())),
});

export type BackupFile = z.infer<typeof backupFileSchema>;

export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}

/* ---------- v0.2 Schemas: Books, Lessons, Audio & Sync ---------- */

export const bookIdSchema = z.enum(['b1', 'b2', 'b3', 'b4', 'b5', 'b6']);

export const audioSliceRefSchema = z.object({
  audioPath: z.string().min(1),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
});

export const lessonSummarySchema = z.object({
  lessonId: z.string().min(1),
  bookId: bookIdSchema,
  lessonNumber: z.number().int().positive(),
  globalLessonNumber: z.number().int().positive(),
  titleZh: z.string(),
  titlePinyin: z.string(),
  titleVi: z.string(),
  startPage: z.number().int().positive(),
  endPage: z.number().int().positive(),
  vocabCount: z.number().int().nonnegative(),
  sentenceCount: z.number().int().nonnegative(),
  lessonAudioPath: z.string().min(1),
});

export const bookSummarySchema = z.object({
  bookId: bookIdSchema,
  volumeNumber: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  titleVi: z.string().min(1),
  titleZh: z.string().min(1),
  pageCount: z.number().int().positive(),
  lessonNumbers: z.array(z.number().int().positive()),
  globalLessonRange: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  lessons: z.array(lessonSummarySchema),
});

export const booksManifestSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().min(1),
  books: z.array(bookSummarySchema).min(1),
});

export const bboxPctSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

export const pageHotspotSchema = z.object({
  id: z.string().min(1),
  bboxPct: bboxPctSchema,
  kind: z.enum(['title', 'sentence', 'vocab', 'note', 'grammar', 'exercise', 'other']),
  refId: z.string().optional(),
  zhText: z.string(),
  pinyin: z.string().optional(),
  viText: z.string().optional(),
  audioSlice: audioSliceRefSchema.optional(),
  ttsAudioPath: z.string().optional(),
});

export const lessonPageMapSchema = z.object({
  pageNumber: z.number().int().positive(),
  imagePath: z.string().min(1),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  hotspots: z.array(pageHotspotSchema),
});

export const lessonVocabItemSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().positive(),
  hanzi: z.string().min(1),
  traditional: z.string().optional(),
  pos: z.string(),
  pinyin: z.string(),
  pinyinNumbered: z.string(),
  hanViet: z.string(),
  meaningEn: z.string(),
  meaningVi: z.string(),
  pageNumber: z.number().int().positive(),
  bboxPct: bboxPctSchema.optional(),
  lessonAudioSlice: audioSliceRefSchema.optional(),
  ttsAudioPath: z.string(),
});

export const sentenceTokenSchema = z.object({
  surface: z.string().min(1),
  pinyin: z.string(),
  citationPinyin: z.string().optional(),
  vocabId: z.string().optional(),
  dictHeadword: z.string().optional(),
  ttsAudioPath: z.string().optional(),
});

export const lessonSentenceSchema = z.object({
  id: z.string().min(1),
  speaker: z.string().optional(),
  zh: z.string().min(1),
  pinyin: z.string(),
  vi: z.string().optional(),
  en: z.string().optional(),
  sandhiNotes: z.array(z.string()).optional(),
  pageNumber: z.number().int().positive(),
  bboxPct: bboxPctSchema.optional(),
  lessonAudioSlice: audioSliceRefSchema.optional(),
  ttsAudioPath: z.string(),
  tokens: z.array(sentenceTokenSchema),
});

export const lessonDialogueBlockSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  sentences: z.array(lessonSentenceSchema),
});

export const lessonNoteItemSchema = z.object({
  id: z.string().min(1),
  heading: z.string(),
  bodyZh: z.string().optional(),
  bodyVi: z.string(),
  bodyEn: z.string().optional(),
  examples: z.array(lessonSentenceSchema),
});

export const lessonGrammarItemSchema = z.object({
  id: z.string().min(1),
  heading: z.string(),
  explanationVi: z.string(),
  explanationEn: z.string().optional(),
  examples: z.array(lessonSentenceSchema),
});

export const lessonPronunciationSectionSchema = z.object({
  initials: z.array(z.string()).optional(),
  finals: z.array(z.string()).optional(),
  toneDrills: z
    .array(
      z.object({
        text: z.string(),
        pinyin: z.string(),
        ttsAudioPath: z.string(),
        lessonAudioSlice: audioSliceRefSchema.optional(),
      }),
    )
    .optional(),
});

export const lessonExerciseItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'substitution',
    'fill_blank',
    'comprehension',
    'correct_sentence',
    'reading_passage',
  ]),
  promptVi: z.string(),
  items: z.array(
    z.object({
      zh: z.string(),
      pinyin: z.string().optional(),
      answer: z.string().optional(),
      ttsAudioPath: z.string().optional(),
    }),
  ),
});

export const lessonDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  lessonId: z.string().min(1),
  bookId: bookIdSchema,
  lessonNumber: z.number().int().positive(),
  globalLessonNumber: z.number().int().positive(),
  titleZh: z.string(),
  titlePinyin: z.string(),
  titleVi: z.string(),
  startPage: z.number().int().positive(),
  endPage: z.number().int().positive(),
  lessonAudioPath: z.string().min(1),
  lessonAudioDurationMs: z.number().nonnegative(),
  pages: z.array(lessonPageMapSchema),
  vocabulary: z.array(lessonVocabItemSchema),
  dialogues: z.array(lessonDialogueBlockSchema),
  notes: z.array(lessonNoteItemSchema),
  grammar: z.array(lessonGrammarItemSchema),
  pronunciation: lessonPronunciationSectionSchema.optional(),
  exercises: z.array(lessonExerciseItemSchema),
  writingTargets: z.array(z.string()),
});

export const audioManifestEntrySchema = z.object({
  path: z.string().min(1),
  durationMs: z.number().nonnegative(),
  voice: z.string().optional(),
  engine: z.string().optional(),
});

export const audioManifestSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().min(1),
  defaultVoice: z.string().optional(),
  voice: z.string().optional(),
  engine: z.string().optional(),
  words: z.record(audioManifestEntrySchema),
  sentences: z.record(audioManifestEntrySchema),
});

export const courseStepIdSchema = z.enum(['vocab', 'dialogue', 'grammar', 'drill', 'writing']);

export const courseLessonProgressSchema = z.object({
  lessonId: z.string().min(1),
  bookId: z.string().min(1),
  completedSteps: z.array(courseStepIdSchema),
  bestDrillScore: z.number().min(0).max(100).optional(),
  writingCompletedChars: z.array(z.string()),
  completedAt: z.string().optional(),
  lastStudiedAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const bookBookmarkSchema = z.object({
  bookId: z.string().min(1),
  lastPageNumber: z.number().int().positive(),
  lastLessonId: z.string().min(1),
  viewMode: z.enum(['page', 'text', 'split']),
  updatedAt: z.string().min(1),
});

export const syncStateFileSchema = z.object({
  schemaVersion: z.literal(1),
  updatedAt: z.string().min(1),
  deviceId: z.string().min(1),
  deletedIds: z.record(z.string()),
  preferences: z.record(z.unknown()),
  savedWords: z.array(z.unknown()),
  wordLists: z.array(z.unknown()),
  notebooks: z.array(z.unknown()),
  categories: z.array(z.unknown()),
  notebookEntries: z.array(z.unknown()),
  decks: z.array(z.unknown()),
  cards: z.array(z.unknown()),
  courseProgress: z.record(courseLessonProgressSchema),
  bookBookmarks: z.record(bookBookmarkSchema),
  dailyActivity: z.record(z.unknown()),
});


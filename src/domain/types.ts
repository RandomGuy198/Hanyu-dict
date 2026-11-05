/** Canonical domain types. Original schemas — not derived from any third-party product's
 *  internal database format. Wire encoding lives in docs/DATA_FORMAT.md. */

/** Pack fields are separated by the ASCII unit separator (decimal 31). */
export const US = String.fromCharCode(31);

export type PackKind = 'dictionary' | 'characters' | 'strokes' | 'examples' | 'content';

export interface PackFileRef {
  path: string;
  sha256: string;
  bytes: number;
  records?: number;
}

export interface PackCoverage {
  records?: number;
  languages?: string[];
  [key: string]: unknown;
}

export interface PackDescriptor {
  id: string;
  kind: PackKind;
  label: string;
  version: string;
  required: boolean;
  license: string;
  sourceUrl?: string;
  attribution: string;
  modifications?: string;
  coverage?: PackCoverage;
  bytes: number;
  files: PackFileRef[];
}

export interface PackManifest {
  schemaVersion: number;
  generatedAt: string;
  minAppVersion: string;
  packs: PackDescriptor[];
}

/** Runtime state of one installed pack. */
export interface PackInstallState {
  id: string;
  version: string;
  kind: PackKind;
  installedAt: string;
  bytes: number;
  files: number;
  status: 'installing' | 'ready' | 'error';
  error?: string;
}

/** One dictionary line, decoded. */
export interface DictEntry {
  /** Stable derived id: simplified form + separator + numbered pinyin. */
  id: string;
  simplified: string;
  traditional: string;
  /** Space separated syllables with trailing tone digits, e.g. "zhong3 guo2". */
  pinyinNumbered: string;
  /** Same reading with tone marks, e.g. "zhǒng guó". */
  pinyinMarked: string;
  /** Lowercase toneless concatenation, e.g. "zhongguo". */
  pinyinPlain: string;
  /** English glosses joined with "; ". */
  definition: string;
  /** Vietnamese glosses joined with "; " (from CVDICT). */
  definitionVi?: string;
  /** Vietnamese gloss list (from CVDICT). */
  definitionsVi?: string[];
  /** Word-level Sino-Vietnamese reading (from Unihan kVietnamese). */
  hanViet?: string;
  /** Character count of the headword. */
  length: number;
}

export interface CharInfo {
  codepoint: number;
  char: string;
  mandarin: string[];
  cantonese: string;
  definition: string;
  radical: string;
  strokeCount: number | null;
  simplifiedOf: number[];
  traditionalOf: number[];
  hanViet?: string[];
}

export interface StrokeData {
  char: string;
  /** SVG path "d" strings, one per stroke, in writing order. */
  strokes: string[];
  /** Median polylines as [x0,y0,x1,y1,...]; re-pair before handing to Hanzi Writer. */
  medians: number[][];
}

export interface ExampleSentence {
  headword: string;
  simplified: string;
  traditional: string;
  pinyin: string;
  english: string;
  refs: string[];
}

export type ContentBlock =
  | { type: 'text'; body: string }
  | { type: 'list'; title?: string; body: string[] }
  | { type: 'dialogue'; title?: string; body: { speaker: string; zh: string; py: string; en: string }[] }
  | { type: 'note'; body: string };

export interface ContentItem {
  id: string;
  kind: 'tip' | 'lesson' | 'story' | 'article';
  title: string;
  summary: string;
  level: 'beginner' | 'elementary' | 'intermediate';
  license: string;
  attribution: string;
  tags: string[];
  blocks: ContentBlock[];
}

export type SearchMode = 'auto' | 'hans' | 'hant' | 'pinyin' | 'english';

export type MatchKind = 'exact' | 'prefix' | 'contains' | 'definition' | 'fuzzy';

export interface SearchResult {
  entry: DictEntry;
  score: number;
  match: MatchKind;
  /** Which field produced the match, for display. */
  via: 'simplified' | 'traditional' | 'pinyin' | 'definition';
}

export interface SearchQuery {
  text: string;
  mode?: SearchMode;
  limit?: number;
}

export interface SearchResponse {
  query: SearchQuery;
  normalized: string;
  interpretedAs: SearchMode;
  results: SearchResult[];
  tookMs: number;
  /** Dictionary coverage: installed entry count and whether the index is partial. */
  coverage: { entries: number; partial: boolean };
}

/** Reader/OCR text annotation spans. */
export interface TextSpan {
  start: number;
  end: number;
  text: string;
  entries: DictEntry[];
}

/* ---------- user data (IndexedDB) ---------- */

export interface SavedWord {
  /** entry id */
  id: string;
  addedAt: string;
  updatedAt?: string;
  /** list ids this word belongs to */
  lists: string[];
  note?: string;
  /** cached display fields so saved words survive pack changes */
  simplified: string;
  traditional: string;
  pinyinMarked: string;
  definition: string;
  definitionVi?: string;
  hanViet?: string;
}

export interface WordList {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  color?: string;
}

export interface Notebook {
  id: string;
  name: string;
  categoryId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  parentId?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface NotebookEntry {
  id: string;
  notebookId: string;
  title: string;
  body: string;
  /** dictionary entry ids referenced by this note */
  entryIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type SrsRating = 'again' | 'hard' | 'good' | 'easy';

export interface SrsCard {
  /** entry id or lesson card id */
  id: string;
  deckId: string;
  kind?: 'recognition' | 'writing';
  simplified: string;
  traditional: string;
  pinyinMarked: string;
  pinyinNumbered?: string;
  hanViet?: string;
  definition: string;
  definitionVi?: string;
  lessonId?: string;
  /** days since last review, current interval and ease factor */
  interval: number;
  ease: number;
  repetitions: number;
  lapses: number;
  due: string;
  lastReviewed?: string;
  createdAt: string;
  updatedAt?: string;
  suspended?: boolean;
}

export interface Deck {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
  /** direction of the prompt shown first */
  prompt: 'zh2en' | 'en2zh' | 'pinyin2zh';
  newPerDay: number;
}

export interface PracticeAttempt {
  id: string;
  sessionId: string;
  kind: 'flashcard' | 'quiz' | 'test';
  entryId?: string;
  question: string;
  given: string;
  expected: string;
  correct: boolean;
  ms: number;
  at: string;
}

export interface PracticeSession {
  id: string;
  kind: 'flashcard' | 'quiz' | 'test';
  label: string;
  startedAt: string;
  endedAt?: string;
  total: number;
  correct: number;
  deckId?: string;
  testId?: string;
}

export interface MockTest {
  id: string;
  title: string;
  level: 'beginner' | 'elementary' | 'intermediate';
  note: string;
  sections: ('reading' | 'meaning' | 'listening' | 'writing')[];
}

export interface ActivityDay {
  /** local date key, YYYY-MM-DD */
  day: string;
  searches: number;
  entriesSaved: number;
  reviews: number;
  newCards: number;
  correct: number;
  attempts: number;
  characters: number;
  readings: number;
  writingStrokes?: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  /** unlocked when the predicate over ActivityDay[]/stats first holds */
  goal: number;
  metric: 'reviews' | 'entriesSaved' | 'searches' | 'correct' | 'characters' | 'readings' | 'days';
  unlockedAt?: string;
}

export interface ImportedDocument {
  id: string;
  name: string;
  kind: 'text' | 'pdf' | 'ocr';
  addedAt: string;
  bytes: number;
  /** document bytes are only kept when the user explicitly chose to save them */
  stored: boolean;
  pageCount?: number;
}

export interface PhotoWord {
  id: string;
  imageKey?: string;
  createdAt: string;
  recognized: string;
  corrected: string;
  entryIds: string[];
  note?: string;
}

export interface Preferences {
  id: 'preferences';
  theme: 'auto' | 'light' | 'dark';
  contrast: 'normal' | 'high';
  reduceMotion: boolean;
  textScale: number;
  fontStack: 'system' | 'serif-cjk';
  displayScript: 'simplified' | 'traditional' | 'both';
  pinyinStyle: 'marks' | 'numbers' | 'none';
  definitionLanguage: 'en';
  showExamples: boolean;
  showPinyin: boolean;
  ttsRate: number;
  ttsLang: string;
  autoSpeak: boolean;
  dailyGoal: number;
  installedPacks: string[];
}

export const DEFAULT_PREFERENCES: Preferences = {
  id: 'preferences',
  theme: 'auto',
  contrast: 'normal',
  reduceMotion: false,
  textScale: 1,
  fontStack: 'system',
  displayScript: 'both',
  pinyinStyle: 'marks',
  definitionLanguage: 'en',
  showExamples: true,
  showPinyin: true,
  ttsRate: 0.9,
  ttsLang: 'zh-CN',
  autoSpeak: false,
  dailyGoal: 20,
  installedPacks: [],
};

/* ---------- Books, Courses, Audio & Sync (v0.2) ---------- */

export type BookId = 'b1' | 'b2' | 'b3' | 'b4' | 'b5' | 'b6';

export interface BooksManifest {
  schemaVersion: 1;
  generatedAt: string;
  books: BookSummary[];
}

export interface BookSummary {
  bookId: BookId;
  volumeNumber: 1 | 2 | 3 | 4 | 5 | 6;
  titleVi: string;
  titleZh: string;
  pageCount: number;
  lessonNumbers: number[];
  globalLessonRange: [number, number];
  lessons: LessonSummary[];
}

export interface LessonSummary {
  lessonId: string;
  bookId: BookId;
  lessonNumber: number;
  globalLessonNumber: number;
  titleZh: string;
  titlePinyin: string;
  titleVi: string;
  startPage: number;
  endPage: number;
  vocabCount: number;
  sentenceCount: number;
  lessonAudioPath: string;
}

export interface AudioSliceRef {
  audioPath: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

export interface PageHotspot {
  id: string;
  bboxPct: [number, number, number, number];
  kind: 'title' | 'sentence' | 'vocab' | 'note' | 'grammar' | 'exercise' | 'other';
  refId?: string;
  zhText: string;
  pinyin?: string;
  viText?: string;
  audioSlice?: AudioSliceRef;
  ttsAudioPath?: string;
}

export interface LessonPageMap {
  pageNumber: number;
  imagePath: string;
  widthPx: number;
  heightPx: number;
  hotspots: PageHotspot[];
}

export interface LessonVocabItem {
  id: string;
  index: number;
  hanzi: string;
  traditional?: string;
  pos: string;
  pinyin: string;
  pinyinNumbered: string;
  hanViet: string;
  meaningEn: string;
  meaningVi: string;
  pageNumber: number;
  bboxPct?: [number, number, number, number];
  lessonAudioSlice?: AudioSliceRef;
  ttsAudioPath: string;
}

export interface SentenceToken {
  surface: string;
  pinyin: string;
  citationPinyin?: string;
  vocabId?: string;
  dictHeadword?: string;
  ttsAudioPath?: string;
}

export interface LessonSentence {
  id: string;
  speaker?: string;
  zh: string;
  pinyin: string;
  vi?: string;
  en?: string;
  sandhiNotes?: string[];
  pageNumber: number;
  bboxPct?: [number, number, number, number];
  lessonAudioSlice?: AudioSliceRef;
  ttsAudioPath: string;
  tokens: SentenceToken[];
}

export interface LessonDialogueBlock {
  id: string;
  title?: string;
  sentences: LessonSentence[];
}

export interface LessonNoteItem {
  id: string;
  heading: string;
  bodyZh?: string;
  bodyVi: string;
  bodyEn?: string;
  examples: LessonSentence[];
}

export interface LessonGrammarItem {
  id: string;
  heading: string;
  explanationVi: string;
  explanationEn?: string;
  examples: LessonSentence[];
}

export interface LessonPronunciationSection {
  initials?: string[];
  finals?: string[];
  toneDrills?: {
    text: string;
    pinyin: string;
    ttsAudioPath: string;
    lessonAudioSlice?: AudioSliceRef;
  }[];
}

export interface LessonExerciseItem {
  id: string;
  kind: 'substitution' | 'fill_blank' | 'comprehension' | 'correct_sentence' | 'reading_passage';
  promptVi: string;
  items: {
    zh: string;
    pinyin?: string;
    answer?: string;
    ttsAudioPath?: string;
  }[];
}

export interface LessonDocument {
  schemaVersion: 1;
  lessonId: string;
  bookId: BookId;
  lessonNumber: number;
  globalLessonNumber: number;
  titleZh: string;
  titlePinyin: string;
  titleVi: string;
  startPage: number;
  endPage: number;
  lessonAudioPath: string;
  lessonAudioDurationMs: number;
  pages: LessonPageMap[];
  vocabulary: LessonVocabItem[];
  dialogues: LessonDialogueBlock[];
  notes: LessonNoteItem[];
  grammar: LessonGrammarItem[];
  pronunciation?: LessonPronunciationSection;
  exercises: LessonExerciseItem[];
  writingTargets: string[];
}

export interface AudioManifest {
  schemaVersion: 1;
  generatedAt: string;
  defaultVoice?: string;
  voice?: string;
  engine?: string;
  words: Record<
    string,
    {
      path: string;
      durationMs: number;
      voice?: string;
      engine?: string;
    }
  >;
  sentences: Record<
    string,
    {
      path: string;
      durationMs: number;
      voice?: string;
      engine?: string;
    }
  >;
}

export type CourseStepId = 'vocab' | 'dialogue' | 'grammar' | 'drill' | 'writing';

export interface CourseLessonProgress {
  lessonId: string;
  bookId: string;
  completedSteps: CourseStepId[];
  bestDrillScore?: number;
  writingCompletedChars: string[];
  completedAt?: string;
  lastStudiedAt: string;
  updatedAt: string;
}

export interface BookBookmark {
  bookId: string;
  lastPageNumber: number;
  lastLessonId: string;
  viewMode: 'page' | 'text' | 'split';
  updatedAt: string;
}

export interface SyncStateFile {
  schemaVersion: 1;
  updatedAt: string;
  deviceId: string;
  deletedIds: Record<string, string>;
  preferences: Record<string, unknown>;
  savedWords: SavedWord[];
  wordLists: WordList[];
  notebooks: Notebook[];
  categories: Category[];
  notebookEntries: NotebookEntry[];
  decks: Deck[];
  cards: SrsCard[];
  courseProgress: Record<string, CourseLessonProgress>;
  bookBookmarks: Record<string, BookBookmark>;
  dailyActivity: Record<string, ActivityDay>;
}


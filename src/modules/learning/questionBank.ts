/** Question bank for the practice tests.
 *
 *  Everything in here is *generated on this device* from two kinds of material and nothing else:
 *  1. licensed CC-CEDICT dictionary lines reached through `DictionaryApi` (the `dictionary-core`
 *     pack, CC-BY-SA-4.0) plus the learner's own rows that were saved from those lines, and
 *  2. the small reading/writing section written for this app below (`AUTHORED_*` data), which is
 *     original plain prose by this project and is labelled as such in the UI.
 *
 *  No third-party exam paper, test bank, audio recording or answer key is used or imitated, and
 *  no score here means anything official. Distractors are always real entries too, preferring a
 *  word of the same character count and the same pinyin initial, so the wrong options look like
 *  plausible neighbours instead of invented noise.
 *
 *  Determinism: every set is seeded from the spec id plus a fingerprint of the exact words it was
 *  built from (see `seedFor`). The random stream is a fixed integer hash plus a linear
 *  congruential generator, and option order and distractor order are sorted by pre-computed keys,
 *  so re-opening the same test replays the same questions. */

import { pinyinKey } from '../../domain/pinyin';
import { db } from '../../data/db';
import type { DictionaryApi } from '../../data/dictionary';
import type {
  DictEntry,
  MockTest,
  Notebook,
  Preferences,
  SavedWord,
  SearchResult,
  SrsCard,
  WordList,
} from '../../domain/types';
import {
  entryIdOfCard,
  glossList,
  hanziPrimary,
  loadSourceWords,
  pinyinDisplay,
  type LearningWord,
  type SourceRef,
} from './learningStore';

/* ------------------------------------------------------------------ questions */

/** The four parts a practice set can be made of — the same union `MockTest` uses. */
export type QuestionSection = MockTest['sections'][number];

export type QuestionKind =
  /** shown the written word, choose the meaning */
  | 'word-to-gloss'
  /** shown the meaning, choose the written word */
  | 'gloss-to-word'
  /** shown the written word, choose the reading */
  | 'word-to-pinyin'
  /** heard through the device voice, choose the meaning */
  | 'listen-to-meaning'
  /** shown the reading plus the meaning, choose the characters */
  | 'letters-to-word'
  /** a question about one of the passages written for this app */
  | 'passage-comprehension'
  /** choose the character or word that fits a line of this app's own passage */
  | 'passage-writing';

export const SECTION_LABEL: Record<QuestionSection, string> = {
  reading: 'Read a word, choose its meaning',
  meaning: 'Read a meaning, choose the word',
  listening: 'Listen with your device voice',
  writing: 'Characters and readings',
};

export const KIND_LABEL: Record<QuestionKind, string> = {
  'word-to-gloss': 'Word → meaning',
  'gloss-to-word': 'Meaning → word',
  'word-to-pinyin': 'Word → reading',
  'listen-to-meaning': 'Heard word → meaning',
  'letters-to-word': 'Reading + meaning → characters',
  'passage-comprehension': 'Reading comprehension (this app’s own passage)',
  'passage-writing': 'Character choice (this app’s own passage)',
};

export interface QuestionOption {
  label: string;
  /** true when the option is Chinese text and must be drawn in the CJK face */
  cjk: boolean;
}

export interface TestQuestion {
  /** stable for a given seed: retrying a set keeps the same ids, so attempts update in place */
  id: string;
  kind: QuestionKind;
  section: QuestionSection;
  stem: string;
  /** the visible prompt (a word, a reading, or a line of the passage) */
  prompt?: string;
  /** text the device speech synthesiser should read aloud for a hearing item */
  spoken?: string;
  /** the original passage this app wrote, shown above the question (reading section only) */
  passage?: { title: string; lines: AuthoredLine[] };
  options: QuestionOption[];
  /** index into `options` */
  answer: number;
  /** quotes only the licensed gloss/reading data (or, for the authored section, this app's line) */
  explanation: string;
  /** dictionary line the item is about, when there is one — lets the result link to the entry */
  entryId?: string;
  /** which words made this item, for the "generated from" note */
  origin: WordOrigin;
}

export type WordOrigin = 'dictionary' | 'saved' | 'card' | 'list' | 'notebook' | 'authored';

export const ORIGIN_LABEL: Record<WordOrigin, string> = {
  dictionary: 'the dictionary data on this device',
  saved: 'words you saved',
  card: 'cards in your decks',
  list: 'one of your word lists',
  notebook: 'one of your notebooks',
  authored: 'a passage written for this app',
};

/* ------------------------------------------------------------------ pool words */

/** One candidate word. `DictEntry`, `SavedWord`, `SrsCard` and `LearningWord` all carry the four
 *  display fields a question needs, so they collapse into this shape before generation. */
export interface BankWord {
  id: string;
  simplified: string;
  traditional: string;
  pinyinMarked: string;
  definition: string;
  origin: WordOrigin;
}

export interface SourcePool {
  label: string;
  words: LearningWord[];
  /** the learner's own list/notebook, resolved by `loadSourceWords` in learningStore */
  exists: boolean;
  /** note references this device's dictionary data could not resolve */
  missing: number;
  origin: 'list' | 'notebook';
}

export interface OwnPool {
  saved: SavedWord[];
  cards: SrsCard[];
}

export const EMPTY_OWN: OwnPool = { saved: [], cards: [] };

function asWord(entry: DictEntry): BankWord {
  return {
    id: entry.id,
    simplified: entry.simplified,
    traditional: entry.traditional,
    pinyinMarked: entry.pinyinMarked,
    definition: entry.definition,
    origin: 'dictionary',
  };
}

function rowWord(row: { id: string; simplified: string; traditional: string; pinyinMarked: string; definition: string }, origin: WordOrigin): BankWord {
  return {
    id: row.id,
    simplified: row.simplified,
    traditional: row.traditional,
    pinyinMarked: row.pinyinMarked,
    definition: row.definition,
    origin,
  };
}

/** Cards are keyed by `deckId|entryId`, so the entry link uses the real dictionary id. */
function cardWord(card: SrsCard): BankWord {
  return { ...rowWord(card, 'card'), id: entryIdOfCard(card) };
}

export function wordsOf(spec: TestSpec, own: OwnPool, source?: SourcePool): BankWord[] {
  switch (spec.pool) {
    case 'saved':
      return own.saved.map((row) => rowWord(row, 'saved'));
    case 'cards':
      return own.cards.filter((card) => !card.suspended).map(cardWord);
    case 'source':
      return source ? source.words.map((row) => rowWord(row, source.origin)) : [];
    case 'authored':
      return authoredWords();
    case 'dictionary':
      return [];
  }
}

/* ------------------------------------------------------------------ specs and catalog */

export type TestPool = 'saved' | 'cards' | 'source' | 'dictionary' | 'authored';

/** What a set reads before it can show a single question. Rendered honestly on the shelf. */
export interface TestNeed {
  label: string;
  /** pack id from the manifest, when a data pack is required */
  pack?: string;
  /** true when the set reads the learner's own rows rather than the dictionary */
  own?: boolean;
  /** a device voice is used but not required: those items fall back to the written word */
  optional?: boolean;
}

/** A dictionary line used as the spine of a generated item. */
export interface ProbeKey {
  text: string;
  mode: 'english' | 'hans';
}

export interface TestSpec extends MockTest {
  pool: TestPool;
  /** question count when there is enough real data for it */
  planned: number;
  /** smallest pool that can still produce four distinct options */
  minPool: number;
  needs: TestNeed[];
  /** keys searched in the licensed index; dictionary sets only */
  keys?: ProbeKey[];
  /** the hearing set uses the device voice for part of its items */
  voice?: boolean;
}

const DICTIONARY_NEED: TestNeed = {
  label: 'the dictionary data pack (CC-CEDICT words, CC-BY-SA-4.0)',
  pack: 'dictionary-core',
};

const VOICE_NEED: TestNeed = {
  label: 'a Chinese voice on this device, for the hearing items only — optional',
  optional: true,
};

function englishKeys(texts: string[]): ProbeKey[] {
  return texts.map((text) => ({ text, mode: 'english' }));
}

export const TEST_CATALOG: TestSpec[] = [
  {
    id: 'saved-20',
    title: '20 questions from your saved words',
    level: 'beginner',
    note: 'Every item is built from the words you starred on this device, with your other saved words as the wrong options.',
    sections: ['reading', 'meaning', 'writing'],
    pool: 'saved',
    planned: 20,
    minPool: 6,
    needs: [{ label: 'at least 6 saved words (one question per word, up to 20)', own: true }],
  },
  {
    id: 'cards-12',
    title: '12 questions from the cards you study',
    level: 'elementary',
    note: 'Uses the cards already in your decks, so the words you have lapsed on come back first.',
    sections: ['meaning', 'reading', 'writing'],
    pool: 'cards',
    planned: 12,
    minPool: 6,
    needs: [{ label: 'at least 6 cards in a deck on this device', own: true }],
  },
  {
    id: 'beginner-style',
    title: 'Beginner style set: everyday words',
    level: 'beginner',
    note: 'Common everyday words looked up in the licensed dictionary data installed here. A practice set in the style of a first-course test — not an official exam and no official level.',
    sections: ['reading', 'meaning', 'writing'],
    planned: 16,
    minPool: 8,
    pool: 'dictionary',
    keys: englishKeys([
      'I, me', 'you', 'he', 'she', 'to drink', 'water', 'to eat', 'rice', 'teacher', 'school',
      'today', 'tomorrow', 'friend', 'good', 'very', 'big', 'small', 'book', 'house', 'money',
    ]),
    needs: [DICTIONARY_NEED],
  },
  {
    id: 'reading-pinyin',
    title: 'Readings: pick the pinyin',
    level: 'elementary',
    note: 'Words from the dictionary data with the tone-marked reading as the answer; the wrong readings are real readings of real words too.',
    sections: ['reading', 'meaning', 'writing'],
    planned: 12,
    minPool: 8,
    pool: 'dictionary',
    keys: englishKeys([
      'Chinese', 'country', 'to speak', 'language', 'to study', 'to work', 'morning', 'evening',
      'weather', 'rain', 'to travel', 'train', 'hospital', 'doctor', 'telephone', 'coffee',
    ]),
    needs: [DICTIONARY_NEED],
  },
  {
    id: 'listening-ear',
    title: 'Hearing set: synthetic voice',
    level: 'beginner',
    note: 'Short words read aloud by your own device speech synthesiser. This is machine-generated audio, not a human recording, and it is never played automatically.',
    sections: ['listening', 'meaning'],
    planned: 10,
    minPool: 6,
    pool: 'dictionary',
    voice: true,
    keys: englishKeys([
      'you', 'he', 'she', 'we', 'thank you', 'sorry', 'goodbye', 'where', 'how many', 'to read',
      'to write', 'slow', 'fast', 'expensive', 'before', 'to arrive',
    ]),
    needs: [DICTIONARY_NEED, VOICE_NEED],
  },
  {
    id: 'reading-writing-section',
    title: 'Reading passage and character section',
    level: 'elementary',
    note: 'Two short passages written for this app, with comprehension and character-choice items. The prose is original to this project; the characters it asks about are checked against the dictionary data when it is installed.',
    sections: ['reading', 'writing'],
    planned: 10,
    minPool: 4,
    pool: 'authored',
    needs: [
      { label: 'nothing to download: the passages ship inside this app' },
      DICTIONARY_NEED,
    ],
  },
];

export function specById(id: string): TestSpec | undefined {
  return TEST_CATALOG.find((spec) => spec.id === id);
}

export type TestRoute =
  | { kind: 'catalog'; id: string }
  | { kind: 'list'; id: string }
  | { kind: 'notebook'; id: string }
  | { kind: 'unknown'; id: string };

/** `/test/:id` carries either a catalog id or a `list-<id>` / `notebook-<id>` pair, because the
 *  route table only allows one path segment. */
export function parseTestId(raw: string): TestRoute {
  const id = decodeURIComponent(raw);
  if (id.startsWith('list-')) return { kind: 'list', id: id.slice('list-'.length) };
  if (id.startsWith('notebook-')) return { kind: 'notebook', id: id.slice('notebook-'.length) };
  if (specById(id)) return { kind: 'catalog', id };
  return { kind: 'unknown', id };
}

export function listTestId(listId: string): string {
  return `list-${listId}`;
}

export function notebookTestId(notebookId: string): string {
  return `notebook-${notebookId}`;
}

export function specForList(list: WordList, wordCount: number): TestSpec {
  return {
    id: listTestId(list.id),
    title: `Test from your list “${list.name}”`,
    level: 'beginner',
    note: `Built from the ${wordCount} dictionary word${wordCount === 1 ? '' : 's'} in this list. Questions, options and explanations come from the licensed data on this device.`,
    sections: ['reading', 'meaning', 'writing'],
    pool: 'source',
    planned: Math.min(20, Math.max(4, wordCount)),
    minPool: 4,
    needs: [{ label: `at least 4 saved words in this list (it has ${wordCount})`, own: true }],
  };
}

export function specForNotebook(notebook: Notebook, wordCount: number): TestSpec {
  return {
    id: notebookTestId(notebook.id),
    title: `Test from your notebook “${notebook.name}”`,
    level: 'beginner',
    note: `Built from the ${wordCount} dictionary word${wordCount === 1 ? '' : 's'} your notes in this notebook refer to.`,
    sections: ['meaning', 'reading', 'writing'],
    pool: 'source',
    planned: Math.min(20, Math.max(4, wordCount)),
    minPool: 4,
    needs: [{ label: `at least 4 dictionary words referenced by your notes (found ${wordCount})`, own: true }],
  };
}

/* ------------------------------------------------------------------ seeded random */

function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash ^ text.charCodeAt(index)) >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** A tiny linear congruential stream: same seed, same numbers, on every engine. */
function randomFrom(seed: string): () => number {
  let state = hash32(seed) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Order by a pre-computed random key so the result never depends on sort stability. */
function reseeded<T>(items: T[], rnd: () => number): T[] {
  return items
    .map((item) => ({ item, key: rnd() }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((entry) => entry.item);
}

/** The fingerprint a set is seeded from: the spec id plus exactly the words it was built from. */
export function seedFor(specId: string, words: readonly BankWord[]): string {
  return `${specId}|${words
    .map((word) => word.id)
    .slice()
    .sort()
    .join(',')}`;
}

function shortId(seedPart: string): string {
  return hash32(seedPart).toString(36);
}

/* ------------------------------------------------------------------ text helpers */

function charCount(text: string): number {
  return [...text].length;
}

function firstGloss(definition: string): string {
  const gloss = glossList(definition)[0] ?? definition;
  return gloss.length > 62 ? `${gloss.slice(0, 59).trimEnd()}…` : gloss;
}

function quote(definition: string): string {
  const flat = definition.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 137).trimEnd()}…` : flat;
}

function pinyinFor(word: BankWord, prefs: Preferences): string {
  // A reading is the point of these items, so the "hide pinyin" preference is ignored: it would
  // make the question impossible to answer rather than merely quieter.
  return pinyinDisplay(word, prefs.pinyinStyle === 'none' ? 'marks' : prefs.pinyinStyle);
}

function shown(word: BankWord, prefs: Preferences): string {
  return hanziPrimary(word, prefs.displayScript) || word.simplified;
}

function pinyinInitial(word: BankWord): string {
  const key = pinyinKey(word.pinyinMarked);
  return key ? key.slice(0, 1) : '';
}

function syllableCount(word: BankWord): number {
  return word.pinyinMarked.trim().split(/\s+/).filter(Boolean).length;
}

function licensedNote(word: BankWord): string {
  const where = ORIGIN_LABEL[word.origin];
  return `The line “${word.simplified}${word.traditional && word.traditional !== word.simplified ? ` / ${word.traditional}` : ''}” in ${where} is read ${word.pinyinMarked || '—'} and glossed “${quote(word.definition)}”. That is the licensed dictionary text for it; the full entry may carry more senses.`;
}

/* ------------------------------------------------------------------ option assembly */

interface Assembled {
  options: QuestionOption[];
  answer: number;
}

const OPTION_COUNT = 4;

function assemble(
  correct: QuestionOption,
  candidates: QuestionOption[],
  rnd: () => number,
): Assembled | null {
  const seen = new Set<string>([correct.label]);
  const others: QuestionOption[] = [];
  for (const option of candidates) {
    const label = option.label.trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    others.push({ label, cjk: option.cjk });
    if (others.length === OPTION_COUNT - 1) break;
  }
  if (others.length < OPTION_COUNT - 1) return null;
  const options = reseeded([correct, ...others], rnd);
  return { options, answer: options.findIndex((option) => option.label === correct.label) };
}

interface DistractorRules {
  /** a candidate may not be offered if it would be an equally correct answer */
  reject: (candidate: BankWord, target: BankWord) => boolean;
  /** higher scores first: same length, then same pinyin initial, then anything */
  prefer: (candidate: BankWord, target: BankWord) => number;
}

const RULES: Record<QuestionKind, DistractorRules> = {
  'word-to-gloss': {
    reject: (candidate, target) => candidate.id === target.id || firstGloss(candidate.definition) === firstGloss(target.definition),
    prefer: (candidate, target) => (pinyinInitial(candidate) === pinyinInitial(target) ? 2 : 0) + (candidate.definition.length > 24 ? 1 : 0),
  },
  'gloss-to-word': {
    reject: (candidate, target) => candidate.id === target.id || candidate.simplified === target.simplified,
    prefer: (candidate, target) => (charCount(candidate.simplified) === charCount(target.simplified) ? 3 : 0) + (pinyinInitial(candidate) === pinyinInitial(target) ? 2 : 0),
  },
  'word-to-pinyin': {
    reject: (candidate, target) => candidate.id === target.id || pinyinKey(candidate.pinyinMarked) === pinyinKey(target.pinyinMarked),
    prefer: (candidate, target) => (syllableCount(candidate) === syllableCount(target) ? 3 : 0) + (pinyinInitial(candidate) === pinyinInitial(target) ? 2 : 0),
  },
  'listen-to-meaning': {
    reject: (candidate, target) => candidate.id === target.id || firstGloss(candidate.definition) === firstGloss(target.definition),
    prefer: (candidate, target) => (charCount(candidate.simplified) === charCount(target.simplified) ? 2 : 0) + (syllableCount(candidate) === syllableCount(target) ? 2 : 0),
  },
  'letters-to-word': {
    reject: (candidate, target) =>
      candidate.id === target.id ||
      candidate.simplified === target.simplified ||
      pinyinKey(candidate.pinyinMarked) === pinyinKey(target.pinyinMarked) ||
      firstGloss(candidate.definition) === firstGloss(target.definition),
    prefer: (candidate, target) => (charCount(candidate.simplified) === charCount(target.simplified) ? 3 : 0) + (pinyinInitial(candidate) === pinyinInitial(target) ? 2 : 0),
  },
  'passage-comprehension': { reject: () => false, prefer: () => 0 },
  'passage-writing': {
    reject: (candidate, target) => candidate.simplified === target.simplified,
    prefer: (candidate, target) => (charCount(candidate.simplified) === charCount(target.simplified) ? 3 : 0),
  },
};

/** Real entries only, closest neighbours first, seeded tie-break so the set replays. */
function chooseDistractors(
  kind: QuestionKind,
  target: BankWord,
  pool: BankWord[],
  rnd: () => number,
): BankWord[] {
  const rules = RULES[kind];
  const scored: { word: BankWord; score: number; key: number }[] = [];
  for (const candidate of pool) {
    if (rules.reject(candidate, target)) continue;
    scored.push({ word: candidate, score: rules.prefer(candidate, target), key: rnd() });
  }
  scored.sort((a, b) =>
    b.score - a.score ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : a.word.id < b.word.id ? -1 : 1),
  );
  return scored.slice(0, OPTION_COUNT - 1).map((entry) => entry.word);
}

/* ------------------------------------------------------------------ item builders */

export interface BuildContext {
  api: DictionaryApi | null;
  prefs: Preferences;
  own: OwnPool;
  /** present for a `list-…` / `notebook-…` test */
  source?: SourcePool;
  /** resolved once per build: does this device have a Chinese voice at all? */
  hasVoice?: boolean;
}

type Builder = (
  target: BankWord,
  pool: BankWord[],
  context: BuildContext,
  rnd: () => number,
  index: number,
  specId: string,
) => TestQuestion | null;

function makeId(specId: string, index: number, target: BankWord): string {
  return `q${index}-${shortId(`${specId}|${index}|${target.id}`)}`;
}

const WORD_TO_GLOSS: Builder = (target, pool, context, rnd, index, specId) => {
  const correct: QuestionOption = { label: firstGloss(target.definition), cjk: false };
  const distractors = chooseDistractors('word-to-gloss', target, pool, rnd).map((word) => ({
    label: firstGloss(word.definition),
    cjk: false,
  }));
  const built = assemble(correct, distractors, rnd);
  if (!built) return null;
  const word = shown(target, context.prefs);
  return {
    id: makeId(specId, index, target),
    kind: 'word-to-gloss',
    section: 'reading',
    stem: `What does “${word}” mean?`,
    prompt: word,
    options: built.options,
    answer: built.answer,
    explanation: licensedNote(target),
    entryId: target.id,
    origin: target.origin,
  };
};

const GLOSS_TO_WORD: Builder = (target, pool, context, rnd, index, specId) => {
  const correct: QuestionOption = { label: shown(target, context.prefs), cjk: true };
  const distractors = chooseDistractors('gloss-to-word', target, pool, rnd).map((word) => ({
    label: shown(word, context.prefs),
    cjk: true,
  }));
  const built = assemble(correct, distractors, rnd);
  if (!built) return null;
  return {
    id: makeId(specId, index, target),
    kind: 'gloss-to-word',
    section: 'meaning',
    stem: `Which of these means “${firstGloss(target.definition)}”?`,
    options: built.options,
    answer: built.answer,
    explanation: licensedNote(target),
    entryId: target.id,
    origin: target.origin,
  };
};

const WORD_TO_PINYIN: Builder = (target, pool, context, rnd, index, specId) => {
  const answer = pinyinFor(target, context.prefs);
  if (!answer) return null;
  const correct: QuestionOption = { label: answer, cjk: false };
  const distractors = chooseDistractors('word-to-pinyin', target, pool, rnd).map((word) => ({
    label: pinyinFor(word, context.prefs),
    cjk: false,
  }));
  const built = assemble(correct, distractors, rnd);
  if (!built) return null;
  return {
    id: makeId(specId, index, target),
    kind: 'word-to-pinyin',
    section: 'writing',
    stem: `Which reading is correct for “${shown(target, context.prefs)}”?`,
    prompt: shown(target, context.prefs),
    options: built.options,
    answer: built.answer,
    explanation: `${licensedNote(target)} Tones are part of the reading.`,
    entryId: target.id,
    origin: target.origin,
  };
};

/** A hearing item. When the device has no Chinese voice the same item is asked from the written
 *  word instead, and the screen says so — the audio is never faked. */
const LISTEN_TO_MEANING: Builder = (target, pool, context, rnd, index, specId) => {
  const correct: QuestionOption = { label: firstGloss(target.definition), cjk: false };
  const distractors = chooseDistractors('listen-to-meaning', target, pool, rnd).map((word) => ({
    label: firstGloss(word.definition),
    cjk: false,
  }));
  const built = assemble(correct, distractors, rnd);
  if (!built) return null;
  const heard = context.hasVoice === false;
  return {
    id: makeId(specId, index, target),
    kind: 'listen-to-meaning',
    section: 'listening',
    stem: heard
      ? `No Chinese voice is installed on this device, so the written word is shown instead of read aloud: what does “${shown(target, context.prefs)}” mean?`
      : 'Play the recording, then choose its meaning. The voice is your device’s own speech synthesiser.',
    prompt: heard ? shown(target, context.prefs) : undefined,
    spoken: target.simplified,
    options: built.options,
    answer: built.answer,
    explanation: `The synthetic voice read “${shown(target, context.prefs)}”. ${licensedNote(target)}`,
    entryId: target.id,
    origin: target.origin,
  };
};

const LETTERS_TO_WORD: Builder = (target, pool, context, rnd, index, specId) => {
  const reading = pinyinFor(target, context.prefs);
  if (!reading) return null;
  const correct: QuestionOption = { label: shown(target, context.prefs), cjk: true };
  const distractors = chooseDistractors('letters-to-word', target, pool, rnd).map((word) => ({
    label: shown(word, context.prefs),
    cjk: true,
  }));
  const built = assemble(correct, distractors, rnd);
  if (!built) return null;
  return {
    id: makeId(specId, index, target),
    kind: 'letters-to-word',
    section: 'writing',
    stem: `Which of these is read ${reading} and means “${firstGloss(target.definition)}”?`,
    options: built.options,
    answer: built.answer,
    explanation: licensedNote(target),
    entryId: target.id,
    origin: target.origin,
  };
};

const KINDS_BY_SECTION: Record<QuestionSection, QuestionKind[]> = {
  reading: ['word-to-gloss', 'letters-to-word'],
  meaning: ['gloss-to-word', 'word-to-gloss'],
  listening: ['listen-to-meaning', 'word-to-gloss'],
  writing: ['word-to-pinyin', 'letters-to-word'],
};

const BUILDERS: Record<QuestionKind, Builder> = {
  'word-to-gloss': WORD_TO_GLOSS,
  'gloss-to-word': GLOSS_TO_WORD,
  'word-to-pinyin': WORD_TO_PINYIN,
  'listen-to-meaning': LISTEN_TO_MEANING,
  'letters-to-word': LETTERS_TO_WORD,
  'passage-comprehension': () => null,
  'passage-writing': () => null,
};

function kindFor(spec: TestSpec, cursor: number): QuestionKind {
  const section = spec.sections[cursor % spec.sections.length] ?? 'reading';
  const kinds = KINDS_BY_SECTION[section];
  return kinds[Math.floor(cursor / spec.sections.length) % kinds.length] ?? kinds[0];
}

/* ------------------------------------------------------------------ authored section */

interface AuthoredLine {
  /** original prose written for this app, not transcribed from any course or exam */
  zh: string;
  pinyin: string;
  en: string;
}

interface AuthoredPassage {
  id: string;
  title: string;
  lines: AuthoredLine[];
  questions: {
    stem: string;
    options: string[];
    answer: number;
    explanation: string;
    /** which line of the passage the answer rests on, so the explanation can quote it */
    evidence: number;
  }[];
}

interface AuthoredItem {
  id: string;
  /** a plain everyday word this app's own passage uses */
  word: string;
  meaning: string;
  pinyin: string;
  /** other real words of the same length, offered as the wrong choices */
  others: string[];
  line: string;
}

export const AUTHORED_PASSAGES: AuthoredPassage[] = [
  {
    id: 'saturday-library',
    title: 'Saturday at the library',
    lines: [
      {
        zh: '今天星期六，图书馆里很安静。',
        pinyin: 'jīn tiān xīng qī liù, tú shū guǎn lǐ hěn ān jìng.',
        en: 'Today is Saturday and the library is very quiet.',
      },
      {
        zh: '她在找一本关于天气的书。',
        pinyin: 'tā zài zhǎo yì běn guān yú tiān qì de shū.',
        en: 'She is looking for a book about the weather.',
      },
      {
        zh: '工作人员说：“那样的书在二楼。”',
        pinyin: 'gōng zuò rén yuán shuō: “nàyàng de shū zài èr lóu.”',
        en: 'The staff member says: “Books like that are on the second floor.”',
      },
      {
        zh: '她在窗边读了两个小时才回家。',
        pinyin: 'tā zài chuāng biān dú le liǎng gè xiǎo shí cái huí jiā.',
        en: 'She read by the window for two hours before going home.',
      },
    ],
    questions: [
      {
        stem: 'Where is she on Saturday?',
        options: ['In a library', 'On a train', 'At her office', 'In a restaurant'],
        answer: 0,
        explanation: 'This set’s own passage opens with the library being quiet, and later mentions the second floor.',
        evidence: 0,
      },
      {
        stem: 'What is she looking for?',
        options: ['A book about the weather', 'A bus ticket', 'A coffee shop', 'A new phone'],
        answer: 0,
        explanation: 'The passage says she is looking for a book about the weather.',
        evidence: 1,
      },
      {
        stem: 'How long does she read before going home?',
        options: ['Two hours', 'Ten minutes', 'All day', 'Half an hour'],
        answer: 0,
        explanation: 'The last line of the passage says she read for two hours.',
        evidence: 3,
      },
    ],
  },
  {
    id: 'rain-and-bus',
    title: 'The rain and the last bus',
    lines: [
      {
        zh: '下午三点开始下雨了。',
        pinyin: 'xià wǔ sān diǎn kāi shǐ xià yǔ le.',
        en: 'It started to rain at three in the afternoon.',
      },
      {
        zh: '他忘了带伞，只能站在门口等。',
        pinyin: 'tā wàng le dài sǎn, zhǐ néng zhàn zài mén kǒu děng.',
        en: 'He forgot to bring an umbrella, so he could only stand at the door and wait.',
      },
      {
        zh: '朋友的电话来了：“我在路口，快上车。”',
        pinyin: 'péng you de diàn huà lái le: “wǒ zài lù kǒu, kuài shàng chē.”',
        en: 'His friend calls: “I am at the crossing, get in quickly.”',
      },
      {
        zh: '他们到家的时候雨已经停了。',
        pinyin: 'tā men dào jiā de shí hou yǐ jīng tíng le.',
        en: 'By the time they got home the rain had stopped.',
      },
    ],
    questions: [
      {
        stem: 'Why does he wait at the door?',
        options: ['He has no umbrella', 'The bus is full', 'He is waiting for a teacher', 'The door is locked'],
        answer: 0,
        explanation: 'The passage says he forgot to bring an umbrella and could only wait.',
        evidence: 1,
      },
      {
        stem: 'What had happened when they got home?',
        options: ['The rain had stopped', 'The lights went out', 'It began to snow', 'The bus left'],
        answer: 0,
        explanation: 'The closing line says the rain had already stopped by the time they arrived.',
        evidence: 3,
      },
    ],
  },
];

/** Character-choice items for the same section. The words below are ordinary high-frequency words,
 *  and each one is checked against the installed dictionary data before the item is used. */
export const AUTHORED_WRITING: AuthoredItem[] = [
  { id: 'write', word: '写', meaning: 'to write', pinyin: 'xiě', others: ['读', '听', '说'], line: '她每天写信给家里的人。' },
  { id: 'rain', word: '雨', meaning: 'rain', pinyin: 'yǔ', others: ['雪', '风', '云'], line: '下午的雨下了半个小时。' },
  { id: 'friend', word: '朋友', meaning: 'friend', pinyin: 'péng you', others: ['老师', '同学', '家人'], line: '朋友在路口等他。' },
  { id: 'home', word: '家', meaning: 'home; family', pinyin: 'jiā', others: ['学校', '医院', '商店'], line: '他们到家的时候雨停了。' },
  { id: 'read', word: '读', meaning: 'to read', pinyin: 'dú', others: ['买', '借', '看'], line: '她在窗边读了两个小时。' },
];

function authoredWords(): BankWord[] {
  // The authored pool is only used to describe the set honestly; the items below carry their own
  // options, so no dictionary line is invented here.
  return AUTHORED_WRITING.map((item) => ({
    id: `authored-${item.id}`,
    simplified: item.word,
    traditional: item.word,
    pinyinMarked: item.pinyin,
    definition: item.meaning,
    origin: 'authored' as const,
  }));
}

/** Comprehension items for the section this app wrote. The options are shuffled deterministically,
 *  so the correct answer does not sit in the same place every time. */
function authoredComprehension(
  passage: AuthoredPassage,
  startIndex: number,
  specId: string,
  rnd: () => number,
): TestQuestion[] {
  const questions: TestQuestion[] = [];
  passage.questions.forEach((question, position) => {
    const wanted = question.options[question.answer];
    const options = reseeded(
      question.options.map((label) => ({ label, cjk: false })),
      rnd,
    );
    const answer = wanted ? options.findIndex((option) => option.label === wanted) : -1;
    if (!wanted || answer === -1) return;
    const line = passage.lines[question.evidence] ?? passage.lines[0];
    questions.push({
      id: `q${startIndex + position}-${shortId(`${specId}|passage|${passage.id}|${position}`)}`,
      kind: 'passage-comprehension',
      section: 'reading',
      stem: question.stem,
      prompt: passage.title,
      passage: { title: passage.title, lines: passage.lines },
      options,
      answer,
      explanation:
        `${question.explanation} The line this app wrote for the passage reads “${line.zh}” ` +
        `(${line.pinyin}) — “${line.en}”. The passage is original to this app and is not taken from ` +
        'any course, textbook or exam paper.',
      origin: 'authored',
    });
  });
  return questions;
}

/** One character-choice item. When the dictionary data is installed the licensed line for the word
 *  is quoted in the explanation; without it, only this app's own sentence backs the item up. */
function authoredWriting(
  item: AuthoredItem,
  licensed: DictEntry | null,
  index: number,
  specId: string,
  rnd: () => number,
): TestQuestion | null {
  const options = reseeded(
    [item.word, ...item.others].map((label) => ({ label, cjk: true })),
    rnd,
  );
  const answer = options.findIndex((option) => option.label === item.word);
  if (answer === -1) return null;
  return {
    id: `q${index}-${shortId(`${specId}|writing|${item.id}`)}`,
    kind: 'passage-writing',
    section: 'writing',
    stem: `Which of these means “${item.meaning}” in this app’s own passage?`,
    prompt: item.line,
    options,
    answer,
    explanation: licensed
      ? `This set’s passage uses “${licensed.simplified}${licensed.traditional && licensed.traditional !== licensed.simplified ? ` / ${licensed.traditional}` : ''}”, read ${licensed.pinyinMarked}, and the licensed line is glossed “${quote(licensed.definition)}”.`
      : `This set’s passage uses “${item.word}”, read ${item.pinyin}, for “${item.meaning}”. The dictionary data is not installed on this device, so only this app’s own sentence (“${item.line}”) supports the item.`,
    entryId: licensed?.id,
    origin: 'authored',
  };
}

/* ------------------------------------------------------------------ dictionary pool */

function pickResult(key: ProbeKey, results: SearchResult[]): SearchResult | undefined {
  if (key.mode === 'hans') {
    return (
      results.find((result) => result.entry.simplified === key.text) ??
      results.find((result) => result.entry.traditional === key.text) ??
      results[0]
    );
  }
  const needle = key.text.toLowerCase();
  return (
    results.find((result) => result.entry.definition.toLowerCase().includes(needle)) ?? results[0]
  );
}

/** Real lines reached through the search API. A key that finds nothing is reported, never
 *  papered over with an invented word. */
async function collectDictionaryPool(
  api: DictionaryApi,
  spec: TestSpec,
  rnd: () => number,
): Promise<{ words: BankWord[]; missed: number }> {
  const words: BankWord[] = [];
  const spare: BankWord[] = [];
  const ids = new Set<string>();
  let missed = 0;
  for (const key of spec.keys ?? []) {
    let results: SearchResult[] = [];
    try {
      results = (await api.search(key.text, { mode: key.mode, limit: 5 })).results;
    } catch (error) {
      console.error('Dictionary lookup failed while building a practice test', key.text, error);
      missed += 1;
      continue;
    }
    const chosen = pickResult(key, results);
    if (!chosen) {
      missed += 1;
      continue;
    }
    if (!ids.has(chosen.entry.id)) {
      ids.add(chosen.entry.id);
      words.push(asWord(chosen.entry));
    }
    for (const extra of results.slice(1, 4)) {
      if (!ids.has(extra.entry.id)) {
        ids.add(extra.entry.id);
        spare.push(asWord(extra.entry));
      }
    }
  }
  return { words: [...words, ...reseeded(spare, rnd).slice(0, 12)], missed };
}

/* ------------------------------------------------------------------ build */

export interface GeneratedTest {
  spec: TestSpec;
  questions: TestQuestion[];
  /** candidate words or keys that produced no usable item on this device */
  skipped: number;
  /** set when the data a generated set needs is not installed here */
  blocked?: 'dictionary';
  /** what the words of this set actually came from */
  words: BankWord[];
  seed: string;
}

export async function buildTest(spec: TestSpec, context: BuildContext): Promise<GeneratedTest> {
  if (spec.pool === 'authored') return buildAuthoredTest(spec, context);
  if (!context.api) {
    return {
      spec,
      questions: [],
      skipped: spec.planned,
      blocked: 'dictionary',
      words: [],
      seed: seedFor(spec.id, []),
    };
  }

  let pool = wordsOf(spec, context.own, context.source);
  let skipped = 0;
  if (spec.pool === 'dictionary') {
    const collected = await collectDictionaryPool(context.api, spec, randomFrom(`${spec.id}|pool`));
    pool = collected.words;
    skipped += collected.missed;
  }

  const seed = seedFor(spec.id, pool);
  const rnd = randomFrom(seed);
  const questions: TestQuestion[] = [];
  const used = new Set<string>();

  for (const target of reseeded(pool, rnd)) {
    if (questions.length >= spec.planned) break;
    if (used.has(target.id)) continue;
    const kind = kindFor(spec, questions.length);
    const builder = BUILDERS[kind];
    const question = builder(target, pool, context, rnd, questions.length, spec.id);
    if (question) {
      used.add(target.id);
      questions.push(question);
    } else {
      skipped += 1;
    }
  }

  return { spec, questions, skipped, words: pool, seed };
}

async function buildAuthoredTest(spec: TestSpec, context: BuildContext): Promise<GeneratedTest> {
  const seed = `${spec.id}|authored|${AUTHORED_PASSAGES.length}|${AUTHORED_WRITING.length}`;
  const rnd = randomFrom(seed);
  const questions: TestQuestion[] = [];
  let skipped = 0;

  for (const passage of AUTHORED_PASSAGES) {
    const items = authoredComprehension(passage, questions.length, spec.id, rnd);
    if (items.length === 0) skipped += 1;
    questions.push(...items);
  }

  for (const item of AUTHORED_WRITING) {
    // Only ask about a word the app can actually show data for: with the dictionary installed the
    // headword must resolve, otherwise this device cannot back the item up.
    let licensed: DictEntry | null = null;
    if (context.api) {
      try {
        const found = await context.api.headword(item.word);
        licensed = found[0] ?? null;
      } catch (error) {
        console.error('Dictionary lookup failed while building the reading section', item.word, error);
      }
      if (!licensed) {
        skipped += 1;
        continue;
      }
    }
    const question = authoredWriting(item, licensed, questions.length, spec.id, rnd);
    if (question) questions.push(question);
    else skipped += 1;
  }

  return {
    spec,
    questions: questions.slice(0, spec.planned),
    skipped,
    words: authoredWords(),
    seed,
  };
}

/* ------------------------------------------------------------------ shelf helpers */

export interface PoolCounts {
  saved: number;
  cards: number;
  /** words available from the learner's chosen list or notebook */
  source: number;
}

/** How many questions the set can honestly offer before it is even generated. */
export function plannedCount(spec: TestSpec, counts: PoolCounts): number {
  switch (spec.pool) {
    case 'saved':
      return Math.min(spec.planned, counts.saved);
    case 'cards':
      return Math.min(spec.planned, counts.cards);
    case 'source':
      return Math.min(spec.planned, counts.source);
    case 'authored':
      return AUTHORED_PASSAGES.reduce((sum, passage) => sum + passage.questions.length, 0) +
        AUTHORED_WRITING.length;
    case 'dictionary':
      return spec.planned;
  }
}

/** The reason a set cannot be started yet, in the learner's own numbers, or null when it can. */
export function shortfall(spec: TestSpec, counts: PoolCounts): string | null {
  const available = plannedCount(spec, counts);
  if (spec.pool === 'dictionary' || spec.pool === 'authored') return null;
  if (available >= Math.min(spec.minPool, spec.planned)) return null;
  const have =
    spec.pool === 'saved'
      ? `you have ${counts.saved} saved word${counts.saved === 1 ? '' : 's'}`
      : spec.pool === 'cards'
        ? `you have ${counts.cards} card${counts.cards === 1 ? '' : 's'} in your decks`
        : `this source has ${counts.source} resolvable dictionary word${counts.source === 1 ? '' : 's'}`;
  return `A multiple-choice item needs four different real words to choose between, so this set needs at least ${spec.minPool}. Right now ${have}.`;
}

export function sectionsBuilt(questions: TestQuestion[]): QuestionSection[] {
  const seen: QuestionSection[] = [];
  for (const question of questions) {
    if (!seen.includes(question.section)) seen.push(question.section);
  }
  return seen;
}

export function levelLabel(level: MockTest['level']): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}

/** A rough, honest duration: most people answer one of these in well under a minute. */
export function minutesFor(questions: number): number {
  return Math.max(1, Math.round(questions * 0.75));
}

/** Where the words of a set come from, in one sentence, for the shelf badge. */
export function poolLabel(pool: TestPool): string {
  switch (pool) {
    case 'saved':
      return 'from the words you saved';
    case 'cards':
      return 'from the cards you study';
    case 'source':
      return 'from one of your lists or notebooks';
    case 'dictionary':
      return 'generated from the dictionary data here';
    case 'authored':
      return 'passages written for this app';
  }
}

/* ------------------------------------------------------------------ pools read from this device */

/** The learner's own rows: saved words and every card on the device. */
export async function loadOwnPool(): Promise<OwnPool> {
  const [saved, cards] = await Promise.all([db.savedWords.toArray(), db.cards.toArray()]);
  return { saved, cards };
}

/** One list or notebook resolved into words. Notebook entries are dictionary ids, so a note whose
 *  line is no longer installed is counted as missing instead of being replaced by an invented word. */
export async function loadSourcePool(
  src: SourceRef,
  api: DictionaryApi | null,
): Promise<SourcePool> {
  const found = await loadSourceWords(src, async (entryId) => {
    if (!api) return undefined;
    try {
      return await api.entry(entryId);
    } catch (error) {
      console.error('Dictionary lookup failed while resolving a note reference', entryId, error);
      return undefined;
    }
  });
  return {
    label: found.label,
    words: found.words,
    exists: found.exists,
    missing: found.missing,
    origin: src.kind === 'notebook' ? 'notebook' : 'list',
  };
}


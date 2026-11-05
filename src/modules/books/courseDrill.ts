/** Step 4 of the five-step course: the twelve auto-generated recognition questions.
 *
 *  Everything here is derived at runtime from the lesson JSON — no question text is shipped in the
 *  public bundle. The generator is seeded so a lesson always produces the same twelve questions,
 *  which keeps the drill reproducible and testable. A kind is skipped rather than padded when the
 *  lesson cannot supply four distinct options for it. */

import { numberedToMarks, toneFromMarks } from '../../domain/pinyin';
import type { AudioSliceRef, LessonDocument, LessonVocabItem } from '../../domain/types';

export type DrillKind = 'audio2zh' | 'zh2vi' | 'pinyin' | 'cloze';

export interface DrillAudioPrompt {
  hanzi: string;
  pinyinNumbered: string;
  ttsAudioPath?: string;
  lessonAudioSlice?: AudioSliceRef;
}

export interface DrillQuestion {
  id: string;
  kind: DrillKind;
  /** Vietnamese instruction shown above the question. */
  labelVi: string;
  /** What the learner sees; empty for the listening questions, which are audio-only. */
  stem: string;
  /** Present when the question is answered by ear. */
  audio?: DrillAudioPrompt;
  options: string[];
  answer: number;
  /** Shown after the learner commits, so a wrong answer still teaches something. */
  reveal?: string;
}

export const DRILL_LABELS: Record<DrillKind, string> = {
  'audio2zh': 'Nghe âm thanh, chọn chữ Hán đúng',
  'zh2vi': 'Nhìn chữ Hán, chọn nghĩa Tiếng Việt',
  pinyin: 'Chọn phiên âm Pinyin đúng',
  cloze: 'Điền từ vào câu khóa',
};

const QUESTIONS_PER_KIND = 3;
const OPTION_COUNT = 4;
const PASS_RATIO = 0.8;

/** mulberry32 — small deterministic PRNG, so a given lesson yields a given drill. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function shuffled<T>(rng: () => number, rows: readonly T[]): T[] {
  const out = [...rows];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function uniqueStrings(values: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function pinyinOf(item: LessonVocabItem): string {
  const numbered = item.pinyinNumbered?.trim();
  if (numbered) return numberedToMarks(numbered);
  return item.pinyin?.trim() ?? '';
}

function meaningOf(item: LessonVocabItem): string {
  return item.meaningVi?.trim() || item.meaningEn?.trim() || '';
}

/** Builds the option list around `correctValue`; returns null when the lesson cannot offer
 *  enough distinct distractors, which is how a kind gets skipped instead of guessed at. */
function buildOptions(
  rng: () => number,
  correctValue: string,
  pool: (string | undefined)[],
): { options: string[]; answer: number } | null {
  if (!correctValue) return null;
  const distractors = uniqueStrings(pool).filter((value) => value !== correctValue);
  if (distractors.length < OPTION_COUNT - 1) return null;
  const chosen = shuffled(rng, distractors).slice(0, OPTION_COUNT - 1);
  const options = shuffled(rng, [correctValue, ...chosen]);
  return { options, answer: options.indexOf(correctValue) };
}

function audioPrompt(item: LessonVocabItem): DrillAudioPrompt {
  return {
    hanzi: item.hanzi,
    pinyinNumbered: item.pinyinNumbered ?? '',
    ...(item.ttsAudioPath ? { ttsAudioPath: item.ttsAudioPath } : {}),
    ...(item.lessonAudioSlice ? { lessonAudioSlice: item.lessonAudioSlice } : {}),
  };
}

function listeningQuestions(
  rng: () => number,
  vocab: LessonVocabItem[],
  lesson: LessonDocument,
): DrillQuestion[] {
  const out: DrillQuestion[] = [];
  for (const item of shuffled(rng, vocab)) {
    if (out.length === QUESTIONS_PER_KIND) break;
    if (!item.hanzi) continue;
    const built = buildOptions(
      rng,
      item.hanzi,
      vocab.map((row) => row.hanzi),
    );
    if (!built) continue;
    out.push({
      id: `${lesson.lessonId}-audio2zh-${item.id}`,
      kind: 'audio2zh',
      labelVi: DRILL_LABELS['audio2zh'],
      stem: '',
      audio: audioPrompt(item),
      ...built,
      reveal: pinyinOf(item),
    });
  }
  return out;
}

function meaningQuestions(
  rng: () => number,
  vocab: LessonVocabItem[],
  lesson: LessonDocument,
): DrillQuestion[] {
  const out: DrillQuestion[] = [];
  for (const item of shuffled(rng, vocab)) {
    if (out.length === QUESTIONS_PER_KIND) break;
    if (!item.hanzi) continue;
    const built = buildOptions(
      rng,
      meaningOf(item),
      vocab.map((row) => meaningOf(row)),
    );
    if (!built) continue;
    out.push({
      id: `${lesson.lessonId}-zh2vi-${item.id}`,
      kind: 'zh2vi',
      labelVi: DRILL_LABELS['zh2vi'],
      stem: item.hanzi,
      ...built,
      reveal: pinyinOf(item),
    });
  }
  return out;
}

function pinyinQuestions(
  rng: () => number,
  vocab: LessonVocabItem[],
  lesson: LessonDocument,
): DrillQuestion[] {
  const out: DrillQuestion[] = [];
  for (const item of shuffled(rng, vocab)) {
    if (out.length === QUESTIONS_PER_KIND) break;
    const reading = pinyinOf(item);
    if (!item.hanzi || !reading) continue;
    const built = buildOptions(
      rng,
      reading,
      vocab.map((row) => pinyinOf(row)),
    );
    if (!built) continue;
    const tone = toneFromMarks(reading);
    out.push({
      id: `${lesson.lessonId}-pinyin-${item.id}`,
      kind: 'pinyin',
      labelVi: DRILL_LABELS.pinyin,
      stem: `${item.hanzi} · ${meaningOf(item)}`,
      ...built,
      ...(tone > 0 && tone < 5 ? { reveal: `Thanh ${tone}` } : {}),
    });
  }
  return out;
}

function clozeQuestions(
  rng: () => number,
  vocab: LessonVocabItem[],
  lesson: LessonDocument,
): DrillQuestion[] {
  const sentences = lesson.dialogues.flatMap((block) => block.sentences);
  const out: DrillQuestion[] = [];
  const usedSentences = new Set<string>();

  for (const sentence of shuffled(rng, sentences)) {
    if (out.length === QUESTIONS_PER_KIND) break;
    if (!sentence.zh || usedSentences.has(sentence.id)) continue;

    // Prefer a vocabulary word that appears verbatim in the sentence.
    const candidates = shuffled(
      rng,
      vocab.filter((item) => item.hanzi && sentence.zh.includes(item.hanzi)),
    );
    const target = candidates[0];
    if (!target) continue;

    const built = buildOptions(
      rng,
      target.hanzi,
      vocab.map((row) => row.hanzi),
    );
    if (!built) continue;

    usedSentences.add(sentence.id);
    out.push({
      id: `${lesson.lessonId}-cloze-${sentence.id}`,
      kind: 'cloze',
      labelVi: DRILL_LABELS.cloze,
      stem: sentence.zh.replace(target.hanzi, '＿＿'),
      ...(sentence.lessonAudioSlice || sentence.ttsAudioPath
        ? {
            audio: {
              hanzi: target.hanzi,
              pinyinNumbered: target.pinyinNumbered ?? '',
              ...(sentence.ttsAudioPath ? { ttsAudioPath: sentence.ttsAudioPath } : {}),
              ...(sentence.lessonAudioSlice
                ? { lessonAudioSlice: sentence.lessonAudioSlice }
                : {}),
            },
          }
        : {}),
      ...built,
      ...(sentence.vi ? { reveal: sentence.vi } : {}),
    });
  }
  return out;
}

/** Twelve questions when the lesson can support them: three of each kind. */
export function buildLessonDrill(lesson: LessonDocument): DrillQuestion[] {
  const rng = seededRandom(hashString(lesson.lessonId));
  const vocab = lesson.vocabulary;
  if (vocab.length < OPTION_COUNT) return [];

  return [
    ...listeningQuestions(rng, vocab, lesson),
    ...meaningQuestions(rng, vocab, lesson),
    ...pinyinQuestions(rng, vocab, lesson),
    ...clozeQuestions(rng, vocab, lesson),
  ];
}

export function drillPassMark(total: number): number {
  return Math.ceil(total * PASS_RATIO);
}

export function isDrillPassed(correct: number, total: number): boolean {
  if (total <= 0) return false;
  return correct / total >= PASS_RATIO;
}

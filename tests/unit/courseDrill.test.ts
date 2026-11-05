/** Step 4 of the guided course: the auto-generated recognition drill (`07_UI_SPEC.md` §2.4.4).
 *  The generator is pure and seeded, so it is tested without React. */

import { describe, expect, it } from 'vitest';
import {
  DRILL_LABELS,
  buildLessonDrill,
  drillPassMark,
  isDrillPassed,
  type DrillKind,
} from '@/modules/books/courseDrill';
import { COURSE_LESSON } from '../fixtures/courseLesson';
import type { LessonDocument, LessonVocabItem } from '@/domain/types';

const KINDS: DrillKind[] = ['audio2zh', 'zh2vi', 'pinyin', 'cloze'];

function withVocabulary(vocab: LessonVocabItem[]): LessonDocument {
  return { ...COURSE_LESSON, vocabulary: vocab };
}

describe('buildLessonDrill (07 §2.4.4)', () => {
  it('produces twelve questions — three of each kind — for a five-word lesson', () => {
    const drill = buildLessonDrill(COURSE_LESSON);

    expect(drill).toHaveLength(12);
    for (const kind of KINDS) {
      expect(drill.filter((question) => question.kind === kind)).toHaveLength(3);
    }
  });

  it('is seeded: the same lesson always yields the same questions in the same order', () => {
    expect(buildLessonDrill(COURSE_LESSON)).toEqual(buildLessonDrill(COURSE_LESSON));
  });

  it('gives every question four distinct options and an answer index that points at one of them', () => {
    for (const question of buildLessonDrill(COURSE_LESSON)) {
      expect(question.options).toHaveLength(4);
      expect(new Set(question.options).size).toBe(4);
      expect(question.answer).toBeGreaterThanOrEqual(0);
      expect(question.answer).toBeLessThan(4);
      expect(question.labelVi).toBe(DRILL_LABELS[question.kind]);
    }
  });

  it('marks the listening questions as audio-only and blanks a word in each cloze stem', () => {
    const drill = buildLessonDrill(COURSE_LESSON);

    for (const question of drill.filter((row) => row.kind === 'audio2zh')) {
      expect(question.stem).toBe('');
      expect(question.audio?.hanzi).toBeTruthy();
    }
    for (const question of drill.filter((row) => row.kind === 'cloze')) {
      expect(question.stem).toContain('＿＿');
    }
  });

  it('keeps the answer correct for the meaning and pinyin kinds', () => {
    const byHanzi = new Map(
      COURSE_LESSON.vocabulary.map((item) => [item.hanzi, item] as const),
    );
    const readings = new Set(COURSE_LESSON.vocabulary.flatMap((item) => [item.pinyin, item.pinyinNumbered]));

    for (const question of buildLessonDrill(COURSE_LESSON)) {
      const correct = question.options[question.answer];
      if (question.kind === 'zh2vi') {
        const item = byHanzi.get(question.stem);
        expect(item).toBeDefined();
        expect(correct).toBe(item?.meaningVi);
      }
      if (question.kind === 'pinyin') {
        const hanzi = question.stem.split(' · ')[0];
        expect(byHanzi.has(hanzi ?? '')).toBe(true);
        expect(readings.has(correct)).toBe(true);
      }
    }
  });

  it('returns nothing for a lesson too small to offer four distinct options', () => {
    expect(buildLessonDrill(withVocabulary(COURSE_LESSON.vocabulary.slice(0, 3)))).toEqual([]);
  });

  it('skips a kind instead of padding it with duplicate options', () => {
    const flatMeanings = COURSE_LESSON.vocabulary.map((item, index) => ({
      ...item,
      meaningVi: index === 0 ? 'bận; vội vã' : 'như nhau',
    }));

    const drill = buildLessonDrill(withVocabulary(flatMeanings));

    expect(drill.filter((question) => question.kind === 'zh2vi')).toEqual([]);
    expect(drill.filter((question) => question.kind === 'audio2zh')).toHaveLength(3);
  });
});

describe('drillPassMark / isDrillPassed (07 §2.4.4)', () => {
  it('needs 80% of the set', () => {
    expect(drillPassMark(12)).toBe(10);
    expect(drillPassMark(11)).toBe(9);
    expect(drillPassMark(0)).toBe(0);
    expect(isDrillPassed(10, 12)).toBe(true);
    expect(isDrillPassed(9, 12)).toBe(false);
    expect(isDrillPassed(0, 0)).toBe(false);
  });
});

/** Bibliographic shelf data for *Giáo trình Hán ngữ*.
 *
 *  Only facts that are safe to ship publicly live here: volume numbers, series names, lesson ranges
 *  and page counts. Every page image, lesson text, translation and audio file comes from the
 *  private `Hanyu-data` repository at runtime (`D-04`), never from this bundle. */

export type BookId = 'b1' | 'b2' | 'b3' | 'b4' | 'b5' | 'b6';

export interface BookVolume {
  id: BookId;
  /** `Quyển 3` — the number printed on the cover. */
  volume: number;
  /** `Tập 2 Thượng` — the series half this volume belongs to. */
  series: string;
  /** Lesson numbers *as printed in the book*. */
  lessons: string;
  lessonCount: number;
  pageCount: number;
  /** Global lesson order across all six volumes (`1`–`76`); used for the private manifest. */
  globalLessonFrom: number;
  globalLessonTo: number;
}

export const BOOK_VOLUMES: readonly BookVolume[] = [
  {
    id: 'b1',
    volume: 1,
    series: 'Tập 1 Thượng',
    lessons: 'Bài 1–15',
    lessonCount: 15,
    pageCount: 177,
    globalLessonFrom: 1,
    globalLessonTo: 15,
  },
  {
    id: 'b2',
    volume: 2,
    series: 'Tập 1 Hạ',
    lessons: 'Bài 16–30',
    lessonCount: 15,
    pageCount: 245,
    globalLessonFrom: 16,
    globalLessonTo: 30,
  },
  {
    id: 'b3',
    volume: 3,
    series: 'Tập 2 Thượng',
    lessons: 'Bài 1–10',
    lessonCount: 10,
    pageCount: 185,
    globalLessonFrom: 31,
    globalLessonTo: 40,
  },
  {
    id: 'b4',
    volume: 4,
    series: 'Tập 2 Hạ',
    lessons: 'Bài 11–20',
    lessonCount: 10,
    pageCount: 181,
    globalLessonFrom: 41,
    globalLessonTo: 50,
  },
  {
    id: 'b5',
    volume: 5,
    series: 'Tập 3 Thượng',
    lessons: 'Bài 1–13',
    lessonCount: 13,
    pageCount: 209,
    globalLessonFrom: 51,
    globalLessonTo: 63,
  },
  {
    id: 'b6',
    volume: 6,
    series: 'Tập 3 Hạ',
    lessons: 'Bài 14–26',
    lessonCount: 13,
    pageCount: 237,
    globalLessonFrom: 64,
    globalLessonTo: 76,
  },
];

export const TOTAL_LESSONS = BOOK_VOLUMES.reduce((sum, book) => sum + book.lessonCount, 0);
export const TOTAL_PAGES = BOOK_VOLUMES.reduce((sum, book) => sum + book.pageCount, 0);

export function findVolume(id: string | undefined): BookVolume | undefined {
  return BOOK_VOLUMES.find((book) => book.id === id);
}

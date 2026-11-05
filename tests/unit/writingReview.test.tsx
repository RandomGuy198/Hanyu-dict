/** The study hub's due-writing queue (`04_EXECUTION_PHASES.md` Phase 7.2): the mistake threshold that
 *  turns a drawn character into an SRS grade, and the grade actually landing on the card. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { db } from '@/data/db';
import * as audioPlayer from '@/data/audioPlayer';
import type { SrsCard, SrsRating } from '@/domain/types';
import WritingReviewPanel, {
  ratingFromMistakes,
  writingRatingLabel,
} from '@/modules/learning/WritingReviewPanel';

function writingCard(id: string, hanzi: string, repetitions: number): SrsCard {
  const past = new Date(Date.now() - 60_000).toISOString();
  return {
    id,
    deckId: 'deck-book-b1',
    kind: 'writing',
    simplified: hanzi,
    traditional: hanzi,
    pinyinMarked: 'máng',
    pinyinNumbered: 'mang2',
    hanViet: 'mang',
    definition: `Tập viết chữ ${hanzi}`,
    definitionVi: 'bận; vội vã',
    interval: 3,
    ease: 2.5,
    repetitions,
    lapses: 0,
    due: past,
    createdAt: past,
  };
}

function renderPanel(cards: SrsCard[], onGraded?: (card: SrsCard, rating: SrsRating) => void) {
  return render(
    <MemoryRouter>
      <WritingReviewPanel cards={cards} sessionLabel="Ôn viết chữ Hán" onGraded={onGraded} />
    </MemoryRouter>,
  );
}

describe('ratingFromMistakes (Phase 7.2)', () => {
  it('grades a clean recall by how well the card was already known', () => {
    expect(ratingFromMistakes(0, 0)).toBe('good');
    expect(ratingFromMistakes(0, 3)).toBe('easy');
  });

  it('falls through good, hard and again as the stroke mistakes pile up', () => {
    expect(ratingFromMistakes(2, 1)).toBe('good');
    expect(ratingFromMistakes(3, 1)).toBe('hard');
    expect(ratingFromMistakes(5, 1)).toBe('hard');
    expect(ratingFromMistakes(6, 1)).toBe('again');
  });

  it('labels every rating in Vietnamese', () => {
    expect(writingRatingLabel('again')).toMatch(/Quên rồi/i);
    expect(writingRatingLabel('hard')).toMatch(/sai vài nét/i);
    expect(writingRatingLabel('good')).toMatch(/Ổn/i);
    expect(writingRatingLabel('easy')).toMatch(/đúng mọi nét/i);
  });
});

describe('WritingReviewPanel (Phase 7.2)', () => {
  beforeEach(() => {
    vi.spyOn(audioPlayer, 'playWordAudio').mockResolvedValue({ ok: true, source: 'tts-file' });
  });

  it('offers the queue only when writing cards are due, and says so when they are not', () => {
    const withCards = renderPanel([writingCard('write:忙', '忙', 0)]);
    expect(
      screen.getByRole('button', { name: /Ôn 1 thẻ tập viết đang đến hạn/i }),
    ).toBeInTheDocument();
    withCards.unmount();

    renderPanel([]);
    expect(
      screen.getByText(/Chưa có thẻ tập viết nào đến hạn/i),
    ).toBeInTheDocument();
  });

  it('snapshots the queue, grades a "không nhớ" answer into the card, and moves on', async () => {
    const card = writingCard('write:忙', '忙', 0);
    await db.decks.put({
      id: 'deck-book-b1',
      name: 'Khoá học Hán ngữ — Quyển 1',
      createdAt: card.createdAt,
      prompt: 'zh2en',
      newPerDay: 20,
    });
    await db.cards.put(card);

    const graded: string[] = [];
    renderPanel([card], (row, rating) => graded.push(`${row.simplified}:${rating}`));

    fireEvent.click(screen.getByRole('button', { name: /Ôn 1 thẻ tập viết đang đến hạn/i }));

    // The prompt is the card's own meaning and reading, not a dictionary lookup.
    expect(await screen.findByText('bận; vội vã')).toBeInTheDocument();
    expect(screen.getByText('máng')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nghe phát âm 忙/i })).toBeInTheDocument();
    expect(screen.getByText(/Thẻ 1\/1/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Không nhớ chữ này/i }));

    await waitFor(() => expect(graded).toEqual(['忙:again']));

    const stored = await db.cards.get(card.id);
    expect(new Date(stored?.due ?? '').getTime()).toBeGreaterThan(new Date(card.due).getTime());
    expect(stored?.lapses).toBe(1);
    expect(await db.attempts.toArray()).toHaveLength(1);
    expect((await db.activity.toArray()).length).toBeGreaterThan(0);
    // The grade has to reach the sync queue: `meta` is written outside the review transaction.
    await waitFor(async () => expect((await db.meta.get('sync.dirty'))?.value).toBe(true));
    expect(await screen.findByText(/Đã ôn 1\/1 thẻ tập viết/i)).toBeInTheDocument();
  });

  it('keeps a card it graded out of the queue even though the live due list shrinks', async () => {
    const first = writingCard('write:忙', '忙', 1);
    const second = writingCard('write:太', '太', 1);
    await db.cards.bulkPut([first, second]);

    const graded: string[] = [];
    renderPanel([first, second], (row, rating) => graded.push(`${row.simplified}:${rating}`));

    fireEvent.click(screen.getByRole('button', { name: /Ôn 2 thẻ tập viết đang đến hạn/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Không nhớ chữ này/i }));

    await waitFor(() => expect(graded).toEqual(['忙:again']));
    expect(await screen.findByText(/Thẻ 2\/2/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nghe phát âm 太/i })).toBeInTheDocument();
  });
});

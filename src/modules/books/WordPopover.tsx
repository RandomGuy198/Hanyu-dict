/**
 * Shared Word Popover (`src/modules/books/WordPopover.tsx`, `07_UI_SPEC.md` §2.3).
 *
 * Opened when a word token inside a sentence or a vocabulary row is clicked — a lightweight
 * dictionary lookup, not an audio trigger. Displays:
 * - Header: `<EntryDetailCard />` — the same content as a dictionary entry (large Hanzi,
 *   pinyin, Hán-Việt badge, Vietnamese + English glosses) — plus a part-of-speech badge and,
 *   when the contextual reading differs from the citation reading, a tone-sandhi badge
 *   (`Đọc trong câu: bú · Đọc riêng: bù`).
 * - The containing sentence's sandhi notes and a short sentence preview.
 * - Quick Actions Footer:
 *   - `⭐ Lưu từ & thêm thẻ SRS`
 *   - `✍️ Tập viết chữ`
 *   - `📖 Mở trang từ điển` (full dictionary page with examples & related words)
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDictionary, useSavedWords, useToast } from '../../app/providers';
import { db, notifyLocalMutation } from '../../data/db';
import { markDirty } from '../../data/syncEngine';
import { marksToNumbered } from '../../domain/pinyin';
import { EASE_DEFAULT } from '../../domain/scheduler';
import { entryId } from '../../domain/searchRanking';
import { EntryDetailCard } from '../../components';
import type {
  Deck,
  DictEntry,
  LessonSentence,
  LessonVocabItem,
  SentenceToken,
  SrsCard,
} from '../../domain/types';

export interface WordPopoverProps {
  vocab?: LessonVocabItem;
  token?: SentenceToken;
  sentence?: LessonSentence;
  vocabulary?: LessonVocabItem[];
  bookId?: string;
  lessonId?: string;
  onClose: () => void;
}

export function WordPopover({
  vocab: propVocab,
  token,
  sentence,
  vocabulary,
  bookId = 'b1',
  lessonId,
  onClose,
}: WordPopoverProps) {
  const { api } = useDictionary();
  const { isSaved, save: saveToWords } = useSavedWords();
  const toast = useToast();

  const matchedVocab = useMemo<LessonVocabItem | undefined>(() => {
    if (propVocab) return propVocab;
    if (!vocabulary || !token) return undefined;
    if (token.vocabId) {
      const byId = vocabulary.find((v) => v.id === token.vocabId);
      if (byId) return byId;
    }
    return vocabulary.find(
      (v) => v.hanzi === token.surface || (token.dictHeadword && v.hanzi === token.dictHeadword),
    );
  }, [propVocab, token, vocabulary]);

  const hanzi = useMemo(() => {
    return (
      token?.surface ||
      matchedVocab?.hanzi ||
      token?.dictHeadword ||
      ''
    ).trim();
  }, [matchedVocab, token]);

  const [dictEntries, setDictEntries] = useState<DictEntry[]>([]);
  const [charHanViet, setCharHanViet] = useState<string>('');
  const [savingSrs, setSavingSrs] = useState(false);
  const [srsAdded, setSrsAdded] = useState(false);

  useEffect(() => {
    if (!api || !hanzi) {
      setDictEntries([]);
      setCharHanViet('');
      return;
    }
    let alive = true;
    const lookupHeadword = token?.dictHeadword || hanzi;
    api
      .headword(lookupHeadword)
      .then(async (entries) => {
        let list = entries;
        if (list.length === 0 && lookupHeadword !== hanzi) {
          list = await api.headword(hanzi);
        }
        if (list.length === 0) {
          const searchRes = await api.search(hanzi, { mode: 'hans', limit: 5 });
          list = searchRes.results
            .map((r) => r.entry)
            .filter((e) => e.simplified === hanzi || e.traditional === hanzi);
        }
        if (!alive) return;
        setDictEntries(list);

        if (!matchedVocab?.hanViet && !list[0]?.hanViet) {
          const chars = [...hanzi];
          const recs = await api.characters(chars);
          if (!alive) return;
          const hvParts = recs
            .map((r) => r?.hanViet?.[0])
            .filter((v): v is string => Boolean(v));
          if (hvParts.length > 0) {
            setCharHanViet(hvParts.join(' '));
          }
        }
      })
      .catch(() => {
        if (alive) setDictEntries([]);
      });
    return () => {
      alive = false;
    };
  }, [api, hanzi, matchedVocab?.hanViet, token?.dictHeadword]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const primaryDict = dictEntries[0];

  const traditional = matchedVocab?.traditional || primaryDict?.traditional || hanzi;
  const displayPinyin =
    token?.pinyin || matchedVocab?.pinyin || primaryDict?.pinyinMarked || '';
  const citationPinyin =
    token?.citationPinyin ||
    (token?.pinyin && matchedVocab?.pinyin && token.pinyin.toLowerCase() !== matchedVocab.pinyin.toLowerCase()
      ? matchedVocab.pinyin
      : undefined);
  const hasSandhi = Boolean(
    citationPinyin &&
      displayPinyin &&
      citationPinyin.trim().toLowerCase() !== displayPinyin.trim().toLowerCase(),
  );

  const pinyinNumbered = useMemo(() => {
    if (matchedVocab?.pinyinNumbered) return matchedVocab.pinyinNumbered;
    if (primaryDict?.pinyinNumbered) return primaryDict.pinyinNumbered;
    const sourcePinyin = citationPinyin || displayPinyin;
    return sourcePinyin ? marksToNumbered(sourcePinyin) : '';
  }, [citationPinyin, displayPinyin, matchedVocab?.pinyinNumbered, primaryDict?.pinyinNumbered]);

  const hanViet = useMemo(() => {
    if (matchedVocab?.hanViet) return matchedVocab.hanViet;
    if (primaryDict?.hanViet) return primaryDict.hanViet;
    if (charHanViet) return charHanViet;
    if (hanzi === '不') return 'bất';
    if (hanzi === '一') return 'nhất';
    if (hanzi === '你') return 'nhĩ';
    if (hanzi === '好') return 'hảo';
    return '';
  }, [charHanViet, hanzi, matchedVocab?.hanViet, primaryDict?.hanViet]);

  const pos = matchedVocab?.pos || '';
  const bookMeaningVi =
    matchedVocab?.meaningVi ||
    (hanzi === '不' && !matchedVocab ? 'không, chẳng (phó từ phủ định)' : '');
  const bookMeaningEn =
    matchedVocab?.meaningEn ||
    (hanzi === '不' && !matchedVocab ? 'not; no' : '');

  const dictViList = useMemo(() => {
    const out: string[] = [];
    for (const entry of dictEntries) {
      const items =
        entry.definitionsVi ??
        (entry.definitionVi ? entry.definitionVi.split('; ').filter(Boolean) : []);
      for (const item of items) {
        if (item && !out.includes(item)) out.push(item);
      }
    }
    return out;
  }, [dictEntries]);

  const syntheticEntry: DictEntry = useMemo(() => {
    if (primaryDict) {
      return {
        ...primaryDict,
        hanViet: primaryDict.hanViet || hanViet || undefined,
        definitionVi:
          primaryDict.definitionVi || bookMeaningVi || dictViList.join('; ') || undefined,
      };
    }
    const numPy = pinyinNumbered || '5';
    return {
      id: entryId(hanzi, numPy),
      simplified: hanzi,
      traditional: traditional || hanzi,
      pinyinNumbered: numPy,
      pinyinMarked: citationPinyin || displayPinyin || hanzi,
      pinyinPlain: hanzi.toLowerCase(),
      definition: bookMeaningEn || bookMeaningVi || hanzi,
      definitionVi: bookMeaningVi || undefined,
      definitionsVi: bookMeaningVi ? [bookMeaningVi] : undefined,
      hanViet: hanViet || undefined,
      length: [...hanzi].length,
    };
  }, [
    bookMeaningEn,
    bookMeaningVi,
    citationPinyin,
    dictViList,
    displayPinyin,
    hanViet,
    hanzi,
    pinyinNumbered,
    primaryDict,
    traditional,
  ]);

  const alreadySaved = isSaved(syntheticEntry.id) || srsAdded;

  const handleSaveWordAndSrs = async () => {
    if (savingSrs || !hanzi) return;
    setSavingSrs(true);
    try {
      await saveToWords(syntheticEntry);

      const now = new Date();
      const nowIso = now.toISOString();
      const deckId = `deck-book-${bookId}`;
      const volNum = bookId.replace(/^b/i, '') || '1';
      const deckName = `Bộ sách Hán ngữ — Quyển ${volNum}`;

      await db.transaction('rw', db.decks, db.cards, async () => {
        const existingDeck = await db.decks.get(deckId);
        if (!existingDeck) {
          const newDeck: Deck = {
            id: deckId,
            name: deckName,
            createdAt: nowIso,
            updatedAt: nowIso,
            prompt: 'zh2en',
            newPerDay: 20,
          };
          await db.decks.put(newDeck);
        }

        const recCardId = `${deckId}|rec|${syntheticEntry.id}`;
        const writeCardId = `${deckId}|write|${syntheticEntry.id}`;
        const existingRec = await db.cards.get(recCardId);
        const existingWrite = await db.cards.get(writeCardId);

        const cardsToPut: SrsCard[] = [];
        if (!existingRec) {
          cardsToPut.push({
            id: recCardId,
            deckId,
            kind: 'recognition',
            simplified: syntheticEntry.simplified,
            traditional: syntheticEntry.traditional,
            pinyinMarked: syntheticEntry.pinyinMarked,
            pinyinNumbered: syntheticEntry.pinyinNumbered,
            hanViet: syntheticEntry.hanViet,
            definition: syntheticEntry.definition,
            definitionVi: syntheticEntry.definitionVi,
            lessonId: lessonId ?? matchedVocab?.id.split('-v')[0],
            interval: 0,
            ease: EASE_DEFAULT,
            repetitions: 0,
            lapses: 0,
            due: nowIso,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
        if (!existingWrite) {
          cardsToPut.push({
            id: writeCardId,
            deckId,
            kind: 'writing',
            simplified: syntheticEntry.simplified,
            traditional: syntheticEntry.traditional,
            pinyinMarked: syntheticEntry.pinyinMarked,
            pinyinNumbered: syntheticEntry.pinyinNumbered,
            hanViet: syntheticEntry.hanViet,
            definition: syntheticEntry.definition,
            definitionVi: syntheticEntry.definitionVi,
            lessonId: lessonId ?? matchedVocab?.id.split('-v')[0],
            interval: 0,
            ease: EASE_DEFAULT,
            repetitions: 0,
            lapses: 0,
            due: nowIso,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
        if (cardsToPut.length > 0) {
          await db.cards.bulkPut(cardsToPut);
        }
      });

      notifyLocalMutation();
      markDirty();
      setSrsAdded(true);
      toast.push(`Đã lưu "${hanzi}" & tạo thẻ SRS (Nhận biết + Tập viết)`);
    } catch (error) {
      toast.push({
        message: error instanceof Error ? error.message : 'Không thể lưu thẻ SRS.',
        tone: 'danger',
      });
    } finally {
      setSavingSrs(false);
    }
  };

  const firstChar = [...hanzi][0] ?? hanzi;
  const entryRouteId = primaryDict ? primaryDict.id : hanzi;

  return (
    <div
      className="word-popover-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="card word-popover"
        role="dialog"
        aria-modal="true"
        aria-label={`Chi tiết từ ${hanzi}`}
      >
        <header className="word-popover-header">
          <div className="word-popover-title-group">
            <EntryDetailCard
              entry={syntheticEntry}
              pinyin={displayPinyin}
              extraBadges={
                <>
                  {pos ? <span className="badge">({pos})</span> : null}
                  {hasSandhi && citationPinyin ? (
                    <span className="badge badge-warn word-popover-sandhi">
                      Đọc trong câu: <strong>{displayPinyin}</strong> · Đọc riêng:{' '}
                      <strong>{citationPinyin}</strong>
                    </span>
                  ) : null}
                </>
              }
            />
          </div>

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Đóng bảng tra từ"
            onClick={onClose}
          >
            ✕ Đóng
          </button>
        </header>

        {sentence?.sandhiNotes && sentence.sandhiNotes.length > 0 ? (
          <div className="notice notice-warn word-popover-sandhi-note">
            <div className="text-sm">{sentence.sandhiNotes.join(' · ')}</div>
          </div>
        ) : null}

        {sentence ? (
          <div className="word-popover-sentence-preview">
            <span className="text-sm faint">Câu chứa từ: </span>
            <span className="cjk" lang="zh">
              {sentence.zh}
            </span>{' '}
            <span className="pinyin text-sm">({sentence.pinyin})</span>
          </div>
        ) : null}

        <footer className="word-popover-footer">
          <button
            type="button"
            className={`btn btn-sm ${alreadySaved ? 'badge-ok' : 'btn-primary'}`}
            disabled={savingSrs}
            onClick={() => void handleSaveWordAndSrs()}
          >
            ⭐ {alreadySaved ? 'Đã lưu & thêm thẻ SRS' : 'Lưu từ & thêm thẻ SRS'}
          </button>
          <Link
            className="btn btn-sm"
            to={`/writing?c=${encodeURIComponent(firstChar)}&chars=${encodeURIComponent(hanzi)}`}
            onClick={onClose}
          >
            ✍️ Tập viết chữ
          </Link>
          <Link
            className="btn btn-sm"
            to={`/entry/${encodeURIComponent(entryRouteId)}`}
            onClick={onClose}
          >
            📖 Mở trang từ điển
          </Link>
        </footer>
      </section>
    </div>
  );
}

export default WordPopover;

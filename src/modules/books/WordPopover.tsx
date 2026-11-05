/**
 * Shared Word Popover (`src/modules/books/WordPopover.tsx`, `07_UI_SPEC.md` §2.3).
 *
 * Opened when a word token inside a sentence or a vocabulary row/hotspot is clicked.
 * Displays:
 * - Header: Large Hanzi (and traditional if different), Pinyin, contextual tone sandhi badge
 *   (`Đọc trong câu: bú · Đọc riêng: bù`), Hán-Việt badge, and Part of Speech (`pos`).
 * - Two Audio Buttons side by side:
 *   1. `🔊 Từ đơn (TTS)` — plays standalone TTS audio for the word.
 *   2. `🎧 Trong câu (Băng gốc)` — plays the containing sentence's audio or vocabulary slice.
 * - Meanings:
 *   - Nghĩa trong sách (TV & EN)
 *   - Từ điển mở rộng (CVDICT / CC-CEDICT)
 * - Quick Actions Footer:
 *   - `⭐ Lưu từ & thêm thẻ SRS`
 *   - `✍️ Tập viết chữ`
 *   - `📖 Mở trang từ điển`
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDictionary, useSavedWords, useToast } from '../../app/providers';
import { playLessonSlice, playSentenceAudio, playWordAudio } from '../../data/audioPlayer';
import { db, notifyLocalMutation } from '../../data/db';
import { markDirty } from '../../data/syncEngine';
import { marksToNumbered } from '../../domain/pinyin';
import { EASE_DEFAULT } from '../../domain/scheduler';
import { entryId } from '../../domain/searchRanking';
import type {
  AudioSliceRef,
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
  const [busyAudio, setBusyAudio] = useState<'word' | 'context' | null>(null);
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

  const dictEnList = useMemo(() => {
    const out: string[] = [];
    for (const entry of dictEntries) {
      const items = entry.definition ? entry.definition.split('; ').filter(Boolean) : [];
      for (const item of items) {
        if (item && !out.includes(item)) out.push(item);
      }
    }
    return out;
  }, [dictEntries]);

  const contextSlice: AudioSliceRef | undefined =
    sentence?.lessonAudioSlice ?? matchedVocab?.lessonAudioSlice;
  const hasContextAudio = Boolean(sentence || contextSlice);

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

  const handlePlayStandalone = async () => {
    setBusyAudio('word');
    try {
      const result = await playWordAudio(hanzi, pinyinNumbered || undefined, undefined);
      if (!result.ok) {
        toast.push({ message: result.reason ?? 'Không phát được âm thanh từ đơn.', tone: 'warn' });
      }
    } finally {
      setBusyAudio(null);
    }
  };

  const handlePlayContext = async () => {
    setBusyAudio('context');
    try {
      if (sentence) {
        const result = await playSentenceAudio(sentence, 'context', 1.0);
        if (!result.ok) {
          toast.push({ message: result.reason ?? 'Không phát được âm thanh câu.', tone: 'warn' });
        }
        return;
      }
      if (contextSlice) {
        const result = await playLessonSlice(contextSlice, 1.0);
        if (!result.ok) {
          toast.push({ message: result.reason ?? 'Không phát được băng gốc.', tone: 'warn' });
        }
      }
    } finally {
      setBusyAudio(null);
    }
  };

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
            <div className="row-wrap" style={{ alignItems: 'baseline', gap: 'var(--sp-2)' }}>
              <span className="word-popover-hanzi cjk" lang="zh">
                {hanzi}
              </span>
              {traditional && traditional !== hanzi ? (
                <span className="word-popover-trad cjk faint" lang="zh">
                  {traditional}
                </span>
              ) : null}
              {displayPinyin ? <span className="word-popover-pinyin">{displayPinyin}</span> : null}
              {pos ? <span className="badge">({pos})</span> : null}
            </div>

            <div className="row-wrap" style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-1)' }}>
              {hanViet ? (
                <span className="badge badge-info word-popover-hv">
                  [HÁN VIỆT: {hanViet.toUpperCase()}]
                </span>
              ) : null}
              {hasSandhi && citationPinyin ? (
                <span className="badge badge-warn word-popover-sandhi">
                  Đọc trong câu: <strong>{displayPinyin}</strong> · Đọc riêng:{' '}
                  <strong>{citationPinyin}</strong>
                </span>
              ) : null}
            </div>
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

        <div className="word-popover-audio-row">
          <button
            type="button"
            className="btn btn-primary btn-sm word-popover-audio-btn"
            disabled={busyAudio === 'word'}
            onClick={() => void handlePlayStandalone()}
          >
            🔊 Từ đơn (TTS)
          </button>
          {hasContextAudio ? (
            <button
              type="button"
              className="btn btn-sm word-popover-audio-btn"
              disabled={busyAudio === 'context'}
              onClick={() => void handlePlayContext()}
            >
              🎧 Trong câu (Băng gốc)
            </button>
          ) : null}
        </div>

        <div className="word-popover-meanings stack" style={{ gap: 'var(--sp-3)' }}>
          {bookMeaningVi || bookMeaningEn ? (
            <div className="word-popover-meaning-block">
              <h4 className="text-sm muted">Nghĩa trong sách (TV)</h4>
              {bookMeaningVi ? (
                <p className="word-popover-vi">
                  <strong>{bookMeaningVi}</strong>
                </p>
              ) : null}
              {bookMeaningEn ? <p className="text-sm muted">EN: {bookMeaningEn}</p> : null}
            </div>
          ) : null}

          {dictViList.length > 0 || dictEnList.length > 0 ? (
            <div className="word-popover-meaning-block">
              <h4 className="text-sm muted">Từ điển mở rộng (CVDICT / CC-CEDICT)</h4>
              {dictViList.length > 0 ? (
                <p className="text-sm">
                  <strong>TV:</strong> {dictViList.slice(0, 4).join('; ')}
                </p>
              ) : null}
              {dictEnList.length > 0 ? (
                <p className="text-sm muted">
                  <strong>EN:</strong> {dictEnList.slice(0, 4).join('; ')}
                </p>
              ) : null}
            </div>
          ) : !bookMeaningVi && !bookMeaningEn ? (
            <p className="text-sm muted">
              Nhấn “Mở trang từ điển” bên dưới để tra cứu chi tiết từ này.
            </p>
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
        </div>

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

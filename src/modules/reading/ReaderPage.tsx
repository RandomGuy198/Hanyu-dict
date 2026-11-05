/** Chinese text annotator: paste or import text and tap any word for a dictionary gloss.
 *
 *  v0.2 removed the PDF engine and the OCR pipeline entirely (D-21.3): the six textbooks are read
 *  in the integrated book reader at `#/books`, where every page and every sentence is already
 *  clickable. What remains here is the one thing a PDF upload was ever used for besides the books —
 *  dropping in an arbitrary Chinese paragraph and looking words up.
 *
 *  This screen looks words up; it does not machine-translate, and there is deliberately no translate
 *  button. Pasted text and its bytes stay in IndexedDB on this device.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ConfirmDialog,
  DefinitionText,
  EmptyState,
  HanziText,
  LoadingGate,
  PageHeader,
  PinyinText,
  SaveButton,
  Segmented,
  SpeakButton,
} from '../../components';
import { IconAlert, IconBook, IconTrash } from '../../app/icons';
import { formatBytes, uid } from '../../app/hooks';
import { useDictionary, usePreferences, useSavedWords, useToast } from '../../app/providers';
import { bumpActivity, db, todayKey } from '../../data/db';
import { readFileAsText } from '../../data/exportImport';
import type { DictionaryApi } from '../../data/dictionary';
import type { DictEntry, ImportedDocument, Preferences, TextSpan } from '../../domain/types';
import { hasCjk, isHanCharacter } from '../../domain/pinyin';
import './reading.css';

/** A pasted or imported document above this is not comfortable to render as one DOM block. */
const MAX_TEXT_BYTES = 8 * 1024 * 1024;

export default function ReaderPage() {
  return (
    <LoadingGate>
      <Desk />
    </LoadingGate>
  );
}

interface Reading {
  id: string;
  name: string;
  text: string;
  bytes: number;
  stored: boolean;
  blob: Blob | null;
}

function Desk() {
  const { prefs, update } = usePreferences();
  const toast = useToast();
  const [reading, setReading] = useState<Reading | null>(null);
  const [draft, setDraft] = useState('');
  const [keepBytes, setKeepBytes] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ImportedDocument | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [lineHeight, setLineHeight] = useState<number>(1.9);
  const documents = useLiveQuery(() => db.documents.orderBy('addedAt').reverse().toArray(), [], []);

  const show = useCallback((message: string) => setStatus(message), []);
  const stopReading = useCallback(() => setReading(null), []);

  const storeDocument = useCallback(
    async (row: Omit<ImportedDocument, 'id' | 'addedAt' | 'stored'>, blob: Blob | null) => {
      const id = uid('doc-');
      let stored = keepBytes && blob !== null;
      await db.documents.add({ ...row, id, addedAt: new Date().toISOString(), stored });
      if (stored && blob) {
        try {
          await db.documentBlobs.put({ id, blob });
        } catch {
          await db.documents.update(id, { stored: false });
          stored = false;
          toast.push({ message: 'Bộ nhớ trình duyệt đã đầy — văn bản đã được ghi tên nhưng không lưu được nội dung.', tone: 'warn' });
        }
      }
      return { id, stored };
    },
    [keepBytes, toast],
  );

  const openText = useCallback(
    async (name: string, text: string, blob: Blob | null) => {
      const bytes = blob?.size ?? new Blob([text]).size;
      if (bytes > MAX_TEXT_BYTES) {
        toast.push({ message: `Văn bản này ${formatBytes(bytes)} — quá lớn để hiển thị một lần. Hãy chia thành phần nhỏ hơn.`, tone: 'danger' });
        return;
      }
      const saved = await storeDocument({ name, kind: 'text', bytes }, blob);
      await bumpActivity(todayKey(), { readings: 1 });
      setReading({ id: saved.id, name, text, bytes, stored: saved.stored, blob });
      show('Văn bản đã sẵn sàng.');
    },
    [show, storeDocument, toast],
  );

  const onTextFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_TEXT_BYTES) {
        toast.push({ message: `${file.name} nặng ${formatBytes(file.size)}, vượt mức ${formatBytes(MAX_TEXT_BYTES)} màn hình này hiển thị.`, tone: 'danger' });
        return;
      }
      try {
        const text = await readFileAsText(file);
        if (!text.trim()) {
          toast.push({ message: `${file.name} không có nội dung văn bản.`, tone: 'warn' });
          return;
        }
        await openText(file.name, text, file);
      } catch (error) {
        toast.push({ message: error instanceof Error ? error.message : 'Không đọc được tệp.', tone: 'danger' });
      }
    },
    [openText, toast],
  );

  const keepBytesNow = useCallback(async () => {
    if (!reading || reading.stored) return;
    const blob = reading.blob ?? new Blob([reading.text], { type: 'text/plain' });
    try {
      await db.documentBlobs.put({ id: reading.id, blob });
      await db.documents.update(reading.id, { stored: true, bytes: blob.size });
      setReading({ ...reading, stored: true, blob, bytes: blob.size });
      toast.push('Đã lưu nội dung trên thiết bị này');
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      toast.push({
        message:
          name === 'QuotaExceededError'
            ? `Không lưu được: bộ nhớ trình duyệt đã đầy (cần ${formatBytes(blob.size)}).`
            : `Không lưu được nội dung: ${error instanceof Error ? error.message : 'lỗi không rõ'}.`,
        tone: 'danger',
      });
    }
  }, [reading, toast]);

  const reopen = useCallback(
    async (row: ImportedDocument) => {
      const record = await db.documentBlobs.get(row.id);
      if (!record) {
        toast.push({ message: 'Nội dung của văn bản này không được giữ lại, chỉ còn tên. Hãy nhập lại tệp để đọc.', tone: 'warn' });
        return;
      }
      const text = await record.blob.text();
      setReading({ id: row.id, name: row.name, text, bytes: row.bytes, stored: true, blob: record.blob });
    },
    [toast],
  );

  const commitRename = useCallback(
    async (row: ImportedDocument, name: string) => {
      const clean = name.trim().slice(0, 120);
      if (!clean || clean === row.name) {
        setRenamingId(null);
        return;
      }
      await db.documents.update(row.id, { name: clean });
      if (reading?.id === row.id) setReading({ ...reading, name: clean });
      setRenamingId(null);
      toast.push('Đã đổi tên trên thiết bị này');
    },
    [reading, toast],
  );

  const removeDocument = useCallback(
    async (row: ImportedDocument) => {
      await db.transaction('rw', db.documents, db.documentBlobs, async () => {
        await db.documentBlobs.delete(row.id);
        await db.documents.delete(row.id);
      });
      if (reading?.id === row.id) stopReading();
      setPendingDelete(null);
      toast.push('Đã xóa văn bản và nội dung khỏi thiết bị này');
    },
    [reading, stopReading, toast],
  );

  return (
    <div className="stack read-page">
      <PageHeader
        title="Dán văn bản"
        subtitle="Dán hoặc nhập một đoạn tiếng Trung, chạm vào từ để xem nghĩa. Muốn đọc sách giáo trình, hãy mở Sách & Khóa học."
      />

      <p className="notice notice-info read-lead" role="note">
        <IconAlert />
        <span>
          <strong>Chỉ tra từ, không dịch máy.</strong> Từ được đối chiếu với dữ liệu từ điển đã tải,
          khớp cụm dài nhất trước. Không có gì được gửi đi đâu: văn bản và ghi chú nằm trong bộ nhớ
          của trình duyệt này.
        </span>
      </p>

      <p className="read-row">
        <Link className="btn btn-primary" to="/books">
          <IconBook /> Mở sách giáo trình tương tác
        </Link>
        <Link className="btn" to="/">
          Tra từ điển
        </Link>
      </p>

      <section className="card read-column" aria-label="Tùy chọn đọc">
        <div className="read-controls">
          <Segmented
            label="Cỡ chữ"
            value={String(prefs.textScale)}
            options={[
              { value: '0.9', label: 'Nhỏ' },
              { value: '1', label: 'Vừa' },
              { value: '1.15', label: 'Lớn' },
              { value: '1.3', label: 'Rất lớn' },
            ]}
            onChange={(value) => update({ textScale: Number(value) })}
          />
          <Segmented
            label="Giãn dòng"
            value={String(lineHeight)}
            options={[
              { value: '1.6', label: 'Chặt' },
              { value: '1.9', label: 'Vừa' },
              { value: '2.2', label: 'Thoáng' },
              { value: '2.6', label: 'Rất thoáng' },
            ]}
            onChange={(value) => setLineHeight(Number(value))}
          />
          <Segmented
            label="Giao diện"
            value={prefs.theme}
            options={[
              { value: 'auto', label: 'Tự động' },
              { value: 'light', label: 'Sáng' },
              { value: 'dark', label: 'Tối' },
            ]}
            onChange={(value) => update({ theme: value as Preferences['theme'] })}
          />
          <Segmented
            label="Chữ hiển thị"
            value={prefs.displayScript}
            options={[
              { value: 'simplified', label: 'Giản thể' },
              { value: 'traditional', label: 'Phồn thể' },
              { value: 'both', label: 'Cả hai' },
            ]}
            onChange={(value) => update({ displayScript: value as Preferences['displayScript'] })}
          />
          <label className="switch">
            <input type="checkbox" checked={prefs.showPinyin} onChange={(event) => update({ showPinyin: event.target.checked })} />
            <span>Hiện pinyin trong chú giải</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={showAnnotations} onChange={(event) => setShowAnnotations(event.target.checked)} />
            <span>Đánh dấu từ có trong từ điển</span>
          </label>
        </div>
        <p className="text-sm faint">Cỡ chữ và giao diện được lưu vào tùy chọn chung; giãn dòng chỉ áp dụng ở màn hình này.</p>
      </section>

      <section className="card read-column read-import" aria-label="Thêm văn bản">
        <div className="field">
          <label htmlFor="read-paste">Dán văn bản</label>
          <textarea
            id="read-paste"
            className="textarea cjk"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="把要读的内容粘贴在这里…"
          />
          <span className="help">Tối đa {formatBytes(MAX_TEXT_BYTES)}; hiển thị dạng văn bản thuần.</span>
        </div>
        <div className="read-row">
          <button type="button" className="btn btn-primary" disabled={!draft.trim()} onClick={() => void openText('Văn bản đã dán', draft, null)}>
            <IconBook /> Đọc văn bản này
          </button>
          <label className="btn" htmlFor="read-txt">
            Nhập tệp .txt hoặc .md
          </label>
          <input
            id="read-txt"
            className="visually-hidden"
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onTextFile(file);
              event.target.value = '';
            }}
          />
        </div>
        <label className="switch">
          <input type="checkbox" checked={keepBytes} onChange={(event) => setKeepBytes(event.target.checked)} />
          <span>Giữ nội dung trên thiết bị để mở lại sau</span>
        </label>
        {status ? <p className="muted text-sm" role="status" aria-live="polite">{status}</p> : null}
      </section>

      {reading ? (
        <section className="stack" aria-label="Đang đọc">
          <div className="read-row">
            <h2 className="text-lg read-title">{reading.name}</h2>
            <span className="spacer" />
            <span className={`badge ${reading.stored ? 'badge-ok' : 'badge-warn'}`}>
              {reading.stored ? 'đã giữ nội dung' : 'chưa giữ nội dung'}
            </span>
            <button type="button" className="btn btn-sm" onClick={stopReading}>
              Đóng
            </button>
          </div>
          <DocumentSurface text={reading.text} name={reading.name} showAnnotations={showAnnotations} lineHeight={lineHeight} />
          {reading.stored ? null : (
            <div className="read-row">
              <button type="button" className="btn btn-sm" onClick={() => void keepBytesNow()}>
                Giữ nội dung ngay
              </button>
              <span className="text-sm faint">Hiện văn bản chỉ tồn tại trong thẻ này.</span>
            </div>
          )}
        </section>
      ) : null}

      <section className="card read-column" aria-label="Văn bản trên thiết bị">
        <div className="read-row">
          <h2>Văn bản đã lưu ở đây</h2>
          <span className="spacer" />
          <span className="badge">{documents.length}</span>
        </div>
        {documents.length === 0 ? (
          <EmptyState title="Chưa có văn bản" detail="Văn bản bạn mở sẽ được liệt kê ở đây. Không có gì được tải lên; xóa là xóa khỏi thiết bị này." icon={<IconBook />} />
        ) : (
          <ul className="read-docs">
            {documents.map((row) => (
              <li className="item read-doc" key={row.id}>
                {renamingId === row.id ? (
                  <form
                    className="read-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void commitRename(row, renameValue);
                    }}
                  >
                    <div className="field">
                      <label htmlFor={`rename-${row.id}`}>Tên mới cho “{row.name}”</label>
                      <input
                        id={`rename-${row.id}`}
                        className="input"
                        value={renameValue}
                        maxLength={120}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setRenamingId(null);
                        }}
                        autoFocus
                      />
                    </div>
                    <span className="item-side">
                      <button type="submit" className="btn btn-sm">
                        Lưu
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRenamingId(null)}>
                        Hủy
                      </button>
                    </span>
                  </form>
                ) : (
                  <>
                    <button type="button" className="btn btn-ghost read-doc-main" onClick={() => void reopen(row)} disabled={!row.stored}>
                      <span className="item-main">
                        <strong>{row.name}</strong>
                        <span className="faint text-sm">
                          {formatBytes(row.bytes)} · {row.stored ? 'đã giữ' : 'không giữ nội dung — mở lại từ tệp gốc'}
                        </span>
                      </span>
                    </button>
                    <span className="item-side">
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => {
                          setRenamingId(row.id);
                          setRenameValue(row.name);
                        }}
                      >
                        Đổi tên
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setPendingDelete(row)}>
                        <IconTrash /> Xóa
                      </button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm faint">
          Xóa sẽ bỏ văn bản và nội dung khỏi IndexedDB trên thiết bị này. Những từ bạn đã lưu vẫn còn trong sổ tay.
        </p>
      </section>

      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        title="Xóa văn bản này khỏi thiết bị?"
        body={
          <p>
            <strong>{pendingDelete?.name ?? ''}</strong> và bản sao trong trình duyệt sẽ bị xóa. Những từ bạn đã lưu khi đọc vẫn còn trong sổ tay.
          </p>
        }
        confirmLabel="Xóa văn bản"
        onConfirm={() => {
          if (pendingDelete) void removeDocument(pendingDelete);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ gloss popover */

interface Focus {
  x: number;
  y: number;
  label: string;
  entries: DictEntry[];
}

/** The gloss is `position: fixed`, so it receives viewport coordinates; these caps are the
   `.read-gloss` max box from reading.css, used only to keep the card out of the window edges. */
const GLOSS_MAX_WIDTH = 384;
const GLOSS_MAX_HEIGHT = 420;
const GLOSS_EDGE = 8;

function useGlossPop(api: DictionaryApi | null) {
  const [focus, setFocus] = useState<Focus | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focus) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setFocus(null);
    };
    document.addEventListener('keydown', onKey);
    ref.current?.focus({ preventScroll: true });
    return () => document.removeEventListener('keydown', onKey);
  }, [focus]);

  const open = useCallback((label: string, entries: DictEntry[], x: number, y: number) => {
    setFocus({
      x: Math.min(Math.max(GLOSS_EDGE, x), Math.max(GLOSS_EDGE, window.innerWidth - GLOSS_MAX_WIDTH - GLOSS_EDGE)),
      y: Math.min(Math.max(GLOSS_EDGE, y), Math.max(GLOSS_EDGE, window.innerHeight - GLOSS_MAX_HEIGHT - GLOSS_EDGE)),
      label,
      entries,
    });
  }, []);

  const close = useCallback(() => setFocus(null), []);

  /** Longest-first match inside whatever the reader highlighted. */
  const lookup = useCallback(
    async (raw: string, x: number, y: number) => {
      if (!api) return;
      const wanted = raw.trim().slice(0, 60);
      if (!wanted || !hasCjk(wanted)) return;
      const found = await api.spans(wanted, Math.max(1, [...wanted].length));
      if (found.length > 0) {
        open(`“${found[0].text}” trong đoạn chọn`, found[0].entries, x, y);
        return;
      }
      open(`“${wanted}”`, await api.headword(wanted), x, y);
    },
    [api, open],
  );

  const fromSelection = useCallback(
    (event: { clientX?: number; clientY?: number }) => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;
      const rect = selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null;
      const x = rect?.left ?? event.clientX ?? 0;
      const y = (rect?.bottom ?? event.clientY ?? 0) + 4;
      void lookup(selection.toString(), x, y);
    },
    [lookup],
  );

  const popover = focus ? (
    <div
      ref={ref}
      className="card card-tight read-gloss"
      role="dialog"
      aria-modal="false"
      aria-label={`Chú giải cho ${focus.label}`}
      tabIndex={-1}
      style={{ left: focus.x, top: focus.y }}
    >
      <div className="read-row">
        <span className="text-sm muted">{focus.label}</span>
        <span className="spacer" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={close}>
          Đóng
        </button>
      </div>
      {focus.entries.length === 0 ? (
        <p className="text-sm muted" role="status">
          Không có mục từ điển nào trong dữ liệu đã tải khớp với đoạn này.
        </p>
      ) : null}
      {focus.entries.map((entry) => (
        <div className="read-gloss-entry" key={entry.id}>
          <div className="read-row">
            <HanziText entry={entry} size="md" />
            <PinyinText entry={entry} />
            <span className="spacer" />
            <SpeakButton text={entry.simplified} label={`Nghe ${entry.simplified}`} />
            <SaveButton entry={entry} />
          </div>
          <DefinitionText entry={entry} />
          <Link className="btn btn-sm btn-ghost" to={`/entry/${encodeURIComponent(entry.id)}`} onClick={close}>
            Mở mục từ đầy đủ
          </Link>
        </div>
      ))}
      <p className="text-sm faint">Chú giải từ điển — ứng dụng không dịch cả câu.</p>
    </div>
  ) : null;

  return { open, close, lookup, fromSelection, popover, focusedLabel: focus?.label ?? null };
}

/* ------------------------------------------------------------------ text surface */

interface Token {
  text: string;
  span: TextSpan | null;
}

function toTokens(chars: string[], spans: TextSpan[]): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) tokens.push({ text: chars.slice(cursor, span.start).join(''), span: null });
    tokens.push({ text: chars.slice(span.start, span.end).join(''), span });
    cursor = span.end;
  }
  if (cursor < chars.length) tokens.push({ text: chars.slice(cursor).join(''), span: null });
  return tokens;
}

interface Measure {
  words: number;
  hanChars: number;
  coverage: number;
  kept: number;
}

function measure(text: string, spans: TextSpan[], keptIds: Set<string>): Measure {
  const hanChars = [...text].filter(isHanCharacter).length;
  const covered = spans.reduce((sum, span) => sum + [...span.text].length, 0);
  const kept = spans.filter((span) => span.entries.some((entry) => keptIds.has(entry.id))).length;
  return {
    words: spans.length,
    hanChars,
    coverage: hanChars > 0 ? Math.round((covered / hanChars) * 100) : 0,
    kept,
  };
}

function StatGrid({ items, note }: { items: { value: string | number; label: string }[]; note?: string }) {
  return (
    <div className="read-stats" role="status" aria-live="polite">
      {items.map((item) => (
        <span className="read-stat" key={item.label}>
          <strong>{item.value}</strong>
          <span className="text-sm muted">{item.label}</span>
        </span>
      ))}
      {note ? <span className="text-sm faint">{note}</span> : null}
    </div>
  );
}

function DocumentSurface({ text, name, showAnnotations, lineHeight }: { text: string; name: string; showAnnotations: boolean; lineHeight: number }) {
  const { api } = useDictionary();
  const { saved } = useSavedWords();
  const [spans, setSpans] = useState<TextSpan[]>([]);
  const [status, setStatus] = useState('Đang đối chiếu văn bản với từ điển…');
  const [indexSize, setIndexSize] = useState<{ entries: number; partial: boolean } | null>(null);
  const [packCoverage, setPackCoverage] = useState<{ total: number; covered: number } | null>(null);
  const pop = useGlossPop(api);

  const keptIds = useMemo(() => new Set(saved.map((word) => word.id)), [saved]);
  const stats = useMemo(() => measure(text, spans, keptIds), [text, spans, keptIds]);
  const uniqueHan = useMemo(() => new Set([...text].filter(isHanCharacter)).size, [text]);
  const tokens = useMemo(() => toTokens([...text], spans), [text, spans]);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    setStatus('Đang đối chiếu văn bản với từ điển…');
    void api
      .spans(text, 6)
      .then((found) => {
        if (!alive) return;
        setSpans(found);
        setStatus(found.length > 0 ? `Đã khớp ${found.length} từ trong từ điển.` : 'Không có từ nào trong từ điển khớp văn bản này.');
      })
      .catch(() => {
        if (alive) setStatus('Chỉ mục từ điển không trả lời được cho văn bản này.');
      });
    return () => {
      alive = false;
    };
  }, [api, text]);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    void api
      .search('一', { limit: 1 })
      .then((outcome) => {
        if (alive) setIndexSize(outcome.coverage);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api]);

  useEffect(() => {
    if (!api || uniqueHan === 0) {
      setPackCoverage(null);
      return;
    }
    let alive = true;
    const chars = [...new Set([...text].filter(isHanCharacter))];
    void api
      .characters(chars)
      .then((records) => {
        if (!alive) return;
        const covered = records.filter((r) => r !== null).length;
        setPackCoverage({ total: chars.length, covered });
      })
      .catch(() => {
        if (alive) setPackCoverage(null);
      });
    return () => {
      alive = false;
    };
  }, [api, text, uniqueHan]);

  return (
    <div className="card read-column">
      <StatGrid
        items={[
          { value: stats.words, label: `từ trong “${name}”` },
          { value: stats.hanChars, label: 'chữ Hán (tổng)' },
          { value: uniqueHan, label: 'chữ khác nhau' },
          {
            value: packCoverage
              ? `${Math.round((packCoverage.covered / Math.max(1, packCoverage.total)) * 100)}%`
              : `${stats.coverage}%`,
            label: 'chữ có trong gói dữ liệu',
          },
          { value: stats.kept, label: 'từ đã lưu' },
        ]}
      />
      <p className="text-sm faint" role="note">
        {status}
        {indexSize
          ? ` Đo trên ${indexSize.entries.toLocaleString()} mục đã tải${indexSize.partial ? ' (chỉ mục chưa đầy đủ)' : ''}.`
          : ''}{' '}
        Độ phủ cho biết chữ có trong gói dữ liệu, không phải bạn đã biết từ đó trong ngữ cảnh.
      </p>
      <div className="read-surface">
        <div
          className={`read-text${showAnnotations ? '' : ' no-annot'}`}
          lang="zh"
          style={{ lineHeight }}
          onMouseUp={pop.fromSelection}
        >
          {tokens.map((token, index) =>
            token.span ? (
              <button
                key={`${index}-${token.text.slice(0, 4)}`}
                type="button"
                className={`read-word${showAnnotations ? '' : ' no-annot'}${token.span.entries.some((entry) => keptIds.has(entry.id)) && showAnnotations ? ' is-kept' : ''}`}
                aria-current={pop.focusedLabel === `“${token.text}”` ? 'true' : undefined}
                aria-label={`Tra ${token.text}: ${token.span.entries[0]?.definition ?? 'không có chú giải'}`}
                onClick={(event) => {
                  pop.open(`“${token.text}”`, token.span?.entries ?? [], event.clientX, event.clientY + 6);
                }}
              >
                {token.text}
              </button>
            ) : (
              <span key={`${index}-plain`} className="read-plain">
                {token.text}
              </span>
            ),
          )}
        </div>
        {pop.popover}
      </div>
      <p className="text-sm faint">
        Chạm vào từ có gạch chân để xem nghĩa, hoặc bôi đen một cụm. Chú giải lấy từ dữ liệu từ điển đã tải.
      </p>
    </div>
  );
}

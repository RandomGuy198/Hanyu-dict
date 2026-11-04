/** Local reading desk: pasted or imported text and local PDFs, with dictionary glosses under
 *  the finger.
 *
 *  This screen looks words up — it does not machine-translate, and there is deliberately no
 *  translate button. Documents and their bytes stay in IndexedDB on this device; the PDF engine
 *  is only loaded when a PDF is opened, and pages are virtualised so a long book keeps only the
 *  pages near the one you are reading.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { PDFDocumentProxy } from 'pdfjs-dist';
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
import { IconAlert, IconBook, IconChevronLeft, IconTrash } from '../../app/icons';
import { formatBytes, uid } from '../../app/hooks';
import { useDictionary, usePreferences, useSavedWords, useToast } from '../../app/providers';
import { bumpActivity, db, todayKey } from '../../data/db';
import { readFileAsText } from '../../data/exportImport';
import type { DictionaryApi } from '../../data/dictionary';
import type { DictEntry, ImportedDocument, Preferences, TextSpan } from '../../domain/types';
import { hasCjk, isHanCharacter } from '../../domain/pinyin';
import {
  closePdf,
  describePdfProblem,
  drawPage,
  isRenderCancelled,
  MAX_PDF_BYTES,
  openPdf,
  pageSize,
  pdfMemoryCaution,
  releaseTextLayer,
  sampleText,
  type PageBox,
  type PdfProblem,
} from './pdfEngine';
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
  kind: 'text' | 'pdf';
  text: string;
  bytes: number;
  stored: boolean;
  blob: Blob | null;
  doc: PDFDocumentProxy | null;
}

function Desk() {
  const { prefs, update } = usePreferences();
  const toast = useToast();
  const [reading, setReading] = useState<Reading | null>(null);
  const [draft, setDraft] = useState('');
  const [keepBytes, setKeepBytes] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ info: PdfProblem; blob: Blob } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ImportedDocument | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [lineHeight, setLineHeight] = useState<number>(1.9);
  const documents = useLiveQuery(() => db.documents.orderBy('addedAt').reverse().toArray(), [], []);

  useEffect(
    () => () => {
      releaseTextLayer();
      void closePdf(reading?.doc ?? null);
    },
    [reading?.doc],
  );

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
          // Quota exceeded: document metadata remains, bytes are not kept.
          await db.documents.update(id, { stored: false });
          stored = false;
          toast.push({ message: 'Browser storage is full — the document was listed but its bytes were not kept.', tone: 'warn' });
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
        toast.push({ message: `That text is ${formatBytes(bytes)} — too big to render in one piece. Split it into smaller files.`, tone: 'danger' });
        return;
      }
      const saved = await storeDocument({ name, kind: 'text', bytes }, blob);
      await bumpActivity(todayKey(), { readings: 1 });
      setReading({ id: saved.id, name, kind: 'text', text, bytes, stored: saved.stored, blob, doc: null });
      show('Document ready.');
    },
    [show, storeDocument, toast],
  );

  const openBytes = useCallback(
    async (name: string, bytes: Uint8Array, blob: Blob, password?: string) => {
      setStatus('Opening the PDF in a worker thread…');
      try {
        const doc = await openPdf(bytes, password);
        const saved = await storeDocument({ name, kind: 'pdf', bytes: blob.size, pageCount: doc.numPages }, blob);
        await bumpActivity(todayKey(), { readings: 1 });
        setProblem(null);
        setStatus(null);
        setReading({ id: saved.id, name, kind: 'pdf', text: '', bytes: blob.size, stored: saved.stored, blob, doc });
      } catch (error) {
        setStatus(null);
        setProblem({ info: describePdfProblem(error), blob });
      }
    },
    [storeDocument],
  );

  const onTextFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_TEXT_BYTES) {
        toast.push({ message: `${file.name} is ${formatBytes(file.size)}, above the ${formatBytes(MAX_TEXT_BYTES)} this screen renders.`, tone: 'danger' });
        return;
      }
      try {
        const text = await readFileAsText(file);
        if (!text.trim()) {
          toast.push({ message: `${file.name} contains no text.`, tone: 'warn' });
          return;
        }
        await openText(file.name, text, file);
      } catch (error) {
        toast.push({ message: error instanceof Error ? error.message : 'The file could not be read.', tone: 'danger' });
      }
    },
    [openText, toast],
  );

  const onPdfFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_PDF_BYTES) {
        toast.push({ message: `This PDF is ${formatBytes(file.size)}. Above ${formatBytes(MAX_PDF_BYTES)} it will likely run out of memory — open a smaller file.`, tone: 'danger' });
        return;
      }
      const caution = pdfMemoryCaution(file.size);
      if (caution) toast.push({ message: caution, tone: 'warn' });
      show('Reading the file from this device…');
      try {
        const buffer = await file.arrayBuffer();
        await openBytes(file.name, new Uint8Array(buffer), file);
      } catch (error) {
        setStatus(null);
        toast.push({ message: `The file could not be read: ${error instanceof Error ? error.message : 'unknown error'}`, tone: 'danger' });
      }
    },
    [openBytes, show, toast],
  );

  const keepBytesNow = useCallback(async () => {
    if (!reading || reading.stored) return;
    const blob = reading.blob ?? new Blob([reading.text], { type: 'text/plain' });
    try {
      await db.documentBlobs.put({ id: reading.id, blob });
      await db.documents.update(reading.id, { stored: true, bytes: blob.size });
      setReading({ ...reading, stored: true, blob, bytes: blob.size });
      toast.push('File bytes stored on this device');
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      toast.push({
        message:
          name === 'QuotaExceededError'
            ? `Could not keep the bytes: this device's browser storage is full (${formatBytes(blob.size)} needed). Try deleting other documents.`
            : `Could not store the bytes: ${error instanceof Error ? error.message : 'unknown error'}.`,
        tone: 'danger',
      });
    }
  }, [reading, toast]);

  const reopen = useCallback(
    async (row: ImportedDocument) => {
      const record = await db.documentBlobs.get(row.id);
      if (!record) {
        toast.push({ message: 'The bytes of this document were not kept, so only its name is left. Re-import the file to read it again.', tone: 'warn' });
        return;
      }
      if (row.kind === 'pdf') {
        const buffer = await record.blob.arrayBuffer();
        await openBytes(row.name, new Uint8Array(buffer), record.blob);
        return;
      }
      const text = await record.blob.text();
      setReading({ id: row.id, name: row.name, kind: 'text', text, bytes: row.bytes, stored: true, blob: record.blob, doc: null });
    },
    [openBytes, toast],
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
      toast.push('Document renamed on this device');
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
      toast.push('Document and its bytes deleted from this device');
    },
    [reading, stopReading, toast],
  );

  return (
    <div className="stack read-page">
      <PageHeader
        title="Reading desk"
        subtitle="Paste or import a .txt/.md file, or open a PDF from this device. Tap a Chinese word for its dictionary gloss."
      />

      <p className="notice notice-info read-lead" role="note">
        <IconAlert />
        <span>
          <strong>Glosses, not translation.</strong> Words are matched against the dictionary data
          installed on this device, longest run first. Nothing is sent anywhere: files, images and
          notes stay in this browser's storage, and there is nothing to pay for.
        </span>
      </p>

      <section className="card read-column" aria-label="Reading controls">
        <div className="read-controls">
          <Segmented
            label="Text size"
            value={String(prefs.textScale)}
            options={[
              { value: '0.9', label: 'Small' },
              { value: '1', label: 'Normal' },
              { value: '1.15', label: 'Large' },
              { value: '1.3', label: 'Huge' },
            ]}
            onChange={(value) => update({ textScale: Number(value) })}
          />
          <Segmented
            label="Line height"
            value={String(lineHeight)}
            options={[
              { value: '1.6', label: 'Tight' },
              { value: '1.9', label: 'Normal' },
              { value: '2.2', label: 'Relaxed' },
              { value: '2.6', label: 'Spacious' },
            ]}
            onChange={(value) => setLineHeight(Number(value))}
          />
          <Segmented
            label="Theme"
            value={prefs.theme}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            onChange={(value) => update({ theme: value as Preferences['theme'] })}
          />
          <Segmented
            label="Script shown"
            value={prefs.displayScript}
            options={[
              { value: 'simplified', label: 'Simplified' },
              { value: 'traditional', label: 'Traditional' },
              { value: 'both', label: 'Both' },
            ]}
            onChange={(value) => update({ displayScript: value as Preferences['displayScript'] })}
          />
          <label className="switch">
            <input type="checkbox" checked={prefs.showPinyin} onChange={(event) => update({ showPinyin: event.target.checked })} />
            <span>Show pinyin in glosses</span>
          </label>
          <label className="switch">
            <input type="checkbox" checked={showAnnotations} onChange={(event) => setShowAnnotations(event.target.checked)} />
            <span>Show dictionary highlights</span>
          </label>
        </div>
        <p className="text-sm faint">Size and theme are saved in your preferences, so every screen follows them. Line height is local to this screen.</p>
      </section>

      <section className="card read-column read-import" aria-label="Add something to read">
        <div className="field">
          <label htmlFor="read-paste">Paste text to read</label>
          <textarea
            id="read-paste"
            className="textarea cjk"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="把要读的内容粘贴在这里…"
          />
          <span className="help">Up to {formatBytes(MAX_TEXT_BYTES)}; shown as plain text, including any markdown marks.</span>
        </div>
        <div className="read-row">
          <button type="button" className="btn btn-primary" disabled={!draft.trim()} onClick={() => void openText('Pasted text', draft, null)}>
            <IconBook /> Read this text
          </button>
          <label className="btn" htmlFor="read-txt">
            Import .txt or .md
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
          <label className="btn" htmlFor="read-pdf">
            Open a PDF from this device
          </label>
          <input
            id="read-pdf"
            className="visually-hidden"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onPdfFile(file);
              event.target.value = '';
            }}
          />
        </div>
        <p className="text-sm faint">Maximum file sizes: text {formatBytes(MAX_TEXT_BYTES)}, PDF {formatBytes(MAX_PDF_BYTES)} (above which the browser is likely to run out of memory).</p>
        <label className="switch">
          <input type="checkbox" checked={keepBytes} onChange={(event) => setKeepBytes(event.target.checked)} />
          <span>Keep this document's bytes on the device so I can reopen it later</span>
        </label>
        {status ? <p className="muted text-sm" role="status" aria-live="polite">{status}</p> : null}
      </section>

      {problem ? (
        <section className="card read-column" aria-label="PDF problem">
          <p className="notice notice-danger" role="alert">
            <IconAlert />
            <span>
              <strong>{problem.info.title}. </strong>
              {problem.info.detail}
            </span>
          </p>
          <PasswordForm
            needsPassword={problem.info.needsPassword}
            busy={status !== null}
            onSubmit={async (password) => {
              const buffer = await problem.blob.arrayBuffer();
              await openBytes('Protected PDF', new Uint8Array(buffer), problem.blob, password);
            }}
          />
          <div className="read-row">
            <button type="button" className="btn" onClick={() => setProblem(null)}>
              Leave this PDF closed
            </button>
          </div>
        </section>
      ) : null}

      {reading ? (
        <section className="stack" aria-label="Now reading">
          <div className="read-row">
            <h2 className="text-lg read-title">{reading.name}</h2>
            <span className="spacer" />
            <span className={`badge ${reading.stored ? 'badge-ok' : 'badge-warn'}`}>
              {reading.stored ? 'bytes kept on this device' : 'bytes not kept'}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => void stopReading()}>
              Close
            </button>
          </div>
          {reading.kind === 'text' ? (
            <>
              <DocumentSurface text={reading.text} name={reading.name} showAnnotations={showAnnotations} lineHeight={lineHeight} />
              {reading.stored ? null : (
                <div className="read-row">
                  <button type="button" className="btn btn-sm" onClick={() => void keepBytesNow()}>
                    Keep the bytes now
                  </button>
                  <span className="text-sm faint">Right now the text lives only in this tab.</span>
                </div>
              )}
            </>
          ) : reading.doc ? (
            <PdfReader doc={reading.doc} name={reading.name} />
          ) : null}
        </section>
      ) : null}

      <section className="card read-column" aria-label="Documents on this device">
        <div className="read-row">
          <h2>Documents stored here</h2>
          <span className="spacer" />
          <span className="badge">{documents.length}</span>
        </div>
        {documents.length === 0 ? (
          <EmptyState title="No documents yet" detail="Imported files are listed here once you open them. Nothing is uploaded — deleting removes the copy from this device." icon={<IconBook />} />
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
                      <label htmlFor={`rename-${row.id}`}>New name for “{row.name}”</label>
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
                        Save
                      </button>
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRenamingId(null)}>
                        Cancel
                      </button>
                    </span>
                  </form>
                ) : (
                  <>
                    <button type="button" className="btn btn-ghost read-doc-main" onClick={() => void reopen(row)} disabled={!row.stored}>
                      <span className="item-main">
                        <strong>{row.name}</strong>
                        <span className="faint text-sm">
                          {row.kind === 'pdf' ? `PDF${row.pageCount ? ` · ${row.pageCount} pages` : ''}` : 'Text'} · {formatBytes(row.bytes)} ·{' '}
                          {row.stored ? 'kept' : 'bytes not kept — open from the original file again'}
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
                        Rename
                      </button>
                      <button type="button" className="btn btn-sm" onClick={() => setPendingDelete(row)}>
                        <IconTrash /> Delete
                      </button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm faint">
          Delete removes the document and its bytes from IndexedDB on this device. Saved words you
          made while reading stay in your lists.
        </p>
      </section>

      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        title="Delete this document from this device?"
        body={
          <p>
            <strong>{pendingDelete?.name ?? ''}</strong> and the copy of its bytes kept in this
            browser will be erased. Words you saved while reading it stay in your lists.
          </p>
        }
        confirmLabel="Delete document"
        onConfirm={() => {
          if (pendingDelete) void removeDocument(pendingDelete);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function PasswordForm({ needsPassword, busy, onSubmit }: { needsPassword: boolean; busy: boolean; onSubmit: (password: string) => Promise<void> }) {
  const [value, setValue] = useState('');
  if (!needsPassword) return null;
  return (
    <form
      className="read-row"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(value);
      }}
    >
      <div className="field read-password">
        <label htmlFor="read-password">Document password</label>
        <input id="read-password" className="input" type="password" value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" />
        <span className="help">Used only in this tab to decrypt the local copy; never stored or sent.</span>
      </div>
      <button type="submit" className="btn btn-primary" disabled={!value || busy}>
        Try the password
      </button>
    </form>
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
        open(`“${found[0].text}” from the selection`, found[0].entries, x, y);
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
      aria-label={`Gloss for ${focus.label}`}
      tabIndex={-1}
      style={{ left: focus.x, top: focus.y }}
    >
      <div className="read-row">
        <span className="text-sm muted">{focus.label}</span>
        <span className="spacer" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={close}>
          Close
        </button>
      </div>
      {focus.entries.length === 0 ? (
        <p className="text-sm muted" role="status">
          No dictionary line in the data installed on this device matches that text.
        </p>
      ) : null}
      {focus.entries.map((entry) => (
        <div className="read-gloss-entry" key={entry.id}>
          <div className="read-row">
            <HanziText entry={entry} size="md" />
            <PinyinText entry={entry} />
            <span className="spacer" />
            <SpeakButton text={entry.simplified} label={`Play ${entry.simplified} with the device voice`} />
            <SaveButton entry={entry} />
          </div>
          <DefinitionText entry={entry} />
          <Link className="btn btn-sm btn-ghost" to={`/entry/${encodeURIComponent(entry.id)}`} onClick={close}>
            Open full entry
          </Link>
        </div>
      ))}
      <p className="text-sm faint">Dictionary gloss — this app does not translate the sentence.</p>
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
  const [status, setStatus] = useState('Matching this document against the dictionary…');
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
    setStatus('Matching this document against the dictionary…');
    void api
      .spans(text, 6)
      .then((found) => {
        if (!alive) return;
        setSpans(found);
        setStatus(found.length > 0 ? `${found.length} dictionary words matched.` : 'No dictionary words matched this text.');
      })
      .catch(() => {
        if (alive) setStatus('The dictionary index could not answer for this text.');
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
          { value: stats.words, label: `dictionary words in “${name}”` },
          { value: stats.hanChars, label: 'Chinese characters (total)' },
          { value: uniqueHan, label: 'unique characters' },
          {
            value: packCoverage
              ? `${Math.round((packCoverage.covered / Math.max(1, packCoverage.total)) * 100)}%`
              : `${stats.coverage}%`,
            label: 'characters found in installed packs',
          },
          { value: stats.kept, label: 'words already saved' },
        ]}
      />
      <p className="text-sm faint" role="note">
        {status}
        {indexSize
          ? ` Measured against ${indexSize.entries.toLocaleString()} entries installed on this device${indexSize.partial ? ' (index is partial)' : ''}.`
          : ''}{' '}
        Coverage counts whether a character exists in the installed packs, not whether you know the
        word it forms in context.
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
                aria-label={`Look up ${token.text}: ${token.span.entries[0]?.definition ?? 'no gloss'}`}
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
        Tap any underlined word for its gloss, or drag to highlight a phrase. Glosses come from the
        installed dictionary data; the app never translates the surrounding sentence for you.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ pdf surface */

const NEARBY_PAGES = 1;

function PdfReader({ doc, name }: { doc: PDFDocumentProxy; name: string }) {
  const { api } = useDictionary();
  const [current, setCurrent] = useState(1);
  const [scale, setScale] = useState(1);
  const [box, setBox] = useState<PageBox | null>(null);
  const [sample, setSample] = useState<{ text: string; chars: number; pagesSampled: number; truncated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pop = useGlossPop(api);

  useEffect(() => {
    let alive = true;
    void pageSize(doc, 1, 1)
      .then((raw) => {
        if (!alive) return;
        setBox(raw);
        const available = (scroller.current?.clientWidth ?? 720) - 24;
        setScale(Math.max(0.35, Math.min(2.2, available / raw.width)));
      })
      .catch((failure: unknown) => {
        if (alive) setError(describePdfProblem(failure).detail);
      });
    void sampleText(doc)
      .then((found) => {
        if (alive) setSample(found);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [doc]);

  useEffect(() => {
    const onResize = () => {
      if (!box) return;
      const available = (scroller.current?.clientWidth ?? 720) - 24;
      setScale(Math.max(0.35, Math.min(2.2, available / box.width)));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [box]);

  const pageHeight = box ? box.height * scale + 28 : 900;
  const onScroll = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const next = Math.min(doc.numPages, Math.max(1, Math.floor(element.scrollTop / pageHeight) + 1));
    setCurrent((previous) => (previous === next ? previous : next));
  }, [doc.numPages, pageHeight]);

  const jump = useCallback((page: number) => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTop = (page - 1) * pageHeight;
    setCurrent(page);
  }, [pageHeight]);

  const first = Math.max(1, current - NEARBY_PAGES);
  const last = Math.min(doc.numPages, current + NEARBY_PAGES);
  const noTextLayer = sample !== null && sample.chars === 0;

  return (
    <div className="card read-column">
      <div className="read-row">
        <button type="button" className="btn btn-sm" onClick={() => jump(current - 1)} disabled={current <= 1} aria-label="Previous page">
          <IconChevronLeft /> Prev
        </button>
        <label className="row" htmlFor="read-page">
          Page
          <input
            id="read-page"
            className="input read-jump"
            type="number"
            min={1}
            max={doc.numPages}
            value={current}
            onChange={(event) => jump(Number(event.target.value) || 1)}
          />
        </label>
        <span className="text-sm muted">of {doc.numPages}</span>
        <button type="button" className="btn btn-sm" onClick={() => jump(current + 1)} disabled={current >= doc.numPages}>
          Next
        </button>
        <span className="spacer" />
        <span className="badge" role="status" aria-live="polite">
          {last - first + 1} page{last - first === 0 ? '' : 's'} in memory
        </span>
      </div>

      <p className="text-sm muted" role="status" aria-live="polite">
        {name} · pages are drawn in a worker thread and only the page you are on, plus{' '}
        {NEARBY_PAGES} on each side, are kept in memory.
      </p>
      {error ? <p className="notice notice-danger" role="alert">{error}</p> : null}
      {noTextLayer ? (
        <p className="notice notice-warn" role="status" aria-live="polite">
          <IconAlert />
          <span>
            This PDF has no extractable text layer, so it behaves like a scanned image: you can read
            the pages but not select words. Photograph the page and use{' '}
            <Link to="/capture">Camera &amp; OCR</Link> instead.
          </span>
        </p>
      ) : null}

      <div className="read-scroll" ref={scroller} onScroll={onScroll}>
        {Array.from({ length: doc.numPages }, (_, index) => index + 1).map((pageNumber) =>
          pageNumber >= first && pageNumber <= last ? (
            <PageView key={pageNumber} doc={doc} pageNumber={pageNumber} scale={scale} pop={pop} />
          ) : (
            <div
              key={pageNumber}
              className="read-placeholder"
              style={{ height: pageHeight, width: box ? Math.round(box.width * scale) : '100%' }}
              aria-hidden="true"
            />
          ),
        )}
      </div>

      {sample && sample.chars > 0 ? (
        <Coverage text={sample.text} note={`From page${sample.pagesSampled === 1 ? '' : 's'} 1–${sample.pagesSampled} of ${doc.numPages}${sample.truncated ? ' (the rest is not held in memory)' : ''}`} />
      ) : null}
      {pop.popover}
    </div>
  );
}

function PageView({ doc, pageNumber, scale, pop }: { doc: PDFDocumentProxy; pageNumber: number; scale: number; pop: ReturnType<typeof useGlossPop> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const cancel = useRef<() => void>(() => undefined);
  const [state, setState] = useState<'drawing' | 'ready' | 'notext'>('drawing');

  useEffect(() => {
    const canvasNode = canvas.current;
    const layerNode = layer.current;
    if (!canvasNode || !layerNode) return;
    let alive = true;
    setState('drawing');
    void drawPage(doc, pageNumber, canvasNode, layerNode, scale, (fn) => {
      cancel.current = fn;
    })
      .then(({ hasText }) => {
        if (alive) setState(hasText ? 'ready' : 'notext');
      })
      .catch((error: unknown) => {
        if (!alive || isRenderCancelled(error)) return;
        setState('notext');
      });
    return () => {
      alive = false;
      cancel.current();
      layerNode.replaceChildren();
    };
  }, [doc, pageNumber, scale]);

  return (
    <div className="read-page">
      <p className="read-pagehead">
        Page {pageNumber}
        {state === 'drawing' ? <span className="badge">drawing…</span> : null}
        {state === 'notext' ? <span className="badge badge-warn">no text layer on this page</span> : null}
        {state === 'ready' ? <span className="badge badge-ok">text selectable</span> : null}
      </p>
      {/* The layer is positioned from the viewport scale, so it must share a box with the canvas
          and nothing else — the page caption sits outside it to keep the glyphs aligned. */}
      <div className="read-pagebox">
        <canvas ref={canvas} />
        <div
          ref={layer}
          className="read-textlayer"
          onMouseUp={pop.fromSelection}
          aria-label={`Text layer of page ${pageNumber}`}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ coverage */

function Coverage({ text, note }: { text: string; note: string }) {
  const { api } = useDictionary();
  const { saved } = useSavedWords();
  const [spans, setSpans] = useState<TextSpan[]>([]);
  const keptIds = useMemo(() => new Set(saved.map((word) => word.id)), [saved]);
  const stats = useMemo(() => measure(text, spans, keptIds), [text, spans, keptIds]);

  useEffect(() => {
    if (!api) return;
    let alive = true;
    void api
      .spans(text, 6)
      .then((found) => {
        if (alive) setSpans(found);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api, text]);

  return (
    <StatGrid
      note={note}
      items={[
        { value: stats.words, label: 'dictionary words found' },
        { value: stats.hanChars, label: 'Chinese characters in the sampled text' },
        { value: `${stats.coverage}%`, label: 'of characters covered' },
        { value: stats.kept, label: 'already saved' },
      ]}
    />
  );
}

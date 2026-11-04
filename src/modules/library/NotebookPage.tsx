/** /notebook/:id — one notebook of free-text and looked-up notes. Add from the dictionary or as
 *  plain text, edit title/body, tag a category, search and filter, delete, and import a .txt/.csv
 *  picked from the device (client-side, size-capped, never uploaded). Categories are an additive tag
 *  stored on the row — see helpers.ts. */

import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { MAX_IMPORT_BYTES, readFileAsText } from '../../data/exportImport';
import { formatDate, uid } from '../../app/hooks';
import { useDictionary, useToast } from '../../app/providers';
import { ConfirmDialog, EmptyState, PageHeader } from '../../components';
import { IconBook, IconCards, IconPen, IconSearch, IconSpark, IconTrash } from '../../app/icons';
import type { NotebookEntry, SearchResult } from '../../domain/types';
import { tagged, trimOrUndefined, type TaggedNotebookEntry } from './helpers';
import './library.css';

type Draft = { title?: string; body?: string; categoryId?: string };
type NewEntry = { title: string; body: string; entryIds: string[] };

export default function NotebookPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const { api, state } = useDictionary();
  const dictReady = state.phase === 'ready' && api !== null;

  const notebook = useLiveQuery(() => db.notebooks.get(id), [id], null);
  const entries = useLiveQuery(() => db.notebookEntries.where('notebookId').equals(id).sortBy('updatedAt'), [id], []);
  const categories = useLiveQuery(() => db.categories.orderBy('name').toArray(), [], []);

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [pendingDelete, setPendingDelete] = useState<NotebookEntry | null>(null);

  const categoryName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...entries].reverse().filter((entry) => {
      const entryCategory = tagged(entry).categoryId ?? '';
      const categoryPasses =
        categoryFilter === '__none'
          ? entryCategory === ''
          : categoryFilter === '' || entryCategory === categoryFilter;
      if (!categoryPasses) return false;
      return !needle || entry.title.toLowerCase().includes(needle) || entry.body.toLowerCase().includes(needle);
    });
  }, [entries, query, categoryFilter]);

  const categoriesUsed = useMemo(() => {
    const set = new Set<string>();
    for (const entry of entries) {
      const categoryId = tagged(entry).categoryId;
      if (categoryId && categoryName.has(categoryId)) set.add(categoryId);
    }
    return set;
  }, [entries, categoryName]);

  function patchDraft(entryId: string, patch: Draft): void {
    setDrafts((current) => ({ ...current, [entryId]: { ...current[entryId], ...patch } }));
  }

  async function mutate(rows: TaggedNotebookEntry[], remove: string[]): Promise<void> {
    const now = new Date().toISOString();
    await db.transaction('rw', db.notebookEntries, db.notebooks, async () => {
      if (rows.length) await db.notebookEntries.bulkPut(rows);
      for (const removeId of remove) await db.notebookEntries.delete(removeId);
      await db.notebooks.update(id, { updatedAt: now });
    });
  }

  async function commit(entry: NotebookEntry): Promise<void> {
    const draft = drafts[entry.id];
    if (!draft) return;
    const next: TaggedNotebookEntry = { ...entry, title: draft.title ?? entry.title, body: draft.body ?? entry.body, updatedAt: new Date().toISOString() };
    if (draft.categoryId !== undefined) {
      if (draft.categoryId) next.categoryId = draft.categoryId;
      else delete next.categoryId;
    }
    try {
      await mutate([next], []);
      setDrafts((current) => {
        const rest = { ...current };
        delete rest[entry.id];
        return rest;
      });
      toast.push('Note saved.');
    } catch (error) {
      console.error('Could not save the note', error);
      toast.push({ message: 'Could not save that note.', tone: 'danger' });
    }
  }

  async function addEntry(partial: NewEntry): Promise<void> {
    const now = new Date().toISOString();
    const row: TaggedNotebookEntry = { id: uid('ne-'), notebookId: id, title: partial.title, body: partial.body, entryIds: partial.entryIds, createdAt: now, updatedAt: now };
    try {
      await mutate([row], []);
    } catch (error) {
      console.error('Could not add the note', error);
      toast.push({ message: 'Could not add that note.', tone: 'danger' });
    }
  }

  async function deleteEntry(): Promise<void> {
    if (!pendingDelete) return;
    try {
      await mutate([], [pendingDelete.id]);
      toast.push({ message: 'Entry deleted.' });
    } catch (error) {
      console.error('Could not delete the entry', error);
      toast.push({ message: 'Could not delete that entry.', tone: 'danger' });
    } finally {
      setPendingDelete(null);
    }
  }

  async function importLines(lines: string[]): Promise<void> {
    const now = new Date().toISOString();
    const rows: TaggedNotebookEntry[] = lines.map((line) => ({
      id: uid('ne-'), notebookId: id, title: line.length > 120 ? `${line.slice(0, 120)}…` : line,
      body: line, entryIds: [], createdAt: now, updatedAt: now,
    }));
    try {
      await mutate(rows, []);
      toast.push({ message: `Imported ${rows.length} ${rows.length === 1 ? 'line' : 'lines'}.` });
    } catch (error) {
      console.error('Could not import the notes', error);
      toast.push({ message: 'Could not import that file.', tone: 'danger' });
    }
  }

  if (notebook === null) {
    return (
      <div className="stack" role="status" aria-live="polite">
        <div className="skeleton" style={{ height: 32, width: '50%' }} />
        <div className="skeleton" style={{ height: 60 }} />
        <div className="skeleton" style={{ height: 60 }} />
      </div>
    );
  }

  if (notebook === undefined) {
    return (
      <div className="lib-page">
        <PageHeader title="Notebook not found" back={{ label: 'Library', to: '/library' }} />
        <EmptyState title="There is no notebook here" detail="This notebook was deleted, or the link is from another device."
          action={<Link to="/library" className="btn btn-primary btn-sm">Back to the library</Link>} />
      </div>
    );
  }

  return (
    <div className="lib-page">
      <PageHeader
        title={notebook.name}
        back={{ label: 'Library', to: '/library' }}
        subtitle={
          <span aria-live="polite">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · {categoriesUsed.size}{' '}
            {categoriesUsed.size === 1 ? 'category' : 'categories'} used · updated {formatDate(notebook.updatedAt)}
          </span>
        }
        actions={<Link to={`/flashcards?notebook=${encodeURIComponent(notebook.id)}`} className="btn btn-sm"><IconCards /> Flashcards</Link>}
      />

      <AddEntry
        dictReady={dictReady}
        onSearch={async (text) => (api ? (await api.search(text, { limit: 15 })).results : [])}
        onAdd={addEntry}
      />

      <section className="lib-section" aria-labelledby="nb-browse-h">
        <div className="section-title">
          <h2 id="nb-browse-h">Entries</h2>
        </div>
        <div className="lib-inline">
          <span className="searchbar">
            <IconSearch />
            <label className="visually-hidden" htmlFor="nb-search">Search entries</label>
            <input id="nb-search" type="search" placeholder="Search this notebook" value={query} onChange={(e) => setQuery(e.target.value)} />
          </span>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="nb-cat-filter">Filter by category</label>
            <select id="nb-cat-filter" className="select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All categories</option>
              <option value="__none">Uncategorised</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <span className="lib-count" role="status" aria-live="polite">Showing {visible.length} of {entries.length}</span>

        {entries.length === 0 ? (
          <EmptyState icon={<IconBook />} title="No notes yet" detail="Add a note above — free text, a word you looked up, or import a file of lines." />
        ) : visible.length === 0 ? (
          <EmptyState title="Nothing matches" detail="No entry in this notebook fits the current search or category filter." />
        ) : (
          <div className="stack">
            {visible.map((entry) => (
              <EntryEditor key={entry.id} entry={entry} draft={drafts[entry.id]} categories={categories} categoryName={categoryName}
                onChange={(patch) => patchDraft(entry.id, patch)} onSave={() => void commit(entry)} onDelete={() => setPendingDelete(entry)} />
            ))}
          </div>
        )}
      </section>

      <ImportNotes notebookName={notebook.name} onImport={importLines} />

      <ConfirmDialog open={pendingDelete !== null} danger title="Delete this entry?" confirmLabel="Delete"
        body={<p className="text-sm muted">“{pendingDelete?.title || pendingDelete?.body || 'Untitled note'}” will be removed from this notebook permanently. This cannot be undone.</p>}
        onConfirm={() => void deleteEntry()} onCancel={() => setPendingDelete(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ add */

function AddEntry({ dictReady, onSearch, onAdd }: {
  dictReady: boolean;
  onSearch: (text: string) => Promise<SearchResult[]>;
  onAdd: (partial: NewEntry) => Promise<void>;
}) {
  const [mode, setMode] = useState<'text' | 'dict'>('text');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [text, setText] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [busy, setBusy] = useState(false);

  async function submitText(): Promise<void> {
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    if (!cleanTitle && !cleanBody) return;
    await onAdd({ title: cleanTitle || 'Untitled', body: cleanBody, entryIds: [] });
    setTitle('');
    setBody('');
  }

  async function runSearch(): Promise<void> {
    if (!text.trim()) return;
    setBusy(true);
    try {
      setResults(await onSearch(text));
    } catch {
      setResults([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="lib-section card" aria-labelledby="nb-add-h">
      <div className="section-title">
        <h2 id="nb-add-h">Add an entry</h2>
        <span className="spacer" />
        <div className="segmented" role="group" aria-label="Entry source">
          <button type="button" className={`chip ${mode === 'text' ? 'is-active' : ''}`} aria-pressed={mode === 'text'} onClick={() => setMode('text')}>Free text</button>
          <button type="button" className={`chip ${mode === 'dict' ? 'is-active' : ''}`} aria-pressed={mode === 'dict'} disabled={!dictReady} onClick={() => setMode('dict')}>From dictionary</button>
        </div>
      </div>

      {mode === 'text' ? (
        <div className="lib-add-form">
          <div className="field">
            <label htmlFor="nb-new-title">Title (optional)</label>
            <input id="nb-new-title" className="input" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="nb-new-body">Note</label>
            <textarea id="nb-new-body" className="textarea" value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void submitText()} disabled={!title.trim() && !body.trim()}>
            <IconSpark /> Add note
          </button>
        </div>
      ) : !dictReady ? (
        <p className="muted text-sm">The dictionary pack is not installed, so lookup is unavailable. Free text
          and file import still work. <Link to="/offline-data">Manage downloaded data</Link>.</p>
      ) : (
        <div className="lib-add-form">
          <div className="lib-inline">
            <span className="searchbar">
              <IconSearch />
              <label className="visually-hidden" htmlFor="nb-lookup">Look up a word to add</label>
              <input id="nb-lookup" type="search" placeholder="Look up Chinese, pinyin or English" value={text}
                onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }} />
            </span>
            <button type="button" className="btn btn-primary" onClick={() => void runSearch()} disabled={busy || !text.trim()}>Search</button>
          </div>
          {busy ? <p className="muted text-sm" role="status">Searching…</p> : null}
          {results.length > 0 ? (
            <ul className="list" aria-label="Lookup results">
              {results.map((result) => (
                <li key={result.entry.id} className="item">
                  <span className="item-main">
                    <span className="row"><strong className="cjk" lang="zh">{result.entry.simplified}</strong><span className="pinyin">{result.entry.pinyinMarked}</span></span>
                    <span className="definition">{result.entry.definition}</span>
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`Add ${result.entry.simplified} to this notebook`}
                    onClick={() => void onAdd({ title: result.entry.simplified, body: result.entry.definition, entryIds: [result.entry.id] })}>
                    <IconSpark /> Add
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ entry editor */

function EntryEditor({ entry, draft, categories, categoryName, onChange, onSave, onDelete }: {
  entry: NotebookEntry;
  draft?: Draft;
  categories: { id: string; name: string }[];
  categoryName: Map<string, string>;
  onChange: (patch: Draft) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const title = draft?.title ?? entry.title;
  const body = draft?.body ?? entry.body;
  const storedCategory = tagged(entry).categoryId ?? '';
  const categoryId = draft?.categoryId ?? storedCategory;
  const dirty = title !== entry.title || body !== entry.body || categoryId !== storedCategory;
  const currentCategory = categoryId ? categoryName.get(categoryId) : undefined;
  const linked = entry.entryIds.length;

  return (
    <article className="card lib-entry">
      <div className="lib-entry-head">
        <span className="badge">{formatDate(entry.updatedAt)}</span>
        {currentCategory ? <span className="chip is-active" aria-disabled="true">{currentCategory}</span> : null}
        {linked > 0 ? <span className="badge badge-ok">{linked} linked {linked === 1 ? 'word' : 'words'}</span> : null}
      </div>
      <div className="lib-entry-fields">
        <div className="stack" style={{ gap: 'var(--sp-3)' }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor={`${entry.id}-title`}>Title</label>
            <input id={`${entry.id}-title`} className="input" type="text" value={title} onChange={(e) => onChange({ title: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor={`${entry.id}-body`}>Note</label>
            <textarea id={`${entry.id}-body`} className="textarea" value={body} onChange={(e) => onChange({ body: e.target.value })} />
          </div>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor={`${entry.id}-cat`}>Category</label>
          <select id={`${entry.id}-cat`} className="select" value={categoryId} onChange={(e) => onChange({ categoryId: e.target.value })}>
            <option value="">Uncategorised</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div className="lib-actions">
        <button type="button" className="btn btn-sm" onClick={onSave} disabled={!dirty}><IconPen /> Save note</button>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDelete} aria-label="Delete this entry"><IconTrash /> Delete</button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ import */

function ImportNotes({ notebookName, onImport }: { notebookName: string; onImport: (lines: string[]) => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setStatus('That file is larger than the 32 MB limit for imports. Pick a smaller one.');
      return;
    }
    try {
      const text = await readFileAsText(file);
      const lines = text
        .split(/\r?\n/)
        .map((line) => trimOrUndefined(line.replace(/^\uFEFF/, '')))
        .filter((line): line is string => Boolean(line));
      if (lines.length === 0) {
        setStatus('No text lines were found in that file.');
        return;
      }
      setStatus(`Importing ${lines.length} ${lines.length === 1 ? 'line' : 'lines'} from ${file.name}…`);
      await onImport(lines);
      setStatus(`Imported ${lines.length} ${lines.length === 1 ? 'line' : 'lines'} into “${notebookName}”. Nothing left this device.`);
    } catch (error) {
      console.error('Import failed', error);
      setStatus('That file could not be read.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <section className="lib-section card" aria-labelledby="nb-import-h">
      <div className="section-title">
        <h2 id="nb-import-h">Import notes</h2>
      </div>
      <p className="muted text-sm">Pick a <code>.txt</code> or <code>.csv</code> file. Each non-empty line becomes one
        note. The file is read entirely on this device and never uploaded anywhere.</p>
      <div className="field">
        <label htmlFor="nb-import">Choose a file</label>
        <input ref={inputRef} id="nb-import" className="input" type="file" accept=".txt,.csv,text/plain,text/csv"
          onChange={(e) => void handleFile(e.target.files?.[0])} />
      </div>
      {status ? <p className="text-sm muted" role="status" aria-live="polite">{status}</p> : null}
    </section>
  );
}

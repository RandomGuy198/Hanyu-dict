/** /library — the personal-library hub. Saved words, word lists, notebooks and categories, all
 *  read live from IndexedDB. Nothing here needs the dictionary pack: saved words render from their
 *  cached copy and counts come from local tables. The only thing the pack is needed for is opening
 *  a full entry, so that is explained rather than blocked. */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deleteCategoryCascade, deleteListCascade, deleteNotebookCascade } from '../../data/db';
import { formatDate, uid } from '../../app/hooks';
import { useDictionary, useSavedWords, useToast } from '../../app/providers';
import { ConfirmDialog, EmptyState, EntryLine, PageHeader } from '../../components';
import { IconBook, IconCards, IconGrid, IconPen, IconSearch, IconStar, IconTrash } from '../../app/icons';
import type { Category, Notebook, WordList } from '../../domain/types';
import { describeDialog, savedToEntry, tagged, type LibraryDialog } from './helpers';
import { NameDialog } from './NameDialog';
import './library.css';

type DeleteTarget =
  | { kind: 'list'; row: WordList; detached: number }
  | { kind: 'notebook'; row: Notebook; entries: number }
  | { kind: 'category'; row: Category; entries: number; notebooks: number };

function matches(query: string, ...fields: (string | undefined)[]): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return fields.some((field) => (field ?? '').toLowerCase().includes(needle));
}

const nowIso = () => new Date().toISOString();

export default function LibraryPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { saved } = useSavedWords();
  const dictReady = useDictionary().state.phase === 'ready';

  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<LibraryDialog>(null);
  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null);

  const wordLists = useLiveQuery(() => db.wordLists.orderBy('updatedAt').reverse().toArray(), [], []);
  const notebooks = useLiveQuery(() => db.notebooks.orderBy('updatedAt').reverse().toArray(), [], []);
  const categories = useLiveQuery(() => db.categories.orderBy('name').toArray(), [], []);
  const notebookEntries = useLiveQuery(() => db.notebookEntries.toArray(), [], []);

  const listCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const word of saved) for (const listId of word.lists) map.set(listId, (map.get(listId) ?? 0) + 1);
    return map;
  }, [saved]);
  const notebookCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of notebookEntries) map.set(entry.notebookId, (map.get(entry.notebookId) ?? 0) + 1);
    return map;
  }, [notebookEntries]);
  const categoryEntryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of notebookEntries) {
      const id = tagged(entry).categoryId;
      if (id) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [notebookEntries]);
  const categoryNotebookCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const nb of notebooks) if (nb.categoryId) map.set(nb.categoryId, (map.get(nb.categoryId) ?? 0) + 1);
    return map;
  }, [notebooks]);

  const filteredSaved = useMemo(() => saved.filter((w) => matches(query, w.simplified, w.traditional, w.pinyinMarked, w.definition)), [saved, query]);
  const filteredLists = useMemo(() => wordLists.filter((r) => matches(query, r.name, r.description)), [wordLists, query]);
  const filteredNotebooks = useMemo(() => notebooks.filter((r) => matches(query, r.name)), [notebooks, query]);
  const filteredCategories = useMemo(() => categories.filter((r) => matches(query, r.name)), [categories, query]);
  const selectedIds = useMemo(() => saved.filter((w) => selection.has(w.id)).map((w) => w.id), [saved, selection]);

  function toggleSelect(id: string): void {
    setSelection((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function fail(message: string): (error: unknown) => void {
    return (error) => {
      console.error(message, error);
      toast.push({ message: `${message}. The change was not saved.`, tone: 'danger' });
    };
  }

  async function createList(name: string, ids: string[]): Promise<void> {
    const listId = uid('list-');
    const now = nowIso();
    try {
      await db.transaction('rw', db.wordLists, db.savedWords, async () => {
        await db.wordLists.add({ id: listId, name, createdAt: now, updatedAt: now } satisfies WordList);
        if (ids.length) {
          await db.savedWords.where('id').anyOf(ids).modify((word) => {
            if (!word.lists.includes(listId)) word.lists = [...word.lists, listId];
          });
        }
      });
      setSelection(new Set());
      toast.push({
        message: ids.length ? `Created "${name}" with ${ids.length} ${ids.length === 1 ? 'word' : 'words'}.` : `Created "${name}".`,
        actionLabel: 'Open list',
        onAction: () => navigate(`/list/${listId}`),
      });
    } catch (error) {
      fail('Could not create the list')(error);
    }
  }

  async function createNotebook(name: string): Promise<void> {
    const now = nowIso();
    const row: Notebook = { id: uid('nb-'), name, createdAt: now, updatedAt: now };
    try {
      await db.notebooks.add(row);
      toast.push({ message: `Created notebook "${name}".`, actionLabel: 'Open', onAction: () => navigate(`/notebook/${row.id}`) });
    } catch (error) {
      fail('Could not create the notebook')(error);
    }
  }

  async function createCategory(name: string): Promise<void> {
    const row: Category = { id: uid('cat-'), name, createdAt: nowIso() };
    try {
      await db.categories.add(row);
    } catch (error) {
      fail('Could not create the category')(error);
    }
  }

  async function rename(table: 'wordLists' | 'notebooks' | 'categories', id: string, name: string): Promise<void> {
    try {
      await db[table].update(id, table === 'categories' ? { name } : { name, updatedAt: nowIso() });
    } catch (error) {
      fail('Could not rename it')(error);
    }
  }

  async function runDelete(): Promise<void> {
    if (!pendingDelete) return;
    try {
      if (pendingDelete.kind === 'list') await deleteListCascade(pendingDelete.row.id);
      else if (pendingDelete.kind === 'notebook') await deleteNotebookCascade(pendingDelete.row.id);
      else await deleteCategoryCascade(pendingDelete.row.id);
      toast.push({ message: `Deleted "${pendingDelete.row.name}".` });
    } catch (error) {
      fail('Could not complete the deletion')(error);
    } finally {
      setPendingDelete(null);
    }
  }

  function submitDialog(name: string): void {
    if (dialog?.type === 'list-create') void createList(name, dialog.selection);
    else if (dialog?.type === 'list-rename') void rename('wordLists', dialog.id, name);
    else if (dialog?.type === 'notebook-create') void createNotebook(name);
    else if (dialog?.type === 'notebook-rename') void rename('notebooks', dialog.id, name);
    else if (dialog?.type === 'category-create') void createCategory(name);
    else if (dialog?.type === 'category-rename') void rename('categories', dialog.id, name);
    setDialog(null);
  }

  const d = describeDialog(dialog, { wordLists, notebooks, categories });

  return (
    <div className="lib-page">
      <PageHeader
        title="Library"
        subtitle="Words you saved, the lists you grouped them into, your notebooks and categories. Everything lives on this device."
        actions={
          <>
            <button type="button" className="btn btn-sm" onClick={() => setDialog({ type: 'notebook-create' })}><IconPen /> New notebook</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setDialog({ type: 'list-create', selection: [] })}>New list</button>
          </>
        }
      />

      <div className="lib-toolbar">
        <span className="searchbar">
          <IconSearch />
          <label className="visually-hidden" htmlFor="lib-search">Search the library</label>
          <input id="lib-search" type="search" placeholder="Filter saved words, lists, notebooks and categories" value={query} onChange={(e) => setQuery(e.target.value)} />
        </span>
        <span className="lib-count" role="status" aria-live="polite">
          {saved.length} saved · {wordLists.length} lists · {notebooks.length} notebooks · {categories.length} categories
        </span>
      </div>

      {!dictReady ? (
        <div className="notice notice-info">
          <div>
            <strong>Saved words show from your own copy.</strong>
            <p className="text-sm">The dictionary pack is not installed on this device yet, so opening a
              full entry or searching to add words is unavailable — but everything you have saved still
              lists here, with headword, pinyin and meaning.</p>
          </div>
        </div>
      ) : null}

      <section className="lib-section" aria-labelledby="lib-saved-h">
        <div className="section-title">
          <h2 id="lib-saved-h"><IconStar /> Saved words</h2>
          <span className="lib-count" aria-live="polite">{filteredSaved.length} shown</span>
          <span className="spacer" />
          {selectedIds.length > 0 ? (
            <button type="button" className="btn btn-sm" onClick={() => setDialog({ type: 'list-create', selection: selectedIds })}>
              Create list from {selectedIds.length} selected
            </button>
          ) : null}
        </div>
        {saved.length === 0 ? (
          <EmptyState icon={<IconStar />} title="No saved words yet" detail="Search the Dictionary and tap the star on any entry — it lands here." action={<Link to="/" className="btn btn-primary btn-sm">Go to the dictionary</Link>} />
        ) : filteredSaved.length === 0 ? (
          <EmptyState title="Nothing matches that filter." detail={`No saved word matches “${query}”.`} />
        ) : (
          <ul className="list">
            {filteredSaved.map((word) => (
              <EntryLine
                key={word.id}
                entry={savedToEntry(word)}
                trailing={
                  <input
                    type="checkbox"
                    className="lib-select"
                    checked={selection.has(word.id)}
                    onChange={() => toggleSelect(word.id)}
                    aria-label={`Select ${word.simplified}`}
                  />
                }
              />
            ))}
          </ul>
        )}
      </section>

      <section className="lib-section" aria-labelledby="lib-lists-h">
        <div className="section-title">
          <h2 id="lib-lists-h"><IconGrid /> Word lists</h2>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={() => setDialog({ type: 'list-create', selection: [] })}>New list</button>
        </div>
        {wordLists.length === 0 ? (
          <EmptyState title="No lists yet" detail="Group saved words into a list, or select a few above and choose “Create list from selection”." />
        ) : filteredLists.length === 0 ? (
          <EmptyState title="No list matches that filter." />
        ) : (
          <div className="grid-cards">
            {filteredLists.map((list) => (
              <Card key={list.id} title={list.name} count={listCounts.get(list.id) ?? 0} unit="words" updatedAt={list.updatedAt}
                openTo={`/list/${list.id}`} flashcardsTo={`/flashcards?list=${encodeURIComponent(list.id)}`}
                onRename={() => setDialog({ type: 'list-rename', id: list.id })}
                onDelete={() => setPendingDelete({ kind: 'list', row: list, detached: listCounts.get(list.id) ?? 0 })} />
            ))}
          </div>
        )}
      </section>

      <section className="lib-section" aria-labelledby="lib-nbs-h">
        <div className="section-title">
          <h2 id="lib-nbs-h"><IconBook /> Notebooks</h2>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={() => setDialog({ type: 'notebook-create' })}>New notebook</button>
        </div>
        {notebooks.length === 0 ? (
          <EmptyState title="No notebooks yet" detail="A notebook holds free-text notes and words you looked up — start one to capture what you read." />
        ) : filteredNotebooks.length === 0 ? (
          <EmptyState title="No notebook matches that filter." />
        ) : (
          <div className="grid-cards">
            {filteredNotebooks.map((nb) => (
              <Card key={nb.id} title={nb.name} count={notebookCounts.get(nb.id) ?? 0} unit="entries" updatedAt={nb.updatedAt}
                meta={nb.categoryId ? categories.find((c) => c.id === nb.categoryId)?.name : undefined}
                openTo={`/notebook/${nb.id}`} flashcardsTo={`/flashcards?notebook=${encodeURIComponent(nb.id)}`}
                onRename={() => setDialog({ type: 'notebook-rename', id: nb.id })}
                onDelete={() => setPendingDelete({ kind: 'notebook', row: nb, entries: notebookCounts.get(nb.id) ?? 0 })} />
            ))}
          </div>
        )}
      </section>

      <section className="lib-section" aria-labelledby="lib-cats-h">
        <div className="section-title">
          <h2 id="lib-cats-h"><IconCards /> Categories</h2>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={() => setDialog({ type: 'category-create' })}>New category</button>
        </div>
        <p className="muted text-sm">Categories tag notebook entries and group notebooks. Deleting a category
          never deletes notes — they simply become uncategorised.</p>
        {categories.length === 0 ? (
          <EmptyState title="No categories yet" detail="Create one to tag your notebook entries." />
        ) : filteredCategories.length === 0 ? (
          <EmptyState title="No category matches that filter." />
        ) : (
          <div className="grid-cards">
            {filteredCategories.map((category) => (
              <Card key={category.id} title={category.name} count={categoryEntryCounts.get(category.id) ?? 0} unit="tagged entries"
                meta={`${categoryNotebookCounts.get(category.id) ?? 0} notebooks`}
                onRename={() => setDialog({ type: 'category-rename', id: category.id })}
                onDelete={() => setPendingDelete({ kind: 'category', row: category, entries: categoryEntryCounts.get(category.id) ?? 0, notebooks: categoryNotebookCounts.get(category.id) ?? 0 })} />
            ))}
          </div>
        )}
      </section>

      <NameDialog open={dialog !== null} title={d.title} label={d.label} initialValue={d.initialValue} taken={d.taken}
        submitLabel={d.submitLabel} onSubmit={submitDialog} onCancel={() => setDialog(null)} />

      <ConfirmDialog open={pendingDelete !== null} danger title="Delete this for good?" confirmLabel="Delete"
        body={<DeleteBody target={pendingDelete} />} onConfirm={() => void runDelete()} onCancel={() => setPendingDelete(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ presentational bits */

function DeleteBody({ target }: { target: DeleteTarget | null }) {
  if (!target) return null;
  if (target.kind === 'list') {
    return (
      <p className="text-sm muted">“{target.row.name}” will be removed. {target.detached} saved{' '}
        {target.detached === 1 ? 'word is' : 'words are'} attached to it. Deleting the list only detaches
        them — every word stays in your Saved words.</p>
    );
  }
  if (target.kind === 'notebook') {
    return (
      <p className="text-sm muted">“{target.row.name}” will be removed. This permanently deletes the notebook
        and its {target.entries} {target.entries === 1 ? 'entry' : 'entries'} of notes. It cannot be undone.</p>
    );
  }
  return (
    <p className="text-sm muted">Category “{target.row.name}” will be removed. {target.entries} notebook{' '}
      {target.entries === 1 ? 'entry is' : 'entries are'} tagged with it and {target.notebooks}{' '}
      {target.notebooks === 1 ? 'notebook points' : 'notebooks point'} at it. None are deleted — they just
      stop carrying this tag.</p>
  );
}

interface CardProps {
  title: string;
  count: number;
  unit: string;
  updatedAt?: string;
  meta?: string;
  openTo?: string;
  flashcardsTo?: string;
  onRename: () => void;
  onDelete: () => void;
}

function Card({ title, count, unit, updatedAt, meta, openTo, flashcardsTo, onRename, onDelete }: CardProps) {
  return (
    <article className="card card-tight">
      <h3 className="lib-card-title">{title}</h3>
      <span className="lib-card-sub muted text-sm">
        <span aria-live="polite">{count} {unit}</span>
        {updatedAt ? ` · updated ${formatDate(updatedAt)}` : ''}
        {meta ? ` · ${meta}` : ''}
      </span>
      <div className="lib-actions">
        {openTo ? <Link to={openTo} className="btn btn-sm">Open</Link> : null}
        {flashcardsTo ? <Link to={flashcardsTo} className="btn btn-sm"><IconCards /> Flashcards</Link> : null}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onRename} aria-label={`Rename ${title}`}><IconPen /> Rename</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDelete} aria-label={`Delete ${title}`}><IconTrash /> Delete</button>
      </div>
    </article>
  );
}

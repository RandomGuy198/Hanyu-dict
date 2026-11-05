/** /list/:id — one word list. Renders its saved entries with the shared entry components (from
 *  cached fields, so it works without the dictionary pack), lets you remove entries, edit a note,
 *  re-sort, add more by searching the dictionary inline, and export the list to CSV on the client. */

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../data/db';
import { formatDate } from '../../app/hooks';
import { useDictionary, useToast } from '../../app/providers';
import { EmptyState, EntryLine, PageHeader, Segmented } from '../../components';
import { IconDownload, IconSearch, IconStar, IconTrash } from '../../app/icons';
import type { DictEntry, SavedWord, SearchResult } from '../../domain/types';
import { byHeadword, byPinyin, downloadCsv, safeFileBase, savedFields, savedToEntry } from './helpers';
import './library.css';

type Sort = 'added' | 'headword' | 'pinyin';

const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: 'added', label: 'Date added' },
  { value: 'headword', label: 'Headword' },
  { value: 'pinyin', label: 'Pinyin' },
];

export default function ListPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const { api, state } = useDictionary();
  const dictReady = state.phase === 'ready' && api !== null;

  // A null default distinguishes "still loading" (null) from "no such list" (undefined).
  const list = useLiveQuery(() => db.wordLists.get(id), [id], null);
  const entries = useLiveQuery(() => db.savedWords.where('lists').equals(id).sortBy('addedAt'), [id], []);

  const [sort, setSort] = useState<Sort>('added');
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const inList = useMemo(() => new Set(entries.map((entry) => entry.id)), [entries]);

  const ordered = useMemo(() => {
    const copy = [...entries];
    if (sort === 'added') copy.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    else if (sort === 'headword') copy.sort(byHeadword);
    else copy.sort(byPinyin);
    return copy;
  }, [entries, sort]);

  async function saveNote(word: SavedWord): Promise<void> {
    const draft = draftNotes[word.id];
    if (draft === undefined) return;
    const trimmed = draft.trim();
    if (trimmed === (word.note ?? '')) return;
    try {
      await db.savedWords.update(word.id, { note: trimmed || undefined });
      setDraftNotes((current) => {
        const next = { ...current };
        delete next[word.id];
        return next;
      });
    } catch (error) {
      console.error('Could not save the note', error);
      toast.push({ message: 'Could not save that note.', tone: 'danger' });
    }
  }

  async function removeFromList(word: SavedWord): Promise<void> {
    try {
      await db.savedWords.update(word.id, { lists: word.lists.filter((listId) => listId !== id) });
      toast.push({
        message: `Removed ${word.simplified} from this list.`,
        actionLabel: 'Undo',
        onAction: () => void db.savedWords.update(word.id, { lists: [...word.lists, id] }).catch(() => undefined),
      });
    } catch (error) {
      console.error('Could not remove the word from the list', error);
      toast.push({ message: 'Could not remove that word.', tone: 'danger' });
    }
  }

  async function runSearch(): Promise<void> {
    if (!api || !searchText.trim()) return;
    setSearching(true);
    setSearched(true);
    try {
      const outcome = await api.search(searchText, { limit: 25 });
      setResults(outcome.results);
    } catch (error) {
      console.error('Dictionary search failed', error);
      setResults([]);
      toast.push({ message: 'The dictionary search failed. Try again.', tone: 'danger' });
    } finally {
      setSearching(false);
    }
  }

  async function addToList(entry: DictEntry): Promise<void> {
    const now = new Date().toISOString();
    try {
      await db.transaction('rw', db.savedWords, async () => {
        const existing = await db.savedWords.get(entry.id);
        if (existing) {
          if (!existing.lists.includes(id)) {
            await db.savedWords.update(entry.id, { lists: [...existing.lists, id] });
          }
        } else {
          const row: SavedWord = {
            id: entry.id,
            addedAt: now,
            lists: [id],
            ...savedFields(entry),
          };
          await db.savedWords.add(row);
        }
      });
      toast.push(`Added ${entry.simplified} to the list`);
    } catch (error) {
      console.error('Could not add the entry to the list', error);
      toast.push({ message: 'Could not add that word.', tone: 'danger' });
    }
  }

  function exportCsv(): void {
    if (!list) return;
    const rows: (string | undefined)[][] = [
      ['Simplified', 'Traditional', 'Pinyin', 'Definition', 'Note', 'Added'],
      ...ordered.map((word) => [word.simplified, word.traditional, word.pinyinMarked, word.definition, word.note, word.addedAt]),
    ];
    downloadCsv(`${safeFileBase(list.name)}.csv`, rows);
    toast.push(`Exported ${ordered.length} ${ordered.length === 1 ? 'row' : 'rows'} as CSV.`);
  }

  if (list === null) {
    return (
      <div className="stack" role="status" aria-live="polite">
        <div className="skeleton" style={{ height: 32, width: '50%' }} />
        <div className="skeleton" style={{ height: 60 }} />
        <div className="skeleton" style={{ height: 60 }} />
      </div>
    );
  }

  if (list === undefined) {
    return (
      <div className="lib-page">
        <PageHeader title="List not found" back={{ label: 'Library', to: '/library' }} />
        <EmptyState
          title="There is no list here"
          detail="This list was deleted, or the link is from another device. Your saved words are still in the library."
          action={
            <Link to="/library" className="btn btn-primary btn-sm">
              Back to the library
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="lib-page">
      <PageHeader
        title={list.name}
        back={{ label: 'Library', to: '/library' }}
        subtitle={
          <span aria-live="polite">
            {entries.length} {entries.length === 1 ? 'word' : 'words'} · created {formatDate(list.createdAt)}
          </span>
        }
        actions={
          <button type="button" className="btn btn-sm" onClick={exportCsv} disabled={ordered.length === 0}>
            <IconDownload /> Export CSV
          </button>
        }
      />

      <section className="lib-section" aria-labelledby="list-browse-h">
        <div className="section-title">
          <h2 id="list-browse-h">Words</h2>
          <span className="spacer" />
          <Segmented label="Sort words" value={sort} options={SORT_OPTIONS} onChange={setSort} />
        </div>

        {entries.length === 0 ? (
          <EmptyState
            title="This list is empty"
            detail="Add words with the search box below, or star an entry in the dictionary and add it to this list later."
          />
        ) : (
          <ul className="list">
            {ordered.map((word) => (
              <EntryLine
                key={word.id}
                entry={savedToEntry(word)}
                trailing={
                  <span className="lib-trail">
                    <input
                      className="lib-note-input"
                      type="text"
                      placeholder="Note"
                      value={draftNotes[word.id] ?? word.note ?? ''}
                      onChange={(event) => setDraftNotes((current) => ({ ...current, [word.id]: event.target.value }))}
                      onBlur={() => void saveNote(word)}
                      aria-label={`Note for ${word.simplified}`}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={() => void removeFromList(word)}
                      aria-label={`Remove ${word.simplified} from this list`}
                      title="Remove from this list"
                    >
                      <IconTrash />
                    </button>
                  </span>
                }
              />
            ))}
          </ul>
        )}
      </section>

      <section className="lib-section" aria-labelledby="list-add-h">
        <div className="section-title">
          <h2 id="list-add-h">Add more words</h2>
        </div>

        {!dictReady ? (
          <EmptyState
            title="Search needs the dictionary pack"
            detail="The dictionary data is still arriving on this device — it downloads on its own and works without a connection afterwards. Your existing list is safe and listed above."
          />
        ) : (
          <>
            <div className="lib-inline">
              <span className="searchbar">
                <IconSearch />
                <label className="visually-hidden" htmlFor="list-add-search">
                  Search the dictionary
                </label>
                <input
                  id="list-add-search"
                  type="search"
                  placeholder="Search Chinese, pinyin or English"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void runSearch();
                  }}
                />
              </span>
              <button type="button" className="btn btn-primary" onClick={() => void runSearch()} disabled={searching || !searchText.trim()}>
                Search
              </button>
            </div>

            {searching ? <p className="muted text-sm" role="status">Searching…</p> : null}

            {!searching && searched && results.length === 0 ? (
              <p className="muted text-sm" role="status">
                No dictionary results for “{searchText}”. Try fewer characters or a different spelling.
              </p>
            ) : null}

            {results.length > 0 ? (
              <ul className="list lib-search-results" aria-label="Search results">
                {results.map((result) => (
                  <EntryLine
                    key={result.entry.id}
                    entry={result.entry}
                    matchLabel={result.via}
                    trailing={
                      inList.has(result.entry.id) ? (
                        <span className="badge badge-ok">In list</span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => void addToList(result.entry)}
                          aria-label={`Add ${result.entry.simplified} to ${list.name}`}
                        >
                          <IconStar /> Add
                        </button>
                      )
                    }
                  />
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

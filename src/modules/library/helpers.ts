/** Local helpers for the library screens: rebuilding displayable dictionary rows from cached
 *  IndexedDB copies (so saved words render without the dictionary pack), CSV building with
 *  correct Unicode/quote handling, name validation and the additive category field notebook
 *  entries need but the frozen domain schema does not carry. */

import { parseEntryKey } from '../../components';
import { pinyinKey } from '../../domain/pinyin';
import type { Category, DictEntry, Notebook, NotebookEntry, SavedWord, WordList } from '../../domain/types';
import { downloadBlob } from '../../data/exportImport';

/** Rebuild a displayable `DictEntry` from a cached saved-word row. Saved words store the headword,
 *  pinyin and definition precisely so the library survives a pack uninstall, but not the derived
 *  `pinyinNumbered` / `pinyinPlain` / `length`. The numbered reading is recoverable from the id
 *  (`parseEntryKey`), the toneless key is derived, and length is the headword character count. */
export function savedToEntry(word: SavedWord): DictEntry {
  const { pinyinNumbered } = parseEntryKey(word.id);
  return {
    id: word.id,
    simplified: word.simplified,
    traditional: word.traditional,
    pinyinNumbered,
    pinyinMarked: word.pinyinMarked,
    pinyinPlain: pinyinKey(pinyinNumbered),
    definition: word.definition,
    length: [...word.simplified].length,
  };
}

/** Build the SavedWord fields (minus id/timing/lists) from a dictionary entry. Mirrors db.entrySummary
 *  without importing a non-exported helper path; the display copy is what keeps saved words alive
 *  offline. */
export function savedFields(entry: DictEntry): Pick<
  SavedWord,
  'simplified' | 'traditional' | 'pinyinMarked' | 'definition'
> {
  return {
    simplified: entry.simplified,
    traditional: entry.traditional,
    pinyinMarked: entry.pinyinMarked,
    definition: entry.definition,
  };
}

/* ------------------------------------------------------------------ names */

/** Empty names are refused; everything else is allowed (duplicates are warned by the dialog, not
 *  blocked, because two lists called "HSK 1" may be intentional). */
export function nameError(raw: string): string | null {
  const name = raw.trim();
  if (!name) return 'Enter a name — it cannot be empty.';
  if (name.length > 120) return 'Keep the name under 120 characters.';
  return null;
}

/** Case/space-insensitive duplicate test used for the warning banner. */
export function isDuplicateName(name: string, taken: readonly string[]): boolean {
  const key = name.trim().toLowerCase();
  if (!key) return false;
  return taken.some((candidate) => candidate.trim().toLowerCase() === key);
}

/* ------------------------------------------------------------------ CSV export */

/** RFC 4180 cell: quote only when the value contains a delimiter, a quote or a newline, and double
 *  any embedded quote. This keeps 中文, pinyin tone marks and commas in definitions intact. */
function csvCell(value: string | undefined): string {
  const text = value ?? '';
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(rows: readonly (readonly (string | undefined)[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/** Download rows as a UTF-8 CSV. A byte-order mark is prepended so spreadsheets open CJK correctly. */
export function downloadCsv(filename: string, rows: readonly (readonly (string | undefined)[])[]): void {
  const csv = `\uFEFF${buildCsv(rows)}`;
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
}

/** Filesystem-safe base name for an export, from a possibly CJK / punctuation-heavy list name. */
export function safeFileBase(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, 60) : 'export';
}

/* ------------------------------------------------------------------ notebook entry categories */

/** `NotebookEntry` in the frozen domain schema has no category field, yet notes must be classified
 *  and filtered. Dexie persists whole objects, so the library stores an additive optional
 *  `categoryId` on the row. The table's TypeScript type does not know about it, so reads go through
 *  `tagged()` — a single documented boundary cast between the fixed schema and the persisted row.
 *  Dangling ids (a deleted category) simply resolve to "Uncategorized" and never corrupt a note. */
export interface TaggedNotebookEntry extends NotebookEntry {
  categoryId?: string;
}

export function tagged(entry: NotebookEntry): TaggedNotebookEntry {
  return entry as TaggedNotebookEntry;
}

/* ------------------------------------------------------------------ text utils */

export function trimOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Stable sort comparators shared by the library's entry lists. */
export function byHeadword(a: SavedWord, b: SavedWord): number {
  return a.simplified.localeCompare(b.simplified, 'zh');
}

export function byPinyin(a: SavedWord, b: SavedWord): number {
  return a.pinyinMarked.localeCompare(b.pinyinMarked, 'en');
}

/* ------------------------------------------------------------------ library dialog descriptors */

/** The create/rename dialog state machine for the library hub, and the delete-confirm target. */
export type LibraryDialog =
  | { type: 'list-create'; selection: string[] }
  | { type: 'list-rename'; id: string }
  | { type: 'notebook-create' }
  | { type: 'notebook-rename'; id: string }
  | { type: 'category-create' }
  | { type: 'category-rename'; id: string }
  | null;

export interface DialogDescriptor {
  title: string;
  label: string;
  initialValue: string;
  taken: string[];
  submitLabel: string;
}

/** Pure mapping from dialog state to NameDialog props, so the page only wires behaviour. */
export function describeDialog(
  dialog: LibraryDialog,
  rows: { wordLists: WordList[]; notebooks: Notebook[]; categories: Category[] },
): DialogDescriptor {
  const blank: DialogDescriptor = { title: 'Name', label: 'Name', initialValue: '', taken: [], submitLabel: 'Save' };
  if (!dialog) return blank;
  const names = (list: { id: string; name: string }[], except?: string) =>
    list.filter((r) => r.id !== except).map((r) => r.name);
  switch (dialog.type) {
    case 'list-create': {
      const count = dialog.selection.length;
      return {
        title: count > 0 ? `New list from ${count} selected ${count === 1 ? 'word' : 'words'}` : 'New word list',
        label: 'List name',
        initialValue: '',
        taken: names(rows.wordLists),
        submitLabel: 'Create list',
      };
    }
    case 'list-rename':
      return { title: 'Rename list', label: 'List name', initialValue: rows.wordLists.find((r) => r.id === dialog.id)?.name ?? '', taken: names(rows.wordLists, dialog.id), submitLabel: 'Rename' };
    case 'notebook-create':
      return { title: 'New notebook', label: 'Notebook name', initialValue: '', taken: names(rows.notebooks), submitLabel: 'Create notebook' };
    case 'notebook-rename':
      return { title: 'Rename notebook', label: 'Notebook name', initialValue: rows.notebooks.find((r) => r.id === dialog.id)?.name ?? '', taken: names(rows.notebooks, dialog.id), submitLabel: 'Rename' };
    case 'category-create':
      return { title: 'New category', label: 'Category name', initialValue: '', taken: names(rows.categories), submitLabel: 'Create category' };
    case 'category-rename':
      return { title: 'Rename category', label: 'Category name', initialValue: rows.categories.find((r) => r.id === dialog.id)?.name ?? '', taken: names(rows.categories, dialog.id), submitLabel: 'Rename' };
  }
}

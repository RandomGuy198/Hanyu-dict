# App contract for module screens

Everything a module screen is allowed to import, and the rules it must follow. The spine
(files listed here) is already typechecking; module work must not change it.

## You may import

### State and services — `src/app/providers.tsx`
- `usePreferences()` → `{ prefs: Preferences, ready, update(patch), reset() }`
  - `prefs` fields used by screens: `displayScript` (`'simplified'|'traditional'|'both'`),
    `pinyinStyle` (`'marks'|'numbers'|'none'`), `showPinyin`, `showExamples`, `theme`,
    `contrast`, `reduceMotion`, `textScale`, `ttsLang`, `ttsRate`, `autoSpeak`, `dailyGoal`,
    `installedPacks`.
- `useToast()` → `{ push(toastOrString), dismiss(id) }` — `push({ message, tone?, actionLabel?, onAction? })`
- `useDictionary()` → `{ state: LoadState, api: DictionaryApi | null, install: InstallProgress | null, reload() }`
  - `state.phase` is `'idle' | 'installing' | 'loading' | 'indexing' | 'ready' | 'error'`.
- `useSavedWords()` → `{ saved: SavedWord[], isSaved(id), toggle(entry, listIds?), save(entry, listIds?), unsave(id) }`
- `useAppReady()` → boolean

### UI vocabulary — `src/components` (default-free named exports)
`PageHeader, HanziText, PinyinText, DefinitionText, SpeakButton, SaveButton, EntryLine,
EmptyState, ProgressBar, Segmented, ConfirmDialog, LoadingGate, AttributionNote, LastUpdated,
preferredHeadword, preferredPinyin, parseEntryKey, entryKey`

- `PageHeader({ title, subtitle?, actions?, back?: { label, to } })`
- `EntryLine({ entry, onOpen?, trailing?, matchLabel? })` — navigates to `/entry/:key` by default.
- `Segmented({ label, value, options, onChange })` — accessible radiogroup of chips.
- `ConfirmDialog({ open, title, body?, confirmLabel, cancelLabel?, danger?, onConfirm, onCancel })`
- Wrap every data-bearing page in `<LoadingGate>…</LoadingGate>` so the download/index state is
  explained once, everywhere.

### Helpers — `src/app/hooks`
`useDebouncedValue, formatBytes, formatDate, useQueryState(name, fallback), useIsWideScreen,
uid, sleep`

### Icons — `src/app/icons`
`IconSearch, IconBook, IconGrid, IconCards, IconCamera, IconPen, IconSpark, IconGear,
IconSpeaker, IconStar, IconChevronLeft, IconTrash, IconDownload, IconCheck, IconAlert, BrandMark`

### Storage — `src/data/db`
`db` (Dexie), `USER_STORES`, `todayKey`, `bumpActivity(day, patch)`, `deleteListCascade`,
`deleteNotebookCascade`, `deleteCategoryCascade`, `ensurePreferences`, `savePreferences`,
`setMeta`, `getMeta`, `entrySummary`.
Use `useLiveQuery` from `dexie-react-hooks` for lists that must react to changes.
Tables: `meta, preferences, searchHistory, savedWords, wordLists, notebooks, categories,
notebookEntries, decks, cards, attempts, sessions, activity, achievements, packs, packFiles,
documents, documentBlobs, photos, photoImages` — see `src/data/db.ts` for row shapes and keys.

### Packs — `src/data/packs`
`loadManifest, cachedManifest, packOverview, installPack, uninstallPack, ensureRequiredPacks,
storageUsage, requestPersistence, packFilePaths, readPackFile, packText, clearAllData, dataUrl`
### Backup — `src/data/exportImport`
`exportBackupBlob, buildBackup, parseBackup, importBackup, downloadBlob, defaultBackupName,
readFileAsText, MAX_IMPORT_BYTES`
### Speech — `src/data/speech`
`speak(text, {lang, rate}), stopSpeaking, inspectSpeech(lang), onVoicesChanged`

### Domain — `src/domain/*`
`types.ts` (all records + `DEFAULT_PREFERENCES` + `US`), `pinyin.ts` (`numberedToMarks`,
`pinyinKey`, `queryPinyinKeys`, `hasCjk`, `isHanCharacter`, `stripToneMarks`),
`scheduler.ts` (`newCard, schedule, isDue, dueQueue, newCards, previewInterval, reviewDelta`),
`achievements.ts` (`ACHIEVEMENTS, totals, evaluateAchievements, weeklySummary, currentStreak`),
`service.ts` (`CharRecord` type for character rows).

`DictionaryApi` methods (all async): `search(text, {mode?, limit?})`, `entry(id)`,
`headword(text)`, `spans(text, maxLen?)`, `character(char)`, `characters(chars)`,
`convert(text, 'toSimplified'|'toTraditional')`, `strokes(char)`, `examples(headword, limit?)`,
`sampleCharacters(count)`.
`search()` returns `{ results: SearchResult[], coverage: { entries, partial }, tookMs }`.

## Routes (hash-based, react-router 6)
`/`, `/search?q=`, `/entry/:key`, `/character/:value`, `/writing`, `/library`, `/list/:id`,
`/notebook/:id`, `/practice`, `/flashcards`, `/test`, `/test/:id`, `/progress`, `/capture`,
`/reader`, `/learn`, `/learn/:id`, `/settings`, `/offline-data`, `/data`, `/about`
`<Link to="…">` / `useNavigate()` take the path without the `#`.

## Rules every screen follows
1. **Honest states.** Loading, empty, offline, permission-denied, "no data for this character",
   "no Chinese voice installed" and "pack not downloaded" are designed screens, not console logs.
   Never fake a result, a network call, a sync, or an online user.
2. **Everything free.** No paywall, entitlement flag, ad slot, trial counter or locked tier.
3. **Local by default.** No network request except same-origin `public/data` and `public/licenses`
   fetches. Camera images, PDFs and notes stay in IndexedDB. Anything leaving the device must be
   explicitly opted into and labelled.
4. **Accessibility.** One `h1` per page (via `PageHeader`); labels on every input; `aria-live`
   for changing status; visible focus; 44px targets (already in tokens); no colour-only meaning;
   reduced-motion respected (`prefs.reduceMotion` / `--motion`); text stays readable at 200% zoom.
5. **Styling.** Tokens only (`var(--…)`) — never hard-coded hex, px font sizes or magic spacing.
   Put module CSS in `src/modules/<name>/<name>.css`, import it from the page component, and
   prefix classes with the module (`.cap-`, `.read-`, `.learn-`, `.lib-`, `.char-`).
   Reuse `.card .btn .chip .field .item .notice .empty-state .grid-cards .table` from
   `src/styles/components.css` before inventing anything.
6. **TypeScript strict**, no `any` unless a boundary demands it (then comment why), no unused
   imports, no `console.log` of user content (`console.error` for real failures only).
7. Do not edit: `src/domain/*`, `src/data/*`, `src/app/*`, `src/components/*`, `src/styles/*`,
   `vite.config.ts`, `package.json`, `public/data/**`. If one of them is genuinely wrong,
   report it instead of changing it.
8. Verify with `npx tsc -p tsconfig.json --noEmit` before finishing.

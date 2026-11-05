# Plan compliance record

Against `../Modded/IMPLEMENTATION_PLAN.md` (dated 2026-11-04, read-only reference). Snapshot taken
**2026-11-04**, while several workstreams were still landing modules. This repository moves: re-run
the commands in *How to re-verify* instead of trusting the statuses below.

Rules this document follows: an item is `done` only when the code exists and does what the plan says;
`partial` names the missing part; `deferred` and `omitted` each carry a reason. No item is marked done
because a screen with its name exists, and no exit gate is called met because a build succeeded.

## How to re-verify

```bash
npm run data:check    # provenance, licence texts, hashes, clean-room scan of src/public/scripts
npm run typecheck     # strict tsc
npm test              # vitest unit suite
npx eslint .          # needs the ESLint toolchain (see README "Quality gates")
npm run build:only    # production build into dist/
grep -rl "SKELETON - replaced" src            # placeholder screens still standing
ls playwright.config.ts tests/e2e   # end-to-end coverage: config present, specs only when they appear here
find src tests -name '*.test.ts*' 2>/dev/null | wc -l   # how many test files exist (CI counts these in git)
```

Legend: **D** done · **P** partial · **F** deferred with reason · **O** omitted with reason ·
**X** not implemented (say so plainly).

## Phase 0 - clean-room specification and feasibility gate

| # | Plan item | Status | Where / why |
| --- | --- | --- | --- |
| 0.1 | Feature register: feature, permitted observation source, assumptions, priority, status, parity limitation | **D** (outside the repo, by design) | `../Modded/FEATURE_INVENTORY.md` holds the observed-declaration register; `../Modded/IMPLEMENTATION_PLAN.md` §3 the track split; this file plus `README.md` hold implementation status. Reference documents stay out of the repository (CI asserts it). |
| 0.2 | Manually document authorised user-visible workflows, else write fresh requirements | **P** | No walkthrough study of the reference app was performed or recorded. Every screen here is a fresh requirement (`docs/APP_CONTRACT.md`), which the plan explicitly allows as the alternative; the consequence is in *Parity unknowns*. |
| 0.3 | Data/asset provenance register; reject unclear sources | **D** | `scripts/content/provenance.json` (9 sources, pinned URLs/versions/checksums/licences/transformations), verified by `scripts/content/check-provenance.mjs`. Lingua Libre and Make Me a Hanzi `dictionary.txt` were rejected - see *Deviations*. |
| 0.4 | Decide supported interface/definition languages and initial coverage | **P** | Interface: English only, no i18n layer. Definition language: English (CC-CEDICT glosses) plus Chinese headword data. The plan's optional `dictionary-<language>` packs are **F** - no other language has a cleared, redistributable gloss source in `DATA_SOURCES.md`. Coverage: 125,365 word records, 98,682 characters. |
| 0.5 | Publish a browser support matrix | **D** | `README.md` "Browser and device support", stated as capability requirements plus expected status, with the caveat that nothing has been device-verified (Phase 12.8). |
| 0.6 | Tiny fixture proving Pages base paths, routing, IndexedDB persistence, SW updates, offline pack loading | **P** | The real app replaces the fixture: `base: './'` with relative URLs asserted in both workflows, hash routing, Dexie persistence, `registerType: 'prompt'` updates, pack install from committed data. What the fixture was supposed to prove on a *deployed* site (install, reopen offline) has not been observed yet, because no Pages deployment exists. |
| 0.7 | Initial bundle, search-latency, memory and content-size budgets | **P** | Content sizes are measured and published (`public/data/manifest.json`, 50.3 MB / 273,481 records). Bundle guards exist informally (`chunkSizeWarningLimit: 1024`, route-level lazy chunks, `maximumFileSizeToCacheInBytes: 8 MB`, and the built shell precaches 1.4 MB). No latency or memory budget has been written down or measured: **F** until Phase 12.7 runs. |

**Exit gate:** rights documented for every shipped source - **met**. Fixture installs and reopens
offline - **not met** (nothing deployed, no device run). No APK-derived content in the repository -
**met** (`check-provenance.mjs` §8 scans the tree; `.github/workflows/ci.yml` asserts the git index).

## Phase 1 - repository and quality scaffold

| # | Plan item | Status | Where / why |
| --- | --- | --- | --- |
| 1.1 | Create `Modded/hanyu-web` as a new Git repository | **D** (relocated) | The app lives in `Hanyu Dictionary/Hanyu dict` because the user asked for the files there (Deviation 1). It is a git repository with `origin = https://github.com/RandomGuy198/Hanyu-dict`, `main` pushed at `8ce9788` (577 tracked files, working tree clean at the time of the 2026-11-05 audit). Whether that repository is public was not verified from this machine (no `gh` CLI installed). |
| 1.2 | React + TypeScript + Vite with strict type checking | **D** | `package.json`, `tsconfig.json` (`strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `isolatedModules`), `vite.config.ts`. |
| 1.3 | Formatting, linting, unit tests, component tests, Playwright | **P** | Unit tests **D-ish**: `tests/unit/{pinyin,search,scheduler,schema,db}.test.ts`, 165 cases all passing at this snapshot - though `tsc` reports type errors inside `tests/unit/db.test.ts`, because vitest transpiles rather than typechecks its suite. Linting **P**: `eslint.config.js` is written and was run against this codebase with an out-of-tree ESLint 9 install (8 errors, 9 warnings), but the toolchain is not in `package.json`, so `npm run lint` cannot run from a clean checkout (Deviation 7). Formatting **F**: `format`/`format:check` scripts exist but prettier is not installed. Component tests **X**: @testing-library is a dependency and `tests/setup.ts` exists, yet no component-render test is written. Playwright **X**: no `playwright.config.ts`, no `tests/e2e/`, so `npm run test:e2e` fails. |
| 1.4 | Path aliases, environment typing, error boundaries, minimal logging policy | **D** | `@` and `@data` aliases (tsconfig + vite), `src/vite-env.d.ts`, `src/app/ErrorBoundary.tsx` + a `NotFound` route, logging policy in `docs/APP_CONTRACT.md` rule 6 (no `console.log` of user content, `console.error` for real failures) reinforced by `no-console: ['warn', {allow:['warn','error']}]` for `src/`. |
| 1.5 | Configure Vite base as `/hanyu-web/` | **D**, deliberately different | `base: './'` instead (Deviation 2). |
| 1.6 | CI for format, lint, typecheck, tests, provenance validation, production build | **P** | `.github/workflows/ci.yml`: provenance, typecheck, tests, lint, build, artifact completeness, clean-room assertion, npm cache, `dist/` artifact. Format is **not** gated (prettier absent). Tests and lint warn-instead-of-fail only in the precise case where the tool/suite does not exist yet, and record `NOT RUN` in the job summary. |
| 1.7 | README with development, data rights, build, test, deployment commands | **D** | `README.md`. |

**Exit gate:** "a clean checkout passes CI and produces a deployable static build with no runtime
console errors" - **not met.** `npm run data:check` and `npm test` are green and `npm run build:only`
produces a 49 MB `dist/` (58 precached entries) that passes the artifact completeness gate, but a clean
checkout still fails `typecheck` (files being finished in `learning/` and `profile/`), lint cannot run
without the toolchain, and no runtime-console-error sweep has been done on a published site.

## Phase 2 - original design system and PWA shell

| # | Plan item | Status | Where |
| --- | --- | --- | --- |
| 2.1 | Original typography, colour tokens, spacing, icons, light/dark themes | **D** | `src/styles/tokens.css` (custom properties; contracts forbid hard-coded hex/px outside tokens), `base.css`, `components.css`, `entries.css`, `src/app/icons.tsx` (hand-drawn SVG set), theme + contrast + text scale in `src/modules/profile/SettingsPage.tsx`. |
| 2.2 | Mobile bottom navigation, desktop multi-pane navigation | **D** | `src/app/Shell.tsx` (primary tabs + secondary menu, `useIsWideScreen`), `src/styles/base.css` safe-area handling. |
| 2.3 | Landmarks, visible focus, keyboard navigation, 44px targets, reduced motion, safe areas, long-text wrapping | **D (mechanics)** / audit **F** | Skip link + `<main>`/nav landmarks in `Shell.tsx`, focus styles and 44px targets in `components.css`, `--motion` + `prefs.reduceMotion`, `overflow-wrap` for CJK runs. No WCAG audit has been run (Phase 11.5). |
| 2.4 | Web manifest, original icons, install guidance, standalone display | **D** | `public/manifest.webmanifest` (hand-written, `manifest: false` in the PWA plugin so the file is reviewable), `public/icons/*` produced by `scripts/make-icons.mjs`, `display: standalone` + `display_override`, install guidance in Settings/Offline data. |
| 2.5 | Offline navigation, update notification, error pages, empty states | **D** | `vite.config.ts` `navigateFallback: 'index.html'` + runtime caching of the pack registry, `registerType: 'prompt'` with `registerSW` in `Shell.tsx` (an update never hijacks an active session), `ErrorBoundary`, `NotFound`, `EmptyState`/`LoadingGate` in `src/components/index.tsx`. |
| 2.6 | Global settings persistence and schema migration tests | **P** | Preferences persist through `ensurePreferences`/`savePreferences` in `src/data/db.ts` with `db.version(1)`. There is only one schema version, so real migration paths do not exist yet and **no migration test exists**; `tests/unit/db.test.ts` covers the current shape. When `version(2)` lands, this becomes release-blocking. |

**Exit gate** (installs, works offline, survives updates, passes keyboard/basic a11y at both widths):
**not met** - the mechanics are in place but nothing has been installed or reloaded offline, because
the site is not published.

## Phase 3 - data pipeline and storage foundation

| # | Plan item | Status | Where |
| --- | --- | --- | --- |
| 3.1 | Approved source importers and canonical schemas | **D** | `scripts/content/build-{dictionary,characters,strokes,examples,content,ocr,licenses,manifest}.mjs`, shared helpers in `scripts/content/lib/`, Zod schema `src/data/schema.ts`, format documented in `docs/DATA_FORMAT.md`. |
| 3.2 | Generate small fixture packs before full datasets | **O** | Skipped: the small original `content-*` packs (21-45 KB) served as the end-to-end test while the full packs were generated. Reproducibility is instead proven by re-running `data:build` offline in CI (see `build-all.mjs` header). |
| 3.3 | Hash validation, atomic install, rollback, coverage reporting | **D** | `src/data/packs.ts` ("download, hash-verify, install atomically, roll back on failure"; the previous version stays readable until every new file verifies), coverage per pack in the manifest and in `OfflineDataPage.tsx`. |
| 3.4 | IndexedDB repositories and transactional migrations | **D** (single version) | `src/data/db.ts`: Dexie, 20 stores, `USER_STORES` kept separate from pack storage so content upgrades never touch learning progress. See 2.6 for the migration-test gap. |
| 3.5 | Versioned JSON/ZIP export/import with schema and size validation | **P** | JSON-only backup in `src/data/exportImport.ts` (`exportBackupBlob`, `parseBackup`, `MAX_IMPORT_BYTES`, schema-validated). **No ZIP container** (Deviation 8) - fine for a single-file human-readable backup, but a documented difference from the plan. |
| 3.6 | Confirm before overwrite/merge; recoverable conflict handling | **P** | Import is confirm-gated in `DataPage.tsx` and refuses oversized/invalid files. Conflict *merging* (importing onto existing data) is not implemented as a designed flow: the app replaces or rejects rather than reconciling. |
| 3.7 | Quota, interrupted-download, corrupted-pack, storage-eviction tests | **P** | Corrupt-pack and schema-rejection are covered (`tests/unit/schema.test.ts`, hash checks at install). Quota exhaustion, interrupted download and eviction are **X** - no test, and `requestPersistence()` denial is handled in code but untested. |

**Exit gate** (install a pack, reload offline, export, reset, restore): **unverified on a device**; the
code paths exist and unit-verified pieces are in `tests/unit/db.test.ts`.

## Phase 4 - core dictionary MVP

| # | Plan item | Status | Where |
| --- | --- | --- | --- |
| 4.1 | Worker-based query/normalisation layer | **D** | `src/workers/search.worker.ts`, `src/domain/searchIndex.ts`, `src/domain/pinyin.ts`, `src/data/dictionary.ts`. |
| 4.2 | Hanzi/pinyin/definition search with deterministic ranking | **D** | `src/domain/searchRanking.ts` (exact → prefix → meaning, stable tie-breaks); pinyin with tone marks, numbers, no tones, `ü` and the `v` convention (`tests/unit/pinyin.test.ts`, `tests/unit/search.test.ts`). |
| 4.3 | Results, entry details, source attribution, history, save | **D** | `HomePage.tsx`, `SearchPage.tsx`, `EntryPage.tsx`, `db.searchHistory`, `SavedWordsProvider` + `SaveButton`. |
| 4.4 | Simplified/traditional display and conversion from approved mappings only | **D** | Unihan `kSimplifiedVariant`/`kTraditionalVariant` in the `characters` pack, `DictionaryApi.convert`, `prefs.displayScript`. Characters without a mapping stay unchanged - a documented Unihan gap, not a silent guess. |
| 4.5 | Examples/collocations only where licensed | **D** (examples) / **O** (collocations) | 39,806 Tatoeba `cmn`→`eng` pairs over 20,011 headwords, as an optional pack with per-sentence IDs. Collocations would need a source with cleared rights; none exists in `DATA_SOURCES.md`, so the section is absent rather than approximated. |
| 4.6 | Pronunciation via licensed audio or clearly labelled device synthesis | **D** (synthesis only) | `src/data/speech.ts` + `SpeakButton` label it as synthetic ("Play synthetic audio for …"); no human-recording pack (Deviation 3). |
| 4.7 | Malformed queries, no results, unavailable audio, missing characters, partial coverage | **D** | Honest states are enforced by `docs/APP_CONTRACT.md` rule 1 and `LoadingGate`/`EmptyState`; `inspectSpeech` reports "no Chinese voice installed". |
| 4.8 | Test the search → entry → save → reload-offline journey | **X** | No automated journey test and no published site to reload offline. This is the single biggest hole in the MVP exit gate. |

**Exit gate** (works offline after download, exact matches first, state persists, every dataset
attributable): ranking, persistence and attribution are met in code and unit tests; the *offline* half
is unverified.

## Phase 5 - character and writing tools

| # | Plan item | Status | Where |
| --- | --- | --- | --- |
| 5.1 | Character metadata, radicals, components, Zhuyin/pinyin from approved data | **P** | `CharacterPage.tsx` + `characters` pack: kMandarin, kCantonese, kDefinition, RSUnicode radical + residual strokes, kTotalStrokes, variant sets. **Zhuyin/bopomofo: X** - Unihan `kBopomofo` was never selected into the pipeline (an ingestion omission, easy to add). **Component/IDS decomposition: X** - deliberate (Deviation 4). |
| 5.2 | Per-character stroke data with play/pause/replay/speed | **D** | `strokes` pack (9,574 characters, Arphic outlines + medians), `src/modules/characters/StrokePanel.tsx` over `hanzi-writer` with `charDataLoader` pointed at local data (no CDN). |
| 5.3 | Mouse/touch/pen practice via Pointer Events | **D** | `WritingPage.tsx`. |
| 5.4 | Grid/guides, clear/undo, accessible alternatives to timed animation | **D** | `WritingPage.tsx` + reduce-motion respect; guided replay is user-triggered, not automatic. |
| 5.5 | Stroke-order feedback only where validated data supports it; never fabricate | **D** | Median guides come from the licensed data; the UI says "Free drawing - there is no median guide for this character, so nothing is scored" and marks extra strokes unscored. |
| 5.6 | Glyph evolution only if rights-cleared content exists | **O** | No etymology/glyph-evolution artwork has cleared rights; the feature is absent, not mocked with emoji or screenshots. |
| 5.7 | Test simplified/traditional variants and unsupported characters | **P** | Covered by `tests/unit/pinyin.test.ts`/`schema.test.ts` for normalisation and by unit tests over variant maps; no dedicated test for a character absent from the pack. |

**Exit gate:** met in code for mouse (touch/pen unverified on device); unsupported data does produce an
explicit unavailable state.

## Phase 6 - notebooks, flashcards and assessments

| # | Plan item | Status | Where |
| --- | --- | --- | --- |
| 6.1 | Notebook/category/entry CRUD and search | **D** | `LibraryPage.tsx`, `ListPage.tsx`, `NotebookPage.tsx`, `NameDialog.tsx`, cascade deletes in `src/data/db.ts`. |
| 6.2 | Saved-word import into lists/notebooks with duplicate handling | **D** | `useSavedWords().toggle(entry, listIds)`, `src/modules/library/helpers.ts`. |
| 6.3 | Independently designed, documented spaced-repetition scheduler | **D** | `src/domain/scheduler.ts` (own interval/ease rules, caps, `dueQueue`, `previewInterval`, `reviewDelta`), unit-tested in `tests/unit/scheduler.test.ts`. Not Anki's SM-2, and not presented as one. |
| 6.4 | Flashcard/session configuration, results, review history | **D** | `FlashcardsPage.tsx`, `PracticePage.tsx`, `learningStore.ts`, `decks`/`cards`/`attempts`/`sessions` stores. |
| 6.5 | Original practice questions from licensed entries; original/approved mock content | **D** | `src/modules/learning/questionBank.ts` (1,193 lines, authored for the project), `DrillPanel.tsx`, `TestPage.tsx`. |
| 6.6 | Scoring, progress, retries, clear disclosure that tests are not official | **D** | `TestListPage.tsx` / `TestPage.tsx` state "practice tests, not an official exam … nothing is sent anywhere". |
| 6.7 | Local achievements and activity summaries, no manipulative streak recovery or paid mechanics | **D** | `src/domain/achievements.ts` (fixed catalogue read from local counts), `ProgressPage.tsx`, `activity` store. Nothing purchasable, nothing streak-shaming. |
| 6.8 | Referential integrity through deletion, merge, migration, export/import | **P** | Cascade delete + backup coverage are implemented and partly unit-tested; there is no merge path (3.6) and no migration path (2.6), so integrity across those two operations is unproven. |

**Exit gate** (saved material and scheduling survive reload and backup/restore; nothing capped or
locked): met in code; the reload/restore leg has not been exercised in a browser by an automated test.

## Phase 7 - OCR, camera and photo vocabulary

| # | Plan item | Status | Where |
| --- | --- | --- | --- |
| 7.1 | Explicit camera permission flow plus upload and text-entry alternatives | **D** | `CapturePage.tsx` (742 lines): denial is explained and never blocks upload or typing. |
| 7.2 | Approved local OCR in a Worker, lazy-loaded models with provenance and size disclosure | **D** | `src/modules/capture/useOcr.ts` (`createWorker('chi_sim+eng', OEM.LSTM_ONLY)`), `tesseract.js` + `tesseract.js-core`, models/cores under `public/data/ocr/` with `manifest.json` sizes + sha256; Apache-2.0 provenance in `provenance.json`. Caveat: the two core `.wasm.js` files (~7.9 MB) are currently **precached** by the service worker although the models are opt-in - needs `globIgnores` in `vite.config.ts` (recorded as a known gap in the README). |
| 7.3 | Crop/rotate only as needed, original UI code | **D** | `CapturePage.tsx`. |
| 7.4 | Show recognised text for correction and uncertainty before lookup | **D** | Editable result list with per-item lookup; nothing is auto-committed to a list. |
| 7.5 | Selected text into entries, lists or photo-vocabulary collections | **D** | `db.photos` / `db.photoImages` photo vocabulary, plus save-to-list actions. |
| 7.6 | Images local by default, deletion controls | **D** | IndexedDB blobs, per-photo and clear-all deletion; no upload path exists, so nothing can leak. |
| 7.7 | Tests: permission denial, unsupported cameras, poor/large images, low memory, cancellation | **X** | None written; camera paths are untestable without Playwright (Phase 12.4). |

**Exit gate** (denial never blocks; OCR does not freeze the UI): implemented; unverified in a browser.

## Phase 8 - reading and translation assistance

| # | Plan item | Status | Where |
| --- | --- | --- | --- |
| 8.1 | Local plain-text bilingual reading with dictionary selection/annotation | **D** | `ReaderPage.tsx` (924 lines) with `spans()` segmentation. |
| 8.2 | PDF.js rendering in a Worker with page virtualization | **P** | `pdfjs-dist`, page count/page-at-a-time rendering, document bytes in `documents`/`documentBlobs` stores. Strict page *virtualization* (windowed re-render on scroll) is not demonstrably implemented; large-PDF behaviour is unmeasured (8.7). |
| 8.3 | Imported documents local by default, deletion supported | **D** | `ReaderPage.tsx`, `DataPage.tsx`. |
| 8.4 | Distinguish glosses from machine translation in labels and output | **D** | There is no translation feature to mislabel; the dictionary UI says "gloss"/"meaning". |
| 8.5 | Machine translation only via an approved service, opt-in, no secret key in the client | **O** | No external service is called at all: no backend, no key, no disclosure needed. Consequence: users wanting full translation get none, and the README says so. |
| 8.6 | Original/licensed tips, lessons, stories, articles as versioned static content | **D** | `content-tips` (30), `content-lessons` (12), `content-stories` (8), `content-articles` (4), authored under CC BY 4.0, rendered by `LearnPage.tsx` / `ContentPage.tsx` / `ContentBlocks.tsx`. |
| 8.7 | Test complex PDFs, large documents, missing fonts, corrupt files, offline behaviour | **X** | Not written. |

**Exit gate:** text/PDF reading works locally in code; translation claims match the mechanism (there is
none); "large documents do not block the main thread" is **unmeasured**.

## Phase 9 - personalisation and local games

| # | Plan item | Status | Where |
| --- | --- | --- | --- |
| 9.1 | Expand original themes and accessibility preferences | **D** | `SettingsPage.tsx` (539 lines): script, pinyin style, theme, contrast, reduce motion, text scale, speech language/rate, auto-speak, daily goal. |
| 9.2 | Local profiles only if useful; never imply online accounts | **O** | No profile switcher exists. Single-device state + export/import is the documented model; adding "profiles" would read like accounts. |
| 9.3 | Original learning games and solo challenges | **X** | No game is implemented. Practice drills and tests are not games and are not described as such. The manifest shortcut to `#/practice` is a real route. |
| 9.4 | Label any scores/rankings as device-local | **D** | `ProgressPage.tsx` presents streak/achievement counts as local; there is no ranking list to mislead, and no other player. |
| 9.5 | App shortcuts, URL search, share-target integration where supported | **D** | `public/manifest.webmanifest` shortcuts (search/practice/capture/reader), `#/search?q=`, `public/share-target/index.html` + `share_target` GET registration. |
| 9.6 | Forum, public chat, public rankings, live voice, PK unavailable until Track B | **D** | Absent; named in the README as absent with reasons. |

**Exit gate** (every visible control has a real local function; no simulated social/cloud behaviour):
met - and this is the rule the project is most careful about.

## Phase 10 - optional backend decision

| # | Plan item | Status | Where |
| --- | --- | --- | --- |
| 10.1-10.6 | Decide/price a backend, account+privacy design, authenticated sync with conflict resolution, moderation/abuse/rate-limiting, server-side secrets, Track A usable without a backend | **F** (all) | No backend decision has been taken, so nothing here is implemented. **The Track A requirement is met and enforced**: 10.6 is satisfied by construction - `connect-src 'self'` in the build-time CSP, same-origin fetches only (`src/data/packs.ts`), no API keys anywhere in `src/`. |

**Exit gate:** Track B needs its own approval, threat model and cost decision before any of it exists.
That approval has not been sought. Track B items (sync, social, hosted AI, notifications) are excluded
from this static release by design, not by omission.

## Phase 11 - privacy, security and accessibility hardening

| # | Plan item | Status | Where |
| --- | --- | --- | --- |
| 11.1 | No analytics, no undisclosed network calls | **D** | No analytics dependency; the only `fetch` calls are same-origin `public/data` and `public/licenses`; a grep for absolute URLs in `src/` returns licence/provenance *text constants*, not requests. |
| 11.2 | External OCR/translation/AI opt-in with disclosure of what leaves the device | **D by absence** | Nothing leaves the device. OCR is local WASM; the only "opt-in" surface is downloading a model, whose byte size is shown first. |
| 11.3 | Validate imports and packs at the boundary; sanitise rich text; never execute imported HTML/PDF scripts | **D** | Zod validation of manifests and backup payloads (`src/data/schema.ts`, `exportImport.ts` size+schema checks, `MAX_IMPORT_BYTES`); SHA-256 per pack file before install; content JSON validated by the build (`build-content.mjs`). No `dangerouslySetInnerHTML` in the app; the only `innerHTML` writes are `= ''` clears of the Hanzi Writer host (`StrokePanel.tsx`). Imported text is rendered as text. |
| 11.4 | Restrictive CSP compatible with Workers/WASM and the hosting constraint | **D** | `cspForProduction()` in `vite.config.ts` injects the policy as a `<meta http-equiv>` at build time (Pages cannot send headers), with `'wasm-unsafe-eval'` for tesseract and `blob:` workers. Asserted by both workflows. |
| 11.5 | Complete WCAG 2.2 AA checks | **P** | Mechanics implemented app-wide (headings, labels, `aria-live`, focus, contrast/zoom/reduced-motion options, 44px). **No checklist has been run against WCAG 2.2 and nothing has been tested with a screen reader.** |
| 11.6 | Accessible alternatives for pinyin/ruby, audio, stroke animation, colour-coded states | **D** | `showPinyin` / `displayScript` / `pinyinStyle: none` toggles, text definitions of readings when a voice is missing, user-triggered stroke replay, labels alongside colour. |
| 11.7 | Clear-data, export-data, storage-usage and licence/provenance controls | **D** | `DataPage.tsx` (export/import/clear + storage), `OfflineDataPage.tsx` (sizes, usage, persistence, uninstall), licence texts in `public/licenses/` and per-pack licence fields, and a single self-contained `AboutPage.tsx` (432 lines) that renders the register and fetches the same-origin `licenses/*.txt`. `grep -rl "SKELETON" src` returns nothing, and the two helper modules an earlier draft split out (`aboutLicences.ts`, `aboutProvenance.ts`) were deleted as orphans once `AboutPage.tsx` absorbed them. The e2e run asserts the about screen names CC-CEDICT, Unihan and Tatoeba and links the notices file. |

**Exit gate** (no secrets in the client; imports cannot inject markup/script; primary workflows
keyboard and screen-reader usable): the first two are met; the third is **unverified** - no
assistive-technology pass has happened.

## Phase 12 - verification and performance

| # | Plan item | Status | Where |
| --- | --- | --- | --- |
| 12.1 | Unit tests for normalisation, ranking, scheduling, scoring, migrations, imports | **P** | `tests/unit/` covers pinyin, search/ranking, scheduler, pack schema, content shape, backup export/import and IndexedDB shape - 259 cases in 9 suites, all passing, and `npm run typecheck` covers the suite itself. Scoring and migration coverage is still thin: there is one schema version, so v1→v2 is the first upgrade the app has, and it is asserted only as "the v2 indexes exist" (`tests/unit/db.test.ts`). |
| 12.2 | Property tests for Unicode normalisation, malformed imports, idempotent migrations | **X** | None. |
| 12.3 | Integration tests for IndexedDB, Worker protocols, pack install, rollback, SW updates | **P** | fake-indexeddb exercises the db and pack layer; worker protocols, rollback and SW update flows are untested. |
| 12.4 | Playwright journeys on Chromium, Firefox, WebKit at phone/tablet/desktop widths | **P** | `playwright.config.ts` + 9 specs pass on **Chromium at one desktop width** (recorded 2026-11-05, 21.0s). Firefox, WebKit and the phone/tablet widths are not configured (one project, `devices['Desktop Chrome']`), and no CI workflow runs browsers. |
| 12.5 | Golden path: search Hanzi / numbered pinyin / English → entry → save → flashcard → export → reload offline → import | **P** | `tests/e2e/dictionary-flow.spec.ts` automates search in three modes → entry → save → library, plus searching with the network switched off. The flashcard, export and import legs are still only unit-tested (`tests/unit/exportImport.test.ts`, `scheduler.test.ts`), not walked in a browser. |
| 12.6 | Edge cases: variants, neutral tone, multiple readings, `ü`/`v`, no results, camera denial, no speech voice, large imports, quota, interrupted updates | **P** | `ü`/`v`, tone numbers and no-result states are unit-covered; camera denial, quota exhaustion and interrupted update flows are handled in code but untested. |
| 12.7 | Measure cold/warm startup, search latency, memory, pack sizes, OCR latency, PDF rendering on a representative phone and PC | **P** | Pack sizes are measured and published; nothing else has been measured on any device. |
| 12.8 | Installability/offline/accessibility audits and manual verification on the user's phone and PC | **X** | Nothing published, nothing audited, no device run recorded. |

**Exit gate:** **partly met.** The unit layer and a first Chromium browser layer are green, and that
browser layer paid for itself immediately - see "Defects found only in the browser" below. What is
missing is the multi-browser, multi-width sweep and any real-device run (12.7, 12.8).

## Defects found only in the browser (2026-11-04)

The first Playwright run failed 8 of 9 specs, and chasing those failures turned up three defects that
259 passing unit tests had never seen, because each one lived in the seam between the committed data,
IndexedDB and a real page load. All three are fixed and re-verified by the suite.

1. **Simplified and traditional were inverted for every dictionary entry.** CC-CEDICT writes
   `TRADITIONAL SIMPLIFIED [pinyin] /gloss/`, and both parsers (`scripts/content/build-dictionary.mjs`
   and `scripts/content/lib/cedict.mjs`) destructured those two capture groups as
   `simplified, traditional`. The pack format, `entryId`, the `byS`/`byT` index views and
   `displayScript` all define field 0 as simplified, so the whole app treated traditional headwords as
   simplified: the entry screen for `zhong1 guo2` opened with **中國** as the primary headword, and a
   learner choosing "simplified" got traditional glyphs. Found because `dictionary-flow.spec.ts:18`
   asserted the entry heading. Fixed at both parsers, packs rebuilt (this is why the examples pack grew
   from 16,425 to 39,806 records - headword matching against the corrected column now succeeds), and
   `build-dictionary.mjs`'s own error message corrected, it previously described the format as
   "SIMP TRAD".
2. **The entry screen crashed for every user who had saved lists.** `src/data/db.ts` declared
   `wordLists: 'id, updatedAt'` and `categories: 'id, parentId'`, but four screens call
   `orderBy('name')`. IndexedDB has no scan fallback for ordering by an unindexed key path - it
   rejects with `KeyPath name on object store wordLists is not indexed`, which the error boundary
   surfaced as "Something went wrong on this screen". Fixed as a real schema bump: `version(2)` adds
   the two `name` indexes, `SCHEMA_VERSION` is now 2, and `tests/unit/db.test.ts` asserts the indexes
   exist rather than trusting the call sites.
3. **Most characters read as "not recorded".** `DictionaryService.character()` binary-searches the
   concatenated character shards. Two independent faults broke it: the shards are joined, so each
   file's trailing newline left an empty element in the array, and `parseInt('')` is NaN - a probe
   landing on one stops the search dead; and `build-characters.mjs` sorted code points with
   `Number(a, 16) - Number(b, 16)`, but `Number()` ignores a radix, so `'26127'` was read as decimal,
   `'257e3'` as scientific notation (257000) and `'4e2d'` as NaN. The pack was never in code-point
   order at all. Fixed by filtering empty lines in the reader, sorting with `parseInt(x, 16)`, and
   adding a build-time assertion that the rows are strictly ascending, so a future rebuild cannot ship
   an unsearchable pack.

Also fixed alongside them: `playwright.config.ts` polled `http://127.0.0.1:4173` while `vite preview`
with no `--host` binds only the IPv6 loopback on Windows, so the run could never start
("Timed out waiting 300000ms from config.webServer"); and three assertions in the new specs were over
strict (the registry prints the SPDX id `CC-BY-SA-4.0`, the notices link's accessible name is "Full
third-party notices", and Unihan readings are tone-marked `zhōng`).

**Process consequence:** a gate that never executes a browser is not a gate. The repository's CI still
does not run Playwright - the runner has no browsers installed - so these three defects would have
shipped green.

## Open-source licence audit (2026-11-05)

Before the repository went public, the tree was re-scanned for anything that would make an open-source
publication legally unsafe. Two read-only passes: a clean-room trace scan (APK artifacts, decompiled
output, proprietary assets, embedded credentials, absolute local paths, brand names) and a
licence-coverage scan of everything the build actually serves.

**Clean-room scan: clear.** No `.apk`, `.dex`, `.smali`, font, audio or SQLite artifact of any kind is
tracked; the only occurrences of the reference product's name are the disclaimers in `README.md`,
`docs/APP_CONTRACT.md` and the CI ban in `check-provenance.mjs` §8; the icons are generated by
`scripts/make-icons.mjs` (its own deterministic PNG encoder, and it refuses to rasterise a glyph it
cannot draw); no secret and no `C:\Users\…` path is in a tracked file. The names *Hanyu Dictionary* /
*Hanyu Dict* are descriptive, not a brand.

**Licence coverage: three real gaps, all now closed.**

1. **No root licence.** GitHub reads `LICENSE` to state the project's licence; with none, the repository
   advertised nothing even though `package.json` said MIT, and the code-MIT / data-per-source split lived
   only in prose. Added `LICENSE` - the MIT text, so the detector matches it - with a short pointer that
   it covers application code only and grants no rights over the packs or the bundled libraries.
2. **Bundled runtime code shipped with no notice.** The audit's first pass covered the *datasets*; the
   libraries compiled into `dist/assets/*.js` and `dist/sw.js` had no licence anywhere, although MIT
   requires the copyright and permission notice in every redistribution and Apache-2.0 §4(d) requires
   reproducing the upstream NOTICE. Affected: react, react-dom, scheduler, react-router,
   react-router-dom, @remix-run/router, zod, **dexie and dexie-react-hooks (Apache-2.0 - Dexie ships a
   NOTICE naming David Fahlander)**, pdfjs-dist (Apache-2.0), idb-keyval, wasm-feature-detect, the
   transitive leaves (loose-envify, js-tokens, whatwg-url, tr46, webidl-conversions, node-fetch,
   zlibjs, bmp-js, is-url, is-electron, opencollective-postinstall, regenerator-runtime) and the
   **Workbox 7.4 runtime inlined into the service worker** - 42 installed packages in total.
   `scripts/collect-runtime-licenses.mjs` now generates `public/licenses/RUNTIME_NOTICES.md` from the
   tree `npm ci` produces: every MIT/BSD text verbatim, every Apache package with its NOTICE verbatim
   (or an explicit "this package ships no NOTICE"), plus a section for the one package whose tarball
   carries a licence id but no licence text. It is a build stage (`runtime-licenses`) and a gate
   (`npm run data:check` re-derives it and fails on drift), it is linked from
   `THIRD_PARTY_NOTICES.md` and it is readable in-app on `#/about`.
   Note the pre-existing `public/licenses/MIT.txt` is *hanzi-writer's* MIT text (copyright David Chanin),
   which is why per-package texts are generated rather than pointing every MIT library at that file.
3. **`package.json` had no repository or homepage,** which the npm registry, `npm audit` reports and
   GitHub's own package insights all use. Added `repository`, `homepage`, `bugs` and keywords. The
   package stays `"private": true` deliberately: it is an application, never to be published to npm.

**Also fixed while measuring:** the earlier note in this file that the directory "is not a git repository
yet" was stale - `origin/main` exists and matches the local branch; §8 and the release-blocking list now
say which half of that work is genuinely done (pushed) and which is not (Pages, first hosted CI run).
A `.gitattributes` pinning `eol=lf` was added: `core.autocrlf=true` on Windows would convert the
committed LF pack shards to CRLF on a fresh clone, changing the bytes of a file whose SHA-256 is recorded
in `data/manifest.json`, and every pack install would then fail verification - a publication-blocking
foot-gun, not a style preference.

**Remaining, by choice:** the individual-Tatoeba-author gap (deviation 5), and the fact that a licence
audit is not legal advice - the Arphic Public License and the CC BY-SA share-alike duty on
`dictionary-core` are the two terms a downstream reuser is most likely to get wrong, which is why both
are stated in the generated notices and on the About screen rather than only in this file.

## §8 GitHub repository and Pages publication

| # | Plan step | Status | Note |
| --- | --- | --- | --- |
| 8.1 | Working tree contains only intended source, approved assets, generated notices, documentation | **D**, and enforced | `check-provenance.mjs` §8 scans the tree; `ci.yml` scans git's index (APKs, splits, `.dex`, uncompressed `.traineddata`, `.cache/`, `Modded/`, `jadx`/`smali`/`decompiled`, the reference planning documents, `.env`, `*.key`, `*.pem`, `node_modules`). |
| 8.2-8.4 | Create the public repository, push it (gh CLI or web UI + remote) | **D**, user's action | `origin = https://github.com/RandomGuy198/Hanyu-dict`, `main` pushed (`8ce9788 Import Hanyu Dictionary project`, 577 files); `git rev-list --left-right --count origin/main...main` is `0 0`. Visibility, branch protection and Pages settings are GitHub-side and were not asserted from this machine. Never request a token in chat - unchanged rule. |
| 8.5 | Add `.github/workflows/ci.yml` and `deploy.yml` | **D** | Both written here; deploy runs from the branch you declare default. |
| 8.6 | Use configure-pages + upload-pages-artifact + deploy-pages, Pages source = GitHub Actions | **D** | `deploy.yml` shape (a), with `permissions: {pages: write, id-token: write}` and a `github-pages` environment. |
| 8.7 | Deploy only the production artifact | **D** | `path: dist` (shape a) or the verified committed folder (shape b); shape (c) deploys nothing. |
| 8.8 | Verify the planned project URL | **X** | Cannot be done before publication; note that `base: './'` makes the URL name-independent, so `…/<whatever-you-call-it>/` all works. |
| 8.9 | Test deep links, SW scope, offline reload, pack downloads, licences, updates on the live site | **X** | Release-blocking checklist; recorded as pending, not as done. |
| 8.10 | Tag the first release only after real-device verification | **X** | Nothing tagged; correctly so. |

## §9 Acceptance criteria for the complete static release

| Criterion | Met? | Evidence / gap |
| --- | --- | --- |
| Every included feature free, no subscription/entitlement/account | **Yes** | No entitlement flag, ad slot, trial counter or paywall anywhere; asserted in `docs/APP_CONTRACT.md` rule 2. |
| Dictionary, learning and downloaded content work offline within stated limits | **Probably, unproven** | Workbox + hash-verified IndexedDB packs are implemented; nobody has reloaded the app offline yet (12.5, 12.8). |
| Responsive and installable on verified phone and desktop targets | **Not verified** | Manifest/icons/CSP/routes exist; the verification half has not happened. |
| User data survives upgrades and can be exported/restored | **Partly** | Backup export/import and separate user/pack storage are implemented; there is one schema version, so no upgrade path has been exercised. |
| No proprietary APK content or unclear-license asset present | **Yes** | Clean-room register + two enforcement layers; every shipped byte is in `public/data/manifest.json` with a licence and a hash. |
| Every dependency has provenance and required attribution | **Yes with one honest caveat** | Data licences and `THIRD_PARTY_NOTICES.md` ship, and since the 2026-11-05 licence audit so do the *code* licences: `LICENSE` (MIT, application code) at the root and `public/licenses/RUNTIME_NOTICES.md` for every production dependency and the Workbox modules inlined into the service worker, with the Apache-2.0 NOTICE files reproduced verbatim. `npm run data:check` re-derives that file from `npm ci`'s tree, so a bump cannot leave a stale notice behind. The in-app About screen renders both. The individual-Tatoeba-author gap (deviation 5) remains, by choice, with the sentence-id link as the recovery path. |
| No fake social/AI/translation/sync/native capability presented as functional | **Yes** | Enforced by contract and by the absence of any such control. |
| CI, browser tests, real-device golden paths, accessibility checks, publication checks pass | **Partly** | `npm run data:check`, `tsc --noEmit`, `vitest` (259 tests, 9 files), `eslint --max-warnings 0`, `vite build` and `playwright test` (9 specs, Chromium) all pass locally. The GitHub Actions workflows are committed but their first real run on the hosted runner has not been observed, and no real-device golden path or accessibility audit has been performed. |
| GitHub Pages serves the app and all assets under the repository base path | **Not yet** | Relative `./` URLs are asserted at build time; the site is unpublished. |

## Deliberate deviations from the plan

1. **Location.** The plan said `Modded/hanyu-web`; the app lives in `Hanyu Dictionary/Hanyu dict`
   because the user asked for the files there. The reference directory `../Modded` stays read-only and
   outside the repository, which is what the plan actually cared about. `package.json` still names the
   project `hanyu-web`.
2. **`base: './'` instead of `/hanyu-web/`.** A relative base makes the build work under any repository
   name (and any project pages domain) with no edit, at the cost of requiring every emitted URL to stay
   relative - which both workflows now assert.
3. **Lingua Libre pronunciation audio omitted.** `DATA_SOURCES.md` is explicit that Commons files carry
   *per-file* licences and that a category does not have one licence; achieving the coverage a
   dictionary needs would mean auditing thousands of individual recordings and retaining each creator
   credit. Rather than ship something legally thin, pronunciation uses device `SpeechSynthesis` and the
   UI labels it **synthetic**, with an explicit "no Chinese voice installed" state. The optional
   `audio-<language>` pack kind is still defined in `docs/DATA_FORMAT.md`, so the slot exists without
   being filled by guesswork.
4. **Make Me a Hanzi `dictionary.txt` (IDS decomposition) not shipped.** It is LGPL v3+, separate from
   the Arphic licence on the stroke graphics, and the project did not accept that copyleft/source-
   availability model for a data file. Radical *numbers* come from Unihan `kRSUnicode`; general
   component decomposition is therefore a **documented data gap**, and `CharacterPage` shows no
   components rather than inventing them.
5. **Tatoeba contributor usernames recorded as `unknown`.** The pinned per-language exports carry only
   `id`, `lang`, `text`; usernames live in the 1.4 GB `sentences_detailed` and 594 MB contributions
   dumps, deliberately not vendored. Every `sourceRef` is `tatoeba:<id>:unknown`, and
   `attributionGap` in `scripts/content/provenance.json` records exactly this. The recovery path is now
   implemented rather than merely described: `src/domain/sourceRefs.ts` reads the id out of a ref and
   `EntryPage` renders it as a link to `https://tatoeba.org/en/sentences/show/<id>`, the page that names
   the contributor, so an individual credit is one deliberate click away and is never invented offline.
   Attribution to the project and licence is intact; naming authors offline is not, and remains a real
   gap rather than a rounding error.
6. **Track B excluded from this release.** Sync, accounts, forums/chat/PK/live voice, hosted AI,
   pronunciation scoring and push notifications are absent by decision (plan §3 Track B, §7 Phase 10).
   No dead button stands in for any of them.
7. **Lint is configured before it is installed.** `package.json` is owned by another workstream, so
   `eslint.config.js` ships and the exact install command is documented; CI runs lint when the binary
   exists and reports `NOT RUN` (never a fake green) when it does not.
8. **JSON backup instead of JSON/ZIP.** Simpler, inspectable, size-capped, no compression dependency at
   the cost of a larger file; `docs/DATA_FORMAT.md` and `src/data/exportImport.ts` are consistent.
9. **`site/` rather than `docs/` for a committed Pages folder.** `scripts/sync-pages.mjs` documents the
   reason (build output must not live next to hand-written design notes); `deploy.yml` shape (b) still
   accepts `docs` and warns about exposing the internal documentation.
10. **Install name settled in favour of *Hanyu Dictionary*.** `index.html` and
     `public/manifest.webmanifest` now agree (`name: "Hanyu Dictionary — Chinese characters, words and
     study"`, `short_name: "Hanyu Dict"`). An earlier draft installed the app as *Hanzhi*, one letter
     from the reference product's name; plan §4 requires a name that does not present this project as
     that product, so the near-collision was removed rather than argued about.

## Parity unknowns inherited from `FEATURE_INVENTORY.md`

The inventory is a declaration list from a static APK read (ZIP inspection + manifest string pool; the
jadx provider could not run, and the failure is preserved in `base-package-evidence.json`). These
unknowns are **unresolved by this repository** and must stay unresolved until someone performs an
authorised walkthrough or writes fresh requirements. Nothing below is claimed as parity.

1. The user-visible workflow, inputs, outputs, empty states and error behaviour of each original screen.
2. Which declared screens are reachable in version 6.26.0 versus stale or experimental.
3. Which original features require the vendor's servers, accounts, paid APIs or native Android
   capabilities.
4. The content and redistribution licence of every original dataset and media asset (deliberately not
   investigated: no original content is used).
5. Exact search ranking, romanisation normalisation, handwriting recognition, pronunciation scoring,
   spaced-repetition and synchronisation behaviour of the original app.
6. The user's target phone/browser and required interface languages (this build ships English-only UI
   and assumes a modern mobile-first browser; confirm before calling any device "supported").

Consequences worth repeating: this app does **not** claim feature parity with the reference product,
does not reproduce its ranking or scoring, ships no handwriting *recognition* (only guide-based tracing
with median data), and does not identify which of its screens correspond one-to-one with original
screens beyond the coarse groups in the inventory.

## Data gaps stated plainly

- No human pronunciation audio; no zhuyin/bopomofo; no IDS component decomposition; no collocations;
  no etymology or glyph evolution; no non-English definition languages; no OCR languages beyond
  `chi_sim` and `eng`; no machine translation.
- Simplified/traditional conversion is partial where Unihan has no variant mapping, and the app leaves
  such characters unchanged rather than guessing.
- Example sentences are Tatoeba pairs filtered to `cmn`→`eng`, up to 3 per headword of length ≥ 2,
  4-60 Hanzi; coverage over the 125,365 words is therefore sparse and the UI says when a headword has
  none.
- Tatoeba individual attribution is `unknown` (deviation 5).

## Release-blocking list (what must happen before this is published as 1.0)

1. ~~`git init`, commit, create the repository, push~~ - **done by the user's publishing agent on
   2026-11-04**: `origin = https://github.com/RandomGuy198/Hanyu-dict`, `main` at `8ce9788`, 577 files,
   working tree clean. Still outstanding: the licence-audit changes described above are in the working
   tree, not in that commit, so they have to be committed and pushed; Pages has to be switched on; and
   CI still has never executed on a hosted runner.
2. ~~Get `npm run typecheck` clean~~ - **clean on 2026-11-04** (strict + `noUnusedLocals`, covering
   `tests/**`) and still clean after the 2026-11-05 audit, now at 259 unit cases. ~~What is left here
   is lint~~ - **`eslint . --max-warnings 0` is clean** and the `react-hooks/exhaustive-deps` notes are
   triaged: the two genuine invalidation signals (`voiceTick`, `restartAt`) carry targeted disables with
   the reason beside them, the rest were fixed. Running lint *inside CI* is the remaining half.
3. Configure Playwright and encode the Phase 12.5 golden path plus camera-denial, no-voice, quota and
   offline-reload cases; run it on Chromium, Firefox and WebKit at three widths. `playwright.config.ts`
   plus `app-shell.spec.ts` and `dictionary-flow.spec.ts` exist and cover the shell, CSP, registry,
   offline data table, licence pages, 404 screen and the four search modes - the multi-browser,
   multi-width sweep and the camera-denial/no-voice/quota cases have not been encoded or run.
4. ~~Finish `AboutPage.tsx`~~ - landed on 2026-11-04, typechecks; what is left is a real-device check
   that the licence texts render offline.
5. ~~Add `globIgnores` for the data directory~~ - `vite.config.ts` now precaches only app shell,
   licence texts and icons (`globIgnores: ['**/data/**']`), so the ~7.9 MB of opt-in OCR runtime and the
   packs themselves are never pushed by the service worker; the pack registry is fetched under a
   `NetworkFirst` runtime rule instead.
6. ~~Decide the install name~~ - see deviation 10.
7. ~~Fix the missing `pathToFileURL` import in `scripts/sync-pages.mjs`~~ - fixed, and
   `npm run pages:sync` has since produced `site/` (227 files, 64.2 MB).
8. Manual verification on the user's actual phone and PC: install, offline reload, deep link, pack
   download, camera, PDF, speech, then tag the release.

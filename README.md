# Hanyu Dictionary

A free, installable, offline-first **Chinese (Mandarin) dictionary and study app** that runs entirely
in your browser. Dictionary data is open-licensed; the reading library is written for this project. It
ships as a Progressive Web App and is designed to publish on GitHub Pages under any repository name.

**Version 0.2** added the textbook study side: a six-volume course shelf, an interactive page reader,
a five-step guided lesson, stroke-order writing practice fed into the spaced-repetition scheduler, and
Vietnamese definitions and Hán-Việt readings on every entry.

**This is an independent application.** It is not a client, port, clone, unlock, patch or wrapper of
any commercial dictionary app, is not affiliated with or approved by any of them, and contains no code,
assets, databases, layouts, audio or text taken from one. It was written clean-room against a feature
checklist only.

Everything here costs nothing and nothing is locked: no account of ours, no subscription, no
entitlement flag, no trial counter, no ad slot, no telemetry, no "pro" tier.

---

## Two repositories, and the line between them

| | Public repository (this one) | Private study repository |
| --- | --- | --- |
| Contains | the app, the open data packs, the licence texts | page images, structured lesson text, lesson recordings and generated speech of the textbook you own, plus your own progress |
| Served by | GitHub Pages | the GitHub Contents API of a repository **you** own |
| Guarded by | `npm run legal:check`, before and after every build | a README notice stating it is a private study copy, not for redistribution |

The split is the whole legal position. Book-derived material never enters this repository, its history,
or `dist/`; `scripts/legal/check-public-tree.mjs` fails the build on the first hit. Without a connected
repository the app is a complete dictionary, flashcard and writing app that simply has no textbook to
read - and it says so on screen instead of pretending otherwise.

## What the app does, screen by screen

Routes are hash-based (`#/entry/...`), which is what makes deep links work on GitHub Pages without any
server rewrite rule. The five primary destinations are **Sách & Khóa học**, **Từ điển**, **Ôn tập**,
**Tập viết** and **Sổ tay**.

| Route | Screen | What it actually does |
| --- | --- | --- |
| `#/` | Home | Search box (Hanzi, pinyin with tone marks, tone numbers, no tones, `ü`/`v`, Vietnamese diacritics), recent searches, a character drawn from your own dictionary, device-voice status and quick jumps |
| `#/search?q=` | Results | Ranked results (exact → prefix → meaning), match-type labels, coverage warnings when a pack is not installed, shareable URL |
| `#/entry/:key` | Entry | Headword in both scripts, readings, **Vietnamese glosses above English**, Hán-Việt reading, Tatoeba examples with their sentence ids linked upstream, save/list actions, character links |
| `#/character/:value` | Character | Unihan readings (Mandarin, Cantonese, Hán-Việt), definition, radical + residual strokes, stroke count, variant sets, stroke animation and tracing |
| `#/books` | Book shelf | The six volumes with per-volume progress, the 76-lesson roadmap with five-step completion dots, and a "continue" card resolving your last bookmark |
| `#/books/:bookId`, `#/books/:bookId/page/:n` | Reader | Page image / clean text / split views over the pages from your private repository, with percentage-positioned hotspots on every sentence and vocabulary row, a sticky audio bar (sentence stepping, speed, loop, original recording vs synthetic) and a word popover |
| `#/courses/:bookId/:lessonId` | 5-step lesson | Từ mới → Bài khóa → Chú thích & Ngữ pháp → Luyện nhận biết (a 12-question auto-generated drill, ≥80 % to pass) → Tập viết chữ Hán. Each step seeds SRS cards, records progress and marks the sync state dirty |
| `#/study` | Study hub | Due counts for recognition and writing cards per deck, start a review or a drill, or draw the due characters in the writing review panel that grades strokes into the scheduler |
| `#/writing` | Writing practice | Pointer-events tracing over licensed median guides, per-stroke replay and speed, undo/clear, grid guides; characters without guide data are drawn **unscored** rather than given a fake grade |
| `#/library`, `#/list/:id`, `#/notebook/:id` | Library | Saved words, word lists, notebooks and categories, with cascade delete and duplicate handling |
| `#/flashcards` | Flashcards | The project's own interval-repetition scheduler (`src/domain/scheduler.ts`), ratings, suspension, per-deck statistics |
| `#/test`, `#/test/:id` | Assessments | Question sets generated from licensed entries and from your own lists; the screen states these are not official exam equivalents |
| `#/progress` | Progress | Local activity, streaks and achievement evaluation - all device-local |
| `#/reader` | Reader | Your own Chinese text with tap-to-lookup annotation and simplified/traditional switching |
| `#/learn/:id` | Reading library | Original tips, lessons, stories and articles written for this project (CC BY 4.0) |
| `#/settings` | Settings | Script, pinyin style, theme, contrast, reduce motion, text scale, speech, daily goal, and the GitHub connection card that turns on the study repository |
| `#/data` | Data | Export, import (validated, confirmed), storage statistics, clear-everything |
| `#/about`, `#/licenses` | About | The provenance register with live pack versions and sizes, the ShareAlike duty, and every licence text read from this same origin |

Retired screens keep their bookmarks alive by redirecting: `#/capture` → `#/reader`, `#/offline-data` →
`#/settings`, `#/practice` → `#/study`, `#/learn` → `#/books`.

Search runs in a Web Worker against a prebuilt index; packs are verified by SHA-256 before installation,
install themselves on first use and self-heal if part of one goes missing, and are stored separately
from your own data, so updating content never erases progress.

## Your own study repository, and how it is kept private

- A **fine-grained** personal access token is entered once per device on `#/settings`. Its scope should
  be a single repository with *Contents: Read and write* and nothing else.
- It is stored only in `localStorage['hanyu.gh.pat']` on that device, is never written to IndexedDB,
  never appears in a URL, and is shown masked. "Forget token" removes it and the cached private data.
- It is sent only as `Authorization: Bearer …` to `https://api.github.com`. The CSP says so and the
  build enforces it: `connect-src 'self' https://api.github.com data: blob:`. There is no CDN, no
  analytics host, no font host and no speech endpoint in the bundle.
- Pulls use `If-None-Match`/ETag so unchanged files answer `304` and cost no API quota; pushes of
  `sync/state.json` are debounced and, on a `409` conflict, merge remote and local state and retry.
- Pages, lesson JSON and audio are cached in IndexedDB, so a downloaded lesson keeps working offline.
  Images and audio are shown as `blob:` URLs, never as upstream URLs.

## The open data

`scripts/content/` is an auditable, build-time-only pipeline. Nothing in `src/` talks to a third-party
server; the app fetches same-origin `public/data` and `public/licenses`, plus the GitHub API only when
you connect a repository.

```bash
npm run data:fetch   # the ONLY step that touches the network (a maintainer machine)
npm run data:build   # rebuild every pack + the licence texts from the cache
npm run data:check   # the release gate; runs offline, no cache required
```

- Raw downloads never enter the repository: they land in `<repo>/../.cache/raw` (overridable with
  `--cache <dir>` or `HANYU_CACHE`), which `.gitignore` keeps out of git.
- Every source is pinned in `scripts/content/provenance.json` before use: upstream project, exact URL,
  version or commit SHA, licence id and licence file, attribution text, ShareAlike duty, the
  transformations applied, the checksum of each download, and which packs it produces. `data:fetch`
  refuses a hash mismatch.
- Generated packs are committed, so a fresh clone deploys with no data build and no network.

Eight packs, 273,481 records, 57.6 MB (`npm run data:check` prints the current totals):

| Pack | Source | Licence | Records | Installed by |
| --- | --- | --- | --- | --- |
| `dictionary-core` | CC-CEDICT (MDBG) merged with CVDICT and Unihan `kVietnamese` | CC BY-SA 4.0 | 125,365 entries, 115,382 with Vietnamese glosses, 121,391 with Hán-Việt readings | required, automatic |
| `characters` | Unicode Unihan 16.0.0 | Unicode License v3 | 98,682 characters | required, automatic |
| `strokes` | Make Me a Hanzi via hanzi-writer-data | Arphic Public License 1999 | 9,574 characters | optional |
| `examples` | Tatoeba `cmn`/`eng` export | CC BY 2.0 FR | 39,806 sentence pairs over 20,011 headwords | optional |
| `content-tips`, `content-lessons`, `content-stories`, `content-articles` | written for this project | CC BY 4.0 | 30 / 12 / 8 / 4 | required, automatic |

The textbook course material is **not** in this table and **not** in this repository. Its shape - the
page images, `books/<id>/lessons/l<NN>.json`, `audio/…` and `sync/state.json` - is documented in
[docs/DATA_FORMAT.md](docs/DATA_FORMAT.md) and validated at runtime by the same Zod schemas the app
uses, so a malformed file is treated as absent rather than half-trusted.

## Private-repo pipelines

The generators live with the data they produce, in the private repository under `tools/`:
`build_books.py` (page rendering and lesson extraction), `encode_lesson_audio.py` and
`align_lesson_audio.py` (re-encode the recordings you own and time them to sentences), `generate_tts.py`
(optional synthetic speech; see [scripts/tts/README.md](scripts/tts/README.md) for the rules it keeps)
and `verify_private_repo.py --all` (the gate that re-counts pages, lessons, records and sizes).

## Quick start

```bash
npm ci          # installs exactly what package-lock.json pins (Node 20 is what CI uses)
npm run dev     # Vite dev server on http://localhost:5173
```

The dev server serves the committed packs in `public/data`, so the dictionary works on a fresh clone
with no data build and no upstream fetch. For the textbook screens in development, the private
repository can be served from a local bridge instead of GitHub.

```bash
npm run typecheck          # tsc --noEmit (strict; also covers tests/)
npm test                   # vitest run (unit + jsdom)
npm run lint               # eslint . over src, tests, scripts and the root configs
npm run legal:check        # the public-tree guard over the tracked tree (+ dist/ if present)
npm run licenses:runtime   # regenerate public/licenses/RUNTIME_NOTICES.md from node_modules
npm run licenses:runtime:check
npm run build              # data:check -> legal:check -> typecheck -> vitest -> vite build -> legal:check
npm run build:only         # vite build into dist/ (base './', CSP meta injected)
npm run preview            # serve dist/ locally
npm run test:e2e           # playwright against a production build on 127.0.0.1:4173
```

## Licences and attribution

Three licence layers apply, and none overrides another:

| Layer | Licence | Where it is written down |
| --- | --- | --- |
| Application code (`src/`, `scripts/`, `tests/`, configs, this README) | MIT | [`LICENSE`](LICENSE) |
| Data packs this repository ships | per source: CC BY-SA 4.0, Unicode License v3, Arphic Public License 1999, CC BY 2.0 FR, CC BY 4.0 | [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) (pointer) and `public/licenses/THIRD_PARTY_NOTICES.md` (the generated, version-pinned notice) + the texts in `public/licenses/*.txt` |
| Third-party runtime code bundled into the build | MIT, Apache-2.0, BSD-2-Clause, package by package | `public/licenses/RUNTIME_NOTICES.md`, generated from the installed dependency tree |

**Share-alike:** dictionary packs in this app are adapted from CC-CEDICT and CVDICT and are distributed
under CC BY-SA 4.0. Licensing the code MIT does not relicense the data, and anyone reusing only the
source takes no rights to the packs.

Attribution is shipped as data, not prose, so the app can be used offline *with* its credits:
`public/licenses/` holds the generated notices and every full licence text, `npm run data:check` fails
if a provenance entry, licence text or runtime notice drifts from what is actually installed, and the
About screen (`#/about`, also reachable at `#/licenses`) renders them from the same origin.

One honest gap: Tatoeba's pinned per-language exports publish `id`, `lang` and `text` only - the dumps
that name contributors are multi-GB and deliberately not vendored - so the author segment of every
`sourceRef` is the literal `unknown`. Each sentence keeps its id and the entry screen links it to
`https://tatoeba.org/en/sentences/show/<id>`, where the contributor is named.

`.gitattributes` pins `eol=lf` for the whole tree: the pack installer verifies each downloaded shard
against a SHA-256, so a clone that silently converted LF to CRLF would publish shards that no longer
match their recorded hashes and every install would fail.

## Tests

- **Unit tests pass.** `npm test` runs 304 cases across 15 suites: pinyin normalisation and tone
  sandhi, search ranking (including Vietnamese folding), the SRS scheduler, pack and lesson schemas,
  backup export/import, pack self-healing, the sync engine, the audio client, the course drill
  generator, the five-step lesson screens and the writing-review grading path.
- **End-to-end tests build the production bundle and drive it** (`npm run test:e2e` runs
  `vite preview` on `127.0.0.1:4173`): same-origin asset/CSP/manifest assertions, first-run pack
  install, the five-tab shell, retired-route redirects, the licence pages, the 404 screen, search by
  Hanzi / toneless pinyin / English, entry → save → library, search with the network off, and the
  character page's honest "not recorded" state. `tests/e2e/study-flow.spec.ts` covers the books
  shelf, the reader, all five course steps, `#/writing?chars=` and sync pull/push/`409`-merge against
  a faked `api.github.com` and synthetic lesson fixtures; those tests close the `/__local_private_data__/`
  dev bridge so a run cannot depend on which folder happens to sit next to the checkout. Prerequisite:
  `npx playwright install chromium`.
  Chromium only, one desktop width; Firefox, WebKit and phone widths are not run, and no CI workflow
  executes them.
- `vitest` transpiles and does **not** typecheck its own suite, so a green `npm test` says nothing
  about the types inside `tests/**`. `npm run typecheck` covers them, because `tsconfig.json`
  includes `tests`.

## Quality gates and CI

`.github/workflows/ci.yml` runs on a pull request or a push to the default branch, on Node 20:
`npm ci` → a clean-room assertion over git's index (no `.apk`, `.dex`, `Modded/`, `.cache/`, planning
documents, `.env`, keys or tracked `node_modules`) → `npm run data:check` → `npm run legal:check` →
`npm run typecheck` → `npm test` → `npm run lint` (`eslint . --max-warnings 0`) → `npm run build:only`
→ the artifact-completeness assertion → `dist/` uploaded for inspection. Each gate is the project's own
script, and a step that cannot run reports itself as `NOT RUN` rather than pretending to pass.

`.github/workflows/deploy.yml` is the Pages publisher; see below.

## Publishing to GitHub Pages

`base: './'` in `vite.config.ts` means the build works under **any** repository name
(`https://<user>.github.io/<repo>/`): every emitted URL is relative. There are no secrets in either
workflow, and CI never downloads an upstream data source because the generated packs are committed.

The default shape is **build in CI, deploy `dist/`**: push to `main`, and `deploy.yml` runs the
provenance gate, `legal:check`, typecheck, tests, `npm run build:only`, the artifact completeness gate,
then `actions/configure-pages` → `upload-pages-artifact` → `deploy-pages`. Set Settings → Pages →
Source: **GitHub Actions** once. (The committed `site/` folder and `npm run pages:sync` were retired in
v0.2; Pages cannot send headers, which is why the CSP is injected as a `<meta http-equiv>`.)

Publishing stops if the artifact is missing `index.html`, `manifest.webmanifest`, `sw.js`,
`data/manifest.json`, the core pack shards, `licenses/THIRD_PARTY_NOTICES.md` or
`licenses/RUNTIME_NOTICES.md`, if the CSP meta tag was not injected, if any URL emitted into
`index.html` does not exist, or if the JSON does not parse.

After the first deploy, verify on the published HTTPS URL: install prompt, offline reload, a deep link
(`#/entry/...`), pack install on first use, and the licence pages. Tag a release only after trying it on
a real phone.

## Repository layout

```
LICENSE                     MIT, application code only (data and libraries keep their own terms)
THIRD_PARTY_NOTICES.md      pointer to the generated, version-pinned notices
.gitattributes              pins eol=lf so committed pack shards keep their recorded SHA-256 bytes
.github/workflows/          CI (ci.yml) and Pages deployment (deploy.yml)
docs/                       APP_CONTRACT.md (module boundaries), DATA_FORMAT.md (pack + private-repo schema),
                            PLAN_COMPLIANCE.md (status against the implementation plan)
public/data/                generated, committed content packs + the pack registry
public/licenses/            generated notices, runtime notices and the full licence texts
public/manifest.webmanifest, public/icons/, public/share-target/
scripts/content/            the build-time data pipeline (fetch, build, check) and original content
scripts/legal/              check-public-tree.mjs + allowlist.json - the public-tree guard
scripts/tts/                README only: how a reader generates speech locally, and why it stays private
scripts/collect-runtime-licenses.mjs   regenerates public/licenses/RUNTIME_NOTICES.md
src/app/                    shell, providers, routing, error boundary, icons
src/components/             shared UI vocabulary
src/data/                   Dexie tables, pack installation and self-healing, the dictionary API,
                            the GitHub client, private-data resolution, the sync engine, audio, backup
src/domain/                 pure logic: pinyin, search index and ranking, scheduler, achievements
src/modules/                one folder per feature area (dictionary, characters, books, learning,
                            library, reading, content, profile)
src/styles/                 design tokens and component styles
src/workers/                the search worker
tests/                      vitest suites (unit + fixtures) and the Playwright specs (e2e)
```

Planning and legal documents for the release (`Modded/v0.2/…`) and the reference material live
**outside** this repository, and CI fails if any of them appears in git.

## Known gaps at the time of writing

The numbers below are a snapshot. Re-run the commands to get the live answer.

| Area | State | How to re-check |
| --- | --- | --- |
| Unit tests | 15 suites, 304 cases passing | `npm test` |
| Typecheck | Clean under `strict` + `noUnusedLocals`, covers `tests/**` | `npm run typecheck` |
| Lint | `npx eslint . --max-warnings 0` reports nothing | `npm run lint` |
| Legal guard | `legal:check` OK over the tracked tree and a fresh `dist/` | `npm run legal:check` |
| Runtime notices | match the installed dependency tree | `npm run licenses:runtime:check` |
| End-to-end | 14 tests in Chromium at one desktop width; Firefox/WebKit/phone widths never run, no CI execution | `npx playwright install chromium && npm run test:e2e` |
| Sync against the real API | The pull, push and `409` merge are proven against a faked `api.github.com`; no test holds a real token, so the live path is verified only by the owner's first connection | `tests/e2e/study-flow.spec.ts` |
| Real-device testing | None recorded in this repository. Nothing has been verified on a phone or tablet by the maintainers | install the built site and try it |
| IDS component decomposition | Not shipped - the upstream file is LGPL and that model was not accepted; the gap is stated in the app | docs/PLAN_COMPLIANCE.md |
| Sync debounce | Writes are debounced at 3 s rather than the ≥30 s the cost register suggests; still orders of magnitude inside the 5,000 req/h allowance because ETag `304`s cost nothing | `src/data/syncEngine.ts` |

## Contributing and quality

- Read [docs/APP_CONTRACT.md](docs/APP_CONTRACT.md) before touching a screen: it fixes what a module may
  import, the route list, and the rules every screen follows (honest states, everything free, local by
  default, accessibility, tokens only).
- Keep the boundary. Do not add a network call that leaves the device except the GitHub API, do not add
  a locked tier or a fake "online" control, and never add book-derived text, images or audio to this
  repository - the guard exists to make that unmissable.
- New data source? Add a full provenance entry (URL, version, checksum, licence, attribution,
  transformations) *before* processing it, ship the licence text in `public/licenses/`, and make
  `npm run data:check` pass. A source with unclear rights stays rejected.
- Before opening a pull request: `npm run typecheck`, `npm test`, `npm run lint`,
  `npm run legal:check`, `npm run build`. CI runs the same gates.
- Prefer deleting a feature to faking it.

## Licence

Application code: MIT (see [`LICENSE`](LICENSE)). Data: each pack keeps its own licence - CC BY-SA 4.0
for the dictionary, Unicode License v3 for character metadata, the Arphic Public License for stroke
outlines, CC BY 2.0 FR for example sentences, CC BY 4.0 for this project's own lessons and articles,
Apache-2.0/MIT for bundled runtime components. `public/licenses/THIRD_PARTY_NOTICES.md` is the
authoritative list, is generated, and must not be hand-edited.

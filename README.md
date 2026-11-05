# Hanyu Dictionary

A free, installable, offline-capable **Chinese (Mandarin) dictionary and study app** that runs
entirely in your browser. It is built from open-licensed dictionary data plus content written for
this project, ships as a Progressive Web App, and is designed to be published on GitHub Pages under
any repository name.

**This is an independent application.** It is not a Hanzii client, port, clone, unlock, patch or
wrapper, it is not affiliated with or approved by the makers of any commercial dictionary app, and
it contains no code, assets, databases, layouts, audio or text taken from one. It was written
clean-room against a *feature checklist* only: the names and counts of declared screens in a
reference APK, never its internals. See [docs/PLAN_COMPLIANCE.md](docs/PLAN_COMPLIANCE.md) for the
full boundary, and [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md) for the (original) data schema.

Everything here costs nothing and nothing is locked: no account, no subscription, no entitlement
flag, no trial counter, no ad slot, no telemetry, no "pro" tier. Every included feature is available
to every user on every device that can load the site.

## What is deliberately absent, and what the app does instead

These capabilities from the commercial app this project was scoped against cannot be delivered by a
static site, a third party's servers, or content this project has no rights to. They are **absent,
not hidden, not stubbed and not "coming soon"**: there are no placeholder buttons and no simulated
online behaviour anywhere in the UI.

| Not included | Why | What this app does instead |
| --- | --- | --- |
| Accounts, sign-in, QR linking | Needs a server and a privacy/retention regime this project has not chosen | No account exists. State lives in IndexedDB on your device; `#/data` exports and imports it |
| Automatic cross-device sync | Needs that same server | Versioned backup files you move yourself (JSON, size-capped, schema-validated, confirm-before-overwrite) |
| Forums, chat, live voice, public rankings, PK | Require hosting, moderation, abuse controls and an operator | Device-local achievements, streaks and activity summaries, explicitly labelled as local (`#/progress`) |
| Hosted AI explanation / grammar correction / translation / pronunciation scoring | Requires an API key in the client or a backend, both unacceptable here | Nothing. Dictionary glosses are labelled as glosses, never as "translation"; no model is called |
| Human pronunciation audio | Every recording needs per-file redistribution rights; the reviewed open corpora did not clear at the coverage this app needs | Device speech synthesis through `SpeechSynthesis`, labelled in the UI as *synthetic*, with an honest "no Chinese voice installed on this device" state |
| Android widgets, lock-screen vocabulary, screen overlay, background alarms | No general web equivalent | Installable PWA with a home-screen icon, manifest shortcuts, a share target, and a URL that carries a search (`#/search?q=`) |
| Server-side OCR or translation | Data would leave the device | Tesseract OCR compiled to WebAssembly, run in a Worker, with opt-in model downloads and the byte cost shown first |
| Push notifications | Cross-browser push needs a server | Nothing faked; reminders are out of scope for this release |

If a feature is missing, the screen says so in plain language rather than showing a dead control.

## Features, screen by screen

Routes are hash-based (`#/entry/...`), which is what makes deep links work on GitHub Pages without
any server rewrite rule.

| Route | Screen | What it actually does |
| --- | --- | --- |
| `#/` | Dictionary home | Search box (Hanzi, pinyin with tone marks, tone numbers, no tones, `ü`/`v`), recent searches, daily goal summary, device-voice status, quick jumps |
| `#/search?q=` | Results | Ranked results (exact → prefix → meaning), match-type labels, coverage warnings when a pack is not installed, shareable URL |
| `#/entry/:key` | Entry | Headword in both scripts, readings, glosses, example sentences when the examples pack is installed, save/list actions, character links |
| `#/character/:char` | Character | Unihan readings (Mandarin, Cantonese), definition, radical + residual strokes, stroke count, simplified/traditional variant sets, stroke animation |
| `#/writing` | Writing practice | Pointer-events (mouse/touch/stylus) tracing over the licensed median guides, per-stroke play/replay and speed, undo/clear, grid guides; strokes without guide data are drawn **unscored** rather than given a fake grade |
| `#/library` | Library | Saved words, word lists, notebooks, categories, with cascade delete and duplicate handling |
| `#/list/:id`, `#/notebook/:id` | List / notebook detail | Entries, search within, notes, add/remove, export of a single list |
| `#/practice` | Practice hub | Deck choice, session configuration, due counts |
| `#/flashcards` | Flashcards | The project's own interval-repetition scheduler (documented in `src/domain/scheduler.ts`), ratings, suspension, per-deck statistics |
| `#/test`, `#/test/:id` | Assessments | Original question sets generated from licensed entries (`src/modules/learning/questionBank.ts`), listening/reading/writing drills, scoring and review; the screen states these are not official exam equivalents |
| `#/progress` | Progress | Local activity, streak, achievement evaluation - all device-local |
| `#/capture` | Camera & OCR | Explicit camera permission flow, image upload and typed-text fallbacks (denial never blocks you), crop/rotate, recognised text shown for correction before lookup, results into entries/lists; images stay in IndexedDB |
| `#/reader` | Reader | Your own text or PDF (pdf.js, in a Worker) with tap-to-lookup annotation, simplified/traditional switching, deletion controls; large files do not block the main thread |
| `#/learn`, `#/learn/:id` | Learn | Original tips, lessons, stories and articles written for this project (CC BY 4.0) |
| `#/settings` | Settings | Script (simplified/traditional/both), pinyin style, theme, contrast, reduce motion, text scale, speech language and rate, daily goal |
| `#/offline-data` | Offline data | Pack list with sizes, record counts, licences and coverage; install/uninstall with progress, storage usage, persistence request, and honest handling when the browser refuses |
| `#/data` | Data | Export, import (validated, confirmed), storage statistics, clear-everything |
| `#/about` | About | Provenance register, source versions and licence documents: it reads the same-origin files under `licenses/` (nothing third party is contacted) and falls back to naming the file in `public/licenses/` if a text is unavailable |

Search runs in a Web Worker against a prebuilt index; dictionary packs are verified by SHA-256 before
installation and are stored separately from your own data, so updating content never erases progress.

## Browser and device support

Capability-driven and stated conservatively. **No real-device verification has been performed for
this repository yet** - the matrix below is what the code requires, not what has been measured.

| Platform | Expected status | Notes |
| --- | --- | --- |
| Desktop Chrome / Edge (current and previous major) | Full | Install prompt, offline after packs, OCR, PDF, writing, speech if a voice is installed |
| Desktop Firefox (current and previous major) | Full except install-offline nuances | Service-worker/IndexedDB persistence behaves differently; the app requests persistence and reports the result |
| Desktop Safari (macOS, current and previous major) | Full, with storage caveats | Safari can evict IndexedDB; the app says so rather than assuming it kept your data |
| Android Chrome | Full | Install, share target, manifest shortcuts, camera OCR |
| Android Firefox | Mostly full | Install support varies by version |
| iOS / iPadOS Safari (17+) | Works with caveats | Manifest install supported since 16.4; background storage eviction is the real risk; speech needs a Chinese voice added in Settings |
| Older browsers / text-only / no-JavaScript | Not supported | `index.html` explains that the app needs JavaScript and sends nothing anywhere |

Technically the app needs: ES2022 modules, dynamic `import()`, Web Workers, IndexedDB, Service
Workers + Cache API, a Web App Manifest, Pointer Events, `navigator.storage.persist()`,
`speechSynthesis`, and WebAssembly (with SIMD where available) for OCR. Accessibility targets are
WCAG 2.2 AA for the primary flows: one `h1` per page, labelled inputs, visible focus, `aria-live`
status, 44px targets, no colour-only meaning, reduced-motion support, readable at 200% zoom. A
formal audit has not been run - treat the claim as intent plus implemented mechanics.

## Quick start

```bash
npm ci          # installs exactly what package-lock.json pins (Node 20 is what CI uses)
npm run dev     # Vite dev server on http://localhost:5173
```

The dev server serves the committed packs in `public/data`, so the dictionary works on a fresh
clone with **no data build and no network fetch of upstream sources**. Useful commands:

```bash
npm run typecheck      # tsc --noEmit (strict)
npm test               # vitest run (unit + jsdom)
npm run test:watch     # vitest in watch mode
npm run build:only     # production build into dist/ (base './', CSP meta injected)
npm run build          # data:check -> typecheck -> vitest -> vite build (the full chain)
npm run preview        # serve dist/ locally
npm run lint           # eslint . over src, tests, scripts and the root configs
npm run licenses:runtime   # regenerate public/licenses/RUNTIME_NOTICES.md from node_modules
npm run pages:sync     # copy dist/ -> site/ for branch-based Pages
```

## The data pipeline

`scripts/content/` is an auditable, build-time-only pipeline. Nothing in `src/` talks to a third
party server; the app only ever fetches same-origin `public/data` and `public/licenses`.

```bash
npm run data:fetch   # the ONLY step that touches the network
npm run data:build   # rebuild every pack + the licence texts from the cache
npm run data:check   # the release gate; runs offline, no cache required
```

- **Raw downloads never enter the repository.** They go to the cache directory *outside* it:
  `<repo>/../.cache/raw` by default, overridable with `--cache <dir>` or `HANYU_CACHE`. `.gitignore`
  covers `.cache/`, and CI asserts that no ignored cache path is tracked.
- **Every source is pinned before use** in `scripts/content/provenance.json`: upstream project, exact
  URL, version/date, licence id + licence file, attribution text, ShareAlike duty, the transformations
  applied, the original checksum of each download, and which packs it produces. `data:fetch` refuses a
  hash mismatch; deliberate re-pinning needs `--pin` and changes that file for review.
- **Generated packs are committed** (`public/data/`, `public/licenses/`) so a fresh clone deploys and a
  PR can be reviewed as the real artifact. Shards are deterministic (`SOURCE_DATE_EPOCH` honoured).
- **`npm run data:check` is the legal gate.** It verifies that every file listed in
  `public/data/manifest.json` exists with the recorded SHA-256 and byte count, that no unlisted file
  hides in a pack directory, that each licence text exists and matches its pinned hash, that
  `THIRD_PARTY_NOTICES.md` names every source, that `RUNTIME_NOTICES.md` still matches the installed
  dependency tree, that the opt-in OCR manifest matches its models, that
  the pack registry satisfies the same Zod rules the runtime applies, and it runs a clean-room scan of
  `src/`, `public/` and `scripts/` for reference-app material - CI applies the same deny patterns to
  every path git tracks, so documentation and the workflows are covered too. It re-verifies the raw
  cache only when that cache happens to be present.

Committed content, regenerated by `npm run data:build` and verified by `npm run data:check` -
8 packs, 273,481 records, 50.3 MB:

| Pack | Source | Licence | Records | Installed by |
| --- | --- | --- | --- | --- |
| `dictionary-core` | CC-CEDICT (MDBG) | CC BY-SA 4.0 | 125,365 words | required, automatic |
| `characters` | Unicode Unihan 16.0.0 | Unicode License v3 | 98,682 characters | required, automatic |
| `strokes` | Make Me a Hanzi via hanzi-writer-data | Arphic Public License 1999 | 9,574 characters | optional |
| `examples` | Tatoeba `cmn`/`eng` export | CC BY 2.0 FR | 39,806 sentence pairs over 20,011 headwords | optional |
| `content-tips`, `content-lessons`, `content-stories`, `content-articles` | written for this project | CC BY 4.0 | 30 / 12 / 8 / 4 | required, automatic |
| OCR models (`chi_sim`, `eng`) + tesseract core | tesseract-ocr/tessdata_fast, tesseract.js | Apache-2.0 | - | opt-in, size shown first |

## Licences and attribution

Three licence layers apply, and none of them overrides another:

| Layer | Licence | Where it is written down |
| --- | --- | --- |
| Application code (`src/`, `scripts/`, `tests/`, configs, this README) | MIT | [`LICENSE`](LICENSE) at the repository root |
| Data packs the app ships | per source: CC BY-SA 4.0, Unicode License v3, Arphic Public License 1999, CC BY 2.0 FR, CC BY 4.0 | `public/licenses/THIRD_PARTY_NOTICES.md` + the texts in `public/licenses/*.txt` |
| Third-party runtime code bundled into the build | MIT, Apache-2.0, BSD-2-Clause, package by package | `public/licenses/RUNTIME_NOTICES.md`, generated from the installed dependency tree |

Licensing the code MIT does **not** relicense the data: CC-CEDICT is ShareAlike, so the derived
`dictionary-core` pack is distributed under CC BY-SA 4.0, and this project's own reading content is
CC BY 4.0. Anyone who reuses only the source under MIT takes no rights to the packs.

The app must be usable offline *with* its credits, so attribution is shipped as data, not prose:

- `public/licenses/THIRD_PARTY_NOTICES.md` - generated notice for every data source, with versions,
  modification notes and ShareAlike duties.
- `public/licenses/RUNTIME_NOTICES.md` - generated, version by version, for every production
  dependency plus the Workbox modules copied into the service worker: each MIT/BSD text reproduced
  verbatim, each Apache-2.0 package with its upstream `NOTICE` file verbatim (Dexie's included).
  Refresh with `npm run licenses:runtime`; `npm run data:check` fails if it no longer matches
  `npm ci`'s tree, so a dependency bump cannot leave a stale notice behind.
- `public/licenses/*.txt` - the full licence texts (CC BY-SA 4.0, CC BY 4.0, CC BY 2.0 FR, Unicode
  License v3, Arphic Public License, Apache-2.0, MIT).
- `scripts/content/provenance.json` - the machine-readable register CI checks against.
- In-app: the About screen (`#/about`) renders the same notices, reading the licence texts from this
  same origin (`licenses/*.txt`) so they are available offline. A text that is not reachable is
  reported as unavailable on screen rather than silently replaced with a summary.

One honest attribution note: Tatoeba contributor usernames are not in the pinned per-language
exports (they live in multi-GB dumps this project deliberately does not vendor), so the author field
of every `sourceRef` is the literal `unknown` and an offline build cannot name the author itself.
Each sentence keeps its Tatoeba id, and the entry screen links it to
`https://tatoeba.org/en/sentences/show/<id>` - the page where the contributor is named. See
`attributionGap` in `scripts/content/provenance.json`.

`.gitattributes` pins `eol=lf` for the whole tree. That is not cosmetics: the pack installer verifies
each downloaded shard against a SHA-256 in `data/manifest.json`, so a clone that silently converted
LF to CRLF on commit would publish shards whose bytes no longer match their recorded hashes and every
install would fail.

## Tests

```bash
npm test           # vitest run - unit tests for pinyin, ranking, scheduler, schema, db, packs
npm run test:e2e   # playwright test
```

Status, stated plainly.

- **Unit tests exist and pass.** `npm test` reports 259 passing cases across 9 suites (pinyin
  normalisation, search ranking, scheduler, pack schema, backup export/import, content-pack shape,
  IndexedDB via fake-indexeddb).
- **End-to-end tests run and pass on Chromium.** `npm run test:e2e` builds the production bundle,
  serves it with `vite preview` on `127.0.0.1:4173` and executes 9 specs
  (`tests/e2e/app-shell.spec.ts`, `tests/e2e/dictionary-flow.spec.ts`): same-origin asset/CSP/manifest
  assertions, first-run pack install, the offline-data pack table, the licence pages, the 404 screen,
  search by Hanzi / toneless pinyin / English, entry → save → library, search with the network off,
  and the character page's honest "not recorded" state. That is one browser at one desktop width;
  Firefox, WebKit and phone widths have not been run, and the camera-denial, no-voice and storage-quota
  paths are still not encoded. Prerequisite: `npx playwright install chromium` (the config does not
  download browsers).
- One caveat worth repeating: `vitest` transpiles and does **not** typecheck its own suite, so a green
  `npm test` says nothing about the types inside `tests/**`. `npm run typecheck` covers them, because
  `tsconfig.json` includes `tests`.

## Quality gates and CI

`.github/workflows/ci.yml` runs, on a pull request or a push to the default branch, on Node 20:

`npm ci` → clean-room assertion (git index must contain no `*.apk`, `*.apk.xz`, `*.dex`,
uncompressed `*.traineddata`, `.cache/`, `Modded/`, `jadx`/`smali`/`decompiled` output, reference
planning documents, `.env`, `*.key`, `*.pem` or tracked `node_modules`) → `npm run data:check` →
`npm run typecheck` → `npm test` → `npm run lint` → `npm run build:only` → a build-completeness
assertion → `dist/` uploaded as an artifact for inspection. npm is cached via
`actions/setup-node`.

**Lint runs and is clean.** `eslint.config.js` is a flat config (TypeScript + React + react-hooks) and
the toolchain - `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react`,
`eslint-plugin-react-hooks`, `globals` - is declared in `devDependencies`, so `npm ci` gives you a
working `npm run lint`. `npx eslint . --max-warnings 0` currently reports **0 errors and 0 warnings**;
three `react-hooks/exhaustive-deps` cases are silenced inline because `voiceTick` and `restartAt` are
deliberate invalidation signals rather than inputs to the memo, and the rule cannot see that.
`eslint.config.js` skips `dist/`, the committed `site/` artifact, `public/` (generated packs and
licence texts) and the raw cache - those are build output, not source.

The unit-test step uses the same honesty rule: it runs `npm test` whenever any `*.test.ts(x)` file is
tracked, and warns `NOT RUN` when none is. A gate that can run always fails the job when it fails;
warnings do not.

## Publishing to GitHub Pages

`base: './'` in `vite.config.ts` means the build works under **any** repository name
(`https://<user>.github.io/<repo>/`): every emitted URL is relative (`./assets/...`,
`./manifest.webmanifest`, `./data/manifest.json`). Nothing needs to be renamed if you do not call the
repository `hanyu-web`. There are no secrets in either workflow - no tokens are stored, and CI never
downloads an upstream data source, because the generated packs are committed.

The repository is not initialised as a git repository yet. To publish:

```bash
git init -b main
git add .
git commit -m "Hanyu Dictionary: clean-room dictionary PWA"
# then create the (empty) repository on GitHub and:
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

**Shape (a) - build in CI, deploy `dist/` (default, recommended).**
Push to `main`; `.github/workflows/deploy.yml` runs the provenance gate, typecheck, tests when
present, `npm run build:only`, the artifact completeness gate, then
`actions/configure-pages` → `actions/upload-pages-artifact` → `actions/deploy-pages`.
Set Settings → Pages → Source: **GitHub Actions** once. The job declares
`permissions: { pages: write, id-token: write }` and exposes the deployment as a `github-pages`
environment, which is where the live URL comes from.

**Shape (b) - publish a committed static folder.**
`npm run build:only` then `npm run pages:sync` writes `site/` (byte-for-byte copy of `dist/`, plus
`.nojekyll`, stale files pruned, incomplete builds refused) - commit `site/`, then run *Deploy GitHub
Pages* manually with `pages_source: committed-folder`, `pages_folder: site`. Pages stays on Source:
GitHub Actions for that job to deploy. `docs/` is selectable but discouraged: it holds this project's
design documents, and publishing it makes them part of the site. `site/` is currently populated in
this folder (227 files, 64.2 MB), so shape (b) needs no build before the first upload.

**Shape (c) - branch-based Pages.**
In Settings → Pages choose **Deploy from a branch** → `main` → `/site (root)` and GitHub publishes on
push with no workflow. Then disable the automatic `push` trigger of `deploy.yml` (or the default-branch
build will fail at `configure-pages`, because the repository setting and the workflow disagree about
who publishes). Run the workflow manually with `pages_source: verify-committed-folder` to prove the
committed folder is a complete PWA - that mode deploys nothing.

Whichever shape you choose, publishing stops if the artifact is missing `index.html`,
`manifest.webmanifest`, `sw.js`, `data/manifest.json`, the core pack shards,
`licenses/THIRD_PARTY_NOTICES.md` or `licenses/RUNTIME_NOTICES.md`, if the CSP meta tag was not injected, if any URL emitted into
`index.html` does not exist, or if the JSON does not parse. A Pages deploy of a PWA without its
manifest is otherwise invisible: it installs, registers a service worker, and simply never loads a
dictionary.

After the first deploy, verify on the published HTTPS URL: install prompt, offline reload, a deep link
(`#/entry/...`), pack download in `#/offline-data`, OCR model opt-in, and the licence pages. Tag a
release only after you have done that on a real phone.

## Repository layout

```
LICENSE            MIT, application code only (the data and the libraries keep their own terms)
.gitattributes     pins eol=lf so committed pack shards keep their recorded SHA-256 bytes
.github/workflows/ CI (ci.yml) and Pages deployment (deploy.yml)
docs/                APP_CONTRACT.md (module boundaries), DATA_FORMAT.md (pack schema),
                     PLAN_COMPLIANCE.md (phase-by-phase status vs. the implementation plan)
public/data/         generated, committed content packs + pack registry
public/licenses/     generated third-party notices, runtime notices and full licence texts
public/manifest.webmanifest, public/icons/, public/share-target/
scripts/content/     the build-time data pipeline (fetch, build, check) and original content
scripts/collect-runtime-licenses.mjs  regenerates public/licenses/RUNTIME_NOTICES.md
src/app/             shell, providers, routing, error boundary, icons
src/components/      shared UI vocabulary
src/data/            Dexie tables, pack installation, dictionary API, speech, backup
src/domain/          pure logic: pinyin, search index/ranking, scheduler, achievements
src/modules/         one folder per feature area (dictionary, characters, library, learning,
                     capture, reading, content, profile)
src/styles/          design tokens and component styles
src/workers/         the search worker
tests/               vitest suites (unit) and the jsdom setup
```

Planning and legal documents (`IMPLEMENTATION_PLAN.md`, `DATA_SOURCES.md`,
`FEATURE_INVENTORY.md`) and the reference APKs live **outside** this repository, in `../Modded` and
`..`, and CI fails if any of them appears in git.

## Known gaps at the time of writing

This section exists so nobody has to guess whether the claims above are aspirational. Re-run these
commands to get the live answer; the numbers below are a snapshot, not a permanent state:

| Area | State | How to re-check |
| --- | --- | --- |
| Unit tests | 9 suites, 259 cases passing | `npm test` |
| Typecheck | Clean under `strict` + `noUnusedLocals`, and it covers `tests/**` | `npm run typecheck` |
| End-to-end tests | 9 specs pass on Chromium at one desktop width (`npx playwright test`, recorded 2026-11-05). Firefox, WebKit and phone/tablet widths have not been run; no CI workflow executes them, because headless browsers are not installed in the runner | `npx playwright install chromium && npm run test:e2e` |
| Lint | Toolchain installed, config in place, `npx eslint . --max-warnings 0` reports nothing | `npm run lint` |
| Real-device testing | None. Nothing in this repository has been loaded on a phone or tablet | install the built site and try it |
| IDS component decomposition, human pronunciation audio | Not shipped - documented data/rights gaps, not oversights | docs/PLAN_COMPLIANCE.md |
| Track B (accounts, sync, forums, hosted AI) | Out of scope by design; no server exists | README section above |
| Storage eviction | The app requests persistence and reports the answer, but iOS/Safari can still evict IndexedDB; unverified on real hardware | `#/offline-data` |

## Contributing and quality

- Read [docs/APP_CONTRACT.md](docs/APP_CONTRACT.md) before touching a screen: it fixes what a module
  may import, the route list, and the rules every screen follows (honest states, everything free,
  local by default, accessibility, tokens only).
- Keep the boundary. Do not add a network call that leaves the device, a locked tier, a fake "online"
  control, or anything derived from a proprietary app. If a feature needs a server, it is Track B and
  needs its own design and approval - see docs/PLAN_COMPLIANCE.md.
- New data source? Add a full provenance entry (URL, version, checksum, licence, attribution,
  transformations) *before* processing it, ship the licence text in `public/licenses/`, and make
  `npm run data:check` pass. A source with unclear rights stays rejected.
- Before opening a pull request: `npm run typecheck`, `npm test`, `npm run data:check`,
  `npm run build:only`. CI runs the same gates and its summary states which gates did not execute.
- Prefer deleting a feature to faking it.

## Licence

Application code: MIT (see `package.json`). Data: each pack keeps its own licence - CC BY-SA 4.0 for
the dictionary, Unicode License v3 for character metadata, Arphic Public License for stroke
outlines, CC BY 2.0 FR for example sentences, CC BY 4.0 for the project's own lessons and articles,
Apache-2.0/MIT for bundled runtime components. `public/licenses/THIRD_PARTY_NOTICES.md` is the
authoritative list and is generated; do not hand-edit it.

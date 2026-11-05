# Third-party notices

The authoritative, version-pinned notice for every dataset and runtime library in this application is
[`public/licenses/THIRD_PARTY_NOTICES.md`](public/licenses/THIRD_PARTY_NOTICES.md). It is generated
from `scripts/content/provenance.json` by `scripts/content/build-licenses.mjs`, ships inside the build
at `<site>/licenses/THIRD_PARTY_NOTICES.md` so it is readable offline, and is what the About screen
links. Do not hand-edit it and do not copy its version numbers here, where they would go stale.

Runtime dependencies are itemised separately, package by package, in
[`public/licenses/RUNTIME_NOTICES.md`](public/licenses/RUNTIME_NOTICES.md), generated from the
installed dependency tree by `npm run licenses:runtime`. `npm run licenses:runtime:check` fails the
build when that file no longer matches `npm ci`'s tree.

## What is credited, in one table

| Upstream | Used for | Licence | Full text shipped |
| --- | --- | --- | --- |
| CC-CEDICT (MDBG / community) | headwords, pinyin, English glosses | CC BY-SA 4.0 | `public/licenses/CC-BY-SA-4.0.txt` |
| CVDICT, Chinese-Vietnamese dictionary by Phong Phan ([github.com/ph0ngp/CVDICT](https://github.com/ph0ngp/CVDICT)) | Vietnamese glosses | CC BY-SA 4.0 | `public/licenses/CC-BY-SA-4.0.txt` |
| Unicode Unihan database | readings, radical/stroke counts, variants, Hán-Việt readings | Unicode License v3 | `public/licenses/Unicode-License-v3.txt` |
| Make Me a Hanzi, distributed as hanzi-writer-data (David Chanin) | stroke outlines and medians | Arphic Public License 1999 | `public/licenses/ARPHIC.txt` |
| hanzi-writer (David Chanin) | stroke animation and quiz player on canvas | MIT | `public/licenses/MIT.txt` |
| Tatoeba (`cmn`/`eng` exports) | example sentences and their translations | CC BY 2.0 FR | `public/licenses/CC-BY-2.0-FR.txt` |
| Content written for this project | tips, lessons, stories, articles | CC BY 4.0 | `public/licenses/CC-BY-4.0.txt` |
| React, React Router, Dexie, dexie-react-hooks, Zod, hanzi-writer, Workbox | the bundled app runtime | MIT / Apache-2.0 / BSD-2-Clause, per package | `public/licenses/RUNTIME_NOTICES.md` + `Apache-2.0.txt` |

**Share-alike:** *dictionary packs in this app are adapted from CC-CEDICT and CVDICT and are
distributed under CC BY-SA 4.0.* Publishing the application source under MIT (see
[`LICENSE`](LICENSE)) grants no right to relicense the data packs or the bundled libraries.

## Deliberately not included

- No text, page image, audio, gloss or exercise derived from any copyrighted textbook is contained in
  this repository, in its history, or in `dist/`. `scripts/legal/check-public-tree.mjs` (`npm run
  legal:check`) runs on the tracked tree before and after every build and fails on the first hit.
- No OCR models, no PDF rendering engine and no third-party CDN, font or analytics host: those
  dependencies were retired in v0.2 and their notices were removed with them.
- No human pronunciation recordings are hosted by this project. See
  [`scripts/tts/README.md`](scripts/tts/README.md) for how a reader generates their own audio locally
  and why the result stays in that reader's private repository.

# Local TTS generation (optional, build-time only)

Nothing in this directory is part of the shipped application, and nothing here is required to build,
test or deploy `hanyu-web`. The app plays pronunciation from the device speech synthesiser, and, for a
reader who connects their own private study repository, from audio files that repository already
serves. This folder documents how that private audio is produced locally, so the contract is public
even though the material is not.

## Which tools are involved

| Tool | Role | Licence | Where its code lives | Consequence |
| --- | --- | --- | --- | --- |
| `edge-tts` (Python) | Client for an online neural speech endpoint | GPL-3.0 | never vendored here; installed by the operator in a local virtualenv | GPL code is only ever run locally and never distributed or linked into the bundle, so no GPL obligation attaches to this project |
| `kokoro` + `misaki[zh]` | Offline neural speech model, the fallback engine | Apache-2.0 | same local virtualenv | output may be redistributed with attribution to the model |
| `ffmpeg` | post-processing of the generated audio | LGPL-2.1+/GPL depending on the build | a local binary the operator installs | never committed |

The generation script itself is deliberately **not** committed to this repository. It reads text
lists that belong to a copyrighted book, so its inputs and outputs are private by construction, and
shipping the script would invite shipping the same inputs. It lives with the data it produces, in the
private study repository under `tools/`, and takes every path from command-line arguments rather than
hard-coding one:

```
python tools/generate_tts.py --engine edge|kokoro --concurrency 3 --rate -5% [--force]
```

## Output location

Generated audio is written **only into the private repository working copy** (its `audio/` tree) and
is served from there to the owner's own devices. It is never placed in this repository, never copied
into `dist/`, and never published. `scripts/legal/check-public-tree.mjs` runs on the tracked tree and
on `dist/` and fails the build on any `.mp3`, `.wav`, `.ogg`, `.opus` or `.flac` file, so an
accidental drop here breaks the gate immediately.

## Rules the script must keep

These are the limits the plan imposes on the online endpoint; they exist to stay inside the service's
fair use and to survive it becoming unavailable:

1. Concurrency of at most `3` requests, with at least `250 ms` between requests per worker.
2. Exponential back-off on `429`, `403` or a connection error, up to `5` retries, then move on.
3. Resumable: a file whose hash already exists in the manifest is skipped unless `--force` is passed.
4. One voice per run; a voice change is a deliberate, recorded re-generation.
5. Never imported or called from browser code, and never run in CI.

## Manifest format (engine-neutral)

Switching engines must not require an app change, so `audio/manifest.json` keys every clip by a hash
of its text with the same fields whichever engine wrote it:

```
{ "id", "text", "textHash", "engine": "edge-tts" | "kokoro", "voice",
  "file", "bytes", "durationMs", "createdAt" }
```

The app resolves a word or sentence to `textHash`, asks the repository for that entry and plays the
bytes it returns as a `blob:` URL. It never learns which engine made the audio.

## If you want public audio instead

Audio from the online endpoint has no published licence for its output, so it cannot be shipped in a
public build. Two licensed routes exist: generate with Kokoro (Apache-2.0 model, unrestricted output)
and commit the result here with a provenance entry, or use an official paid speech tier that issues a
licence for its output. Neither is the current default.

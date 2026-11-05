# Pack data format (canonical, clean-room)

Version: `schemaVersion: 1`. This document is the contract between `scripts/content/`
(build-time pipeline) and `src/` (runtime). Nothing here is derived from the reference
APK's internal database formats; the schema is original.

## Directory layout (generated into `public/data/`)

```
public/data/manifest.json          # pack registry, validated with zod at runtime
public/data/packs/dictionary-core/000.txt ...   # word entries
public/data/packs/characters/000.txt ...        # per-codepoint metadata
public/data/packs/strokes/<n>.jsonl             # per-character stroke geometry
public/data/packs/strokes/index.txt             # char -> shard file
public/data/packs/examples/000.txt ...          # example sentences
public/data/packs/content/<id>.json             # original lessons/tips/stories
public/data/ocr/                                # worker + wasm + traineddata (opt-in)
public/licenses/*.txt                             # full license texts
public/licenses/THIRD_PARTY_NOTICES.md            # generated attribution
```

The pipeline is the only writer of `public/data`. Generated files are committed so the
site works without a data build, and every pack is reproducible from
`.cache/raw` + `scripts/content/provenance.json`.

## Shorthand record encoding

Text packs are plain UTF-8, one record per line, fields separated by `U+001F`
(ASCII unit separator). The pipeline fails if a field contains `U+001F`, `U+0000`
or a raw newline. Empty field = empty string.

## `manifest.json`

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-04T00:00:00.000Z",
  "minAppVersion": "1.0.0",
  "packs": [
    {
      "id": "dictionary-core",
      "kind": "dictionary",           // dictionary|characters|strokes|examples|content|ocr
      "label": "CC-CEDICT words",
      "version": "1.0.46",            // pinned upstream release or build date for original content
      "required": true,               // core packs auto-install; optional packs are user-installed
      "license": "CC-BY-SA-4.0",
      "sourceUrl": "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.zip",
      "attribution": "CC-CEDICT community maintenance project (CC-CEDICT.org) and contributors.",
      "modifications": "Re-keyed into a canonical schema; pinyin variants precomputed.",
      "coverage": { "records": 124484, "languages": ["zh-Hans", "zh-Hant", "en"] },
      "bytes": 12345678,
      "files": [{ "path": "packs/dictionary-core/000.txt", "sha256": "<hex>", "bytes": 1234, "records": 8192 }]
    }
  ]
}
```

Runtime validation (`src/data/schema.ts`) rejects: unknown `kind`, missing `sha256`,
missing `license`, missing `attribution`, missing `sourceUrl` for third-party packs,
duplicate pack/file ids, `schemaVersion !== 1`.

## dictionary-core records

```
simplified US traditional US pinyinNumbered US pinyinMarked US pinyinPlain US definition
```

- `pinyinNumbered`: `zhong3 guo2` (syllables space-separated, `5` = neutral tone, as in source).
- `pinyinMarked`: `zhǒng guó` (tone marks, `ü` kept as `ü`).
- `pinyinPlain`: `zhongguo` (lowercase, toneless, `ü`→`v`-friendly alias is *not* baked in;
  the runtime normaliser maps user `v` to `ü`/`u` alternatives).
- `definition`: English gloss(es), semicolon separated, no trailing punctuation requirement.
- Shards are sorted by `simplified` code-point order, then `pinyinNumbered`; 8192 records per shard.
- Entry key at runtime is the line address `"<shardIndex>:<lineIndex>"`; the entry id string is
  `simplified + "\u001E" + pinyinNumbered` (stable, derived, no extra storage).

## characters records

```
codepointHex US char US mandarin US cantonese US definition US radical US strokeCount US simplifiedVariant US traditionalVariant
```

- `codepointHex`: lowercase, e.g. `4e2d`.
- `mandarin`: space-separated `kMandarin` (tone marks).
- `radical`: `RSUnicode` first value, normalised to `<radicalNumber>'<restrokes>'`.
- `strokeCount`: first value of `kTotalStrokes`.
- `simplifiedVariant` / `traditionalVariant`: space-separated codepoints (hex, lowercase),
  used for Hanzi conversion; empty when Unihan has no mapping (documented gap).
- Sorted by code point; 2048 records per shard. Lookup = binary search on code point.

## strokes

`index.txt`: one line per character: `<char> US <shardFile>`.
Shard JSONL: one compact object per line, no whitespace:

```json
{"c":"中","s":["M 254 596 Q ... z"],"m":[[194,598,229,572,236,553]]}
```

`c` = character, `s` = outline SVG path strings (kept verbatim from the Arphic-licensed
source, integers only), `m` = median polylines flattened to `[x0,y0,x1,y1,...]` number
arrays (the runtime re-pairs them into `[[x,y],...]` for Hanzi Writer). Coordinates are in
the source 0..1024 write box. `radStrokes` from the upstream file is intentionally dropped.
Shards hold 400 characters each and are committed under `packs/strokes/`.

## examples records

```
headword US simplifiedSentence US traditionalSentence US pinyin US english US sourceRefs
```

`sourceRefs` = `tatoeba:<id>:<author>` items separated by `+`. At most 3 sentences per headword,
only headwords of length >= 2, only `cmn`→`eng` linked pairs.

`<author>` is the literal `unknown` in every shipped record: the pinned Tatoeba per-language export
publishes `id`, `lang`, `text` only, and the dumps that name contributors (1.4 GB and 594 MB) are
deliberately not vendored. The id is the attribution handle - `src/domain/sourceRefs.ts` reads it and
the entry screen links `https://tatoeba.org/en/sentences/show/<id>`, the page that names the
contributor. See `attributionGap` in `scripts/content/provenance.json`.

## content packs

`content/<id>.json`: `{ id, kind, title, summary, level, license, attribution, blocks[] }`
where `blocks[] = { type: "text"|"dialogue"|"list"|"note", title?, body }`. All content is
originally authored for this project (CC BY 4.0) unless `provenance.json` records otherwise.

## OCR pack

`ocr/manifest.json` records file sizes and sha256 for `worker.min.js`, the tesseract core
wasm/js, and `<lang>.traineddata.gz`. Models are opt-in downloads; the UI must show the byte
size before downloading and keep images local.

## Integrity rules enforced by CI

1. Every pack file's `sha256` must match the bytes on disk (`check-provenance.mjs`).
2. Every third-party pack must resolve to an entry in `scripts/content/provenance.json`
   with license id, source URL, upstream version and the matching text in `public/licenses/`.
3. Build fails on missing provenance, unknown license id, or checksum drift.

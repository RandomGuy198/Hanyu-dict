# PWA / installable assets

This note documents the hand-authored installable assets for the app. All artwork here is
**original** — no third-party logo, no trademark, no font binaries, and no network requests
at build time or runtime.

## Files and what each is for

| Path | Role |
| --- | --- |
| `scripts/make-icons.mjs` | Pure-Node PNG encoder + renderer for the brand mark. Only `node:fs` / `node:zlib`; no npm dependencies. Writes every raster icon and both SVG masters, then self-verifies each PNG. |
| `public/manifest.webmanifest` | The web app manifest. **Hand-authored and committed** — it is the auditable one (see rule below). |
| `public/icons/icon-192.png` | Standard icon, `purpose: any`. |
| `public/icons/icon-384.png` | Standard icon, `purpose: any`. |
| `public/icons/icon-512.png` | Standard icon, `purpose: any`. |
| `public/icons/icon-180.png` | Apple touch icon (opaque paper background, because iOS composites touch icons without alpha). |
| `public/icons/icon-maskable-512.png` | Maskable icon: full-bleed teal background with the glyph kept inside the central safe zone (≥10% padding on every edge) so OS circle/squircle masks never clip it. |
| `public/icons/icon.svg` | Vector master of the mark (referenced by the manifest as a scalable `any` icon). |
| `public/favicon.svg` | Same mark, 64-unit viewBox, referenced by `index.html`. |
| `public/share-target/index.html` | Standalone handler page the manifest's `share_target` posts to. |

All sizes are **square, 8-bit RGBA (PNG colour type 6), non-interlaced**. The generator prints
each file's size, colour depth and byte count when it runs.

## Regenerating the icons

```
npm run icons
```

which is exactly:

```
node scripts/make-icons.mjs
```

The output is deterministic (no timestamps, no `tIME` chunk), so re-running produces
byte-identical files — the script is idempotent and safe to run in CI or before a commit.

## The brand mark

The on-screen `BrandMark` in `src/app/icons.tsx` is just the text glyph `语` rendered with the
device's own CJK font. The raster/SVG mark here deliberately does **not** reproduce that glyph
(doing so would need a third-party font binary and would copy a vendor's outlines). Instead it
renders the mark that same file describes in its own comment — "an abstract seal/square with a
stroke": a rounded square in the brand teal (`--brand-600` / `--primary` = `#1f6f5c`, matching
the `<meta name="theme-color">`) containing a white (`--on-primary` `#ffffff`) square ring plus
one diagonal calligraphic stroke. The squircle corner ratio (~0.27) echoes `.brand-mark` in
`src/styles/base.css`.

## Share-target contract

- Manifest declares `share_target.action = "./share-target/"`, `method = "GET"`, params
  `title`, `text`, `url`, and a `files` entry accepting `image/*` and `text/plain`.
- The handler page reads the GET query (`text` → `url` → `title`, first non-empty wins), shows
  the received value, and points onward to the app using relative URLs that survive any GitHub
  Pages repo path: `../index.html#/search?q=<encoded>` for text, `../index.html#/capture` for
  image/OCR work.
- **Static-host limitation (stated honestly on the page):** GitHub Pages cannot read a POST
  `multipart/form-data` body, so shared **image files are not delivered** to this page. When
  nothing usable arrives the page says so plainly and offers a manual paste box plus a direct
  link into the app. It has a no-JS fallback (the form and links work without scripting) and is
  accessible: one `h1`, a labelled input, visible focus, and a live-region status.

## Rule: vite-plugin-pwa must NOT manage the manifest

`vite.config.ts` sets `VitePWA({ manifest: false, ... })`. The build therefore never generates
or overwrites `public/manifest.webmanifest`. We keep the manifest hand-authored and committed
because **the committed file is the auditable one**: reviewers can read the exact name, colours,
icons, shortcuts and share-target, and the values stay stable across builds. If `manifest` were
ever set to an object, the plugin would emit its own manifest into `dist/` and shadow this file.

## Known limitations

- Icons are 8-bit RGBA with alpha; there is no palette/bit-depth reduction and no photographic
  content (the mark is purely geometric).
- `icon-180.png` is opaque by design (Apple touch icons do not honour transparency).
- Shared images cannot be received on a static host (see share-target contract above).

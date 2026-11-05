/**
 * build-licenses.mjs - ship the full licence texts and generate the attribution document.
 *
 * Every third-party dataset and runtime in this app has a licence that requires the text or a
 * notice to accompany the data. This script puts those texts in public/licenses/ (so the app can
 * show them offline) and writes public/licenses/THIRD_PARTY_NOTICES.md, which is generated from
 * scripts/content/provenance.json and must never be hand-edited.
 *
 * Downloads are cached outside the repository (like the data sources) so a rebuild works offline;
 * a cached text is only reused when it still matches the recorded sha256.
 *
 * Idempotent: unchanged licences are not re-fetched and the notice file only rewrites when its
 * content changes, so `data:build` on an unchanged tree touches nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { LICENSES_DIR, REPO_ROOT, ensureDir, exists, readText, resolveCacheDir, sha256File, writeTextAtomic, log } from './lib/fs.mjs';
import { download } from './lib/archive.mjs';
import { loadProvenance, allLicenseFiles } from './lib/provenance.mjs';

const NOTICES_PATH = path.join(LICENSES_DIR, 'THIRD_PARTY_NOTICES.md');

/** Where each licence text comes from. Types: fetch | cache-file | node-module | provenance. */
const LICENSE_SOURCES = {
  'CC-BY-SA-4.0.txt': { type: 'fetch', url: 'https://creativecommons.org/licenses/by-sa/4.0/legalcode.txt' },
  'CC-BY-2.0-FR.txt': {
    type: 'fetch-html',
    url: 'https://creativecommons.org/licenses/by/2.0/fr/legalcode',
    note: 'Creative Commons publishes no plain-text legal code for this ported licence, so the text below is a faithful rendering of the upstream HTML. The authoritative version is always https://creativecommons.org/licenses/by/2.0/fr/legalcode',
  },
  'CC-BY-4.0.txt': { type: 'fetch', url: 'https://creativecommons.org/licenses/by/4.0/legalcode.txt' },
  'Unicode-License-v3.txt': { type: 'fetch', url: 'https://www.unicode.org/license.txt' },
  'Apache-2.0.txt': { type: 'fetch', url: 'https://www.apache.org/licenses/LICENSE-2.0.txt' },
  'MIT.txt': { type: 'node-module', file: 'node_modules/hanzi-writer/LICENSE' },
  'ARPHIC.txt': { type: 'cache-file', file: 'hw/package/ARPHICPL.TXT', pinnedBy: 'hanzi-writer-data' },
};

/**
 * Minimal, dependency-free HTML -> text rendering, used only for the ported CC licence that
 * Creative Commons publishes as HTML. It keeps every visible character of the legal code: block
 * boundaries become blank lines, tags and inline scripts/styles are dropped, entities are decoded.
 * The rendering note is published in THIRD_PARTY_NOTICES.md so this file stays the licence alone.
 */
function htmlToText(html) {
  let s = html.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|svg|form|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<(p|div|li|ul|ol|h[1-6]|br|tr|section|article)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/&mdash;/gi, '--')
    .replace(/&ndash;/gi, '-')
    .replace(/&sect;/gi, 'Section ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
  const lines = s
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((line, i, all) => line.length > 0 || (i > 0 && all[i - 1].length > 0));
  return lines.join('\n');
}

async function obtain(name, cacheDir) {
  const spec = LICENSE_SOURCES[name];
  if (!spec) throw new Error(`no licence source configured for ${name}`);
  const dest = path.join(LICENSES_DIR, name);

  let sourceText;
  let verbatim = false;
  if (spec.type === 'node-module') {
    const full = path.join(REPO_ROOT, spec.file);
    if (!exists(full)) throw new Error(`${name}: ${spec.file} is missing - run npm ci before building licences`);
    sourceText = readText(full);
    verbatim = true;
    log(`  ${name} <- ${spec.file}`);
  } else if (spec.type === 'cache-file') {
    const full = path.join(cacheDir, spec.file);
    if (!exists(full)) throw new Error(`${name}: ${spec.file} is not in the cache - run node scripts/content/fetch-sources.mjs`);
    sourceText = readText(full);
    verbatim = true;
    log(`  ${name} <- cache/${spec.file}`);
  } else {
    const cached = path.join(cacheDir, 'licenses', name);
    if (!exists(cached)) {
      download(spec.url, cached, { timeoutSec: 120 });
      log(`  ${name} <- ${spec.url}`);
    } else {
      log(`  ${name} <- cached licence text`);
    }
    const raw = readText(cached);
    sourceText = spec.type === 'fetch-html' ? htmlToText(raw) : raw;
  }

  // A licence taken from an upstream file is copied byte for byte, so a pinned sha256 of that
  // document matches it exactly. Fetched texts are newline-normalised only.
  const text = verbatim ? sourceText : `${sourceText.trimEnd()}\n`;
  await writeTextAtomic(dest, text);
  return { name, bytes: fs.statSync(dest).size, sha256: await sha256File(dest) };
}

function noticeDocument(reg) {
  const lines = [];
  lines.push('# Third-party data, code and licences');
  lines.push('');
  lines.push(
    '_Generated by `scripts/content/build-licenses.mjs` from `scripts/content/provenance.json`. Do not edit this file by hand._'
  );
  lines.push('');
  lines.push(
    'This application bundles datasets and runtime components from the projects below. Each section records the upstream ' +
      'project, the exact release used, how it was transformed, the licence it is used under and where the full licence text ships. ' +
      'No content from any proprietary dictionary application is included anywhere in this project.'
  );
  lines.push('');
  lines.push(
    'Three licence layers apply to a distribution of this app, and none of them overrides the others: the ' +
      '**application code** is MIT (the `LICENSE` file at the root of this repository); the **data packs** are the derived material described ' +
      'in this document, each under its own licence and share-alike duty; and the **bundled runtime libraries** - React, ' +
      'React Router, Dexie, Zod, hanzi-writer and the Workbox service-worker runtime - are itemised with ' +
      'their licence texts and upstream notices in [`RUNTIME_NOTICES.md`](./RUNTIME_NOTICES.md). Publishing the source code ' +
      'under MIT grants no right to relicense the data or the libraries.'
  );
  lines.push('');
  lines.push(
    '_The `LICENSE` file named above is not served beside this document: it lives at the root of the source repository, and this file is generated into `public/licenses/`._'
  );
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Source | Release | Licence | Packs / role | Licence text |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const src of reg.sources) {
    const scope = src.packs?.length ? src.packs.join(', ') : 'runtime build';
    lines.push(
      `| ${src.upstreamProject} | ${src.upstreamVersion} | ${src.license} | ${scope} | [\`${path.basename(src.licenseFile)}\`](./${path.basename(src.licenseFile)}) |`
    );
  }
  lines.push('');

  for (const src of reg.sources) {
    lines.push(`## ${src.upstreamProject}`);
    lines.push('');
    lines.push(`- **Licence:** ${src.license} — [upstream](${src.licenseUrl}) — full text: [\`${path.basename(src.licenseFile)}\`](./${path.basename(src.licenseFile)})`);
    lines.push(`- **Source:** ${String(src.sourceUrl).startsWith('http') ? `[${src.sourceUrl}](${src.sourceUrl})` : src.sourceUrl}`);
    if (src.projectUrl && src.projectUrl !== src.sourceUrl) lines.push(`- **Project:** ${src.projectUrl}`);
    lines.push(`- **Release used:** ${src.upstreamVersion}${src.upstreamDate ? ` (dated ${src.upstreamDate})` : ''}`);
    lines.push(`- **Pinned by:** ${src.pinnedBy}`);
    lines.push(`- **Attribution:** ${src.attribution}`);
    if (src.attributionNote) lines.push(`- **Attribution note:** ${src.attributionNote}`);
    if (src.shareAlike) lines.push(`- **ShareAlike:** yes — ${src.shareAlikeNote || 'derived data stays under the same licence.'}`);
    if (src.attributionGap) lines.push(`- **Known gap:** ${src.attributionGap}`);
    if (src.packs?.length) lines.push(`- **Ships as:** ${src.packs.join(', ')}`);
    lines.push('');
    if (src.transformations?.length) {
      lines.push('Modifications made for this application:');
      lines.push('');
      for (const t of src.transformations) lines.push(`- ${t}`);
      lines.push('');
    }
  }

  lines.push('## Notes on the licence texts shipped here');
  lines.push('');
  lines.push('Each file in this directory is the upstream licence text, unaltered and without any added preamble, so a pinned checksum of the upstream document matches it byte for byte.');
  for (const [name, spec] of Object.entries(LICENSE_SOURCES)) {
    if (spec.note) lines.push(`- \`${name}\`: ${spec.note}`);
    else if (spec.type === 'node-module') lines.push(`- \`${name}\`: taken from ${spec.file} in the pinned dependency.`);
    else if (spec.type === 'cache-file') lines.push(`- \`${name}\`: taken from the pinned upstream archive (${spec.file}).`);
    else lines.push(`- \`${name}\`: fetched from ${spec.url}.`);
  }
  lines.push('');

  lines.push('## Datasets and assets that are deliberately NOT included');
  lines.push('');
  lines.push('- No dictionary database, lesson text, test questions, audio, artwork, animation, font or icon taken from any commercial dictionary application.');
  lines.push('- No human pronunciation recordings: audio coverage and per-file licensing on the public archives could not be verified file by file, so pronunciation is produced by the device speech synthesiser and is labelled as synthetic in the app.');
  lines.push('- No general character-component (IDS) decomposition data: the upstream file for it is LGPL, and that model was not accepted for this project. The gap is stated in the app instead of being filled with an unlicensed copy.');
  lines.push('- No server-side translation, speech scoring, forum, chat or account system: this build is a static web application.');
  lines.push('');
  lines.push('## Obligations carried by this project');
  lines.push('');
  lines.push('- CC BY-SA 4.0 (CC-CEDICT & CVDICT): attribution, licence link, indication of changes; the derived `dictionary-core` pack is distributed under CC BY-SA 4.0.');
  lines.push('- Unicode License v3: the copyright and permission notice accompanies the derived Unihan data, in full, at `Unicode-License-v3.txt`.');
  lines.push('- Arphic Public License (stroke graphics): the licence text is shipped unaltered and the change notices above state how and when the data was modified; derived stroke data remains under the Arphic terms.');
  lines.push('- CC BY 2.0 FR (Tatoeba): every sentence id is preserved in each `sourceRef` and the entry screen links it to the upstream sentence page, where the contributor is named; the pinned export itself publishes no usernames (see the known gap above).');
  lines.push('- Apache-2.0 / MIT (bundled runtime code): Dexie, React, React Router, Zod, hanzi-writer and the Workbox service-worker runtime each keep their own licence. Their version-by-version notices, including every upstream NOTICE file reproduced verbatim, are itemised in [`RUNTIME_NOTICES.md`](./RUNTIME_NOTICES.md), generated from the installed dependency tree.');
  lines.push('- CC BY 4.0 (original content): authored for this project and credited as such in every content item.');
  lines.push('- MIT (application code): the repository root `LICENSE`. It covers the code only and changes nothing above.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export async function build({ cacheDir, quiet = false } = {}) {
  const cache = cacheDir || resolveCacheDir(process.argv);
  await ensureDir(LICENSES_DIR);

  const reg = loadProvenance();
  const needed = [...new Set([...reg.sources.map((s) => path.basename(s.licenseFile)), ...allLicenseFiles(reg).map((f) => path.basename(f))])];
  for (const name of needed) {
    if (!LICENSE_SOURCES[name]) throw new Error(`provenance.json requires ${name} but build-licenses.mjs has no source for it`);
  }

  const written = [];
  for (const name of needed) written.push(await obtain(name, cache));

  // Every pinned licence text that provenance.json hashes must still match.
  for (const src of reg.sources) {
    if (!src.licenseTextSha256) continue;
    const dest = path.join(REPO_ROOT, src.licenseFile);
    const digest = await sha256File(dest);
    if (digest !== src.licenseTextSha256) {
      throw new Error(`${src.licenseFile}: sha256 ${digest} does not match the pinned ${src.licenseTextSha256}`);
    }
  }

  const doc = noticeDocument(reg);
  const changed = !exists(NOTICES_PATH) || readText(NOTICES_PATH) !== doc;
  if (changed) await writeTextAtomic(NOTICES_PATH, doc);

  if (!quiet) {
    log(`licences: ${written.length} texts in ${path.relative(process.cwd(), LICENSES_DIR)}`);
    for (const w of written) log(`  ${w.name}  ${w.bytes} bytes  sha256 ${w.sha256.slice(0, 12)}`);
    log(`  THIRD_PARTY_NOTICES.md ${changed ? 'updated' : 'unchanged'} (${Buffer.byteLength(doc, 'utf8')} bytes)`);
  }
  return { written, noticesPath: NOTICES_PATH, changed };
}

/** Standalone hash helper used by check-provenance.mjs. */
export function hashOf(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await build({});
}

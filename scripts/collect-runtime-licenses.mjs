/**
 * collect-runtime-licenses.mjs - generate public/licenses/RUNTIME_NOTICES.md.
 *
 * The app code is MIT (root LICENSE), but the bundle also ships third-party runtime libraries to
 * every browser. MIT requires the copyright + permission notice in every redistribution, and
 * Apache-2.0 section 4(d) requires the upstream NOTICE to accompany the derived work. The data
 * sources are recorded by scripts/content/build-licenses.mjs; nothing there covered the *code*
 * dependencies, which is the gap this script closes.
 *
 * Input is the pinned dependency tree: the production `dependencies` of package.json, walked
 * transitively through node_modules (so `npm ci` decides what is listed), plus the Workbox runtime
 * that vite-plugin-pwa inlines into the generated service worker.
 *
 * Modes:
 *   node scripts/collect-runtime-licenses.mjs          # write the notices file
 *   node scripts/collect-runtime-licenses.mjs --check  # verify the committed file is current
 * `--check` is what `npm run data:check` calls: a bumped dependency, an upstream relicense or a new
 * transitive package all make the shipped notices stale, and a stale notice is a broken notice.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, exists, readText, writeTextAtomic, log } from './content/lib/fs.mjs';

const OUT_PATH = path.join(REPO_ROOT, 'public', 'licenses', 'RUNTIME_NOTICES.md');
const NODE_MODULES = path.join(REPO_ROOT, 'node_modules');
const APACHE_TEXT_FILE = 'Apache-2.0.txt';

/** Licences whose full text this script inlines. Apache bodies are referenced, not repeated. */
const INLINE_TEXT = new Set(['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'Python-2.0', 'Unlicense']);

const ARGV = process.argv.slice(2);
const CHECK_MODE = ARGV.includes('--check');

/** Names this script looks for, in order, when hunting a package's licence document. */
const LICENSE_FILE_NAMES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENSE-MIT',
  'LICENSE-MIT.txt',
  'LICENCE',
  'LICENCE.md',
  'LICENCE.txt',
  'COPYING',
  'COPYING.md',
  'copyright',
];

function pkgJsonAt(dir) {
  const file = path.join(dir, 'package.json');
  if (!exists(file)) return null;
  try {
    return JSON.parse(readText(file));
  } catch (error) {
    throw new Error(`${path.relative(REPO_ROOT, file)}: not valid JSON (${error.message})`);
  }
}

/** SPDX id from the modern `license` field or the legacy `licenses` array. */
function spdxOf(pkg) {
  const { license, licenses } = pkg;
  if (typeof license === 'string' && license.trim()) return license.trim();
  if (license && typeof license === 'object' && typeof license.type === 'string') return license.type.trim();
  if (Array.isArray(licenses) && licenses.length) {
    return licenses.map((entry) => (typeof entry === 'string' ? entry : entry?.type)).filter(Boolean).join(' OR ');
  }
  return '';
}

/** Upstream repository URL from package.json, used when the tarball ships no licence text. */
function repositoryUrlOf(pkg) {
  if (!pkg) return '';
  const repo = pkg.repository;
  if (typeof repo === 'string') return repo;
  if (repo && typeof repo === 'object' && typeof repo.url === 'string') return repo.url;
  if (typeof pkg.homepage === 'string') return pkg.homepage;
  return '';
}

function findLicenseFile(dir) {
  const entries = fs.readdirSync(dir);
  for (const name of LICENSE_FILE_NAMES) {
    const hit = entries.find((entry) => entry.toLowerCase() === name.toLowerCase());
    if (hit && fs.statSync(path.join(dir, hit)).isFile()) return hit;
  }
  return null;
}

function findNotices(dir) {
  const entries = fs.readdirSync(dir);
  const found = [];
  const notice = entries.find((entry) => entry.toUpperCase() === 'NOTICE');
  if (notice) found.push(notice);
  // Packages that grant rights beyond the standard text (extra attribution clauses) put them in a
  // COPYING file beside LICENSE; ship those verbatim too rather than summarising them.
  const copying = entries.find((entry) => /^(COPYING|LICENSE\.COMMUNAL|PATENTS)(\.md|\.txt)?$/i.test(entry));
  if (copying) found.push(copying);
  return found.filter((name) => fs.statSync(path.join(dir, name)).isFile());
}

/** First copyright statement in a licence document, for the summary table. */
function holderOf(text) {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(Copyright\b[^\n]*)$/);
    if (!m) continue;
    const candidate = m[1].replace(/\s+/g, ' ').trim();
    // The Apache-2.0 boilerplate and the MIT warranty paragraph both contain the word "copyright"
    // in a sentence that names nobody; so does the licence's own fill-in-the-blanks appendix.
    if (/shall be included|entity authorized|shall mean|retain the above|\[yyyy\]|\{yyyy\}|\[name of copyright owner\]|\{name of copyright owner\}/i.test(candidate)) continue;
    if (candidate.length < 12) continue;
    return candidate;
  }
  return '';
}

/** The holder line a distributor has to reproduce: the NOTICE when the package ships one, since
 *  Apache-2.0 section 4(d) points at it, otherwise the first real copyright line in the licence. */
function holderFrom(dir, licenseText, noticeFiles) {
  for (const file of noticeFiles) {
    const holder = holderOf(readText(path.join(dir, file)));
    if (holder) return holder;
  }
  return holderOf(licenseText);
}

/**
 * Walk the production tree breadth-first, resolving each name from the requiring package's own
 * node_modules before the top-level one (npm nests when versions conflict).
 */
function collectProductionTree() {
  const rootPkg = pkgJsonAt(REPO_ROOT);
  if (!rootPkg) throw new Error('package.json is missing at the repository root');
  const wanted = Object.keys(rootPkg.dependencies || {});
  if (wanted.length === 0) throw new Error('package.json declares no production dependencies');

  const found = new Map();
  const queue = wanted.map((name) => ({ name, fromDir: REPO_ROOT, via: 'direct dependency' }));
  let guard = 0;
  while (queue.length) {
    if (++guard > 20000) throw new Error('dependency walk did not terminate - a cycle was not deduplicated');
    const { name, fromDir, via } = queue.shift();
    const candidates = [];
    let dir = fromDir;
    for (;;) {
      candidates.push(path.join(dir, 'node_modules', name));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    const resolved = candidates.find((candidate) => exists(path.join(candidate, 'package.json')));
    if (!resolved) {
      throw new Error(`${name}: required by ${path.relative(REPO_ROOT, fromDir) || '.'} but not installed - run npm ci`);
    }
    const pkg = pkgJsonAt(resolved);
    if (!pkg) throw new Error(`${name}: ${path.relative(REPO_ROOT, resolved)}/package.json could not be read`);
    // Keyed by name *and* version: npm nests two copies of one package when the ranges conflict, and
    // both are installed - the row that matters is the copy this requiring package actually resolves.
    const key = `${name}@${pkg.version || 'unknown'}`;
    if (found.has(key)) continue;
    found.set(key, { name, version: pkg.version || 'unknown', spdx: spdxOf(pkg), dir: resolved, via });
    for (const dep of Object.keys(pkg.dependencies || {})) {
      queue.push({ name: dep, fromDir: resolved, via: `dependency of ${key}` });
    }
  }
  return found;
}

/**
 * The Workbox runtime is not a production dependency: `vite-plugin-pwa` pulls `workbox-window` into
 * the app bundle (the registerSW module) and `workbox-build` copies the workbox-* runtime modules
 * into the generated service worker. Both reach the device, so both are listed here even though npm
 * files them under devDependencies. Versions come from the installed packages, never from a build
 * artifact, so this document is reproducible from `npm ci` alone.
 */
function collectWorkboxRuntime() {
  const found = new Map();
  const add = (name, via) => {
    const dir = path.join(NODE_MODULES, name);
    if (!exists(dir) || found.has(name)) return;
    found.set(name, { version: null, dir, via });
  };
  add('workbox-window', 'imported by the service-worker registration this site generates');

  const buildPkg = path.join(NODE_MODULES, 'workbox-build', 'package.json');
  if (exists(buildPkg)) {
    const pkg = JSON.parse(readText(buildPkg));
    for (const name of Object.keys(pkg.dependencies || {})) {
      if (name.startsWith('workbox-')) add(name, 'copied into the generated service worker by workbox-build');
    }
  }
  return found;
}

function toRecord(name, version, spdx, dir, via) {
  const licenseFile = findLicenseFile(dir);
  if (!licenseFile && !spdx) {
    throw new Error(
      `${name}@${version}: neither a licence document nor a licence id in package.json - this package cannot ship until its licence is known`,
    );
  }
  const text = licenseFile ? readText(path.join(dir, licenseFile)) : '';
  if (licenseFile && text.trim().length < 40) {
    throw new Error(`${name}@${version}: ${licenseFile} looks empty (${text.length} characters)`);
  }
  const extraFiles = licenseFile ? findNotices(dir).filter((file) => file !== licenseFile) : [];
  return {
    name,
    version,
    spdx: spdx || 'unspecified',
    dir,
    via,
    licenseFile,
    licenseText: text,
    holder: holderFrom(dir, text, extraFiles),
    repository: repositoryUrlOf(pkgJsonAt(dir)),
    extraFiles,
  };
}

function gather() {
  if (!exists(NODE_MODULES)) {
    throw new Error(`node_modules is missing - run npm ci before ${CHECK_MODE ? 'checking' : 'building'} runtime licences`);
  }
  const tree = collectProductionTree();
  const records = [];
  for (const { name, version, spdx, dir, via } of tree.values()) records.push(toRecord(name, version, spdx, dir, via));

  const workbox = collectWorkboxRuntime();
  const treeNames = new Set([...tree.values()].map((entry) => entry.name));
  for (const [name, meta] of workbox) {
    if (treeNames.has(name)) continue;
    const pkg = pkgJsonAt(meta.dir);
    if (!pkg) throw new Error(`${name}: named as shipped runtime code but package.json is unreadable`);
    records.push(toRecord(name, pkg.version || 'unknown', spdxOf(pkg), meta.dir, meta.via));
  }

  records.sort((a, b) => a.name.localeCompare(b.name) || String(a.version).localeCompare(String(b.version), undefined, { numeric: true }));
  const unlicensed = records.filter((r) => !r.spdx || r.spdx === 'unspecified');
  if (unlicensed.length) {
    throw new Error(`no SPDX licence id for: ${unlicensed.map((r) => `${r.name}@${r.version}`).join(', ')} - add it to the notices by hand after reading their licence`);
  }
  return records;
}

function isApache(spdx) {
  return /Apache-2\.0/.test(spdx);
}

function renderDocument(records) {
  const generatedBy = 'scripts/collect-runtime-licenses.mjs';
  const L = [];
  L.push('# Bundled runtime code and licences');
  L.push('');
  L.push(`_Generated by \`${generatedBy}\` from the dependency tree installed by \`npm ci\` (pinned by \`package-lock.json\`). Do not edit this file by hand._`);
  L.push('');
  L.push(
    'The application code in this repository is MIT and covered by the root `LICENSE`. The packages below are the ' +
      'runtime dependency tree this app installs for production, resolved through `package-lock.json`, plus the ' +
      'Workbox modules that the build copies into the service worker. No library is loaded from a CDN: every module ' +
      'this app executes is bundled and served from this origin. Where a browser build resolves a smaller subset than ' +
      'the tree npm installs (Node-only fallbacks behind a `browser` field, for instance), the subset is still listed ' +
      'here - naming a package you do not ship costs nothing, omitting one you do is a breach.'
  );
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push('| Package | Version | Licence | Copyright holder as recorded | How it is reached |');
  L.push('| --- | --- | --- | --- | --- |');
  for (const r of records) {
    const holder = r.licenseFile
      ? r.holder || '_no copyright line in the licence text; see below_'
      : '_the published tarball ships no licence text; see below_';
    L.push(`| \`${r.name}\` | ${r.version} | ${r.spdx} | ${holder} | ${r.via} |`);
  }
  L.push('');

  const noText = records.filter((r) => !r.licenseFile);
  const withText = records.filter((r) => r.licenseFile);
  const apache = withText.filter((r) => isApache(r.spdx));
  const inlined = withText.filter((r) => !isApache(r.spdx) && INLINE_TEXT.has(r.spdx));
  const other = withText.filter((r) => !isApache(r.spdx) && !INLINE_TEXT.has(r.spdx));

  if (inlined.length) {
    L.push(`## Packages under an inlined permissive licence (${inlined.length})`);
    L.push('');
    L.push(
      'The MIT-family and BSD texts are short enough to reproduce in full, which is what those licences require of a redistribution. Each block below is the licence document as it ships inside the installed package, byte for byte.'
    );
    L.push('');
    for (const r of inlined) {
      L.push(`### \`${r.name}\` ${r.version} - ${r.spdx}`);
      L.push('');
      L.push(`Source: \`${r.name}\` ${r.version}, licence file \`${r.licenseFile}\` in the installed package${r.holder ? `, ${r.holder}` : ''}.`);
      L.push('');
      L.push('```');
      L.push(r.licenseText.trimEnd());
      L.push('```');
      L.push('');
      for (const file of r.extraFiles) {
        L.push(`Additional upstream notice \`${file}\`, reproduced verbatim:`);
        L.push('');
        L.push('```');
        L.push(readText(path.join(r.dir, file)).trimEnd());
        L.push('```');
        L.push('');
      }
    }
  }

  if (apache.length) {
    L.push(`## Packages under Apache License 2.0 (${apache.length})`);
    L.push('');
    L.push(
      `The Apache-2.0 terms apply to each package in this section; the full text ships unaltered at [\`${APACHE_TEXT_FILE}\`](./${APACHE_TEXT_FILE}) and is not repeated here. Section 4(d) obliges a redistribution to reproduce any NOTICE file the upstream supplies, so the notices below are included verbatim; where a package ships no NOTICE, that is stated instead.`
    );
    L.push('');
    for (const r of apache) {
      L.push(`### \`${r.name}\` ${r.version} - ${r.spdx}`);
      L.push('');
      L.push(`Licence: Apache-2.0, see [\`${APACHE_TEXT_FILE}\`](./${APACHE_TEXT_FILE}).${r.holder ? ` Copyright line in the package: ${r.holder}.` : ''}`);
      L.push('');
      if (r.extraFiles.length === 0) {
        L.push('_This package ships no NOTICE file, so there is no additional notice to reproduce._');
        L.push('');
      }
      for (const file of r.extraFiles) {
        L.push(`Notice file \`${file}\`, reproduced verbatim:`);
        L.push('');
        L.push('```');
        L.push(readText(path.join(r.dir, file)).trimEnd());
        L.push('```');
        L.push('');
      }
    }
  }

  if (other.length) {
    L.push(`## Packages under another licence (${other.length})`);
    L.push('');
    L.push('These need a human decision, so their upstream licence document is reproduced in full:');
    L.push('');
    for (const r of other) {
      L.push(`### \`${r.name}\` ${r.version} - ${r.spdx}`);
      L.push('');
      L.push('```');
      L.push(r.licenseText.trimEnd());
      L.push('```');
      L.push('');
      for (const file of r.extraFiles) {
        L.push(`Additional upstream notice \`${file}\`, reproduced verbatim:`);
        L.push('');
        L.push('```');
        L.push(readText(path.join(r.dir, file)).trimEnd());
        L.push('```');
        L.push('');
      }
    }
  }

  if (noText.length) {
    L.push(`## Packages whose tarball ships no licence text (${noText.length})`);
    L.push('');
    L.push(
      'These packages declare a licence id in `package.json` but the published tarball contains no licence document, ' +
        'so there is no upstream text to reproduce. They are recorded here rather than silently dropped. Some are ' +
        'reached only through Node code paths that a bundler replaces using the importing package\'s `browser` field, ' +
        'so no copy of them is served to a user. Before any build starts shipping one, take the notice from the ' +
        'upstream repository named below and add it to this document.'
    );
    L.push('');
    L.push('| Package | Version | Declared licence | Upstream |');
    L.push('| --- | --- | --- | --- |');
    for (const r of noText) {
      L.push(`| \`${r.name}\` | ${r.version} | ${r.spdx} | ${r.repository || '_not stated in package.json_'} |`);
    }
    L.push('');
  }

  L.push('## Development-only tooling');
  L.push('');
  L.push(
    'TypeScript, Vite, Rollup, ESLint, Vitest, Playwright and the content pipeline libraries are build-time tools. Their code is not served to users and none of their output is a derived work of the app bundle, so they carry no notice obligation here. They are installed from `package.json` under their own licences.'
  );
  L.push('');
  L.push('## How to refresh this file');
  L.push('');
  L.push('```');
  L.push('npm ci');
  L.push(`node ${generatedBy}`);
  L.push('```');
  L.push('');
  L.push('`npm run data:check` re-derives the document from the installed tree and fails if the committed copy differs, so an update to any dependency forces a fresh notice.');
  L.push('');
  return `${L.join('\n')}\n`;
}

export async function build({ quiet = false } = {}) {
  const records = gather();
  const doc = renderDocument(records);
  await writeTextAtomic(OUT_PATH, doc);
  if (!quiet) {
    log(`runtime licences: ${records.length} packages -> ${path.relative(REPO_ROOT, OUT_PATH)} (${Buffer.byteLength(doc, 'utf8')} bytes)`);
  }
  return { records, doc, outPath: OUT_PATH };
}

export async function check() {
  const records = gather();
  const expected = renderDocument(records);
  if (!exists(OUT_PATH)) {
    throw new Error(`public/licenses/RUNTIME_NOTICES.md is missing - run: node scripts/collect-runtime-licenses.mjs`);
  }
  const current = readText(OUT_PATH);
  if (current !== expected) {
    // Every record has exactly one summary-table row, so a row that is absent names the package
    // that moved; when all rows are present the difference is in the wording or the licence texts.
    const missing = records.filter((r) => !current.includes(`| \`${r.name}\` | ${r.version} |`));
    const detail = missing.length
      ? ` Out of date or absent: ${missing.map((r) => `${r.name}@${r.version}`).join(', ')}.`
      : ' All packages are listed, so the wording or a reproduced licence text differs.';
    throw new Error(
      `public/licenses/RUNTIME_NOTICES.md no longer matches the installed dependency tree.${detail} Run: node scripts/collect-runtime-licenses.mjs`
    );
  }
  return { records, ok: true };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  if (CHECK_MODE) {
    const { records } = await check();
    log(`runtime licences: OK - ${records.length} packages match ${path.relative(process.cwd(), OUT_PATH)}`);
  } else {
    await build({});
  }
}

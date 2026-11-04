/**
 * sync-pages.mjs - produce the folder a GitHub Pages "deploy from a branch" job can serve.
 *
 * Why this exists: the user publishes this app from their own repository, and Pages can be set up
 * in two ways. Building in CI is the better one (nothing stale is committed). When a repository is
 * configured for "Deploy from a branch" instead, Pages needs the finished site committed in the
 * tree - that is what `site/` is for.
 *
 * `docs/` is deliberately NOT used: it holds this project's design documents, and mixing a build
 * output into hand-written documentation is how stale pages and lost notes happen.
 *
 * Run `npm run build:only` (or let this script run it) first, then:
 *   node scripts/sync-pages.mjs            copy dist/ -> site/, add .nojekyll, print the summary
 *   node scripts/sync-pages.mjs --build    run the production build first
 *
 * The copy is byte-for-byte; nothing here edits a generated file, so the sha256 values published
 * in site/data/manifest.json keep matching the bytes Pages serves.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');
const SITE = path.join(ROOT, 'site');

/** Files that must exist before a Pages deploy is considered sane. */
const REQUIRED = [
  'index.html',
  'manifest.webmanifest',
  path.join('data', 'manifest.json'),
  path.join('data', 'packs', 'dictionary-core', '000.txt'),
  path.join('data', 'packs', 'characters', '000.txt'),
  path.join('licenses', 'THIRD_PARTY_NOTICES.md'),
];

function copyTree(src, dest) {
  let files = 0;
  let bytes = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      const sub = copyTree(from, to);
      files += sub.files;
      bytes += sub.bytes;
    } else {
      fs.copyFileSync(from, to);
      files++;
      bytes += fs.statSync(to).size;
    }
  }
  return { files, bytes };
}

/** Remove only what this script previously copied, never hand-written files. */
function pruneStale(dir, keep) {
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(SITE, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      removed += pruneStale(full, keep);
      if (!fs.readdirSync(full).length) fs.rmdirSync(full);
    } else if (!keep.has(rel) && rel !== '.nojekyll') {
      fs.rmSync(full);
      removed++;
    }
  }
  return removed;
}

function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), `${rel}/`));
    else out.push(rel);
  }
  return out;
}

export function sync({ build = false, quiet = false } = {}) {
  if (build) {
    const r = spawnSync('npm', ['run', 'build:only'], { cwd: ROOT, stdio: 'inherit', shell: true, windowsHide: true });
    if (r.status !== 0) throw new Error('production build failed; site/ was left untouched');
  }
  if (!fs.existsSync(DIST)) throw new Error('dist/ is missing - run `npm run build:only` first');

  const missing = REQUIRED.filter((rel) => !fs.existsSync(path.join(DIST, rel)));
  if (missing.length) {
    throw new Error(
      `dist/ is not a deployable app. Missing: ${missing.join(', ')}\n` +
        'A Pages deploy without the manifest or the core pack would install an app that cannot download its dictionary.'
    );
  }

  const keep = new Set(listFiles(DIST));
  fs.mkdirSync(SITE, { recursive: true });
  const removed = pruneStale(SITE, keep);
  const { files, bytes } = copyTree(DIST, SITE);
  fs.writeFileSync(path.join(SITE, '.nojekyll'), '# Pages must not run Jekyll over this build\n', 'utf8');

  if (!quiet) {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    console.log(`site/ updated: ${files} files, ${mb} MB, ${removed} stale file(s) removed`);
    console.log('  Pages setting: Source = "Deploy from a branch", Branch = your default branch, Folder = /site');
    console.log(`  entry points: ${REQUIRED.slice(0, 3).map((r) => `site/${r.split(path.sep).join('/')}`).join(', ')}`);
  }
  return { files, bytes, removed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  sync({ build: process.argv.includes('--build') });
}

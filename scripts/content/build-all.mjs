/**
 * build-all.mjs - run the whole content pipeline in dependency order.
 *
 * Only the manifest has to run last: it hashes whatever is then present on disk. Every other
 * stage reads the raw cache (never the repository) or scripts/content/original, so stages are
 * independent of each other.
 *
 * This script never touches the network. Fetch first with `npm run data:fetch`, then build.
 * CI can re-run it offline against the committed packs, which is exactly what proves they are
 * reproducible.
 *
 * Usage:
 *   node scripts/content/build-all.mjs                  everything
 *   node scripts/content/build-all.mjs --only strokes   one stage
 *   node scripts/content/build-all.mjs --skip content   leave a stage out
 *   node scripts/content/build-all.mjs --cache <dir>    non-default cache location
 */
import { pathToFileURL } from 'node:url';
import { resolveCacheDir, log } from './lib/fs.mjs';
import { build as buildDictionary } from './build-dictionary.mjs';
import { build as buildCharacters } from './build-characters.mjs';
import { build as buildStrokes } from './build-strokes.mjs';
import { build as buildExamples } from './build-examples.mjs';
import { build as buildContent } from './build-content.mjs';
import { build as buildLicenses } from './build-licenses.mjs';
import { build as buildRuntimeLicenses } from '../collect-runtime-licenses.mjs';
import { build as buildManifest } from './build-manifest.mjs';
import { check } from './check-provenance.mjs';

const STAGES = [
  { id: 'dictionary', build: buildDictionary },
  { id: 'characters', build: buildCharacters },
  { id: 'strokes', build: buildStrokes },
  { id: 'examples', build: buildExamples },
  { id: 'content', build: buildContent },
  { id: 'licenses', build: buildLicenses },
  { id: 'runtime-licenses', build: buildRuntimeLicenses },
  { id: 'manifest', build: buildManifest },
];

function selector(argv) {
  const only = [];
  const skip = [];
  let i = 2;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--only') only.push(argv[++i]);
    else if (a === '--skip') skip.push(argv[++i]);
    else if (a === '--cache') i += 2;
    else throw new Error(`Unknown argument: ${a} (stages: ${STAGES.map((s) => s.id).join(', ')})`);
    i++;
  }
  for (const id of [...only, ...skip]) {
    if (!STAGES.some((s) => s.id === id)) throw new Error(`No such stage: ${id} (stages: ${STAGES.map((s) => s.id).join(', ')})`);
  }
  return (stage) => (!only.length || only.includes(stage.id)) && !skip.includes(stage.id);
}

export async function buildAll({ cacheDir, argv = process.argv } = {}) {
  const cache = cacheDir || resolveCacheDir(argv);
  const wanted = selector(argv);
  const started = Date.now();
  const done = [];

  for (const stage of STAGES) {
    if (!wanted(stage)) {
      log(`--- ${stage.id}: skipped by request`);
      continue;
    }
    log(`\n=== ${stage.id} ===`);
    await stage.build({ cacheDir: cache, quiet: false });
    done.push(stage.id);
  }

  const verdict = await check({ cacheDir: cache });
  if (!verdict.ok) {
    throw new Error(`provenance check reported ${verdict.failures.length} problem(s); the packs above are not publishable`);
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  log(`\nbuild-all: ${done.join(', ')} rebuilt and provenance-verified in ${seconds}s`);
  return { done, seconds: Number(seconds) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await buildAll({});
}

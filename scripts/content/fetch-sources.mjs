/**
 * fetch-sources.mjs - fill and verify the raw-download cache from provenance.json.
 *
 * This is the ONLY pipeline step that touches the network, and it never writes inside the
 * repository: raw downloads live in the cache dir (default `../.cache/raw`, override with
 * `--cache <dir>` or `HANYU_CACHE`). Every build script reads from that cache and refuses to
 * run when a file's sha256 does not match the value pinned in scripts/content/provenance.json.
 *
 * Modes:
 *   node scripts/content/fetch-sources.mjs              download whatever is missing, verify the rest
 *   node scripts/content/fetch-sources.mjs --verify-only  no network; fail if a cache file is absent or wrong
 *   node scripts/content/fetch-sources.mjs --only <id>  handle one source id (repeatable)
 *   node scripts/content/fetch-sources.mjs --pin        overwrite the recorded sha256/bytes after a
 *                                                        verified fresh download (deliberate re-pinning)
 *
 * A cached file whose hash matches the pin is never re-downloaded, so rebuilds stay offline.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { exists, ensureDir, resolveCacheDir, sha256File, formatBytes, table, log } from './lib/fs.mjs';
import { download, extractTarGz, npmPack, unzipMemberStream, streamToFile } from './lib/archive.mjs';
import { loadProvenance, cacheExpectations, PROVENANCE_PATH } from './lib/provenance.mjs';

const CACHE_INDEX = 'sha256.txt';

function parseArgs(argv) {
  const only = [];
  let i = 2;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--only') only.push(argv[++i]);
    else if (a === '--verify-only' || a === '--pin') {
      /* handled by caller through argv membership */
    } else if (a !== '--cache') {
      throw new Error(`Unknown argument: ${a}`);
    } else i += 2;
    i++;
  }
  return { only, verifyOnly: argv.includes('--verify-only'), pin: argv.includes('--pin') };
}

/** One download entry -> the cache file it must produce. */
async function materialise(entry, cacheDir) {
  const target = path.join(cacheDir, entry.cacheFile);
  const fetch = entry.fetch;
  switch (fetch.kind) {
    case 'url': {
      log(`  downloading ${fetch.url}`);
      download(fetch.url, target);
      return target;
    }
    case 'archive-member': {
      const archive = path.join(cacheDir, `${entry.cacheFile}.archive`);
      log(`  downloading ${fetch.url} (member ${fetch.member})`);
      download(fetch.url, archive);
      if (fetch.archiveSha256) {
        const digest = await sha256File(archive);
        if (digest !== fetch.archiveSha256) {
          fs.rmSync(archive, { force: true });
          throw new Error(
            `${entry.cacheFile}: archive checksum mismatch\n  expected ${fetch.archiveSha256}\n  actual   ${digest}\n` +
              `  The upstream URL serves the current release, so the release changed. Review the new\n` +
              `  version in provenance.json and re-pin with --pin if the change is intended.`
          );
        }
      }
      const { stream } = unzipMemberStream(archive, fetch.member);
      await streamToFile(stream, target);
      fs.rmSync(archive, { force: true });
      return target;
    }
    case 'npm-tarball': {
      log(`  npm pack ${fetch.pkg}@${fetch.version}`);
      const tarball = npmPack(fetch.pkg, fetch.version, cacheDir);
      const renamed = path.join(cacheDir, entry.cacheFile);
      if (tarball !== renamed) fs.renameSync(tarball, renamed);
      const extract = entry.extract;
      if (extract) {
        const into = path.join(cacheDir, extract.into);
        fs.rmSync(into, { recursive: true, force: true });
        extractTarGz(renamed, cacheDir);
        if (!exists(into)) throw new Error(`expected ${into} after extracting ${entry.cacheFile}`);
        if (extract.expectedCharFiles) {
          const dir = path.join(cacheDir, extract.expectedDir);
          const count = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length;
          if (count !== extract.expectedCharFiles) {
            throw new Error(
              `${entry.cacheFile}: ${extract.expectedDir} holds ${count} json files, expected ${extract.expectedCharFiles}`
            );
          }
        }
      }
      return renamed;
    }
    default:
      throw new Error(`${entry.cacheFile}: unknown fetch kind ${fetch.kind}`);
  }
}

async function main() {
  const argv = process.argv;
  const { only, verifyOnly, pin } = parseArgs(argv);
  const cacheDir = resolveCacheDir(argv);
  await ensureDir(cacheDir);

  const reg = loadProvenance();
  const rows = cacheExpectations(reg).filter((r) => !only.length || only.includes(r.source));
  if (!rows.length) throw new Error(`Nothing to do for ${only.join(', ') || '(no sources)'}`);

  const report = [];
  const rePinned = [];

  for (const row of rows) {
    const target = path.join(cacheDir, row.cacheFile);
    const have = exists(target);
    let digest = have ? await sha256File(target) : null;

    if (have && digest === row.sha256) {
      report.push({ file: row.cacheFile, state: 'verified', bytes: formatBytes(row.bytes) });
      continue;
    }

    if (verifyOnly) {
      throw new Error(
        `--verify-only: ${row.cacheFile} is ${have ? 'corrupt' : 'missing'} in ${cacheDir}\n` +
          `  expected ${row.sha256}\n  actual   ${digest ?? 'n/a'}\n` +
          `  Run without --verify-only to fetch it, or check the pin in provenance.json.`
      );
    }

    log(`${row.source}: fetching ${row.cacheFile}`);
    await materialise(row, cacheDir);
    digest = await sha256File(target);
    const bytes = fs.statSync(target).size;

    if (row.sha256 && digest !== row.sha256) {
      if (!pin) {
        throw new Error(
          `${row.cacheFile}: fresh download does not match the pinned sha256\n` +
            `  pinned ${row.sha256}\n  got    ${digest}\n` +
            `  Upstream content changed. Verify the new release, update provenance.json, or re-pin with --pin.`
        );
      }
      rePinned.push({ cacheFile: row.cacheFile, sha256: digest, bytes });
      report.push({ file: row.cacheFile, state: 'RE-PINNED', bytes: formatBytes(bytes) });
      continue;
    }
    if (!row.sha256) rePinned.push({ cacheFile: row.cacheFile, sha256: digest, bytes });
    report.push({ file: row.cacheFile, state: 'downloaded', bytes: formatBytes(bytes) });
  }

  if (rePinned.length) {
    if (!pin) throw new Error('internal: re-pin requested without --pin');
    let changed = 0;
    for (const src of reg.sources) {
      for (const dl of src.downloads || []) {
        const fresh = rePinned.find((r) => r.cacheFile === dl.cacheFile);
        if (!fresh) continue;
        if (dl.sha256 !== fresh.sha256 || dl.bytes !== fresh.bytes) {
          dl.sha256 = fresh.sha256;
          dl.bytes = fresh.bytes;
          changed++;
        }
      }
    }
    if (changed) {
      const doc = { ...reg.doc };
      fs.writeFileSync(PROVENANCE_PATH, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
      log(`\nre-pinned ${changed} download entry/entries in provenance.json (review the diff).`);
    }
  }

  const index = [];
  for (const f of fs.readdirSync(cacheDir)) {
    const full = path.join(cacheDir, f);
    if (!fs.statSync(full).isFile() || f === CACHE_INDEX) continue;
    index.push(`${await sha256File(full)} *${f}`);
  }
  fs.writeFileSync(path.join(cacheDir, CACHE_INDEX), `${index.sort().join('\n')}\n`, 'utf8');

  log(`\ncache ${cacheDir}`);
  log(table(report.map((r) => ({ ...r })), [
    ['cache file', 'file'],
    ['state', 'state'],
    ['size', 'bytes'],
  ]));
  log(`\n${report.length} cache entries, ${report.filter((r) => r.state === 'verified').length} already pinned and verified.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

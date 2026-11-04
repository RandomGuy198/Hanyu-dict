/**
 * Decompression helpers for the raw cache.
 *
 * Preference order, as required by the build notes: system binaries first
 * (bzip2 / unzip ship with Git Bash and with CI Linux images), Node libraries
 * only as a fallback so the pipeline also runs where no binary exists.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const require = createRequire(import.meta.url);

const availability = new Map();

export function binaryAvailable(name) {
  if (availability.has(name)) return availability.get(name);
  let ok = false;
  try {
    const r = spawnSync(name, ['--version'], { stdio: 'ignore', windowsHide: true });
    ok = !r.error;
  } catch {
    ok = false;
  }
  availability.set(name, ok);
  return ok;
}

export function isBsdtar() {
  if (availability.has('__bsdtar')) return availability.get('__bsdtar');
  let ok = false;
  if (binaryAvailable('tar')) {
    const r = spawnSync('tar', ['--version'], { encoding: 'utf8', windowsHide: true });
    ok = /bsdtar/i.test(r.stdout || '');
  }
  availability.set('__bsdtar', ok);
  return ok;
}

/** Spawn a command and expose stdout as a Readable that rejects on failure. */
function spawnReadable(cmd, args, { stderrMirror = false } = {}) {
  const out = new PassThrough();
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let err = '';
  child.stdout.pipe(out);
  child.stderr.on('data', (b) => {
    err += b.toString('utf8');
    if (stderrMirror) process.stderr.write(b);
  });
  child.on('error', (e) => out.destroy(e));
  child.on('close', (code) => {
    if (code === 0) {
      out.end();
    } else {
      out.destroy(new Error(`${cmd} ${args.join(' ')} failed (exit ${code}): ${err.slice(0, 400)}`));
    }
  });
  return out;
}

/**
 * Readable byte stream of a decompressed .bz2 file.
 * Set HANYU_NODE_BZ2=1 to force the pure-Node fallback (used by the test suite).
 */
export function openBz2(file) {
  const forceNode = process.env.HANYU_NODE_BZ2 === '1';
  if (!forceNode && binaryAvailable('bzip2')) {
    return { stream: spawnReadable('bzip2', ['-dc', file]), impl: 'bzip2' };
  }
  if (!forceNode && isBsdtar()) {
    return { stream: spawnReadable('tar', ['-xf', file, '--to-stdout']), impl: 'bsdtar' };
  }
  const unbzip2 = requireUnbzip2();
  return { stream: fs.createReadStream(file).pipe(unbzip2()), impl: 'unbzip2-stream' };
}

let unbzip2Factory;
function requireUnbzip2() {
  if (unbzip2Factory) return unbzip2Factory;
  try {
    const mod = require('unbzip2-stream');
    unbzip2Factory = mod.default ?? mod;
    return unbzip2Factory;
  } catch (e) {
    throw new Error(
      'No bzip2 backend available: install the system bzip2 binary or add the unbzip2-stream devDependency ' +
        `(tried unbzip2-stream: ${e.message})`
    );
  }
}

/** TSV lines of a (possibly .bz2 compressed) file, as async iterator. */
export async function* tsvLines(file) {
  const isBz2 = file.endsWith('.bz2');
  const stream = isBz2 ? openBz2(file).stream : fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) yield line;
  } finally {
    rl.close();
    if (!stream.destroyed) stream.destroy();
  }
}

/** Which bzip2 backend would be used right now (for reporting). */
export function bz2Backend() {
  if (process.env.HANYU_NODE_BZ2 === '1') return 'unbzip2-stream';
  if (binaryAvailable('bzip2')) return 'bzip2';
  if (isBsdtar()) return 'bsdtar';
  return 'unbzip2-stream';
}

/** Whole member of a zip file as a UTF-8 string. */
export function unzipMemberText(zipPath, member) {
  if (binaryAvailable('unzip')) {
    const r = spawnSync('unzip', ['-p', zipPath, member], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
    });
    if (r.status !== 0) throw new Error(`unzip -p ${zipPath} ${member} failed: ${r.stderr}`);
    return r.stdout;
  }
  if (isBsdtar()) {
    const r = spawnSync('tar', ['-xf', zipPath, '--to-stdout', member], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
    });
    if (r.status !== 0) throw new Error(`bsdtar ${zipPath} ${member} failed: ${r.stderr}`);
    return r.stdout;
  }
  throw new Error('No zip reader available: install unzip (Git Bash / CI image provides it)');
}

/** Streaming reader for a zip member (used for the largest Unihan files). */
export function unzipMemberStream(zipPath, member) {
  if (binaryAvailable('unzip')) return { stream: spawnReadable('unzip', ['-p', zipPath, member]), impl: 'unzip' };
  if (isBsdtar())
    return { stream: spawnReadable('tar', ['-xf', zipPath, '--to-stdout', member]), impl: 'bsdtar' };
  throw new Error('No zip reader available: install unzip');
}

export function listZipMembers(zipPath) {
  if (binaryAvailable('unzip')) {
    const r = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`unzip -Z1 failed: ${r.stderr}`);
    return r.stdout.split(/\r?\n/).filter(Boolean);
  }
  if (isBsdtar()) {
    const r = spawnSync('tar', ['-tf', zipPath], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new Error(`bsdtar -tf failed: ${r.stderr}`);
    return r.stdout.split(/\r?\n/).filter(Boolean);
  }
  throw new Error('No zip reader available: install unzip');
}

/** Extract a .tar(.gz) into destDir. */
export function extractTarGz(tgzPath, destDir) {
  if (!binaryAvailable('tar')) throw new Error('tar is required to unpack ' + path.basename(tgzPath));
  fs.mkdirSync(destDir, { recursive: true });
  const r = spawnSync('tar', ['-xf', tgzPath, '-C', destDir], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`tar -xf ${tgzPath} failed: ${r.stderr}`);
  return destDir;
}

/** Download a URL with curl into a destination path. */
export function download(url, dest, { timeoutSec = 900 } = {}) {
  if (!binaryAvailable('curl')) throw new Error('curl is required to download sources');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const args = ['--fail', '--location', '--silent', '--show-error', '--max-time', String(timeoutSec), '--output', dest, url];
  const r = spawnSync('curl', args, { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`curl failed for ${url}: ${(r.stderr || '').slice(0, 300)}`);
  return dest;
}

/** npm pack a package version into destDir, returning the tarball path. */
export function npmPack(pkg, version, destDir) {
  const r = spawnSync('npm', ['pack', `${pkg}@${version}`, '--pack-destination', destDir], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`npm pack ${pkg}@${version} failed: ${r.stderr || r.stdout}`);
  const name = (r.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop();
  return path.join(destDir, name);
}

export async function streamToFile(stream, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await pipeline(stream, fs.createWriteStream(dest));
  return dest;
}

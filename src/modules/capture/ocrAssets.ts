/** The same-origin OCR assets produced by the build pipeline under `public/data/ocr`.
 *
 *  `ocr/manifest.json` is the source of truth for what recognition costs in bytes: the UI
 *  reads it *before* anything is downloaded, so the opt-in is honest. Nothing here contacts
 *  a third-party host — every URL is built through `dataUrl()`, the same helper the pack
 *  installer uses, so the app also works under a GitHub Pages repo path.
 */

import { dataUrl } from '../../data/packs';

export interface OcrFileRef {
  path: string;
  bytes: number;
  sha256: string;
}

export interface OcrManifest {
  generatedAt: string;
  files: OcrFileRef[];
}

export type OcrAssets =
  | { kind: 'checking' }
  | { kind: 'missing'; reason: string }
  | { kind: 'present'; manifest: OcrManifest; totalBytes: number; groups: OcrGroup[] };

/** Display grouping so the cost breakdown reads as "engine / models" instead of filenames. */
export interface OcrGroup {
  label: string;
  detail: string;
  bytes: number;
}

/** `./data/ocr`, `./data/ocr/lang/chi_sim.traineddata.gz` — relative to the deployed directory. */
export function assetUrl(relative = ''): string {
  const tail = relative.replace(/^\/+/, '');
  return dataUrl(tail ? `ocr/${tail}` : 'ocr');
}

/** Paths tesseract.js needs. `corePath` is a directory on purpose: the library picks
 *  `tesseract-core-simd-lstm.wasm.js` or `tesseract-core-lstm.wasm.js` per CPU. */
export function ocrPaths(): { workerPath: string; corePath: string; langPath: string } {
  return {
    workerPath: assetUrl('worker.min.js'),
    corePath: assetUrl(),
    langPath: assetUrl('lang'),
  };
}

function isFileRef(value: unknown): value is OcrFileRef {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.path === 'string' &&
    record.path.length > 0 &&
    !record.path.includes('..') &&
    !/^[a-z]+:/i.test(record.path) &&
    typeof record.bytes === 'number' &&
    Number.isFinite(record.bytes) &&
    record.bytes >= 0 &&
    typeof record.sha256 === 'string'
  );
}

/** Hand validation: the manifest is untrusted text, and only the listed paths are ever used.
 *  The pipeline groups the files as `runtime` (engine scripts) and `models` (traineddata), so
 *  both lists are flattened into one file set for the cost breakdown. */
export function parseOcrManifest(input: unknown): OcrManifest | null {
  if (typeof input !== 'object' || input === null) return null;
  const record = input as Record<string, unknown>;
  if (typeof record.generatedAt !== 'string') return null;
  const listed = [...toRefs(record.runtime), ...toRefs(record.models)];
  const files = listed.filter(isFileRef);
  if (files.length === 0 || files.length !== listed.length) return null;
  return { generatedAt: record.generatedAt, files };
}

function toRefs(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

const GROUP_RULES: { match: (path: string) => boolean; label: string; detail: string }[] = [
  {
    match: (path) => path.endsWith('worker.min.js'),
    label: 'Recognition engine (worker script)',
    detail: 'Apache-2.0, ships with this build',
  },
  {
    match: (path) => path.includes('tesseract-core'),
    label: 'Recognition core (WebAssembly)',
    detail: 'runs in its own thread, never on the page',
  },
  {
    match: (path) => path.endsWith('.traineddata.gz'),
    label: 'Language models',
    detail: 'Simplified Chinese + English',
  },
];

export function groupFiles(files: OcrFileRef[]): OcrGroup[] {
  const groups: OcrGroup[] = [];
  for (const rule of GROUP_RULES) {
    const matched = files.filter((file) => rule.match(file.path));
    if (matched.length === 0) continue;
    groups.push({
      label: rule.label,
      detail: `${rule.detail} — ${matched.length} file${matched.length === 1 ? '' : 's'}`,
      bytes: matched.reduce((sum, file) => sum + file.bytes, 0),
    });
  }
  const covered = new Set(GROUP_RULES.map((rule) => files.filter((f) => rule.match(f.path))).flat());
  const other = files.filter((file) => !covered.has(file));
  if (other.length > 0) {
    groups.push({
      label: 'Other bundled files',
      detail: 'same-origin, part of this build',
      bytes: other.reduce((sum, file) => sum + file.bytes, 0),
    });
  }
  return groups;
}

/** Fetch the manifest. A failure is a designed state, not a crash: OCR is simply unavailable. */
export async function probeOcrAssets(): Promise<OcrAssets> {
  try {
    const response = await fetch(assetUrl('manifest.json'), { cache: 'default' });
    if (!response.ok) {
      return {
        kind: 'missing',
        reason: `OCR assets are not present in this build (manifest request returned ${response.status}).`,
      };
    }
    const manifest = parseOcrManifest(await response.json());
    if (!manifest) {
      return {
        kind: 'missing',
        reason: 'OCR assets are not present in this build: the manifest could not be read.',
      };
    }
    const expected = ['worker.min.js', 'chi_sim.traineddata.gz', 'eng.traineddata.gz'];
    const absent = expected.filter((name) => !manifest.files.some((file) => file.path.endsWith(name)));
    if (absent.length > 0) {
      return {
        kind: 'missing',
        reason: `OCR assets are not present in this build: ${absent.join(', ')} is missing from the manifest.`,
      };
    }
    return {
      kind: 'present',
      manifest,
      totalBytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0),
      groups: groupFiles(manifest.files),
    };
  } catch (error) {
    return {
      kind: 'missing',
      reason: `OCR assets are not present in this build (${error instanceof Error ? error.message : 'fetch failed'}).`,
    };
  }
}

/** Rough headroom check so a 1 GB phone is not asked to decode a 4000-pixel photo. */
export function deviceMemoryGiB(): number | null {
  const value = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function isLowMemory(): boolean {
  const memory = deviceMemoryGiB();
  return memory !== null && memory <= 2;
}

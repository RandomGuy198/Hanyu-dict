/** pdfjs-dist v4.10 behind a lazy boundary.
 *
 *  The library is only imported when a PDF is actually opened, so the reading desk stays small
 *  for text-only readers. The worker file is the one Vite emits from `pdfjs-dist` itself —
 *  same-origin, no CDN, no build-time network call.
 */

import type { PDFDocumentProxy } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export type Pdfjs = typeof import('pdfjs-dist');

let pending: Promise<Pdfjs> | null = null;

export function loadPdfjs(): Promise<Pdfjs> {
  if (!pending) {
    pending = import('pdfjs-dist')
      .then((mod) => {
        mod.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        return mod;
      })
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}

/** Above this, decoding on a phone is likely to fail or exhaust memory. */
export const MAX_PDF_BYTES = 40 * 1024 * 1024;
/** Pages sampled when measuring how much text a PDF actually carries. */
export const TEXT_SAMPLE_PAGES = 20;

export interface PdfProblem {
  title: string;
  detail: string;
  needsPassword: boolean;
}

const PROBLEMS: Record<string, PdfProblem> = {
  PasswordException: {
    title: 'This PDF is password-protected',
    detail: 'Enter the document password to open it, or leave it closed — the file is never sent anywhere.',
    needsPassword: true,
  },
  InvalidPDFException: {
    title: 'This PDF could not be read',
    detail: 'The file is damaged or is not a PDF. The bytes were examined locally and rejected.',
    needsPassword: false,
  },
  MissingPDFException: {
    title: 'The PDF is no longer reachable',
    detail: 'The stored copy of this document is missing from this device.',
    needsPassword: false,
  },
  UnexpectedResponseException: {
    title: 'The PDF could not be loaded',
    detail: 'Reading the local file stopped part-way through. Try opening it again.',
    needsPassword: false,
  },
};

/** pdfjs raises subclasses of `Error` with a stable `name`, so no cast is needed here. */
export function describePdfProblem(error: unknown): PdfProblem {
  const name = error instanceof Error ? error.name : '';
  const known = PROBLEMS[name];
  if (known) return known;
  return {
    title: 'This PDF is not supported here',
    detail: `${error instanceof Error ? error.message : String(error)}. Nothing was uploaded while trying.`,
    needsPassword: false,
  };
}

export function isRenderCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === 'RenderingCancelledException';
}

/** Honest caution before opening: `navigator.deviceMemory` is a coarse, capped hint. */
export function pdfMemoryCaution(bytes: number): string | null {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof memory !== 'number' || !Number.isFinite(memory)) return null;
  if (memory > 2) return null;
  if (bytes < 5 * 1024 * 1024) return null;
  return `This device reports ${memory} GB of memory and the file is ${Math.round(bytes / 1024 / 1024)} MB — pages may render slowly or fail. Close other apps if it stalls.`;
}

export async function openPdf(bytes: Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const mod = await loadPdfjs();
  const task = mod.getDocument({
    data: bytes,
    password: password || undefined,
    // A local file needs no range requests, and disabling them keeps the whole doc on-device.
    disableAutoFetch: false,
    isEvalSupported: false,
    verbosity: 0,
  });
  return task.promise;
}

export interface PageBox {
  width: number;
  height: number;
}

export async function pageSize(doc: PDFDocumentProxy, pageNumber: number, scale: number): Promise<PageBox> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  page.cleanup();
  return { width: Math.round(viewport.width), height: Math.round(viewport.height) };
}

/** One page: canvas first, then the text layer on top of it, so native selection works.
 *  `registerCancel` receives a canceller so an off-screen page cannot keep the thread busy. */
export async function drawPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  layer: HTMLDivElement,
  scale: number,
  registerCancel?: (cancel: () => void) => void,
): Promise<{ hasText: boolean; chars: number }> {
  const mod = await loadPdfjs();
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const context = canvas.getContext('2d');
  if (!context) {
    page.cleanup();
    throw new Error('This browser cannot draw to a canvas.');
  }
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  layer.replaceChildren();
  const render = page.render({ canvasContext: context, viewport });
  registerCancel?.(() => render.cancel());
  try {
    await render.promise;
  } finally {
    registerCancel?.(() => undefined);
  }

  const content = await page.getTextContent();
  const chars = content.items.reduce((sum, item) => sum + ('str' in item ? item.str.length : 0), 0);
  if (chars > 0) {
    // pdf.js sizes its text runs from this custom property; set imperatively to avoid a cast.
    layer.style.setProperty('--scale-factor', String(viewport.scale));
    const textLayer = new mod.TextLayer({ textContentSource: content, container: layer, viewport });
    await textLayer.render();
  }
  page.cleanup();
  return { hasText: chars > 0, chars };
}

export function releaseTextLayer(): void {
  void import('pdfjs-dist')
    .then((mod) => {
      mod.TextLayer.cleanup();
    })
    .catch(() => undefined);
}

export interface TextSample {
  text: string;
  chars: number;
  pagesSampled: number;
  truncated: boolean;
}

/** Extract text from the first pages of a PDF — enough for an honest coverage readout
 *  without holding a 400-page book in memory. */
export async function sampleText(doc: PDFDocumentProxy, maxPages = TEXT_SAMPLE_PAGES): Promise<TextSample> {
  const limit = Math.min(doc.numPages, maxPages);
  const parts: string[] = [];
  for (let pageNumber = 1; pageNumber <= limit; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    parts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(''));
    page.cleanup();
  }
  const text = parts.join('\n');
  return {
    text,
    chars: text.replace(/\s+/g, '').length,
    pagesSampled: limit,
    truncated: doc.numPages > limit,
  };
}

export async function closePdf(doc: PDFDocumentProxy | null): Promise<void> {
  if (!doc) return;
  try {
    await doc.cleanup();
    await doc.destroy();
  } catch (error) {
    console.error('pdf.js cleanup reported:', error);
  }
}

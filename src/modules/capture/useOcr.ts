/** tesseract.js v5 driven from React.
 *
 *  Recognition runs in tesseract's own worker thread, so the page never freezes; the only
 *  main-thread work is copying progress messages into state (throttled). Every path is
 *  same-origin (`ocrPaths()`), the engine is only loaded after an explicit opt-in, and
 *  `cancel()` really terminates the worker.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createWorker, OEM } from 'tesseract.js';
import { ocrPaths } from './ocrAssets';

type TessWorker = Awaited<ReturnType<typeof createWorker>>;

export type OcrPhase = 'idle' | 'loading' | 'ready' | 'running' | 'done' | 'cancelled' | 'failed';

export interface OcrState {
  phase: OcrPhase;
  /** Human sentence for the live region, e.g. "Downloading the language models". */
  label: string;
  /** 0..100 within the current phase. */
  percent: number;
  error: string | null;
  /** True once the models are on this device (tesseract caches them itself). */
  loaded: boolean;
}

export interface OcrOutcome {
  text: string;
  /** tesseract's own word-level confidence, 0..100; shown to the user, never hidden. */
  confidence: number;
}

const INITIAL: OcrState = { phase: 'idle', label: 'Recognition has not run yet.', percent: 0, error: null, loaded: false };

const STATUS_TEXT: Record<string, string> = {
  'loading tesseract core': 'Loading the recognition engine',
  'initializing tesseract': 'Starting the recognition engine',
  'loading language traineddata': 'Loading the language models',
  'initializing api': 'Preparing the language models',
  'recognizing text': 'Reading the image',
};

function statusLabel(status: string): string {
  return STATUS_TEXT[status] ?? status.replace(/-/g, ' ');
}

export function useOcr() {
  const [state, setState] = useState<OcrState>(INITIAL);
  const workerRef = useRef<TessWorker | null>(null);
  // the pending promise resolves to null when the generation changed or startup failed
  const startingRef = useRef<Promise<TessWorker | null> | null>(null);
  const generationRef = useRef(0);
  const lastTickRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      const worker = workerRef.current;
      workerRef.current = null;
      void worker?.terminate();
    };
  }, []);

  const report = useCallback((patch: Partial<OcrState>) => {
    if (!mountedRef.current) return;
    setState((current) => ({ ...current, ...patch }));
  }, []);

  /** Load engine + models inside a worker. Returns null when it failed or was cancelled. */
  const start = useCallback((): Promise<TessWorker | null> => {
    if (workerRef.current) return Promise.resolve(workerRef.current);
    if (startingRef.current) return startingRef.current;

    const generation = generationRef.current;
    const pending = createWorker('chi_sim+eng', OEM.LSTM_ONLY, {
      ...ocrPaths(),
      gzip: true,
      // A blob-wrapped worker would need `script-src blob:` for its importScripts call;
      // loading the same-origin file directly matches this app's content policy.
      workerBlobURL: false,
      logger: (message) => {
        if (generationRef.current !== generation) return;
        const now = Date.now();
        const recognizing = message.status === 'recognizing text';
        if (!recognizing && now - lastTickRef.current < 80) return;
        lastTickRef.current = now;
        setState((current) => ({
          ...current,
          phase: recognizing ? 'running' : 'loading',
          label: statusLabel(message.status),
          percent: Math.round(Math.min(1, Math.max(0, message.progress)) * 100),
        }));
      },
      errorHandler: (failure: unknown) => {
        if (generationRef.current !== generation) return;
        report({
          phase: 'failed',
          error: failure instanceof Error ? failure.message : String(failure),
        });
      },
    })
      .then((worker) => {
        startingRef.current = null;
        if (generationRef.current !== generation) {
          void worker.terminate();
          return null;
        }
        workerRef.current = worker;
        setState((current) => ({
          ...current,
          phase: 'ready',
          label: 'Recognition is ready on this device.',
          percent: 100,
          loaded: true,
          error: null,
        }));
        return worker;
      })
      .catch((error: unknown) => {
        startingRef.current = null;
        if (generationRef.current !== generation) return null;
        workerRef.current = null;
        report({
          phase: 'failed',
          label: 'Recognition could not be started.',
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });

    startingRef.current = pending;
    return pending;
  }, [report]);

  const recognize = useCallback(
    async (image: Blob | HTMLCanvasElement): Promise<OcrOutcome | null> => {
      const worker = await start();
      if (!worker) return null;
      const generation = generationRef.current;
      report({ phase: 'running', label: 'Reading the image', percent: 0, error: null });
      try {
        const result = await worker.recognize(image, {}, {
          text: true,
          blocks: false,
          layoutBlocks: false,
          hocr: false,
          tsv: false,
          box: false,
          unlv: false,
          osd: false,
          pdf: false,
          imageColor: false,
          imageGrey: false,
          imageBinary: false,
          debug: false,
        });
        if (generationRef.current !== generation) return null;
        const text = result.data.text ?? '';
        report({
          phase: 'done',
          label: text.trim() ? 'Recognition finished — check the text before looking words up.' : 'Recognition finished with no readable text.',
          percent: 100,
        });
        return { text, confidence: Math.round(result.data.confidence ?? 0) };
      } catch (error) {
        if (generationRef.current !== generation) return null;
        report({
          phase: 'failed',
          label: 'Recognition failed.',
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    [report, start],
  );

  /** Terminate the worker mid-flight. tesseract.js v5 has no in-job cancel, so the only
   *  honest stop is tearing the thread down; the pending promise is simply abandoned. */
  const cancel = useCallback(() => {
    generationRef.current += 1;
    startingRef.current = null;
    const worker = workerRef.current;
    workerRef.current = null;
    void worker?.terminate();
    report({
      phase: 'cancelled',
      label: 'Recognition cancelled. Nothing was saved from that attempt.',
      percent: 0,
      error: null,
    });
  }, [report]);

  const reset = useCallback(() => {
    report({ ...INITIAL, loaded: workerRef.current !== null });
  }, [report]);

  const forget = useCallback(() => {
    generationRef.current += 1;
    startingRef.current = null;
    const worker = workerRef.current;
    workerRef.current = null;
    void worker?.terminate();
    setState({ ...INITIAL, loaded: false, label: 'Recognition engine released from this session.' });
  }, []);

  return { state, start, recognize, cancel, reset, forget };
}

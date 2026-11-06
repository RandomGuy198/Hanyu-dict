/**
 * Unified audio player (`src/data/audioPlayer.ts`) for Hanyu v0.2.
 *
 * Playback hierarchy (D-08, D-10):
 * 1. Contextual Lesson Recording Slice (`lesson-slice`): plays exact `[startMs, endMs]` slice
 *    from the original lesson MP3 in `Hanyu-data`.
 * 2. Standalone TTS MP3 (`tts-file`): plays pre-generated static MP3 from `Hanyu-data/audio/tts/`.
 * 3. Device Speech Synthesis (`web-speech`): last-resort fallback when `Hanyu-data` is disconnected
 *    or the requested item has no pre-generated audio file.
 */

import { getAudioBlob, getAudioManifest } from './privateData';
import { speak, stopSpeaking } from './speech';
import type { AudioSliceRef, LessonSentence } from '../domain/types';

export type AudioSourceKind = 'lesson-slice' | 'tts-file' | 'web-speech' | 'none';

export interface PlayAudioResult {
  ok: boolean;
  source: AudioSourceKind;
  reason?: string;
}

let activeAudio: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let activeTimer: ReturnType<typeof setTimeout> | null = null;
let activeFinish: ((result: PlayAudioResult) => void) | null = null;
let activeSource: AudioBufferSourceNode | null = null;
let audioCtx: AudioContext | null = null;
const decodedBuffers = new Map<string, Promise<AudioBuffer>>();

function cleanupActiveAudio(): void {
  if (activeTimer) {
    clearTimeout(activeTimer);
    activeTimer = null;
  }
  if (activeAudio) {
    try {
      activeAudio.pause();
    } catch {
      // Ignore pause errors in headless/jsdom environments
    }
    activeAudio.onended = null;
    activeAudio.onerror = null;
    activeAudio.ontimeupdate = null;
    activeAudio = null;
  }
  if (activeObjectUrl) {
    try {
      URL.revokeObjectURL(activeObjectUrl);
    } catch {
      // Ignore
    }
    activeObjectUrl = null;
  }
  if (activeSource) {
    try {
      activeSource.onended = null;
      activeSource.stop();
    } catch {
      // Ignore stop errors in headless environments
    }
    activeSource = null;
  }
  if (activeFinish) {
    const finish = activeFinish;
    activeFinish = null;
    finish({ ok: true, source: 'none' });
  }
}

export function stopAudio(): void {
  cleanupActiveAudio();
  stopSpeaking();
}

export function getActiveAudioElement(): HTMLAudioElement | null {
  return activeAudio;
}

function getAudioContext(): AudioContext {
  if (!audioCtx) {
    const g = globalThis as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio is not supported on this device.');
    audioCtx = new Ctor();
  }
  return audioCtx;
}

/** Decode a lesson recording once and reuse the buffer, so repeated sentence clicks in the same
 *  lesson don't re-download or re-decode the MP3. Keyed by the private-repo path. */
async function decodeLessonBuffer(key: string, blob: Blob): Promise<AudioBuffer> {
  const hit = decodedBuffers.get(key);
  if (hit) return hit;
  const ctx = getAudioContext();
  const bytes = await blob.arrayBuffer();
  const pending = ctx.decodeAudioData(bytes.slice(0));
  decodedBuffers.set(key, pending);
  pending.catch(() => decodedBuffers.delete(key));
  return pending;
}

/**
 * Play an exact `[startSec, endSec]` range from a decoded buffer via Web Audio. This is
 * sample-accurate and does not depend on `HTMLAudioElement.currentTime` seeking, which Firefox
 * and Safari silently drop on blob MP3s — the reason slices replayed from 0 there.
 */
function playBufferRange(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  playbackRate: number,
): Promise<PlayAudioResult> {
  const ctx = getAudioContext();
  const rate = playbackRate > 0 ? playbackRate : 1;
  return new Promise<PlayAudioResult>((resolve) => {
    let settled = false;
    let guard: ReturnType<typeof setTimeout> | null = null;
    const src = ctx.createBufferSource();
    const finish = (result: PlayAudioResult) => {
      if (settled) return;
      settled = true;
      if (guard) {
        clearTimeout(guard);
        guard = null;
      }
      if (activeSource === src) {
        try {
          src.onended = null;
        } catch {
          // Ignore
        }
        activeSource = null;
      }
      if (activeFinish === finish) activeFinish = null;
      resolve(result);
    };
    activeFinish = finish;
    src.buffer = buffer;
    src.playbackRate.value = rate;
    src.connect(ctx.destination);
    src.onended = () => finish({ ok: true, source: 'lesson-slice' });
    activeSource = src;
    const duration = Math.max(0.001, endSec - startSec);
    guard = setTimeout(() => finish({ ok: true, source: 'lesson-slice' }), (duration / rate) * 1000 + 1500);
    const begin = () => {
      if (settled) return;
      try {
        src.start(0, startSec, duration);
      } catch (err) {
        finish({
          ok: false,
          source: 'lesson-slice',
          reason: err instanceof Error ? err.message : 'Audio playback failed.',
        });
      }
    };
    if (ctx.state === 'suspended') ctx.resume().then(begin).catch(begin);
    else begin();
  });
}

async function sha1HexPrefix16(text: string): Promise<string> {
  const normalized = text.trim().normalize('NFC');
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = new TextEncoder().encode(normalized);
    const digest = await crypto.subtle.digest('SHA-1', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
  }
  return '';
}

/** Resolve when `el` fires `name`, or after `timeoutMs` — whichever comes first. Keeps the
 *  seek-before-play bootstrap from hanging where media events never arrive (headless/jsdom). */
function once(el: HTMLAudioElement, name: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const handler = () => {
      clearTimeout(timer);
      el.removeEventListener(name, handler);
      resolve();
    };
    const timer = setTimeout(handler, timeoutMs);
    el.addEventListener(name, handler);
  });
}

function playBlobSliceOrFull(
  blob: Blob,
  sourceKind: 'lesson-slice' | 'tts-file',
  playbackRate = 1.0,
  slice?: { startMs: number; endMs: number },
): Promise<PlayAudioResult> {
  stopAudio();

  return new Promise<PlayAudioResult>((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    activeAudio = audio;
    activeObjectUrl = url;
    audio.playbackRate = playbackRate > 0 ? playbackRate : 1.0;

    let settled = false;
    const finish = (result: PlayAudioResult) => {
      if (settled) return;
      settled = true;
      if (activeTimer) {
        clearTimeout(activeTimer);
        activeTimer = null;
      }
      if (activeAudio === audio) {
        try {
          audio.pause();
        } catch {
          // Ignore
        }
        activeAudio = null;
      }
      if (activeObjectUrl === url) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore
        }
        activeObjectUrl = null;
      }
      if (activeFinish === finish) {
        activeFinish = null;
      }
      resolve(result);
    };

    activeFinish = finish;

    const startSec = slice ? Math.max(0, slice.startMs / 1000) : 0;
    const endSec = slice ? Math.max(startSec, slice.endMs / 1000) : undefined;
    const rate = audio.playbackRate;
    audio.preload = 'auto';

    audio.onended = () => {
      finish({ ok: true, source: sourceKind });
    };

    audio.onerror = () => {
      finish({
        ok: false,
        source: sourceKind,
        reason: 'Could not decode or play audio file.',
      });
    };

    if (endSec !== undefined) {
      audio.ontimeupdate = () => {
        if (audio.currentTime >= endSec) finish({ ok: true, source: sourceKind });
      };
    }

    // Wall-clock backstop so a stuck or undecodable source still settles (and headless tests
    // without a real decoder resolve). Sized generously so it never truncates a real slice.
    const guardMs = slice ? Math.max(20, (slice.endMs - slice.startMs) / rate) + 1500 : 2500;
    activeTimer = setTimeout(() => finish({ ok: true, source: sourceKind }), guardMs);

    // Load metadata, seek to the slice start, and only then start playback. A seek issued
    // before the browser knows the duration is silently dropped — which is exactly what made
    // every slice replay from 0 (the previous sentence) instead of its own range.
    void (async () => {
      await once(audio, 'loadedmetadata', 2000);
      if (settled || activeAudio !== audio) return;
      if (slice) {
        try {
          audio.currentTime = startSec;
        } catch {
          // Ignore
        }
        await once(audio, 'seeked', 1000);
        if (settled || activeAudio !== audio) return;
        if (Math.abs(audio.currentTime - startSec) > 0.02) {
          try {
            audio.currentTime = startSec;
          } catch {
            // Ignore
          }
        }
      }
      try {
        await audio.play();
      } catch (err) {
        finish({
          ok: false,
          source: sourceKind,
          reason: err instanceof Error ? err.message : 'Audio playback failed.',
        });
      }
    })();
  });
}

export async function playLessonSlice(
  slice: AudioSliceRef,
  playbackRate = 1.0,
): Promise<{ ok: boolean; source: 'lesson-slice'; reason?: string }> {
  if (!slice?.audioPath || slice.endMs <= slice.startMs) {
    return {
      ok: false,
      source: 'lesson-slice',
      reason: 'Invalid audio slice range.',
    };
  }
  const blob = await getAudioBlob(slice.audioPath);
  if (!blob) {
    return {
      ok: false,
      source: 'lesson-slice',
      reason: 'Lesson audio file is not available.',
    };
  }
  let res: PlayAudioResult;
  try {
    const buffer = await decodeLessonBuffer(slice.audioPath, blob);
    res = await playBufferRange(buffer, slice.startMs / 1000, slice.endMs / 1000, playbackRate);
  } catch (error) {
    return {
      ok: false,
      source: 'lesson-slice',
      reason: error instanceof Error ? error.message : 'Could not decode lesson audio.',
    };
  }
  return {
    ok: res.ok,
    source: 'lesson-slice',
    ...(res.reason ? { reason: res.reason } : {}),
  };
}

export async function playWordAudio(
  hanzi: string,
  pinyinNumbered?: string,
  fallbackSlice?: AudioSliceRef,
  options?: { rate?: number; lang?: string },
): Promise<PlayAudioResult> {
  const rate = options?.rate ?? 1.0;

  if (fallbackSlice) {
    const sliceRes = await playLessonSlice(fallbackSlice, rate);
    if (sliceRes.ok) return sliceRes;
  }

  const trimmedHanzi = hanzi.trim();
  const manifest = await getAudioManifest();
  if (manifest && trimmedHanzi) {
    const normalizedPinyin = pinyinNumbered?.trim().toLowerCase();
    const compositeKey = normalizedPinyin ? `${trimmedHanzi}|${normalizedPinyin}` : undefined;
    const entry =
      (compositeKey ? manifest.words[compositeKey] : undefined) ?? manifest.words[trimmedHanzi];

    if (entry?.path) {
      const blob = await getAudioBlob(entry.path);
      if (blob) {
        const played = await playBlobSliceOrFull(blob, 'tts-file', rate);
        if (played.ok) return played;
      }
    }
  }

  const speechRes = await speak(trimmedHanzi, {
    lang: options?.lang ?? 'zh-CN',
    rate: options?.rate ?? 0.9,
  });
  return {
    ok: speechRes.ok,
    source: speechRes.ok ? 'web-speech' : 'none',
    ...(speechRes.reason ? { reason: speechRes.reason } : {}),
  };
}

export async function playSentenceAudio(
  sentence: LessonSentence,
  mode: 'context' | 'tts' = 'context',
  playbackRate = 1.0,
): Promise<PlayAudioResult> {
  if (
    mode === 'context' &&
    sentence.lessonAudioSlice &&
    sentence.lessonAudioSlice.confidence >= 0.75
  ) {
    const sliceRes = await playLessonSlice(sentence.lessonAudioSlice, playbackRate);
    if (sliceRes.ok) return sliceRes;
  }

  let ttsPath = sentence.ttsAudioPath?.trim();
  if (!ttsPath && sentence.zh) {
    const manifest = await getAudioManifest();
    if (manifest) {
      const hash = await sha1HexPrefix16(sentence.zh);
      if (hash && manifest.sentences[hash]?.path) {
        ttsPath = manifest.sentences[hash].path;
      }
    }
  }

  if (ttsPath) {
    const blob = await getAudioBlob(ttsPath);
    if (blob) {
      const played = await playBlobSliceOrFull(blob, 'tts-file', playbackRate);
      if (played.ok) return played;
    }
  }

  const speechRes = await speak(sentence.zh, {
    lang: 'zh-CN',
    rate: playbackRate,
  });
  return {
    ok: speechRes.ok,
    source: speechRes.ok ? 'web-speech' : 'none',
    ...(speechRes.reason ? { reason: speechRes.reason } : {}),
  };
}

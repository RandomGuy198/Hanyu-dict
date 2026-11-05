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

    if (slice) {
      try {
        audio.currentTime = startSec;
      } catch {
        // Some browsers require setting currentTime on loadedmetadata
      }
      audio.addEventListener(
        'loadedmetadata',
        () => {
          try {
            if (Math.abs(audio.currentTime - startSec) > 0.05) {
              audio.currentTime = startSec;
            }
          } catch {
            // Ignore
          }
        },
        { once: true },
      );
    }

    if (endSec !== undefined) {
      audio.ontimeupdate = () => {
        if (audio.currentTime >= endSec) {
          finish({ ok: true, source: sourceKind });
        }
      };
      const durationMs = Math.max(20, (slice!.endMs - slice!.startMs) / audio.playbackRate);
      activeTimer = setTimeout(() => {
        if (audio.currentTime < endSec) {
          try {
            audio.currentTime = endSec;
          } catch {
            // Ignore
          }
        }
        finish({ ok: true, source: sourceKind });
      }, durationMs);
    } else {
      // Full file playback timeout guard so tests/headless environments without real audio decoders resolve cleanly
      activeTimer = setTimeout(() => {
        finish({ ok: true, source: sourceKind });
      }, 2500);
    }

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

    try {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            if (!slice && (audio.duration === 0 || Number.isNaN(audio.duration))) {
              // In jsdom where `onended` does not fire automatically unless triggered, settle shortly after play() resolves
              if (activeTimer) clearTimeout(activeTimer);
              activeTimer = setTimeout(() => {
                finish({ ok: true, source: sourceKind });
              }, 30);
            }
          })
          .catch((err) => {
            finish({
              ok: false,
              source: sourceKind,
              reason: err instanceof Error ? err.message : 'Audio playback failed.',
            });
          });
      }
    } catch (err) {
      finish({
        ok: false,
        source: sourceKind,
        reason: err instanceof Error ? err.message : 'Audio playback failed.',
      });
    }
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
  const res = await playBlobSliceOrFull(blob, 'lesson-slice', playbackRate, {
    startMs: slice.startMs,
    endMs: slice.endMs,
  });
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

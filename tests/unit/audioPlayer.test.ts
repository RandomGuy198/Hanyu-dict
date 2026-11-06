/**
 * Unit tests for `src/data/audioPlayer.ts` (09 §3.4).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  playLessonSlice,
  playSentenceAudio,
  playWordAudio,
  stopAudio,
} from '@/data/audioPlayer';
import { db } from '@/data/db';
import { clearGitHubConfig } from '@/data/githubClient';
import * as speechModule from '@/data/speech';
import type { AudioManifest, LessonSentence } from '@/domain/types';

class FakeAudioElement {
  static instances: FakeAudioElement[] = [];

  src: string;
  preload = '';
  playbackRate = 1.0;
  duration = 120;
  paused = true;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeupdate: (() => void) | null = null;

  private _currentTime = 0;
  private listeners: Record<string, Set<() => void>> = {};

  constructor(src = '') {
    this.src = src;
    FakeAudioElement.instances.push(this);
  }

  get currentTime(): number {
    return this._currentTime;
  }

  set currentTime(value: number) {
    this._currentTime = value;
    // Real media elements fire 'seeked' asynchronously once a seek completes.
    setTimeout(() => this.emit('seeked'), 0);
  }

  addEventListener(name: string, cb: () => void): void {
    (this.listeners[name] ??= new Set()).add(cb);
    if (name === 'loadedmetadata') setTimeout(() => cb(), 0);
  }

  removeEventListener(name: string, cb: () => void): void {
    this.listeners[name]?.delete(cb);
  }

  private emit(name: string): void {
    this.listeners[name]?.forEach((cb) => cb());
  }

  play(): Promise<void> {
    this.paused = false;
    const start = this._currentTime;
    setTimeout(() => {
      if (this.paused) return;
      // Advance just past the slice end so ontimeupdate settles, then fire ended.
      this._currentTime = start + 0.05;
      this.ontimeupdate?.();
      this.onended?.();
    }, 10);
    return Promise.resolve();
  }

  pause(): void {
    this.paused = true;
  }
}

describe('audioPlayer (contextual lesson slices, TTS files, and speech fallback)', () => {
  beforeEach(() => {
    stopAudio();
    clearGitHubConfig();
    FakeAudioElement.instances = [];
    vi.stubGlobal('Audio', FakeAudioElement);
    if (typeof URL.createObjectURL !== 'function') {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: vi.fn(() => 'blob:mock-audio-url'),
      });
    } else {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-audio-url');
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: vi.fn(),
      });
    } else {
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    }
  });

  it('playSentenceAudio(sentence, "context") loads lesson MP3 blob and seeks to startMs / 1000, pausing at endMs / 1000', async () => {
    const lessonMp3Bytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]).buffer;
    await db.remoteCache.put({
      path: 'audio/lessons/b1/l02.mp3',
      category: 'audio',
      data: lessonMp3Bytes,
      updatedAt: '2026-11-05T00:00:00.000Z',
    });

    const sentence: LessonSentence = {
      id: 'b1-l02-s01',
      zh: '汉语不太难。',
      pinyin: 'Hànyǔ bú tài nán.',
      pageNumber: 31,
      lessonAudioSlice: {
        audioPath: 'audio/lessons/b1/l02.mp3',
        startMs: 14200,
        endMs: 14230,
        confidence: 0.92,
      },
      ttsAudioPath: 'audio/tts/sentences/aa/aa11.mp3',
      tokens: [],
    };

    const result = await playSentenceAudio(sentence, 'context', 1.0);
    expect(result.ok).toBe(true);
    expect(result.source).toBe('lesson-slice');
    expect(FakeAudioElement.instances).toHaveLength(1);
    const instance = FakeAudioElement.instances[0];
    // Started at 14.2s and paused at or after 14.23s
    expect(instance.currentTime).toBeGreaterThanOrEqual(14.2);
    expect(instance.paused).toBe(true);
  });

  it('playWordAudio("忙", "mang2") resolves "忙|mang2" in audio/manifest.json and plays the TTS MP3 blob', async () => {
    const manifest: AudioManifest = {
      schemaVersion: 1,
      generatedAt: '2026-11-05T00:00:00.000Z',
      defaultVoice: 'voice-zh',
      words: {
        '忙|mang2': {
          path: 'audio/tts/words/3a/3a8f1122.mp3',
          durationMs: 820,
          voice: 'voice-zh',
          engine: 'kokoro',
        },
      },
      sentences: {},
    };

    await db.remoteCache.put({
      path: 'audio/manifest.json',
      category: 'manifest',
      version: manifest.generatedAt,
      data: manifest,
      updatedAt: '2026-11-05T00:00:00.000Z',
    });

    await db.remoteCache.put({
      path: 'audio/tts/words/3a/3a8f1122.mp3',
      category: 'audio',
      data: new Uint8Array([1, 2, 3, 4]).buffer,
      updatedAt: '2026-11-05T00:00:00.000Z',
    });

    const speakSpy = vi.spyOn(speechModule, 'speak');

    const result = await playWordAudio('忙', 'mang2');
    expect(result.ok).toBe(true);
    expect(result.source).toBe('tts-file');
    expect(FakeAudioElement.instances).toHaveLength(1);
    expect(speakSpy).not.toHaveBeenCalled();
  });

  it('falls back to window.speechSynthesis only when Hanyu-data is disconnected or key is absent', async () => {
    // No manifest in remoteCache and no network bridge
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const speakSpy = vi
      .spyOn(speechModule, 'speak')
      .mockResolvedValue({ ok: true });

    const result = await playWordAudio('未知词', 'wei4 zhi1 ci2');
    expect(result.ok).toBe(true);
    expect(result.source).toBe('web-speech');
    expect(speakSpy).toHaveBeenCalledWith('未知词', expect.objectContaining({ lang: 'zh-CN' }));
  });

  it('playLessonSlice returns ok: false when slice bounds are invalid', async () => {
    const res = await playLessonSlice({
      audioPath: 'audio/lessons/b1/l01.mp3',
      startMs: 5000,
      endMs: 4000,
      confidence: 0.9,
    });
    expect(res.ok).toBe(false);
    expect(res.source).toBe('lesson-slice');
  });
});

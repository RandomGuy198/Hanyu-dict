/**
 * Sticky bottom synchronized audio player bar (`src/modules/books/AudioBar.tsx`).
 *
 * Controls:
 * - Play / Pause full lesson sentence sequence (`▶ Phát bài` / `⏸ Tạm dừng`), `⏮ Câu trước`, `⏭ Câu tiếp`
 * - Playback speed selector: `0.75×`, `1.0×`, `1.25×`
 * - Sentence loop toggle: `🔁 Lặp câu`
 * - Audio source toggle: `🎧 Băng gốc` (`context`) vs `🔊 TTS chuẩn` (`tts`)
 * - Displays active sentence Chinese + Pinyin + Tone Sandhi note if any, and notifies parent of `activeSentenceId`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { playSentenceAudio, stopAudio } from '../../data/audioPlayer';
import type { LessonSentence } from '../../domain/types';

export interface AudioBarProps {
  sentences: LessonSentence[];
  activeSentenceId: string | null;
  onActiveSentenceChange: (sentenceId: string | null) => void;
  audioMode: 'context' | 'tts';
  onAudioModeChange: (mode: 'context' | 'tts') => void;
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
  loopSentence: boolean;
  onLoopSentenceChange: (loop: boolean) => void;
}

const RATES = [0.75, 1.0, 1.25] as const;

export function AudioBar({
  sentences,
  activeSentenceId,
  onActiveSentenceChange,
  audioMode,
  onAudioModeChange,
  playbackRate,
  onPlaybackRateChange,
  loopSentence,
  onLoopSentenceChange,
}: AudioBarProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const runIdRef = useRef(0);
  const loopRef = useRef(loopSentence);
  const modeRef = useRef(audioMode);
  const rateRef = useRef(playbackRate);

  useEffect(() => {
    loopRef.current = loopSentence;
  }, [loopSentence]);

  useEffect(() => {
    modeRef.current = audioMode;
  }, [audioMode]);

  useEffect(() => {
    rateRef.current = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const runId = runIdRef;
    return () => {
      runId.current++;
      stopAudio();
    };
  }, []);

  const currentIndex = sentences.findIndex((s) => s.id === activeSentenceId);
  const activeSentence =
    currentIndex >= 0 ? sentences[currentIndex] : sentences[0] ?? null;

  const stopSequence = useCallback(() => {
    runIdRef.current++;
    stopAudio();
    setIsPlaying(false);
  }, []);

  const playFromIndex = useCallback(
    async (startIdx: number) => {
      if (sentences.length === 0) return;
      const runId = ++runIdRef.current;
      setIsPlaying(true);

      let idx = Math.max(0, Math.min(sentences.length - 1, startIdx));
      while (idx < sentences.length && runIdRef.current === runId) {
        const target = sentences[idx];
        onActiveSentenceChange(target.id);
        await playSentenceAudio(target, modeRef.current, rateRef.current);
        if (runIdRef.current !== runId) return;

        if (!loopRef.current) {
          idx += 1;
        }
      }

      if (runIdRef.current === runId) {
        setIsPlaying(false);
      }
    },
    [onActiveSentenceChange, sentences],
  );

  const handleTogglePlay = () => {
    if (isPlaying) {
      stopSequence();
      return;
    }
    const startIdx = currentIndex >= 0 ? currentIndex : 0;
    void playFromIndex(startIdx);
  };

  const handlePrev = () => {
    if (sentences.length === 0) return;
    const prevIdx = currentIndex > 0 ? currentIndex - 1 : 0;
    const target = sentences[prevIdx];
    onActiveSentenceChange(target.id);
    if (isPlaying) {
      void playFromIndex(prevIdx);
    } else {
      void playSentenceAudio(target, audioMode, playbackRate);
    }
  };

  const handleNext = () => {
    if (sentences.length === 0) return;
    const nextIdx =
      currentIndex >= 0 && currentIndex + 1 < sentences.length
        ? currentIndex + 1
        : 0;
    const target = sentences[nextIdx];
    onActiveSentenceChange(target.id);
    if (isPlaying) {
      void playFromIndex(nextIdx);
    } else {
      void playSentenceAudio(target, audioMode, playbackRate);
    }
  };

  return (
    <aside className="books-audio-bar card" aria-label="Trình phát âm thanh bài học">
      <div className="books-audio-main">
        <div className="books-audio-controls">
          <button
            type="button"
            className="btn btn-sm"
            disabled={sentences.length === 0}
            onClick={handlePrev}
            aria-label="Câu trước"
          >
            ⏮ Câu trước
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={sentences.length === 0}
            onClick={handleTogglePlay}
          >
            {isPlaying ? '⏸ Tạm dừng' : '▶ Phát bài'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={sentences.length === 0}
            onClick={handleNext}
            aria-label="Câu tiếp"
          >
            ⏭ Câu tiếp
          </button>
        </div>

        <div className="books-audio-options">
          <div className="books-audio-speeds" role="group" aria-label="Tốc độ phát">
            {RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                className={`chip ${playbackRate === rate ? 'is-active' : ''}`}
                aria-pressed={playbackRate === rate}
                onClick={() => onPlaybackRateChange(rate)}
              >
                {rate === 1 ? '1.0×' : `${rate}×`}
              </button>
            ))}
          </div>

          <button
            type="button"
            className={`chip ${loopSentence ? 'is-active' : ''}`}
            aria-pressed={loopSentence}
            onClick={() => onLoopSentenceChange(!loopSentence)}
          >
            🔁 Lặp câu
          </button>

          <div className="books-audio-source" role="group" aria-label="Nguồn âm thanh">
            <button
              type="button"
              className={`chip ${audioMode === 'context' ? 'is-active' : ''}`}
              aria-pressed={audioMode === 'context'}
              onClick={() => onAudioModeChange('context')}
            >
              🎧 Băng gốc
            </button>
            <button
              type="button"
              className={`chip ${audioMode === 'tts' ? 'is-active' : ''}`}
              aria-pressed={audioMode === 'tts'}
              onClick={() => onAudioModeChange('tts')}
            >
              🔊 TTS chuẩn
            </button>
          </div>
        </div>
      </div>

      {activeSentence ? (
        <div className="books-audio-active-line">
          <span className="badge">
            Câu {Math.max(1, currentIndex + 1)} / {sentences.length}
          </span>
          <span className="books-audio-zh cjk" lang="zh">
            {activeSentence.speaker ? `${activeSentence.speaker}: ` : ''}
            {activeSentence.zh}
          </span>
          <span className="pinyin text-sm">{activeSentence.pinyin}</span>
          {activeSentence.sandhiNotes && activeSentence.sandhiNotes.length > 0 ? (
            <span className="badge badge-warn">
              {activeSentence.sandhiNotes.join(' · ')}
            </span>
          ) : null}
        </div>
      ) : (
        <div className="books-audio-active-line text-sm muted">
          Nhấn vào một câu trên trang sách hoặc văn bản để nghe phát âm.
        </div>
      )}
    </aside>
  );
}

export default AudioBar;

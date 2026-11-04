/** The voice part of `/settings`, split out so the screen itself stays short.
 *
 *  Nothing here promises audio the device does not have: the panel asks `inspectSpeech()` what the
 *  browser really offers, lists only voices the browser can name, re-reads the list when the voice
 *  change event fires, and says plainly when no Chinese voice exists. All speech is the device's own
 *  text-to-speech; this app ships no recordings and makes no request to any other host. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconAlert, IconSpeaker } from '../../app/icons';
import {
  inspectSpeech,
  onVoicesChanged,
  speak,
  stopSpeaking,
  type SpeechSupport,
} from '../../data/speech';
import type { Preferences } from '../../domain/types';

const SAMPLE_TEXT = '我喜欢学中文。';
const SAMPLE_GLOSS = 'wǒ xǐhuan xué Zhōngwén — “I like learning Chinese.”';

type PreviewState = { tone: 'idle' | 'busy' | 'ok' | 'fail'; message: string };

/** `zh`, `zh-CN`, `zh_Hans` — but not a language that merely starts with those two letters. */
function isChineseVoice(voice: SpeechSynthesisVoice): boolean {
  return /^zh(-|_|$)/i.test(voice.lang);
}

export function SpeechPanel({
  prefs,
  setPref,
}: {
  prefs: Preferences;
  setPref: (patch: Partial<Preferences>) => void;
}) {
  const [speech, setSpeech] = useState<SpeechSupport>(() => inspectSpeech(prefs.ttsLang));
  const [preview, setPreview] = useState<PreviewState>({
    tone: 'idle',
    message: 'Voice preview has not been run on this device yet.',
  });

  useEffect(() => {
    const refresh = () => setSpeech(inspectSpeech(prefs.ttsLang));
    refresh();
    return onVoicesChanged(refresh);
  }, [prefs.ttsLang]);

  const chineseVoices = useMemo(
    () => speech.voices.filter(isChineseVoice),
    [speech.voices],
  );

  const langOptions = useMemo(() => {
    const tags = new Set<string>(['zh-CN', 'zh-TW', 'zh-HK', 'zh-SG']);
    for (const voice of chineseVoices) tags.add(voice.lang);
    if (!tags.has(prefs.ttsLang)) tags.add(prefs.ttsLang);
    return [...tags].sort();
  }, [chineseVoices, prefs.ttsLang]);

  const previewVoice = useCallback(async () => {
    setPreview({ tone: 'busy', message: `Asking ${speech.voiceName ?? prefs.ttsLang} to speak…` });
    const result = await speak(SAMPLE_TEXT, { lang: prefs.ttsLang, rate: prefs.ttsRate });
    setPreview(
      result.ok
        ? {
            tone: 'ok',
            message: `Played with ${speech.voiceName ?? prefs.ttsLang}. This is the device's own synthetic voice — the app ships no human recordings.`,
          }
        : { tone: 'fail', message: result.reason ?? 'The browser refused to speak that text.' },
    );
  }, [prefs.ttsLang, prefs.ttsRate, speech.voiceName]);

  return (
    <>
      <div className="field">
        <label htmlFor="prof-lang">Spoken language tag</label>
        <select
          id="prof-lang"
          className="select"
          value={prefs.ttsLang}
          onChange={(event) => setPref({ ttsLang: event.target.value })}
        >
          {langOptions.map((lang) => (
            <option key={lang} value={lang}>
              {lang}
              {chineseVoices.some((voice) => voice.lang === lang) ? ' — voice present' : ' — no voice'}
            </option>
          ))}
        </select>
        <span className="help">
          Only Mandarin tags are offered, because that is what this dictionary covers. The list is
          the usual tags plus every Chinese tag this browser reports.
        </span>
      </div>

      <div className="field prof-range-row">
        <label htmlFor="prof-rate">
          Speech rate ({Math.round(prefs.ttsRate * 100)}% of normal speed)
        </label>
        <input
          id="prof-rate"
          type="range"
          min={0.5}
          max={1.5}
          step={0.05}
          value={prefs.ttsRate}
          onChange={(event) => setPref({ ttsRate: Number(event.target.value) })}
        />
      </div>

      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => void previewVoice()}>
          <IconSpeaker /> Preview voice
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            stopSpeaking();
            setPreview({ tone: 'idle', message: 'Stopped.' });
          }}
        >
          Stop
        </button>
      </div>
      <p className="prof-status" role="status" aria-live="polite" data-tone={preview.tone}>
        {preview.message}{' '}
        {preview.tone === 'idle' ? `Sample: ${SAMPLE_TEXT} (${SAMPLE_GLOSS})` : ''}
      </p>

      <div className="prof-stack-sm">
        <h3>Chinese voices this device actually offers</h3>
        {!speech.available ? (
          <div className="notice notice-warn" role="status">
            <IconAlert />
            <div>{speech.reason ?? 'This browser has no speech synthesis at all.'}</div>
          </div>
        ) : speech.chineseVoice ? (
          <>
            <p className="prof-status" role="status">
              Selected: {speech.voiceName ?? prefs.ttsLang}
            </p>
            <ul className="prof-voice-list">
              {chineseVoices.map((voice) => (
                <li key={`${voice.name}-${voice.lang}`}>
                  {voice.name} — {voice.lang}
                  {voice.localService ? ' (on this device)' : ' (downloaded by the browser)'}
                  {voice.default ? ' (browser default)' : ''}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="notice notice-warn" role="status">
            <IconAlert />
            <div>
              {speech.reason ?? `No ${prefs.ttsLang} voice is installed on this device.`} This browser
              lists {speech.voices.length} voice{speech.voices.length === 1 ? '' : 's'} in total and
              none of them is Chinese, so speaker buttons will report that no Chinese voice exists
              instead of reading Chinese with an English voice.
            </div>
          </div>
        )}
        <p className="prof-help">
          Voice availability is a property of the operating system, not of this app: installing the
          app cannot add one. Preview output is synthetic speech from the device.
        </p>
      </div>
    </>
  );
}

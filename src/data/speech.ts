/** Pronunciation through the device's own speech synthesiser. This is deliberately labelled
 *  as synthetic: no human-recording pack is shipped, and the UI must say so. */

export interface SpeechSupport {
  available: boolean;
  chineseVoice: boolean;
  voiceName?: string;
  voices: SpeechSynthesisVoice[];
  reason?: string;
}

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

function pickVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const base = lang.toLowerCase().split('-')[0];
  const exact = voices.find((voice) => voice.lang.toLowerCase() === lang.toLowerCase());
  if (exact) return exact;
  const family = voices.filter((voice) => voice.lang.toLowerCase().startsWith(base));
  if (family.length === 0) return null;
  // Prefer an on-device voice: downloaded-only voices fail silently offline.
  return family.find((voice) => voice.localService) ?? family[0];
}

export function inspectSpeech(lang = 'zh-CN'): SpeechSupport {
  const engine = synth();
  if (!engine) {
    return {
      available: false,
      chineseVoice: false,
      voices: [],
      reason: 'This browser has no speech synthesis. Ask your device to install a Chinese voice, or use the pinyin display.',
    };
  }
  const voices = engine.getVoices();
  const voice = pickVoice(voices, lang);
  return {
    available: true,
    chineseVoice: Boolean(voice),
    voiceName: voice?.name,
    voices,
    reason: voice ? undefined : `No ${lang} voice is installed on this device.`,
  };
}

/** SpeechSynthesis loads its voice list asynchronously on some engines. */
export function onVoicesChanged(handler: () => void): () => void {
  const engine = synth();
  if (!engine) return () => undefined;
  engine.addEventListener('voiceschanged', handler);
  return () => engine.removeEventListener('voiceschanged', handler);
}

export interface SpeakResult {
  ok: boolean;
  reason?: string;
}

export async function speak(
  text: string,
  options: { lang?: string; rate?: number; pitch?: number } = {},
): Promise<SpeakResult> {
  const engine = synth();
  if (!engine) return { ok: false, reason: 'Speech synthesis is not available in this browser.' };
  const lang = options.lang ?? 'zh-CN';
  const support = inspectSpeech(lang);
  if (!support.chineseVoice) {
    return { ok: false, reason: support.reason ?? 'No Chinese voice installed.' };
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = options.rate ?? 0.9;
  utterance.pitch = options.pitch ?? 1;
  if (support.voiceName) {
    const voice = support.voices.find((candidate) => candidate.name === support.voiceName);
    if (voice) utterance.voice = voice;
  }
  return new Promise<SpeakResult>((resolve) => {
    let settled = false;
    const finish = (result: SpeakResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      resolve(result);
    };
    utterance.onend = () => finish({ ok: true });
    utterance.onerror = (event) =>
      finish({
        ok: false,
        reason:
          (event as SpeechSynthesisErrorEvent).error === 'not-allowed'
            ? 'The browser blocked audio playback. Tap the speaker again.'
            : 'The speech engine could not read that text.',
      });
    const guard = setTimeout(() => finish({ ok: false, reason: 'The speech engine timed out.' }), 12000);
    engine.cancel();
    engine.speak(utterance);
  });
}

export function stopSpeaking(): void {
  synth()?.cancel();
}

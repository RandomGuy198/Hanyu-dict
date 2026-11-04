/** `/settings` — every preference the spine exposes, all of it free and stored on this device.
 *
 *  Speech claims are checked against `inspectSpeech()`, so the screen never promises a Chinese
 *  voice the device does not have. Install guidance uses the real `beforeinstallprompt` event
 *  when the browser offers one and manual steps when it does not. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ConfirmDialog,
  PageHeader,
  Segmented,
} from '../../components';
import { IconDownload, IconGear } from '../../app/icons';
import { usePreferences, useToast } from '../../app/providers';
import type { Preferences } from '../../domain/types';
import { SpeechPanel } from './settingsSpeech';
import './profile.css';

/** `beforeinstallprompt` is not in the DOM lib; the two members we call are documented by the
 *  Progressive Web App install lifecycle, so this describes the boundary instead of casting to
 *  an untyped blob. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const TEXT_SCALES = { min: 0.85, max: 1.6, step: 0.05 };

function SwitchRow({
  id,
  label,
  help,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  help?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="prof-check-row">
      <span className="prof-check-text">
        <label htmlFor={id}>{label}</label>
        {help ? <span className="help">{help}</span> : null}
      </span>
      <input
        id={id}
        className="prof-switch"
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}

export default function SettingsPage() {
  const { prefs, ready, update, reset } = usePreferences();
  const toast = useToast();

  const [resetOpen, setResetOpen] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [installNote, setInstallNote] = useState('');

  useEffect(() => {
    const standaloneMedia = window.matchMedia('(display-mode: standalone)');
    const minimalMedia = window.matchMedia('(display-mode: minimal-ui)');
    // iOS Safari exposes standalone only through navigator.standalone.
    const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standaloneMedia.matches || minimalMedia.matches || iosStandalone);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
      setInstallNote('The browser reports this copy as installed.');
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const runInstallPrompt = useCallback(async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    setInstallNote(
      choice.outcome === 'accepted'
        ? 'The browser accepted the install. It is still the browser that owns the shortcut.'
        : 'You dismissed the browser install dialog, so nothing was installed.',
    );
    if (choice.outcome === 'accepted') setInstalled(true);
    setInstallEvent(null);
  }, [installEvent]);

  const platform = useMemo(() => {
    const userAgent = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
    if (/Android/i.test(userAgent)) return 'android';
    return 'desktop';
  }, []);

  const installSteps = useMemo<string[]>(() => {
    if (platform === 'ios') {
      return [
        'Open this site in Safari (Chrome on iOS cannot install web apps).',
        'Tap the Share button in the toolbar.',
        'Choose “Add to Home Screen”, then confirm.',
      ];
    }
    if (platform === 'android') {
      return [
        'Open this site in Chrome or Edge.',
        'Open the browser menu (three dots).',
        'Choose “Add to home screen” / “Install app”. If neither appears, this browser does not offer installs.',
      ];
    }
    return [
      'In Chrome or Edge, look for the install icon at the right end of the address bar.',
      'Or open the browser menu and choose “Install app” / “Apps”, then “Install this site as an app”.',
      'Firefox and Safari on the desktop do not offer an install entry for this site; a bookmark works offline once the data is downloaded.',
    ];
  }, [platform]);

  const setPref = useCallback((patch: Partial<Preferences>) => update(patch), [update]);

  if (!ready) {
    return (
      <div className="stack" role="status" aria-live="polite">
        <PageHeader title="Settings" />
        <div className="skeleton" style={{ height: 96 }} />
        <div className="skeleton" style={{ height: 96 }} />
        <p className="prof-status">Reading your saved settings from this device…</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        title="Settings"
        subtitle="Everything here is stored in this browser’s IndexedDB. No account, no server, no paid tier."
        actions={
          <button type="button" className="btn btn-sm" onClick={() => setResetOpen(true)}>
            <IconGear /> Reset to defaults
          </button>
        }
      />

      <section className="card prof-section" aria-labelledby="prof-appearance">
        <div className="prof-section-head">
          <h2 id="prof-appearance">Appearance</h2>
          <span className="spacer" />
          <span className="prof-count">Applies as soon as you tap it</span>
        </div>
        <div className="field">
          <span className="prof-block-label" id="prof-theme-label">Colour theme</span>
          <Segmented<Preferences['theme']>
            label="Colour theme"
            value={prefs.theme}
            onChange={(value) => setPref({ theme: value })}
            options={[
              { value: 'auto', label: 'Follow system' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
        <div className="field">
          <span className="prof-block-label" id="prof-contrast-label">Contrast</span>
          <Segmented<Preferences['contrast']>
            label="Contrast"
            value={prefs.contrast}
            onChange={(value) => setPref({ contrast: value })}
            options={[
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High contrast' },
            ]}
          />
        </div>
        <div className="field">
          <span className="prof-block-label" id="prof-motion-label">Motion</span>
          <Segmented<'reduced' | 'default'>
            label="Animation"
            value={prefs.reduceMotion ? 'reduced' : 'default'}
            onChange={(value) => setPref({ reduceMotion: value === 'reduced' })}
            options={[
              { value: 'default', label: 'Animated' },
              { value: 'reduced', label: 'Reduced' },
            ]}
          />
          <p className="prof-help">
            Reduced also shortens every transition; the browser’s own “reduce motion” system
            setting is honoured too.
          </p>
        </div>
        <div className="field">
          <span className="prof-block-label" id="prof-script-label">Headword script</span>
          <Segmented<Preferences['displayScript']>
            label="Headword script"
            value={prefs.displayScript}
            onChange={(value) => setPref({ displayScript: value })}
            options={[
              { value: 'simplified', label: 'Simplified' },
              { value: 'traditional', label: 'Traditional' },
              { value: 'both', label: 'Both' },
            ]}
          />
          <p className="prof-help">
            Both forms come from the Unihan variant maps in the character pack; characters Unihan
            does not map stay as written.
          </p>
        </div>
        <div className="field">
          <span className="prof-block-label" id="prof-font-label">Font face</span>
          <Segmented<Preferences['fontStack']>
            label="Font face"
            value={prefs.fontStack}
            onChange={(value) => setPref({ fontStack: value })}
            options={[
              { value: 'system', label: 'System sans' },
              { value: 'serif-cjk', label: 'Serif where available' },
            ]}
          />
          <p className="prof-help">
            No font files are downloaded: this uses faces already installed on your device, so
            results differ between devices.
          </p>
        </div>
        <div className="field prof-range-row">
          <label htmlFor="prof-scale">
            Text size ({Math.round(prefs.textScale * 100)}% of the default)
          </label>
          <input
            id="prof-scale"
            type="range"
            min={TEXT_SCALES.min}
            max={TEXT_SCALES.max}
            step={TEXT_SCALES.step}
            value={prefs.textScale}
            onChange={(event) => setPref({ textScale: Number(event.target.value) })}
          />
          <p className="prof-help">
            Sample: <span className="cjk">中文拼音</span> — layout is also tested at 200% browser
            zoom.
          </p>
        </div>
      </section>

      <section className="card prof-section" aria-labelledby="prof-reading">
        <div className="prof-section-head">
          <h2 id="prof-reading">Reading &amp; pinyin</h2>
        </div>
        <div className="field">
          <span className="prof-block-label" id="prof-py-style-label">Pinyin style</span>
          <Segmented<Preferences['pinyinStyle']>
            label="Pinyin style"
            value={prefs.pinyinStyle}
            onChange={(value) => setPref({ pinyinStyle: value })}
            options={[
              { value: 'marks', label: 'Tone marks (mā)' },
              { value: 'numbers', label: 'Tone numbers (ma1)' },
              { value: 'none', label: 'Hidden' },
            ]}
          />
        </div>
        <SwitchRow
          id="prof-show-py"
          label="Show pinyin"
          help="Master switch for entry lines, examples and the reading screens. Each reading screen can also be toggled from the item itself."
          checked={prefs.showPinyin}
          onChange={(next) => setPref({ showPinyin: next })}
        />
        <SwitchRow
          id="prof-show-ex"
          label="Show example sentences"
          help="Examples come from the Tatoeba pack; if that pack is not installed the section says so instead of inventing sentences."
          checked={prefs.showExamples}
          onChange={(next) => setPref({ showExamples: next })}
        />
        <p className="prof-help">
          Definitions are English only in this build, because that is what the dictionary pack
          contains.
        </p>
      </section>

      <section className="card prof-section" aria-labelledby="prof-speech">
        <div className="prof-section-head">
          <h2 id="prof-speech">Voice</h2>
          <span className="spacer" />
          <span className="prof-count">Device text-to-speech only</span>
        </div>

        <SpeechPanel prefs={prefs} setPref={setPref} />

        <SwitchRow
          id="prof-autospeak"
          label="Speak a headword automatically when an entry is opened"
          help="Only ever uses a Chinese voice that really exists on this device."
          checked={prefs.autoSpeak}
          onChange={(next) => setPref({ autoSpeak: next })}
        />
      </section>

      <section className="card prof-section" aria-labelledby="prof-goals">
        <div className="prof-section-head">
          <h2 id="prof-goals">Daily goal</h2>
        </div>
        <div className="field">
          <label htmlFor="prof-goal">Target items per day</label>
          <input
            id="prof-goal"
            className="input"
            type="number"
            min={0}
            max={500}
            step={1}
            value={prefs.dailyGoal}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) setPref({ dailyGoal: Math.max(0, Math.min(500, Math.round(next))) });
            }}
          />
          <p className="prof-help">
            Counted locally on the progress screen. 0 means no target rather than a locked feature.
          </p>
        </div>
      </section>

      <section className="card prof-section" aria-labelledby="prof-install">
        <div className="prof-section-head">
          <h2 id="prof-install">Install as an app</h2>
          <span className="spacer" />
          <span className="badge badge-ok">{installed ? 'Running installed' : 'Running in a browser tab'}</span>
        </div>
        <p className="prof-status" role="status" aria-live="polite">
          {installed
            ? 'This copy is already running as an installed app, so there is nothing to install.'
            : installEvent
              ? 'Your browser is offering an install shortcut right now.'
              : 'Your browser has not offered an install shortcut for this visit, so there is no install button to press. That is normal — the browser decides when to offer one (usually after a few visits over some days).'}
        </p>
        {installEvent && !installed ? (
          <button type="button" className="btn btn-primary" onClick={() => void runInstallPrompt()}>
            <IconDownload /> Use the browser’s install offer
          </button>
        ) : null}
        {installNote ? <p className="prof-help">{installNote}</p> : null}
        <h3>Manual steps for this device</h3>
        <ol className="prof-voice-list">
          {installSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="prof-help">
          Installing changes nothing about your data: the dictionary packs are already stored in
          this browser either way. See{' '}
          <Link to="/offline-data">offline data</Link> for what is downloaded.
        </p>
      </section>

      <nav className="row-wrap" aria-label="More settings screens">
        <Link className="btn btn-sm" to="/offline-data">
          Offline data packs
        </Link>
        <Link className="btn btn-sm" to="/data">
          Backup &amp; erase
        </Link>
        <Link className="btn btn-sm" to="/about">
          About &amp; licences
        </Link>
      </nav>

      <ConfirmDialog
        open={resetOpen}
        title="Reset every setting to its default?"
        body={
          <div className="stack">
            <p>
              Theme, contrast, motion, text size, script, pinyin, voice and daily goal go back to
              the shipped defaults.
            </p>
            <p className="prof-status">
              Saved words, lists, notes, decks and history are not touched.
            </p>
          </div>
        }
        confirmLabel="Reset settings"
        danger
        onConfirm={() => {
          reset();
          setResetOpen(false);
          toast.push({ message: 'Settings reset to defaults', tone: 'info' });
        }}
        onCancel={() => setResetOpen(false)}
      />
    </div>
  );
}

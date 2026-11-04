/** `/about` — where every byte in this app came from, and what it deliberately does not do.
 *
 *  Nothing here is invented. Pack versions, record counts and sizes are read at runtime from the
 *  registry this site publishes (`data/manifest.json`, through the same helpers the installer
 *  uses), installed state comes from this device's own IndexedDB, and the licence texts are
 *  fetched from this origin only. Where the build genuinely cannot know something, the page says
 *  so instead of guessing. */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadingGate, PageHeader } from '../../components';
import { IconAlert, IconCheck, IconDownload } from '../../app/icons';
import { formatBytes } from '../../app/hooks';
import { cachedManifest, loadManifest, packOverview, type PackOverview } from '../../data/packs';
import type { PackKind, PackManifest } from '../../domain/types';
import './profile.css';

/** Mirrors the `version` field of this project's package.json (`hanyu-web`). The bundle does not
 *  read package.json at runtime, so the string is duplicated here - change both together. */
const APP_VERSION = '1.0.0';
const APP_NAME = 'Hanyu Dictionary';

const KIND_LABEL: Record<PackKind, string> = {
  dictionary: 'word data',
  characters: 'character data',
  strokes: 'stroke artwork',
  examples: 'example sentences',
  content: 'reading content',
  ocr: 'recognition models',
};

/** A manifest licence id to the file that carries its full verbatim text under `public/licenses/`.
 *  The names do not always match (`Unicode-License-3.0` in the data, `Unicode-License-v3.txt` on
 *  disk), so the mapping is explicit and an unmatched licence renders without a button. */
const LICENCE_FILE_BY_ID: Record<string, string> = {
  'CC-BY-SA-4.0': 'CC-BY-SA-4.0.txt',
  'CC-BY-4.0': 'CC-BY-4.0.txt',
  'CC-BY-2.0-FR': 'CC-BY-2.0-FR.txt',
  'Unicode-License-3.0': 'Unicode-License-v3.txt',
  'Arphic-Public-License-1999': 'ARPHIC.txt',
  'Apache-2.0': 'Apache-2.0.txt',
  MIT: 'MIT.txt',
};

/** What each upstream contributes, in the project's own words, and what it obliges us to carry. */
const SOURCES: { name: string; licence: string; file: string; used: string; duty: string }[] = [
  {
    name: 'CC-CEDICT',
    licence: 'Creative Commons Attribution-ShareAlike 4.0',
    file: 'CC-BY-SA-4.0.txt',
    used: 'The dictionary itself: simplified and traditional headwords, pinyin and English glosses.',
    duty: 'Share-alike: the derived word data in this app is published under CC BY-SA 4.0 too.',
  },
  {
    name: 'Unicode Unihan Database 16.0.0',
    licence: 'Unicode License v3',
    file: 'Unicode-License-v3.txt',
    used: 'Character readings, radical and stroke counts, and the variant relationships.',
    duty: 'The Unicode notice must accompany any redistribution, so it is shipped verbatim.',
  },
  {
    name: 'Make Me a Hanzi / hanzi-writer-data 2.0.1',
    licence: 'Arphic Public License 1999',
    file: 'ARPHIC.txt',
    used: 'Stroke order medians that drive the animation and the writing quiz.',
    duty: 'The Arphic licence text is included with the data; stroke glyphs here come from that set.',
  },
  {
    name: 'hanzi-writer 3.7.3',
    licence: 'MIT License',
    file: 'MIT.txt',
    used: 'The drawing and quiz player that renders stroke data on a canvas.',
    duty: 'The MIT notice is reproduced; the library is loaded from this site, never from a CDN.',
  },
  {
    name: 'Tatoeba (cmn and eng sentences)',
    licence: 'Creative Commons Attribution 2.0 France',
    file: 'CC-BY-2.0-FR.txt',
    used: 'Real example sentences paired with their translations, for the examples pack.',
    duty: 'Attribution to the contributors; the export this build used names them as “unknown”.',
  },
  {
    name: 'tesseract.js 5.1.1, tesseract.js-core 5.1.1 and tessdata_fast',
    licence: 'Apache License 2.0',
    file: 'Apache-2.0.txt',
    used: 'Optional on-device text recognition for the camera screen (chi_sim and eng).',
    duty: 'The Apache notice and the model licence ship alongside; nothing is fetched at runtime.',
  },
  {
    name: 'Original content by this project',
    licence: 'Creative Commons Attribution 4.0',
    file: 'CC-BY-4.0.txt',
    used: 'The tips, lessons, stories and articles in the reading library, and this app’s own text.',
    duty: 'Free to reuse with attribution to this project.',
  },
];

/** Things the reference product does that this one deliberately does not. Naming them keeps the
 *  “free and unlocked” claim honest instead of merely silent. */
const NOT_DONE: string[] = [
  'No account, no sign-in, no cloud sync. Backup and restore are files this device writes.',
  'No advertisements, trials, locked tiers or entitlement checks. Every feature is enabled.',
  'No recorded human audio. Pronunciation uses the voices your device already has, and says so when it has none.',
  'No server-side translation, no AI chat, no pronunciation scoring, no simulated other users.',
  'No public leaderboard, chat or live competition. Practice challenges are local and labelled as such.',
  'No home-screen widget, lock-screen card or screen overlay: a browser cannot offer those honestly.',
];

function licenceFileFor(license: string): string | undefined {
  return LICENCE_FILE_BY_ID[license];
}

/** A pack's licence label, hyperlinked to the verbatim text this build ships when there is one.
 *  An unmapped label is shown as plain text rather than guessed at. */
function licenceCell(license: string) {
  const file = licenceFileFor(license);
  if (!file) return <span>{license}</span>;
  return (
    <a href={licenceUrl(file)} target="_blank" rel="noreferrer">
      {license}
    </a>
  );
}

/** Licence texts live beside the data, not under it, so the URL is built the same careful way
 *  `dataUrl()` builds pack URLs: relative to the deployed directory, never to the hash route. */
function licenceUrl(fileName: string): string {
  const base = (import.meta.env.BASE_URL || './').replace(/\/+$/, '');
  return `${base}/licenses/${fileName}`;
}

function LicenceText({ fileName }: { fileName: string }) {
  const [state, setState] = useState<{ phase: 'idle' | 'loading' | 'ready' | 'error'; text: string }>(
    { phase: 'idle', text: '' },
  );

  const open = useCallback(async () => {
    if (state.phase === 'ready' || state.phase === 'loading') {
      setState({ phase: 'idle', text: '' });
      return;
    }
    setState({ phase: 'loading', text: '' });
    try {
      const response = await fetch(licenceUrl(fileName), { cache: 'default' });
      if (!response.ok) {
        setState({
          phase: 'error',
          text: `This site answered HTTP ${response.status} for licenses/${fileName}.`,
        });
        return;
      }
      setState({ phase: 'ready', text: await response.text() });
    } catch (error) {
      setState({
        phase: 'error',
        text: error instanceof Error ? error.message : 'The licence text could not be read.',
      });
    }
  }, [fileName, state.phase]);

  return (
    <div className="prof-block">
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => void open()} aria-expanded={state.phase === 'ready'}>
        {state.phase === 'ready' ? 'Hide the licence text' : 'Read the licence text'}
      </button>
      <a className="btn btn-sm btn-ghost" href={licenceUrl(fileName)} target="_blank" rel="noreferrer">
        Open the file
      </a>
      {state.phase === 'loading' ? <p className="prof-help">Reading {fileName} from this site…</p> : null}
      {state.phase === 'error' ? (
        <p className="prof-err" role="status">
          <IconAlert /> {state.text} The copy in the repository under `public/licenses/` is the one
          that governs.
        </p>
      ) : null}
      {state.phase === 'ready' ? (
        <pre className="prof-code prof-scroll" tabIndex={0} aria-label={`Full licence text of ${fileName}`}>
          {state.text}
        </pre>
      ) : null}
    </div>
  );
}

function Registry({ rows, problem, retry }: { rows: PackOverview[]; problem: string | null; retry: () => void }) {
  if (problem) {
    return (
      <section className="card prof-section">
        <p className="notice notice-warn" role="status">
          <IconAlert /> {problem}
        </p>
        <button type="button" className="btn btn-sm" onClick={retry}>
          Try reading it again
        </button>
      </section>
    );
  }
  if (rows.length === 0) {
    return (
      <section className="card prof-section">
        <p className="muted" role="status">
          The pack registry has not been read yet, so the versions below cannot be quoted. It is
          fetched from this site the first time a dictionary is needed on this device.
        </p>
      </section>
    );
  }
  const bytes = rows.reduce((sum, row) => sum + row.pack.bytes, 0);
  const records = rows.reduce((sum, row) => sum + (row.pack.coverage?.records ?? 0), 0);
  return (
    <section className="card prof-section">
      <div className="prof-section-head">
        <h2>Data installed and installed-ready</h2>
        <span className="chip">{formatBytes(bytes)}</span>
        <span className="chip">{records.toLocaleString()} records</span>
      </div>
      <div className="prof-scroll">
        <table className="table">
          <caption className="visually-hidden">
            Every data pack this build can download, its version, licence and whether this device
            already has it.
          </caption>
          <thead>
            <tr>
              <th scope="col">Pack</th>
              <th scope="col">Contains</th>
              <th scope="col">Version</th>
              <th scope="col">Licence</th>
              <th scope="col">Size</th>
              <th scope="col">On this device</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.pack.id}>
                <th scope="row">{row.pack.label}</th>
                <td>
                  {KIND_LABEL[row.pack.kind]}
                  {row.pack.coverage?.records !== undefined ? ` · ${row.pack.coverage.records.toLocaleString()}` : ''}
                </td>
                <td className="prof-code">{row.pack.version}</td>
                <td>{licenceCell(row.pack.license)}</td>
                <td>{formatBytes(row.pack.bytes)}</td>
                <td>
                  {row.installed ? (
                    <span className="badge badge-ok">
                      <IconCheck /> at this version
                    </span>
                  ) : row.pack.required ? (
                    <span className="badge badge-warn">required, not installed</span>
                  ) : (
                    <span className="badge">not installed</span>
                  )}
                  {row.state?.status === 'error' ? (
                    <p className="prof-err">{row.state.error ?? 'a previous install failed'}</p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="prof-help">
        Versions are the upstream release plus a digest of the generated files, so a rebuilt pack
        always reads as a new version. Sizes are the download cost before installation.{' '}
        <Link to="/offline-data">Install, remove or re-verify packs here</Link>.
      </p>
    </section>
  );
}

function About() {
  const [rows, setRows] = useState<PackOverview[]>([]);
  const [manifest, setManifest] = useState<PackManifest | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setProblem(null);
    packOverview()
      .then(async (overview) => {
        const registry = (await cachedManifest()) ?? (await loadManifest());
        if (!alive) return;
        setRows(overview);
        setManifest(registry);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setRows([]);
        setManifest(null);
        setProblem(
          `${error instanceof Error ? error.message : 'The pack registry could not be read.'} ` +
            'This is the file this site publishes as data/manifest.json.',
        );
      });
    return () => {
      alive = false;
    };
  }, [attempt]);

  return (
    <div className="stack">
      <PageHeader
        title={`About ${APP_NAME}`}
        subtitle={
          <>
            A free Chinese–English dictionary and study app that runs entirely in this browser,
            built from openly licensed data and text written for it.
          </>
        }
      />

      <section className="card prof-section">
        <div className="prof-section-head">
          <h2>What this is</h2>
          <span className="chip">app v{APP_VERSION}</span>
        </div>
        <p>
          {APP_NAME} searches a {manifest ? `${manifest.packs.length}-pack ` : ''}dictionary, shows
          character data, animates stroke order, drills flashcards, reads PDFs and photographs, and
          keeps notes, lists and study schedules - all on this device. Searches, saved words, notes,
          documents and photos stay in this browser's IndexedDB. The only requests the app makes are
          for files this same site publishes: the pack registry, the data packs you choose to
          install and the licence texts quoted here.
        </p>
        <p className="muted text-sm">
          Nothing is metered, locked or sold. There is no account to create and nothing to upgrade.
        </p>
        <ul className="prof-list">
          <li>
            <IconDownload /> First use downloads the required packs (roughly{' '}
            {formatBytes(rows.filter((row) => row.pack.required).reduce((sum, row) => sum + row.pack.bytes, 0))}
            ) from this site; after that the app works with the network off.
          </li>
          <li>
            <IconCheck /> Installation is verified by SHA-256 against the registry before a pack is
            marked ready, and rolled back if a file does not match.
          </li>
        </ul>
        {manifest ? (
          <p className="prof-help">
            Registry schema v{manifest.schemaVersion}, generated {manifest.generatedAt}, requires app
            v{manifest.minAppVersion} or newer.
          </p>
        ) : null}
      </section>

      <Registry
        rows={rows}
        problem={problem}
        retry={() => setAttempt((n) => n + 1)}
      />

      <section className="card prof-section">
        <div className="prof-section-head">
          <h2>Where the data comes from</h2>
          <a className="btn btn-sm btn-ghost" href={licenceUrl('THIRD_PARTY_NOTICES.md')} target="_blank" rel="noreferrer">
            Full third-party notices
          </a>
        </div>
        <p className="muted text-sm">
          Every source below is used under its own licence, with the licence text shipped in this
          build. The modifications column of each pack is recorded in the registry; the notices file
          repeats it per source.
        </p>
        <ul className="prof-src-grid">
          {SOURCES.map((source) => (
            <li className="prof-src" key={source.name}>
              <div className="prof-src-head">
                <h3>{source.name}</h3>
                <span className="chip">{source.licence}</span>
              </div>
              <p>{source.used}</p>
              <p className="prof-help">{source.duty}</p>
              <LicenceText fileName={source.file} />
            </li>
          ))}
        </ul>
      </section>

      <section className="card prof-section">
        <div className="prof-section-head">
          <h2>What this app does not do</h2>
        </div>
        <ul className="prof-list">
          {NOT_DONE.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="prof-help">
          This is an independent project written from a clean-room specification. It is not
          affiliated with, derived from, or endorsed by any commercial dictionary application, and it
          contains no code, artwork, audio, lesson content or database taken from one.
        </p>
      </section>

      <section className="card prof-section">
        <div className="prof-section-head">
          <h2>Settings, data and help</h2>
        </div>
        <ul className="prof-list">
          <li>
            <Link to="/settings">Themes, script, pinyin style, speech and accessibility</Link>
          </li>
          <li>
            <Link to="/offline-data">Which packs are on this device, and what they cost</Link>
          </li>
          <li>
            <Link to="/data">Back up or restore your own words, notes and schedule</Link>
          </li>
          <li>
            <Link to="/learn">The reading library built from text written for this app</Link>
          </li>
        </ul>
        <p className="prof-help">
          If something here looks wrong - a gloss, a licence, a character count - report it through
          the place you got this address from, and name the pack version printed above. Those
          versions are what make a report reproducible.
        </p>
      </section>
    </div>
  );
}

export default function AboutPage() {
  return (
    <LoadingGate>
      <About />
    </LoadingGate>
  );
}

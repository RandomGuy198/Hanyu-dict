/** Photo vocabulary tool: capture an image (or type text), recognise it on this device with
 *  tesseract.js, correct the recognition, then look words up and save them.
 *
 *  Three entry paths are equal in weight and a camera denial only ever disables the camera —
 *  upload and typing stay usable. Nothing leaves the device: images, text and the language
 *  models are handled locally, and the OCR cost is shown before any download.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ConfirmDialog,
  DefinitionText,
  EmptyState,
  HanziText,
  LoadingGate,
  PageHeader,
  PinyinText,
  ProgressBar,
  SaveButton,
  SpeakButton,
} from '../../components';
import { IconAlert, IconCamera, IconCheck, IconDownload, IconPen, IconTrash } from '../../app/icons';
import { formatBytes, uid, useDebouncedValue } from '../../app/hooks';
import { useDictionary, usePreferences, useSavedWords, useToast } from '../../app/providers';
import { bumpActivity, db, todayKey } from '../../data/db';
import type { DictEntry, PhotoWord, Preferences, TextSpan } from '../../domain/types';
import { hasCjk } from '../../domain/pinyin';
import { useOcr } from './useOcr';
import { isLowMemory, probeOcrAssets, type OcrAssets } from './ocrAssets';
import './capture.css';

/** A 20 MB photo decodes to a bitmap far above what a phone should hold in memory. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export default function CapturePage() {
  return (
    <LoadingGate>
      <Capture />
    </LoadingGate>
  );
}

interface Staged {
  blob: Blob;
  url: string;
  from: 'camera' | 'upload';
  label: string;
}

function Capture() {
  const { api } = useDictionary();
  const { prefs } = usePreferences();
  const { save } = useSavedWords();
  const toast = useToast();
  const ocr = useOcr();

  const [assets, setAssets] = useState<OcrAssets>({ kind: 'checking' });
  const [staged, setStaged] = useState<Staged | null>(null);
  const [consented, setConsented] = useState(false);
  const [keepImage, setKeepImage] = useState(false);
  const [recognized, setRecognized] = useState('');
  const [corrected, setCorrected] = useState('');
  const [sourceLabel, setSourceLabel] = useState('');
  const [spans, setSpans] = useState<TextSpan[]>([]);
  const [matching, setMatching] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [focus, setFocus] = useState<{ label: string; entries: DictEntry[] } | null>(null);
  const [listIds, setListIds] = useState<string[]>([]);
  const [newList, setNewList] = useState('');
  const [notebookId, setNotebookId] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);

  const debounced = useDebouncedValue(corrected, 240);
  const lists = useLiveQuery(() => db.wordLists.orderBy('updatedAt').reverse().toArray(), [], []);
  const notebooks = useLiveQuery(() => db.notebooks.toArray(), [], []);

  useEffect(() => {
    let alive = true;
    void probeOcrAssets().then((next) => {
      if (alive) setAssets(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!staged) return;
    return () => URL.revokeObjectURL(staged.url);
  }, [staged]);

  const stageImage = useCallback((blob: Blob, from: 'camera' | 'upload', label: string) => {
    setStaged({ blob, url: URL.createObjectURL(blob), from, label });
    ocr.reset();
    if (blob.size > MAX_IMAGE_BYTES) {
      toast.push({
        message: `That image is ${formatBytes(blob.size)} — too big to decode safely here. Pick a smaller one.`,
        tone: 'warn',
      });
    }
  }, [ocr, toast]);

  const discardStaged = useCallback(() => setStaged(null), []);

  const useTypedText = useCallback((text: string) => {
    setRecognized('');
    setCorrected(text);
    setSourceLabel('Typed or pasted text — no recognition was run.');
    setPicked([]);
    setFocus(null);
  }, []);

  useEffect(() => {
    if (!api) {
      setSpans([]);
      return;
    }
    const trimmed = debounced.trim();
    if (!trimmed) {
      setSpans([]);
      setMatching(false);
      return;
    }
    let alive = true;
    setMatching(true);
    void api
      .spans(debounced, 6)
      .then((found) => {
        if (!alive) return;
        setSpans(found);
        setMatching(false);
      })
      .catch(() => {
        if (alive) setMatching(false);
      });
    return () => {
      alive = false;
    };
  }, [api, debounced]);

  const runRecognition = useCallback(async () => {
    if (!staged) return;
    const outcome = await ocr.recognize(staged.blob);
    if (!outcome) return;
    setRecognized(outcome.text);
    setCorrected(outcome.text);
    setSourceLabel(
      outcome.text.trim()
        ? `Recognised on this device (engine confidence ${outcome.confidence}%). Recognition is approximate.`
        : 'Recognition found no readable text in this image.',
    );
    if (!outcome.text.trim()) toast.push({ message: 'No readable text found — try a steadier, brighter photo.', tone: 'warn' });
  }, [ocr, staged, toast]);

  const entriesFor = useCallback(
    (indexes: number[]): DictEntry[] => {
      const out: DictEntry[] = [];
      for (const index of indexes) {
        const entry = spans[index]?.entries[0];
        if (entry && !out.some((candidate) => candidate.id === entry.id)) out.push(entry);
      }
      return out;
    },
    [spans],
  );

  const lookupSelection = useCallback(async () => {
    const field = textRef.current;
    if (!field || !api) return;
    const selection = corrected.slice(field.selectionStart, field.selectionEnd).trim();
    if (!selection) {
      toast.push({ message: 'Select text in the box first, then look it up.', tone: 'warn' });
      return;
    }
    const found = await api.spans(selection, Math.max(1, [...selection].length));
    const entries = found.length > 0 ? found[0].entries : await api.headword(selection);
    if (entries.length === 0) {
      setFocus({ label: `“${selection}” is not in the installed dictionary data.`, entries: [] });
      return;
    }
    setFocus({ label: `Selection: ${selection}`, entries });
  }, [api, corrected, toast]);

  const createList = useCallback(async () => {
    const name = newList.trim();
    if (!name) return;
    const now = new Date().toISOString();
    const id = uid('list-');
    await db.wordLists.add({ id, name, createdAt: now, updatedAt: now });
    setListIds((current) => [...current, id]);
    setNewList('');
    toast.push(`List “${name}” created`);
  }, [newList, toast]);

  const savePicked = useCallback(async () => {
    const entries = entriesFor(picked);
    if (entries.length === 0) {
      toast.push({ message: 'Tap the words you want to keep first.', tone: 'warn' });
      return;
    }
    for (const entry of entries) await save(entry, listIds);
    await bumpActivity(todayKey(), { entriesSaved: entries.length });
    toast.push(`${entries.length} word${entries.length === 1 ? '' : 's'} saved`);
  }, [entriesFor, listIds, picked, save, toast]);

  const keepAsPhotoWord = useCallback(async () => {
    const id = uid('photo-');
    const entryIds = entriesFor(picked).map((entry) => entry.id);
    let imageKey: string | undefined;
    if (keepImage && staged) {
      imageKey = uid('img-');
      await db.photoImages.put({ id: imageKey, blob: staged.blob });
    }
    const now = new Date().toISOString();
    const row: PhotoWord = { id, imageKey, createdAt: now, recognized, corrected, entryIds };
    await db.photos.add(row);
    if (notebookId) {
      const notebook = notebooks.find((candidate) => candidate.id === notebookId);
      if (notebook) {
        await db.notebookEntries.add({
          id: uid('note-'),
          notebookId,
          title: `Capture — ${corrected.slice(0, 24) || 'untitled'}`,
          body: corrected,
          entryIds,
          createdAt: now,
          updatedAt: now,
        });
        await db.notebooks.update(notebookId, { updatedAt: now });
      }
    }
    await bumpActivity(todayKey(), { characters: [...corrected].filter(hasCjk).length });
    toast.push(keepImage ? 'Capture kept with its image on this device' : 'Capture kept — text only, no image stored');
    setStaged(null);
    setKeepImage(false);
    setPicked([]);
  }, [corrected, entriesFor, keepImage, notebookId, notebooks, picked, recognized, staged, toast]);

  const busy = ocr.state.phase === 'loading' || ocr.state.phase === 'running';
  const wordCount = useMemo(() => [...corrected].filter(hasCjk).length, [corrected]);
  const bigImage = staged !== null && staged.blob.size > MAX_IMAGE_BYTES;

  return (
    <div className="stack cap-page">
      <PageHeader
        title="Camera & text capture"
        subtitle="Photograph a menu, a page or a sign, correct what the recogniser found, then look the words up. Recognition is on-device and approximate."
      />

      <p className="notice notice-info" role="note">
        <span>
          <strong>Nothing is uploaded.</strong> Images are only ever saved to this device's own
          storage when you choose to keep them, recognition runs locally, and word lists stay in
          IndexedDB. There is no account, no server and no cost.
        </span>
      </p>

      <section className="grid-cards cap-paths" aria-label="Ways to get text in">
        <CameraCard onCapture={(blob) => stageImage(blob, 'camera', 'photo')} />
        <div className="card cap-path">
          <h2>2. Upload an image</h2>
          <p>Any photo on this device — the file is read locally, never sent anywhere.</p>
          <div className="cap-path-actions">
            <label className="btn btn-primary" htmlFor="cap-file">
              <IconDownload /> Choose an image
            </label>
            <input
              id="cap-file"
              className="visually-hidden"
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) stageImage(file, 'upload', file.name);
                event.target.value = '';
              }}
            />
          </div>
        </div>
        <TypeCard onSubmit={useTypedText} />
      </section>

      {assets.kind === 'checking' ? <p className="muted text-sm" role="status" aria-live="polite">Checking whether the recognition models are bundled…</p> : null}
      {assets.kind === 'missing' ? (
        <div className="notice notice-warn" role="status">
          <IconAlert />
          <span>{assets.reason} You can still upload or type text and look up words, and you can still keep photos.</span>
        </div>
      ) : null}

      {staged ? (
        <section className="card cap-column" aria-label="Image ready for recognition">
          <div className="cap-row-wrap">
            <img className="cap-preview" src={staged.url} alt={`Staged ${staged.from} image: ${staged.label}`} />
          </div>
          <p className="text-sm muted">
            {staged.from === 'camera' ? 'Photo taken with the camera' : `File “${staged.label}”`} —{' '}
            {formatBytes(staged.blob.size)}. Not uploaded anywhere.
          </p>

          {assets.kind === 'present' ? (
            bigImage ? (
              <p className="notice notice-danger" role="alert">This image is too large to decode safely. Pick a smaller one and try again.</p>
            ) : (
              <div className="cap-column">
                <p className="text-sm">
                  Recognition needs these same-origin files, {formatBytes(assets.totalBytes)} in total,
                  downloaded once and cached on this device:
                </p>
                <table className="table cap-cost-table">
                  <caption className="visually-hidden">Files needed before recognition can run</caption>
                  <tbody>
                    {assets.groups.map((group) => (
                      <tr key={group.label}>
                        <th scope="row">{group.label}</th>
                        <td>{formatBytes(group.bytes)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="faint text-sm" colSpan={2}>
                        Listed in <code>ocr/manifest.json</code> ({assets.manifest.files.length} files, generated {assets.manifest.generatedAt}).
                      </td>
                    </tr>
                  </tbody>
                </table>
                {isLowMemory() ? (
                  <p className="notice notice-warn" role="status">
                    <IconAlert /> This device reports 2 GB of memory or less. Recognition may be slow or fail on a big photo.
                  </p>
                ) : null}
                <label className="switch">
                  <input type="checkbox" checked={consented} onChange={(event) => setConsented(event.target.checked)} />
                  <span>Download {formatBytes(assets.totalBytes)} of recognition files to this device and run it on this image.</span>
                </label>
                <div className="cap-row-wrap">
                  <button type="button" className="btn btn-primary" disabled={!consented || busy} onClick={() => void runRecognition()}>
                    <IconCamera /> {busy ? 'Working…' : 'Recognise this image'}
                  </button>
                  {busy ? (
                    <button type="button" className="btn" onClick={ocr.cancel}>
                      Cancel recognition
                    </button>
                  ) : null}
                </div>
              </div>
            )
          ) : null}

          <label className="switch">
            <input type="checkbox" checked={keepImage} onChange={(event) => setKeepImage(event.target.checked)} />
            <span>Keep this image on this device with the words I save.</span>
          </label>
          <div className="cap-row-wrap">
            <button type="button" className="btn btn-ghost" onClick={discardStaged}>
              Discard this image
            </button>
          </div>

          {ocr.state.phase !== 'idle' ? (
            <div className="cap-progress" role="status" aria-live="polite">
              <p className="cap-progress-meta">
                <span>{ocr.state.label}</span>
                <span className="faint">{ocr.state.percent}%</span>
              </p>
              <ProgressBar value={ocr.state.percent} total={100} label="Recognition progress" />
              {busy ? <button type="button" className="btn btn-sm" onClick={ocr.cancel}>Cancel</button> : null}
              {ocr.state.error ? <p className="notice notice-danger" role="alert">Recognition stopped: {ocr.state.error}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {corrected ? (
        <section className="card cap-column" aria-label="Review the recognised text">
          <div className="section-title">
            <h2>Check the text before looking words up</h2>
          </div>
          <p className="notice notice-warn" role="note">
            <IconAlert />
            <span>
              {sourceLabel} {recognized ? 'Recognition gets Chinese characters wrong often enough that you should correct the text yourself — the words below come from this edited text.' : 'Typing or pasting is often faster than recognising a photo.'}
            </span>
          </p>
          <div className="field">
            <label htmlFor="cap-text">Recognised text (editable)</label>
            <textarea
              id="cap-text"
              ref={textRef}
              className="textarea cap-review-text cjk"
              value={corrected}
              onChange={(event) => setCorrected(event.target.value)}
              placeholder="Correct the characters here…"
            />
            <span className="help">
              {wordCount} Chinese character{wordCount === 1 ? '' : 's'} in the box · {matching ? 'matching the dictionary…' : `${spans.length} dictionary word${spans.length === 1 ? '' : 's'} found`}
            </span>
          </div>
          <div className="cap-row-wrap">
            <button type="button" className="btn" onClick={() => void lookupSelection()} disabled={!api}>
              Look up selected text
            </button>
            {recognized ? (
              <button type="button" className="btn btn-ghost" onClick={() => setCorrected(recognized)}>
                Reset to raw recognition
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost" onClick={() => { setCorrected(''); setRecognized(''); setFocus(null); setPicked([]); }}>
              Clear text
            </button>
          </div>

          {spans.length > 0 ? (
            <>
              <p className="text-sm muted">Tap the words you want — then save, speak or open the full entry.</p>
              <ul className="cap-words" aria-label="Dictionary words found in this text">
                {spans.map((span, index) => (
                  <li key={`${span.start}-${span.text}`}>
                    <button
                      type="button"
                      className="cap-word cjk"
                      aria-pressed={picked.includes(index)}
                      onClick={() => {
                        setPicked((current) => (current.includes(index) ? current.filter((value) => value !== index) : [...current, index]));
                        const entry = span.entries[0];
                        setFocus(entry ? { label: `“${span.text}” in this text`, entries: span.entries } : null);
                      }}
                    >
                      <span className="cjk">{span.text}</span>
                      {span.entries[0] ? <PinyinText entry={span.entries[0]} /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : matching ? (
            <div className="skeleton" style={{ height: 48 }} />
          ) : (
            <p className="muted text-sm" role="status">
              {hasCjk(corrected)
                ? 'No dictionary entry matched these characters. The installed data is a compact dictionary, and recognition mistakes can hide real words — correct the text above and they appear.'
                : 'No Chinese characters in this text yet — correct the recognition or paste some Chinese.'}
            </p>
          )}

          {focus ? <Gloss focus={focus} prefs={prefs} /> : null}

          <div className="card card-tight cap-column" aria-label="Where to save">
            <h3 className="text-sm">Save {picked.length} selected word{picked.length === 1 ? '' : 's'}</h3>
            <div className="cap-row-wrap" role="group" aria-label="Word lists">
              {lists.length === 0 ? <span className="muted text-sm">No lists yet — create one below.</span> : null}
              {lists.map((list) => (
                <button
                  key={list.id}
                  type="button"
                  className={`chip ${listIds.includes(list.id) ? 'is-active' : ''}`}
                  aria-pressed={listIds.includes(list.id)}
                  onClick={() => setListIds((current) => (current.includes(list.id) ? current.filter((value) => value !== list.id) : [...current, list.id]))}
                >
                  {list.name}
                </button>
              ))}
            </div>
            <div className="field">
              <label htmlFor="cap-newlist">New list name</label>
              <div className="cap-row-wrap">
                <input id="cap-newlist" className="input" value={newList} onChange={(event) => setNewList(event.target.value)} placeholder="e.g. Menu words" />
                <button type="button" className="btn" onClick={() => void createList()} disabled={!newList.trim()}>
                  Create list
                </button>
              </div>
              <span className="help">Optional — saved words always land in “Saved words” as well.</span>
            </div>
            <div className="field">
              <label htmlFor="cap-notebook">Also write the text into a notebook (optional)</label>
              <select id="cap-notebook" className="select" value={notebookId} onChange={(event) => setNotebookId(event.target.value)}>
                <option value="">No notebook</option>
                {notebooks.map((notebook) => (
                  <option key={notebook.id} value={notebook.id}>
                    {notebook.name}
                  </option>
                ))}
              </select>
              {notebooks.length === 0 ? <span className="help">Create a notebook in the Library first to use this.</span> : null}
            </div>
            <div className="cap-row-wrap">
              <button type="button" className="btn btn-primary" onClick={() => void savePicked()} disabled={picked.length === 0}>
                <IconCheck /> Save to saved words
              </button>
              <button type="button" className="btn" onClick={() => void keepAsPhotoWord()}>
                Add as photo-word
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <PhotoLibrary />
    </div>
  );
}

/* ------------------------------------------------------------------ path 1: camera */

function CameraCard({ onCapture }: { onCapture: (blob: Blob) => void }) {
  const [mode, setMode] = useState<'intro' | 'opening' | 'live' | 'unsupported' | 'denied' | 'nodevice' | 'busy'>('intro');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);

  useEffect(() => {
    if (mode !== 'live') return;
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    video.srcObject = streamRef.current;
    void video.play().catch(() => setMode('busy'));
  }, [mode]);

  const request = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMode('unsupported');
      return;
    }
    setMode('opening');
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      setMode('live');
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      setMode(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'nodevice' : 'busy');
    }
  }, []);

  const shoot = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      setMode('busy');
      return;
    }
    context.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) onCapture(blob);
    }, 'image/png');
    stop();
    setMode('intro');
  }, [onCapture, stop]);

  return (
    <div className="card cap-path">
      <h2>1. Take a photo</h2>
      <p>Your browser will ask permission first. Declining only disables this path.</p>
      {mode === 'live' ? (
        <div className="cap-videobox">
          <video ref={videoRef} muted playsInline aria-label="Camera preview" />
        </div>
      ) : null}
      {mode === 'denied' ? (
        <p className="notice notice-warn" role="status">Camera permission was declined. Upload the photo instead, or type the text — both keep working.</p>
      ) : null}
      {mode === 'unsupported' ? (
        <p className="notice notice-warn" role="status">This browser does not expose a camera to web pages. Upload the photo instead, or type the text.</p>
      ) : null}
      {mode === 'nodevice' ? (
        <p className="notice notice-warn" role="status">No camera was found on this device. Upload the photo instead, or type the text.</p>
      ) : null}
      {mode === 'busy' ? (
        <p className="notice notice-warn" role="status">The camera could not start — another app may be using it. Upload the photo instead, or type the text.</p>
      ) : null}
      <div className="cap-path-actions">
        {mode === 'live' ? (
          <>
            <button type="button" className="btn btn-primary" onClick={shoot}>
              <IconCamera /> Capture
            </button>
            <button type="button" className="btn" onClick={() => { stop(); setMode('intro'); }}>
              Close camera
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void request()} disabled={mode === 'opening'}>
            <IconCamera /> {mode === 'opening' ? 'Waiting for permission…' : 'Open the camera'}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ path 3: typing */

function TypeCard({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="card cap-path">
      <h2>3. Type or paste text</h2>
      <p>No recognition needed — fastest when you can already read the characters.</p>
      <div className="field">
        <label htmlFor="cap-type">Chinese text</label>
        <textarea id="cap-type" className="textarea cjk" value={text} onChange={(event) => setText(event.target.value)} placeholder="例如：我想要一杯咖啡" />
      </div>
      <div className="cap-path-actions">
        <button type="button" className="btn btn-primary" onClick={() => onSubmit(text)} disabled={!text.trim()}>
          <IconPen /> Use this text
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ gloss panel */

function Gloss({ focus, prefs }: { focus: { label: string; entries: DictEntry[] }; prefs: Preferences }) {
  return (
    <div className="card card-tight cap-gloss" role="region" aria-label="Dictionary glosses for the selection">
      <p className="text-sm muted">{focus.label}</p>
      {focus.entries.length === 0 ? <p className="muted text-sm">No dictionary line matched that text in the data installed on this device.</p> : null}
      {focus.entries.map((entry) => (
        <div className="cap-gloss-entry" key={entry.id}>
          <div className="row">
            <HanziText entry={entry} size="md" />
            {prefs.showPinyin ? <PinyinText entry={entry} /> : null}
            <span className="spacer" />
            <SpeakButton text={entry.simplified} />
            <SaveButton entry={entry} />
          </div>
          <DefinitionText entry={entry} />
          <Link className="btn btn-sm btn-ghost" to={`/entry/${encodeURIComponent(entry.id)}`}>
            Open full entry
          </Link>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ kept captures */

function PhotoLibrary() {
  const photos = useLiveQuery(() => db.photos.orderBy('createdAt').reverse().toArray(), [], []);
  const imageBytes = useLiveQuery(async () => (await db.photoImages.toArray()).reduce((sum, row) => sum + row.blob.size, 0), [], 0);
  const [confirm, setConfirm] = useState(false);
  const toast = useToast();

  const removeOne = async (row: PhotoWord) => {
    await db.transaction('rw', db.photos, db.photoImages, async () => {
      if (row.imageKey) await db.photoImages.delete(row.imageKey);
      await db.photos.delete(row.id);
    });
    toast.push('Capture deleted');
  };

  const removeAllImages = async () => {
    await db.transaction('rw', db.photos, db.photoImages, async () => {
      await db.photoImages.clear();
      await db.photos.toCollection().modify((photo) => {
        delete photo.imageKey;
      });
    });
    toast.push('All captured images deleted — the words you saved are untouched');
  };

  return (
    <section className="card cap-column" aria-label="Kept captures">
      <div className="section-title">
        <h2>Kept on this device</h2>
        <span className="spacer" />
        <span className="badge">{formatBytes(imageBytes)} of images</span>
      </div>
      {photos.length === 0 ? (
        <EmptyState
          title="Nothing kept yet"
          detail="Captures are only stored when you press “Add as photo-word”, and images only when you tick “Keep this image”."
          icon={<IconCamera />}
        />
      ) : (
        <>
          <ul className="cap-photolist">
            {photos.map((photo) => (
              <li className="cap-photo" key={photo.id}>
                {photo.imageKey ? <Thumb imageKey={photo.imageKey} /> : <div className="cap-thumb-missing">Image not kept</div>}
                <p className="text-sm cjk" lang="zh">{photo.corrected.slice(0, 60) || '（no text）'}</p>
                <p className="text-sm faint">
                  {new Date(photo.createdAt).toLocaleString()} · {photo.entryIds.length} word{photo.entryIds.length === 1 ? '' : 's'}
                  {photo.recognized ? ' · raw recognition kept' : ''}
                </p>
                <span className="cap-photo-foot">
                  <button type="button" className="btn btn-sm" onClick={() => void removeOne(photo)}>
                    <IconTrash /> Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="cap-row-wrap">
            <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)} disabled={imageBytes === 0}>
              <IconTrash /> Delete all captured images
            </button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirm}
        title="Delete every captured image?"
        body={<p>The photos stored by this screen are removed from IndexedDB. Saved words, lists and capture text stay.</p>}
        confirmLabel="Delete images"
        danger
        onConfirm={() => void removeAllImages()}
        onCancel={() => setConfirm(false)}
      />
    </section>
  );
}

function Thumb({ imageKey }: { imageKey: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let created: string | null = null;
    let alive = true;
    void db.photoImages.get(imageKey).then((row) => {
      if (!row || !alive) return;
      created = URL.createObjectURL(row.blob);
      setUrl(created);
    });
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [imageKey]);
  return url ? <img className="cap-thumb" src={url} alt="Captured photo" /> : <div className="cap-thumb-missing">Loading…</div>;
}

/** `/learn/:id` — one item, rendered straight from its packed JSON blocks.
 *
 *  No text is ever composed here: the blocks come from a checksum-verified content pack, and an
 *  unknown id gets a not-found screen instead of a made-up lesson. Chinese lines are matched
 *  against the on-device dictionary so every Hanzi run is tappable. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AttributionNote,
  EmptyState,
  EntryLine,
  LoadingGate,
  PageHeader,
} from '../../components';
import { IconAlert, IconCheck } from '../../app/icons';
import { useDictionary, usePreferences, useSavedWords, useToast } from '../../app/providers';
import { db, bumpActivity, todayKey } from '../../data/db';
import { inspectSpeech, onVoicesChanged, type SpeechSupport } from '../../data/speech';
import type { DictEntry } from '../../domain/types';
import { BlockView, type WordTap } from './ContentBlocks';
import {
  chineseTexts,
  itemStats,
  loadContentItem,
  useReadMarks,
} from './contentSource';
import './content.css';

const KIND_LABEL: Record<string, string> = {
  tip: 'Study tip',
  lesson: 'Lesson',
  story: 'Short story',
  article: 'Article',
};

export default function ContentPage() {
  const { id = '' } = useParams();
  const toast = useToast();
  const { prefs, update } = usePreferences();
  const { api } = useDictionary();
  const { isSaved, save } = useSavedWords();
  const { marks, toggle: toggleMark } = useReadMarks();

  const result = useLiveQuery(() => loadContentItem(id), [id]);
  const lists = useLiveQuery(() => db.wordLists.orderBy('name').toArray(), [], []);

  const [selected, setSelected] = useState<WordTap | null>(null);
  const [listId, setListId] = useState('');
  const [candidates, setCandidates] = useState<DictEntry[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [speech, setSpeech] = useState<SpeechSupport>(() => inspectSpeech(prefs.ttsLang));

  const item = result?.item;

  useEffect(() => {
    const refresh = () => setSpeech(inspectSpeech(prefs.ttsLang));
    refresh();
    return onVoicesChanged(refresh);
  }, [prefs.ttsLang]);

  /* Which words in this item does the local dictionary actually know? */
  useEffect(() => {
    if (!api || !item) {
      setCandidates(null);
      return;
    }
    let alive = true;
    setScanning(true);
    void (async () => {
      const found = new Map<string, DictEntry>();
      for (const text of chineseTexts(item)) {
        const spans = await api.spans(text);
        for (const span of spans) {
          const entry = span.entries[0];
          if (entry && !found.has(entry.id)) found.set(entry.id, entry);
        }
      }
      if (!alive) return;
      setCandidates([...found.values()]);
      setScanning(false);
    })().catch(() => {
      if (alive) {
        setCandidates([]);
        setScanning(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [api, item]);

  const fresh = useMemo(
    () => (candidates ?? []).filter((entry) => !isSaved(entry.id)),
    [candidates, isSaved],
  );

  const collect = useCallback(async () => {
    const chosen = lists.find((list) => list.id === listId);
    let added = 0;
    try {
      for (const entry of fresh) {
        await save(entry, chosen ? [chosen.id] : []);
        added += 1;
      }
      toast.push({
        message: `Added ${added} word${added === 1 ? '' : 's'} to ${chosen ? chosen.name : 'saved words'}`,
        tone: 'info',
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      toast.push({ message: `Stopped after ${added}: ${reason}`, tone: 'danger' });
    }
  }, [fresh, lists, listId, save, toast]);

  const markRead = useCallback(
    async (read: boolean) => {
      if (!item) return;
      const wasRead = marks.has(item.id);
      await toggleMark(item.id, read);
      if (read && !wasRead) await bumpActivity(todayKey(), { readings: 1 });
    },
    [item, marks, toggleMark],
  );

  const pinyinHiddenByStyle = prefs.pinyinStyle === 'none';
  const showPinyin = prefs.showPinyin && !pinyinHiddenByStyle;

  const body = !result ? (
    <div className="stack" role="status" aria-live="polite">
      <div className="skeleton" style={{ height: 32, width: '50%' }} />
      <div className="skeleton" style={{ height: 120 }} />
      <p className="text-sm faint">Reading the installed content packs…</p>
    </div>
  ) : !item ? (
    <div className="stack">
      <PageHeader
        title="This item is not on this device"
        back={{ label: 'Back to Learn', to: '/learn' }}
        subtitle={`Nothing in the content packs has the id “${id}”.`}
      />
      <EmptyState
        icon={<IconAlert />}
        title="No text to show"
        detail={
          result.registryError
            ? `The pack registry could not be read: ${result.registryError}`
            : 'This app only shows lessons written for it, straight out of a verified content pack. It will not substitute text it does not have.'
        }
        action={
          <Link to="/learn" className="btn btn-sm btn-primary">
            Browse what is installed
          </Link>
        }
      />
      {result.problems.length > 0 ? (
        <p className="notice notice-warn text-sm" role="alert">
          <IconAlert /> {result.problems.join(' · ')}
        </p>
      ) : null}
    </div>
  ) : (
    <div className="stack learn-item">
      <PageHeader
        title={item.title}
        back={{ label: 'Back to Learn', to: '/learn' }}
        subtitle={item.summary}
        actions={
          <button
            type="button"
            className="btn btn-sm"
            aria-pressed={marks.has(item.id)}
            onClick={() => void markRead(!marks.has(item.id))}
          >
            {marks.has(item.id) ? <IconCheck /> : null}
            {marks.has(item.id) ? 'Read' : 'Mark as read'}
          </button>
        }
      />

      <div className="learn-badges">
        <span className="badge">{KIND_LABEL[item.kind] ?? item.kind}</span>
        <span className="badge">{item.level}</span>
        {item.tags.map((tag) => (
          <Link key={tag} to={`/learn?q=${encodeURIComponent(tag)}`} className="chip">
            #{tag}
          </Link>
        ))}
      </div>

      <div className="learn-toolbar">
        <label className="switch">
          <input
            type="checkbox"
            checked={prefs.showPinyin}
            onChange={(event) => update({ showPinyin: event.target.checked })}
          />
          <span>Show pinyin on this item</span>
        </label>
        <span className="text-sm faint">
          {pinyinHiddenByStyle
            ? 'Pinyin style is set to “none” in Settings, so pinyin stays hidden until you change it.'
            : 'Saved as your reading preference; it follows you to every item.'}
        </span>
        <span className="spacer" />
        <span className="text-sm faint">
          {itemStats(item).zhLines} Chinese lines · tap any Hanzi word to look it up
        </span>
      </div>

      {speech.available && !speech.chineseVoice ? (
        <div className="notice notice-warn" role="status">
          <div>
            <strong>No Chinese voice on this device</strong>
            <p className="text-sm">
              {speech.reason ?? 'No zh voice found.'} The speaker buttons will report this instead
              of playing the wrong language. Install a Chinese voice in your system settings, or read
              with the pinyin line shown.{' '}
              <Link to="/settings">Voice settings</Link>
            </p>
          </div>
        </div>
      ) : null}
      {!speech.available ? (
        <p className="notice text-sm" role="status">
          {speech.reason ?? 'This browser has no speech synthesis, so audio is unavailable here.'}
        </p>
      ) : null}

      {item.blocks.map((block, index) => (
        <BlockView
          key={`${index}-${block.type}`}
          block={block}
          api={api}
          showPinyin={showPinyin}
          onWord={setSelected}
        />
      ))}

      {selected ? (
        <section className="card learn-panel" aria-live="polite" aria-label="Dictionary lookup">
          <div className="row">
            <h2 className="learn-block-title" lang="zh">
              {selected.text}
            </h2>
            <span className="spacer" />
            <button type="button" className="btn btn-sm" onClick={() => setSelected(null)}>
              Close
            </button>
          </div>
          {selected.entries.length === 0 ? (
            <p className="text-sm muted">
              The dictionary installed on this device has no entry for that run of characters, so
              there is nothing to show.
            </p>
          ) : (
            <>
              <ul className="list">
                {selected.entries.slice(0, 6).map((entry) => (
                  <EntryLine key={entry.id} entry={entry} matchLabel={entry.length > 1 ? 'word' : 'char'} />
                ))}
              </ul>
              {selected.entries.length > 6 ? (
                <p className="text-sm faint">{selected.entries.length - 6} more readings in the dictionary.</p>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      <section className="card" aria-labelledby="learn-collect">
        <h2 id="learn-collect">Collect the words in this item</h2>
        <p className="text-sm muted" role="status" aria-live="polite">
          {scanning
            ? 'Matching this item’s Chinese against the dictionary on this device…'
            : candidates === null
              ? 'The dictionary index is not available, so words cannot be matched.'
              : `${candidates.length} dictionary word${candidates.length === 1 ? '' : 's'} appear in this item; ${
                  fresh.length
                } of them ${fresh.length === 1 ? 'is' : 'are'} not in your saved words yet.`}
        </p>
        <div className="field">
          <label htmlFor="learn-list">Add to list</label>
          <select
            id="learn-list"
            className="select"
            value={listId}
            onChange={(event) => setListId(event.target.value)}
          >
            <option value="">Saved words (no list)</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
          <span className="help">
            Lists you create live under{' '}
            <Link to="/library">Library</Link>; collected words stay on this device.
          </span>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={fresh.length === 0 || scanning || !api}
          onClick={() => void collect()}
        >
          {fresh.length === 0 ? 'Nothing new to collect' : `Add ${fresh.length} word${fresh.length === 1 ? '' : 's'}`}
        </button>
        {lists.length === 0 ? (
          <p className="text-sm faint">
            No word lists exist yet — the words go to your saved words until you make one.
          </p>
        ) : null}
      </section>

      <AttributionNote attribution={item.attribution} license={item.license} />
    </div>
  );

  return <LoadingGate>{body}</LoadingGate>;
}

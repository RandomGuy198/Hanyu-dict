/** Renders one validated content block.
 *
 *  Hanzi inside pack text is tappable: a dictionary word opens the lookup panel, a bare
 *  character opens `/character/:c`. Nothing is rendered unless `api.spans` matched it, so a
 *  character with no dictionary record stays plain text rather than a dead link. */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SpeakButton } from '../../components';
import { isHanCharacter } from '../../domain/pinyin';
import type { DictionaryApi } from '../../data/dictionary';
import type { ContentBlock, DictEntry, TextSpan } from '../../domain/types';

export interface WordTap {
  text: string;
  entries: DictEntry[];
}

interface Segment {
  text: string;
  /** Dictionary senses for this run, or null when the dictionary has no record for it. */
  entries: DictEntry[] | null;
}

/** Span lookups are pure functions of the text, so cache them for the session. */
const spanCache = new Map<string, TextSpan[]>();

function useWordSpans(text: string, api: DictionaryApi | null): TextSpan[] | null {
  const [spans, setSpans] = useState<TextSpan[] | null>(() => spanCache.get(text) ?? null);

  useEffect(() => {
    if (!api || !text) {
      setSpans(null);
      return;
    }
    const cached = spanCache.get(text);
    if (cached) {
      setSpans(cached);
      return;
    }
    let alive = true;
    void api
      .spans(text)
      .then((result) => {
        if (!alive) return;
        spanCache.set(text, result);
        setSpans(result);
      })
      .catch(() => {
        // A failed lookup must leave the text readable, not linkless-and-broken.
        if (alive) setSpans([]);
      });
    return () => {
      alive = false;
    };
  }, [api, text]);

  return spans;
}

function segmentText(text: string, spans: TextSpan[]): Segment[] {
  const chars = [...text];
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let cursor = 0;
  for (const span of ordered) {
    if (span.start < cursor || span.end > chars.length) continue;
    if (span.start > cursor) out.push({ text: chars.slice(cursor, span.start).join(''), entries: null });
    out.push({ text: chars.slice(span.start, span.end).join(''), entries: span.entries });
    cursor = span.end;
  }
  if (cursor < chars.length) out.push({ text: chars.slice(cursor).join(''), entries: null });
  return out;
}

function PlainPortion({ text }: { text: string }) {
  return (
    <>
      {[...text].map((character, index) =>
        isHanCharacter(character) ? (
          <Link
            key={`${index}-${character}`}
            to={`/character/${encodeURIComponent(character)}`}
            className="learn-char"
            lang="zh"
            title={`Character details for ${character}`}
          >
            {character}
          </Link>
        ) : (
          <span key={`${index}-${character}`}>{character}</span>
        ),
      )}
    </>
  );
}

export function PackText({
  text,
  api,
  onWord,
}: {
  text: string;
  api: DictionaryApi | null;
  onWord: (tap: WordTap) => void;
}) {
  const spans = useWordSpans(text, api);
  const segments = useMemo(() => segmentText(text, spans ?? []), [text, spans]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.entries ? (
          <button
            key={`${index}-${segment.text}`}
            type="button"
            className="learn-word"
            lang="zh"
            aria-label={`Look up ${segment.text}`}
            title={segment.entries[0]?.definition}
            onClick={() => onWord({ text: segment.text, entries: segment.entries ?? [] })}
          >
            {segment.text}
          </button>
        ) : (
          <PlainPortion key={`${index}-${segment.text.slice(0, 8)}`} text={segment.text} />
        ),
      )}
    </>
  );
}

function DialogueBlock({
  title,
  lines,
  api,
  showPinyin,
  onWord,
}: {
  title?: string;
  lines: { speaker: string; zh: string; py: string; en: string }[];
  api: DictionaryApi | null;
  showPinyin: boolean;
  onWord: (tap: WordTap) => void;
}) {
  return (
    <div className="learn-block">
      {title ? <h2 className="learn-block-title">{title}</h2> : null}
      <ul className="learn-dialogue">
        {lines.map((line, index) => (
          <li className="learn-line" key={`${index}-${line.speaker}`}>
            <span className="learn-speaker" lang="zh">
              {line.speaker}
            </span>
            <span>
              <span className="learn-zh-row">
                <span className="learn-zh" lang="zh">
                  <PackText text={line.zh} api={api} onWord={onWord} />
                </span>
                <SpeakButton text={line.zh} label={`Play ${line.zh} with the device voice`} compact />
              </span>
              {showPinyin && line.py ? (
                <span className="learn-py" lang="zh-Latn-pinyin">
                  {line.py}
                </span>
              ) : null}
              <span className="learn-en">{line.en}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BlockView({
  block,
  api,
  showPinyin,
  onWord,
}: {
  block: ContentBlock;
  api: DictionaryApi | null;
  showPinyin: boolean;
  onWord: (tap: WordTap) => void;
}) {
  if (block.type === 'text') {
    return (
      <div className="learn-block">
        <p className="learn-text">
          <PackText text={block.body} api={api} onWord={onWord} />
        </p>
      </div>
    );
  }
  if (block.type === 'note') {
    return (
      <aside className="learn-note">
        <span className="learn-note-label">Good to know</span>
        <p className="learn-text">
          <PackText text={block.body} api={api} onWord={onWord} />
        </p>
      </aside>
    );
  }
  if (block.type === 'list') {
    return (
      <div className="learn-block">
        {block.title ? <h2 className="learn-block-title">{block.title}</h2> : null}
        <ol className="learn-list">
          {block.body.map((entryText, index) => (
            <li key={`${index}-${entryText.slice(0, 12)}`}>
              <PackText text={entryText} api={api} onWord={onWord} />
            </li>
          ))}
        </ol>
      </div>
    );
  }
  return (
    <DialogueBlock
      title={block.title}
      lines={block.body}
      api={api}
      showPinyin={showPinyin}
      onWord={onWord}
    />
  );
}

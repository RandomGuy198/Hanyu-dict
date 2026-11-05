/** Shared UI vocabulary. Module screens compose from these so spacing, labels, keyboard
 *  behaviour and empty/error states stay consistent across the app. */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDictionary, usePreferences, useSavedWords, useToast } from '../app/providers';
import { IconChevronLeft, IconCheck, IconSpeaker, IconStar } from '../app/icons';
import { formatBytes, formatDate } from '../app/hooks';
import { playWordAudio } from '../data/audioPlayer';
import { entryId } from '../domain/searchRanking';
import { US } from '../domain/types';
import type { AudioSliceRef, DictEntry, Preferences } from '../domain/types';

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { label: string; to: string };
}) {
  return (
    <header className="page-header">
      {back ? (
        <Link to={back.to} className="btn btn-ghost btn-sm page-back">
          <IconChevronLeft /> {back.label}
        </Link>
      ) : null}
      <div className="row">
        <h1 tabIndex={-1}>{title}</h1>
        <span className="spacer" />
        {actions ? <div className="row">{actions}</div> : null}
      </div>
      {subtitle ? <p className="muted text-sm">{subtitle}</p> : null}
    </header>
  );
}

export function preferredHeadword(entry: DictEntry, prefs: Preferences): string {
  if (prefs.displayScript === 'traditional') return entry.traditional;
  return entry.simplified;
}

export function secondaryHeadword(entry: DictEntry, prefs: Preferences): string | null {
  if (prefs.displayScript === 'both' && entry.traditional !== entry.simplified) {
    return entry.traditional;
  }
  return null;
}

export function preferredPinyin(entry: DictEntry, prefs: Preferences): string {
  if (prefs.pinyinStyle === 'none') return '';
  return prefs.pinyinStyle === 'numbers' ? entry.pinyinNumbered : entry.pinyinMarked;
}

export function entryKey(entry: DictEntry): string {
  return entryId(entry.simplified, entry.pinyinNumbered);
}

/** Decode an entry id into the two fields the route needs. */
export function parseEntryKey(key: string): { simplified: string; pinyinNumbered: string } {
  const index = key.indexOf(US);
  return index === -1
    ? { simplified: key, pinyinNumbered: '' }
    : { simplified: key.slice(0, index), pinyinNumbered: key.slice(index + 1) };
}

export function HanziText({
  entry,
  size = 'md',
}: {
  entry: DictEntry;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const { prefs } = usePreferences();
  const primary = preferredHeadword(entry, prefs);
  const secondary = secondaryHeadword(entry, prefs);
  return (
    <span className={`hanzi hanzi-${size}`} lang="zh">
      <span className="hanzi-primary cjk">{primary}</span>
      {secondary ? <span className="hanzi-secondary cjk faint"> {secondary}</span> : null}
    </span>
  );
}

export function PinyinText({ entry }: { entry: DictEntry }) {
  const { prefs } = usePreferences();
  const text = preferredPinyin(entry, prefs);
  if (!text) return null;
  return <span className="pinyin">{text}</span>;
}

export function DefinitionText({ entry }: { entry: DictEntry }) {
  const glosses = useMemo(() => entry.definition.split('; ').filter(Boolean), [entry.definition]);
  const glossesVi = useMemo(() => {
    if (entry.definitionsVi?.length) return entry.definitionsVi.filter(Boolean);
    if (entry.definitionVi) return entry.definitionVi.split('; ').filter(Boolean);
    return [];
  }, [entry.definitionVi, entry.definitionsVi]);

  return (
    <span className="definition">
      {entry.hanViet ? <span className="badge han-viet-badge">[HV: {entry.hanViet}] </span> : null}
      {glossesVi.length > 0 ? (
        <span className="definition-vi">
          <strong>{glossesVi.join('; ')}</strong>
          {glosses.length > 0 ? ' — ' : ''}
        </span>
      ) : null}
      {glosses.length > 2 ? (
        <ol className="gloss-list">
          {glosses.map((gloss, index) => (
            <li key={`${index}-${gloss.slice(0, 12)}`}>{gloss}</li>
          ))}
        </ol>
      ) : (
        glosses.join('; ')
      )}
    </span>
  );
}

export function SpeakButton({
  text,
  pinyin,
  slice,
  lang,
  label,
  compact,
}: {
  text: string;
  pinyin?: string;
  slice?: AudioSliceRef;
  lang?: string;
  label?: string;
  compact?: boolean;
}) {
  const { prefs } = usePreferences();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`btn btn-ghost btn-icon ${compact ? 'btn-sm' : ''}`}
      aria-label={label ?? `Play synthetic audio for ${text}`}
      title={label ?? 'Play pronunciation audio'}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const result = await playWordAudio(text, pinyin, slice, {
          lang: lang ?? prefs.ttsLang,
          rate: prefs.ttsRate,
        });
        setBusy(false);
        if (!result.ok) toast.push({ message: result.reason ?? 'No audio available', tone: 'warn' });
      }}
    >
      <IconSpeaker />
    </button>
  );
}

export function SaveButton({ entry }: { entry: DictEntry }) {
  const { isSaved, toggle } = useSavedWords();
  const saved = isSaved(entry.id);
  return (
    <button
      type="button"
      className={`btn btn-ghost btn-icon ${saved ? 'is-saved' : ''}`}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${entry.simplified} from saved words` : `Save ${entry.simplified}`}
      onClick={() => void toggle(entry)}
    >
      {saved ? <IconCheck /> : <IconStar />}
    </button>
  );
}

export function EntryLine({
  entry,
  onOpen,
  trailing,
  matchLabel,
}: {
  entry: DictEntry;
  onOpen?: (entry: DictEntry) => void;
  trailing?: ReactNode;
  matchLabel?: string;
}) {
  const navigate = useNavigate();
  const { prefs } = usePreferences();
  return (
    <li className="entry-line">
      <button
        type="button"
        className="item entry-line-main"
        onClick={() => (onOpen ? onOpen(entry) : navigate(`/entry/${encodeURIComponent(entry.id)}`))}
      >
        <span className="item-main">
          <span className="row">
            <HanziText entry={entry} />
            <PinyinText entry={entry} />
          </span>
          <span className="definition-row">
            <DefinitionText entry={entry} />
          </span>
        </span>
        <span className="item-side">
          {matchLabel ? <span className="badge">{matchLabel}</span> : null}
          {prefs.displayScript === 'both' && entry.traditional !== entry.simplified ? (
            <span className="badge">简 / 繁</span>
          ) : null}
        </span>
      </button>
      <span className="entry-line-actions">
        <SpeakButton text={preferredHeadword(entry, prefs)} pinyin={entry.pinyinNumbered} />
        <SaveButton entry={entry} />
        {trailing}
      </span>
    </li>
  );
}

export function EmptyState({
  title,
  detail,
  action,
  icon,
}: {
  title: string;
  detail?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      {detail ? <div className="text-sm">{detail}</div> : null}
      {action}
    </div>
  );
}

export function ProgressBar({
  value,
  total,
  label,
}: {
  value: number;
  total: number;
  label?: string;
}) {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div
      className="progress"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  const id = useId();
  return (
    <div className="segmented" role="radiogroup" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="visually-hidden">
        {label}
      </span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={`chip ${option.value === value ? 'is-active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Native dialog keeps focus trapping, Escape and restore-behaviour correct for us. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      onClick={(event) => {
        if (event.target === ref.current) onCancel();
      }}
    >
      <div className="dialog">
        <h2 id="confirm-title">{title}</h2>
        {body}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              onConfirm();
              ref.current?.close();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** One place decides what "the dictionary is not ready" looks like. */
export function LoadingGate({ children }: { children: ReactNode }) {
  const { state, install, reload } = useDictionary();
  const ready = state.phase === 'ready';
  if (ready) return <>{children}</>;
  if (state.phase === 'error') {
    return (
      <div className="stack">
        <div className="notice notice-danger" role="alert">
          <div>
            <strong>Chưa tải được dữ liệu từ điển</strong>
            <p>{state.error ?? state.message}</p>
            <p className="text-sm faint">
              Từ đã lưu, ghi chú và lịch ôn tập vẫn còn nguyên. Kiểm tra màn Dữ liệu &amp; đồng bộ
              rồi thử lại.
            </p>
            <button type="button" className="btn btn-sm" onClick={() => void reload()}>
              Thử lại
            </button>
          </div>
        </div>
        <Link to="/data" className="btn btn-sm">
          Quản lý dữ liệu đã tải
        </Link>
      </div>
    );
  }
  const percent =
    install && install.totalBytes > 0
      ? Math.round((install.bytes / install.totalBytes) * 100)
      : state.total > 0
        ? Math.round((state.done / state.total) * 100)
        : null;
  return (
    <div className="stack" role="status" aria-live="polite">
      <h1>{state.phase === 'installing' ? 'Downloading dictionary data' : 'Preparing the dictionary'}</h1>
      <p className="muted text-sm">
        {install
          ? `File ${install.file} of ${install.files} (${formatBytes(install.bytes)} of ${formatBytes(install.totalBytes)})`
          : state.message}
      </p>
      <ProgressBar value={percent ?? 0} total={100} label="Dictionary download progress" />
      <p className="text-sm faint">
        About 22 MB of open-licensed data, once. Everything afterwards works with no connection.
      </p>
      {percent === null ? <div className="skeleton" style={{ height: 12 }} /> : null}
    </div>
  );
}

export function AttributionNote({
  attribution,
  license,
  version,
}: {
  attribution: string;
  license?: string;
  version?: string;
}) {
  return (
    <p className="attribution text-sm faint">
      Source: {attribution}
      {license ? ` — licensed ${license}` : ''}
      {version ? ` (data version ${version})` : ''}
      {' · '}
      <Link to="/about#licenses">licence details</Link>
    </p>
  );
}

export function LastUpdated({ iso }: { iso?: string }) {
  return <span className="faint text-sm">updated {formatDate(iso)}</span>;
}

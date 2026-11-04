/** App-wide providers: preferences (persisted + applied to the document), toasts, and the
 *  dictionary index. Every screen gets its data through these hooks. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ensurePreferences, savePreferences } from '../data/db';
import { createDictionary, type DictionaryApi, type LoadState } from '../data/dictionary';
import { ensureRequiredPacks, type InstallProgress } from '../data/packs';
import type { DictEntry, Preferences, SavedWord } from '../domain/types';
import { DEFAULT_PREFERENCES } from '../domain/types';

/* ------------------------------------------------------------------ preferences */

interface PreferencesValue {
  prefs: Preferences;
  ready: boolean;
  update: (patch: Partial<Preferences>) => void;
  reset: () => void;
}

const PreferencesContext = createContext<PreferencesValue>({
  prefs: DEFAULT_PREFERENCES,
  ready: false,
  update: () => undefined,
  reset: () => undefined,
});

function applyPreferences(prefs: Preferences): void {
  const root = document.documentElement;
  root.dataset.theme = prefs.theme;
  root.dataset.contrast = prefs.contrast;
  root.dataset.motion = prefs.reduceMotion ? 'reduced' : 'default';
  root.style.setProperty('--text-scale', String(prefs.textScale));
  root.lang = 'en';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', prefs.theme === 'dark' ? '#131a17' : '#1f6f5c');
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void ensurePreferences().then((loaded) => {
      if (!alive) return;
      setPrefs(loaded);
      applyPreferences(loaded);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback((patch: Partial<Preferences>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      applyPreferences(next);
      void savePreferences(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => update({ ...DEFAULT_PREFERENCES }), [update]);

  const value = useMemo(() => ({ prefs, ready, update, reset }), [prefs, ready, update, reset]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  return useContext(PreferencesContext);
}

/* ------------------------------------------------------------------ toasts */

export interface Toast {
  id: number;
  message: string;
  tone?: 'info' | 'warn' | 'danger';
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastValue {
  push: (toast: Omit<Toast, 'id'> | string) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastValue>({ push: () => 0, dismiss: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, 'id'> | string) => {
      const id = nextId.current++;
      const record: Toast = typeof toast === 'string' ? { id, message: toast } : { id, ...toast };
      setToasts((current) => [...current.slice(-2), record]);
      window.setTimeout(() => dismiss(id), record.actionLabel ? 9000 : 4200);
      return id;
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div className={`toast toast-${toast.tone ?? 'info'}`} key={toast.id}>
            <span>{toast.message}</span>
            {toast.actionLabel ? (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  toast.onAction?.();
                  dismiss(toast.id);
                }}
              >
                {toast.actionLabel}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  return useContext(ToastContext);
}

/* ------------------------------------------------------------------ dictionary */

interface DictionaryValue {
  state: LoadState;
  api: DictionaryApi | null;
  install: InstallProgress | null;
  /** Re-run pack download + index build, e.g. after the user installs a pack. */
  reload: () => Promise<void>;
}

const DictionaryContext = createContext<DictionaryValue>({
  state: { phase: 'idle', message: 'Not started', done: 0, total: 0 },
  api: null,
  install: null,
  reload: async () => undefined,
});

export function DictionaryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LoadState>({ phase: 'idle', message: 'Not started', done: 0, total: 0 });
  const [install, setInstall] = useState<InstallProgress | null>(null);
  const [api, setApi] = useState<DictionaryApi | null>(null);
  const attempt = useRef(0);

  const boot = useCallback(async () => {
    const run = ++attempt.current;
    setState({ phase: 'installing', message: 'Checking which data packs are installed', done: 0, total: 1 });
    try {
      await ensureRequiredPacks((progress) => {
        if (run === attempt.current) setInstall(progress);
      });
      if (run !== attempt.current) return;
      setInstall(null);
      const created = await createDictionary((next) => {
        if (run === attempt.current) setState(next);
      });
      if (run !== attempt.current) return;
      setApi(created.api);
    } catch (error) {
      if (run !== attempt.current) return;
      setState({
        phase: 'error',
        message: 'The dictionary data could not be prepared on this device.',
        done: 0,
        total: 1,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  const value = useMemo(() => ({ state, api, install, reload: boot }), [state, api, install, boot]);
  return <DictionaryContext.Provider value={value}>{children}</DictionaryContext.Provider>;
}

export function useDictionary(): DictionaryValue {
  return useContext(DictionaryContext);
}

/* ------------------------------------------------------------------ saved words */

interface SavedValue {
  saved: SavedWord[];
  isSaved: (entryId: string) => boolean;
  toggle: (entry: DictEntry, listIds?: string[]) => Promise<boolean>;
  save: (entry: DictEntry, listIds?: string[]) => Promise<void>;
  unsave: (entryId: string) => Promise<void>;
}

const SavedContext = createContext<SavedValue>({
  saved: [],
  isSaved: () => false,
  toggle: async () => false,
  save: async () => undefined,
  unsave: async () => undefined,
});

export function SavedWordsProvider({ children }: { children: ReactNode }) {
  const saved = useLiveQuery(() => db.savedWords.orderBy('addedAt').reverse().toArray(), [], []);
  const toast = useToast();

  const ids = useMemo(() => new Set(saved.map((row) => row.id)), [saved]);

  const save = useCallback(
    async (entry: DictEntry, listIds: string[] = []) => {
      const row: SavedWord = {
        id: entry.id,
        addedAt: new Date().toISOString(),
        lists: listIds,
        simplified: entry.simplified,
        traditional: entry.traditional,
        pinyinMarked: entry.pinyinMarked,
        definition: entry.definition,
      };
      await db.savedWords.put(row);
      toast.push(`Saved ${entry.simplified}`);
    },
    [toast],
  );

  const unsave = useCallback(
    async (entryId: string) => {
      await db.savedWords.delete(entryId);
      toast.push('Removed from saved words');
    },
    [toast],
  );

  const toggle = useCallback(
    async (entry: DictEntry, listIds?: string[]) => {
      if (ids.has(entry.id)) {
        await db.savedWords.delete(entry.id);
        toast.push('Removed from saved words');
        return false;
      }
      await save(entry, listIds);
      return true;
    },
    [ids, save, toast],
  );

  const value = useMemo(
    () => ({ saved, isSaved: (entryId: string) => ids.has(entryId), toggle, save, unsave }),
    [saved, ids, toggle, save, unsave],
  );
  return <SavedContext.Provider value={value}>{children}</SavedContext.Provider>;
}

export function useSavedWords(): SavedValue {
  return useContext(SavedContext);
}

export function useAppReady(): boolean {
  const { state } = useDictionary();
  return state.phase === 'ready';
}

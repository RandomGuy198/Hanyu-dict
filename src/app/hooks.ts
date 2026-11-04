/** Small shared hooks and formatters used across modules. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useDebouncedValue<T>(value: T, delay = 180): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : digits)} ${units[exponent]}`;
}

export function formatDate(iso: string | undefined, now = new Date()): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  const diffDays = Math.round((now.getTime() - date.getTime()) / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays > 1 && diffDays < 30) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

/** Shareable search state lives in the query string (plan: `#/search?q=...`). */
export function useQueryState(name: string, fallback = ''): [string, (next: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(name) ?? fallback;
  const setValue = useMemo(
    () => (next: string) => {
      const updated = new URLSearchParams(params);
      if (next) updated.set(name, next);
      else updated.delete(name);
      setParams(updated, { replace: true });
    },
    [name, params, setParams],
  );
  return [value, setValue];
}

export function useIsWideScreen(breakpoint = 900): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(`(min-width: ${breakpoint}px)`).matches);
  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const handler = (event: MediaQueryListEvent) => setWide(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, [breakpoint]);
  return wide;
}

/** Focus the first heading after a route change, for screen-reader and keyboard users. */
export function useAnnounceRoute(path: string): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const heading = document.querySelector('main h1, main h2');
    if (heading instanceof HTMLElement) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }, [path]);
}

export function uid(prefix = ''): string {
  const random =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36).padStart(3, '0')}`;
  return `${prefix}${random}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

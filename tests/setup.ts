/**
 * Test environment for the spine (domain + data + shared components).
 *
 * Order matters here:
 *  1. `fake-indexeddb/auto` must run before Dexie is imported anywhere, because Dexie snapshots
 *     `globalThis.indexedDB` / `IDBKeyRange` at module-evaluation time (`domDeps` in the dexie
 *     bundle), and the app's `db` singleton is created at import.
 *  2. only then may this file import `src/data/db`, so it can reset the very singleton that the
 *     spine modules (packs / exportImport / db helpers) all use.
 *
 * `vite.config.ts` declares `environment: 'jsdom'` and `setupFiles: ['tests/setup.ts']` and does
 * NOT enable `globals`, so each test file imports its own `describe / it / expect` from 'vitest'.
 */
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import Dexie from 'dexie';
import { db } from '../src/data/db';

/* ---------------------------------------------------------------- globals jsdom lacks */

// jsdom's `window.crypto` has getRandomValues but no SubtleCrypto, so pack hash verification
// would always throw. Node's WebCrypto implements the same SHA-256 as a browser, so installing it
// keeps `sha256Hex` behaviour real instead of stubbing the digest away.
type CryptoWithSubtle = Crypto & { subtle: SubtleCrypto };
const cryptoGlobal = globalThis as unknown as { crypto?: CryptoWithSubtle };
if (!cryptoGlobal.crypto || !cryptoGlobal.crypto.subtle) {
  // Node's `webcrypto` is structurally the browser Crypto interface; jsdom simply does not expose
  // `subtle`, so a cast at the environment boundary is the only option.
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto as unknown as CryptoWithSubtle,
    configurable: true,
    writable: true,
  });
}

// jsdom implements neither matchMedia nor IndexedDB. The stub below keeps hooks such as
// `useIsWideScreen` from crashing when a shared component imports them.
if (typeof globalThis.matchMedia !== 'function') {
  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

/** Invariants every test file depends on; a broken setup fails loudly here, not later. */
async function assertEnvironment(): Promise<void> {
  expect(typeof globalThis.indexedDB?.open).toBe('function');
  expect(
    typeof (globalThis as unknown as { IDBKeyRange?: unknown }).IDBKeyRange,
  ).toBe('function');
  expect(typeof globalThis.crypto.subtle.digest).toBe('function');
  // Dexie snapshotted the fake factory at import time (after `fake-indexeddb/auto` above).
  expect(Dexie.dependencies.indexedDB).toBe(globalThis.indexedDB);
}

/* ---------------------------------------------------------------- database reset */

/** Empty every table of the shared database without dropping its schema. */
export async function resetDatabase(): Promise<void> {
  await Promise.all(db.tables.map((table) => table.clear()));
}

beforeEach(async () => {
  await assertEnvironment();
  await resetDatabase();
});

/* ---------------------------------------------------------------- console guard */

export interface ConsoleRecord {
  kind: 'error' | 'warn';
  text: string;
}

const captured: ConsoleRecord[] = [];
const noisePatterns: RegExp[] = [
  // React 18's act() advice is printed through console.error; our component tests settle
  // updates with `await` / findBy queries, so a stray warning here is worth failing on anyway.
  /not wrapped in act\(\)/,
  /React Router Future Flag Warning/,
];

/** Let a test declare console output it deliberately provoked. */
export function allowConsoleNoise(pattern: RegExp): void {
  noisePatterns.push(pattern);
}

export function takeConsoleNoise(): ConsoleRecord[] {
  return [...captured];
}

const nativeError = console.error;
const nativeWarn = console.warn;

function render(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

beforeEach(() => {
  captured.length = 0;
  console.error = (...args: unknown[]) => {
    captured.push({ kind: 'error', text: render(args) });
  };
  console.warn = (...args: unknown[]) => {
    captured.push({ kind: 'warn', text: render(args) });
  };
});

afterEach(() => {
  const offenders = captured.filter(
    (record) => !noisePatterns.some((pattern) => pattern.test(record.text)),
  );
  console.error = nativeError;
  console.warn = nativeWarn;
  if (offenders.length > 0) {
    throw new Error(
      `Unexpected console output during this test:\n${offenders
        .map((record) => `  [${record.kind}] ${record.text}`)
        .join('\n')}`,
    );
  }
});

/* ---------------------------------------------------------------- other resets */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

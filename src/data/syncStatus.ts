/**
 * A tiny observable for the GitHub sync indicator.
 *
 * `syncEngine.ts` owns the real state machine; this module is the seam the UI subscribes to, so the
 * shell can show a status pill without importing the engine (and therefore without pulling the
 * GitHub client into the first chunk). Plain listeners, no framework dependency.
 */

export type SyncPhase = 'disconnected' | 'idle' | 'syncing' | 'synced' | 'error' | 'offline';

export interface SyncStatus {
  phase: SyncPhase;
  /** ISO-8601 timestamp of the last successful pull or push. */
  lastSyncedAt?: string;
  /** Human-readable, token-free reason for `phase === 'error'`. */
  message?: string;
}

let current: SyncStatus = { phase: 'disconnected' };
const listeners = new Set<(status: SyncStatus) => void>();

export function getSyncStatus(): SyncStatus {
  return current;
}

export function setSyncStatus(next: Partial<SyncStatus> & { phase: SyncPhase }): void {
  current = { ...current, ...next };
  for (const listener of listeners) listener(current);
}

export function subscribeSyncStatus(listener: (status: SyncStatus) => void): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

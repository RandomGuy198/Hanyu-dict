/** Shared helpers for the end-to-end smoke tests. */

import { expect, type Page } from '@playwright/test';

export const APP_NAME = 'Hanyu Dictionary';

/** The two h1s `LoadingGate` shows while the first-run download and index build run. */
const GATE_HEADINGS = ['Downloading dictionary data', 'Preparing the dictionary'];

/** Opens a route and waits until the app itself, rather than the gate, is on screen.
 *
 *  A fresh browser profile has no data packs in IndexedDB, so this is the real first-run path:
 *  the required packs (about 15 MB) are fetched from this same origin, verified and installed.
 *  Timing that out is a genuine failure - it means a visitor would wait forever. */
export async function gotoReady(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(
    (gate: string[]) => !gate.includes(document.querySelector('h1')?.textContent?.trim() ?? ''),
    GATE_HEADINGS,
    { timeout: 180_000 },
  );
}

/** Waits until the service worker controls the page, which is what makes an offline reload a
 *  test of this build rather than of the browser's HTTP cache. `clientsClaim` is on, so a
 *  reload is normally enough for a first install to take control. */
export async function waitForControl(page: Page): Promise<void> {
  const claimed = () => navigator.serviceWorker.controller !== null;
  try {
    await page.waitForFunction(claimed, undefined, { timeout: 15_000 });
  } catch {
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(claimed, undefined, { timeout: 60_000 });
  }
}

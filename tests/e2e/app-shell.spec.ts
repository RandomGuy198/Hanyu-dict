/** The published shape of the site: security policy, install manifest, pack registry and the
 *  screens a first-time visitor reaches from the navigation. Run against the production build
 *  (`vite preview`), because dev-mode URLs are not what GitHub Pages serves. */

import { expect, test } from '@playwright/test';
import { APP_NAME, gotoReady } from './support';

test.describe('published shell', () => {
  test('serves its own CSP, manifest, registry and first pack shard', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    const html = await response.text();
    // GitHub Pages cannot send headers, so the policy has to be in the document itself.
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    // base './' means every emitted URL is relative; an absolute one would 404 under /<repo>/.
    expect(html).not.toMatch(/(?:src|href)="\/[^/]/);

    for (const path of [
      '/manifest.webmanifest',
      '/data/manifest.json',
      '/data/packs/dictionary-core/000.txt',
      '/licenses/THIRD_PARTY_NOTICES.md',
      '/licenses/RUNTIME_NOTICES.md',
      '/icons/icon-192.png',
    ]) {
      const asset = await request.get(path);
      expect(asset.status(), `${path} should be published`).toBe(200);
    }

    const registry = await (await request.get('/data/manifest.json')).json();
    expect(registry.schemaVersion).toBe(1);
    const required = registry.packs.filter((pack: { required: boolean }) => pack.required);
    expect(required.length).toBeGreaterThan(0);
    expect(required.map((pack: { id: string }) => pack.id)).toContain('dictionary-core');
  });

  test('installs the required data on first run, then shows the dictionary', async ({ page }) => {
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(String(error)));
    await gotoReady(page);
    await expect(page.getByRole('heading', { level: 1, name: APP_NAME })).toBeVisible();
    // The home search box is labelled in the interface language v0.2 settled on.
    await expect(
      page.getByLabel(/Tìm kiếm — Chữ Hán, Pinyin, Hán-Việt hoặc Tiếng Việt/).first(),
    ).toBeVisible();
    // The five primary destinations from D-22, in both the sidebar and the mobile bar.
    for (const label of ['Sách & Khóa học', 'Từ điển', 'Ôn tập', 'Tập viết', 'Sổ tay']) {
      await expect(page.getByRole('link', { name: label }).first(), label).toBeVisible();
    }
    expect(failures).toEqual([]);
  });

  test('retired screens redirect instead of breaking old bookmarks', async ({ page }) => {
    // `/capture` (camera/OCR) and `/offline-data` (manual packs) were removed in v0.2.
    await gotoReady(page, '/#/capture');
    await expect(page).toHaveURL(/#\/reader$/);
    await gotoReady(page, '/#/offline-data');
    await expect(page).toHaveURL(/#\/settings$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Cài đặt' })).toBeVisible();
  });

  test('the settings screen offers no device-voice picker', async ({ page }) => {
    await gotoReady(page, '/#/settings');
    await expect(page.getByRole('heading', { name: 'Âm thanh' })).toBeVisible();
    await expect(page.getByText(/Device text-to-speech only/)).toHaveCount(0);
    await expect(page.getByLabel(/Spoken language tag/)).toHaveCount(0);
  });

  test('the about screen names the upstream sources and links the licence texts', async ({ page }) => {
    await gotoReady(page, '/#/about');
    await expect(page.getByRole('link', { name: /third-party notices/i }).first()).toBeVisible();
    for (const source of ['CC-CEDICT', 'CVDICT', 'Unihan', 'Tatoeba']) {
      await expect(page.getByText(source, { exact: false }).first(), source).toBeVisible();
    }
    // R8: the share-alike duty is stated in the interface, not only in the notices file.
    await expect(
      page.getByText(/adapted from CC-CEDICT and CVDICT and are distributed under CC BY-SA 4\.0/),
    ).toBeVisible();
    // The runtime libraries are a separate licence layer from the data, and the audit that added them
    // is only worth anything if the screen that promises them actually renders them.
    await expect(page.getByRole('heading', { name: /bundled runtime libraries/i })).toBeVisible();
    // v0.2 retired camera OCR and the PDF engine; their notices must have gone with them.
    await expect(page.getByText(/tesseract/i)).toHaveCount(0);
    await expect(page.getByText(/pdf\.js/i)).toHaveCount(0);
  });

  test('an unknown address is explained instead of left blank', async ({ page }) => {
    await gotoReady(page, '/#/no-such-page');
    await expect(page.getByRole('heading', { level: 1, name: /does not exist/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Back to the dictionary/i })).toBeVisible();
  });
});

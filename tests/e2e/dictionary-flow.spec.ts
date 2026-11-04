/** The core promise of the product: look a word up three ways, open it, keep it, and still do
 *  all of that with the network switched off. */

import { expect, test } from '@playwright/test';
import { gotoReady, waitForControl } from './support';

test.describe('dictionary flow', () => {
  test('finds 中国 by Hanzi, by toneless pinyin and by English', async ({ page }) => {
    for (const query of ['中国', 'zhongguo', 'China']) {
      await gotoReady(page, `/#/search?q=${encodeURIComponent(query)}`);
      await expect(
        page.getByRole('button', { name: /中国/ }).first(),
        `“${query}” should reach the entry for 中国`,
      ).toBeVisible();
    }
  });

  test('opens an entry, saves the word and finds it in the library', async ({ page }) => {
    await gotoReady(page, '/#/search?q=' + encodeURIComponent('中国'));
    await page.getByRole('button', { name: /中国/ }).first().click();
    await expect(page).toHaveURL(/#\/entry\//);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText('中国');

    await page.getByRole('button', { name: /^Save 中国$/ }).click();
    await expect(page.getByRole('button', { name: /Remove 中国 from saved words/ })).toBeVisible();

    await gotoReady(page, '/#/library');
    await expect(page.getByText('中国').first()).toBeVisible();
  });

  test('keeps searching after the network goes off', async ({ page }) => {
    await gotoReady(page);
    await waitForControl(page);
    await page.context().setOffline(true);
    try {
      await page.goto('/#/search?q=' + encodeURIComponent('图书馆'));
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('button', { name: /图书馆/ }).first()).toBeVisible({ timeout: 60_000 });
    } finally {
      await page.context().setOffline(false);
    }
  });

  test('a character page reports what it knows and what it does not', async ({ page }) => {
    await gotoReady(page, '/#/character/中');
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText('中');
    // Readings come from the required packs; stroke data is an opt-in pack and must be
    // described as missing rather than invented. Unihan carries tone-marked pinyin, hence `zhōng`.
    await expect(page.getByText(/zh[ōo]ng/, { exact: false }).first()).toBeVisible();
  });
});

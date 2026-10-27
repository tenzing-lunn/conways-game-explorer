import { expect, test } from '@playwright/test';
import { clickBoard, snapshot, watchErrors } from './helpers.js';

test.afterEach(async ({ page }) => expect(page.errors).toEqual([]));

// Blocked site data (privacy settings, some in-app browsers) makes storage
// throw. The app must still start and the Playground must still run.
const blockedStorage = {
  'IndexedDB open fails': () => {
    IDBFactory.prototype.open = function () {
      const request = { result: null, error: new DOMException('blocked', 'InvalidStateError') };
      setTimeout(() => request.onerror?.(), 0);
      return request;
    };
  },
  'IndexedDB open throws': () => {
    IDBFactory.prototype.open = function () { throw new DOMException('denied', 'SecurityError'); };
  },
  'localStorage throws': () => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
    Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('denied', 'SecurityError'); } });
  },
};

for (const [name, block] of Object.entries(blockedStorage)) {
  test(`the Playground runs when ${name}`, async ({ page }) => {
    watchErrors(page);
    await page.addInitScript(block);
    await page.goto('/');
    await expect(page.locator('#population')).toHaveText('5');
    await page.locator('#play-toggle').click();
    await expect.poll(async () => (await snapshot(page)).generation).toBeGreaterThan(0);
    await page.locator('#play-toggle').click();
    await page.locator('#mode-community').click();
    await expect(page.locator('#community-panel')).toBeVisible();
  });
}

test('Studio saves for this visit when IndexedDB is blocked', async ({ page, isMobile }) => {
  watchErrors(page);
  await page.addInitScript(blockedStorage['IndexedDB open throws']);
  await page.goto('/studio');
  await clickBoard(page, isMobile, 0.46, 0.4);
  await expect(page.locator('#population')).toHaveText('1');
  await page.locator('#save-project').click();
  await expect(page.locator('#toast')).toHaveText('Saved for this visit only. This browser is blocking site storage.');
  await page.locator('#projects-back').click();
  await expect(page.locator('#projects-list .project-card[data-project-id]')).toHaveCount(1);
});

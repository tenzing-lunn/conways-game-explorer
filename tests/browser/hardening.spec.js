import { expect, test } from '@playwright/test';
import { RECOVERY_KEY, clickBoard, snapshot, watchErrors } from './helpers.js';

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

test('a malformed escape in a pattern link shows the unavailable state', async ({ page }) => {
  watchErrors(page);
  await page.goto('/');
  await page.evaluate(() => {
    history.pushState({}, '', '/c/%E0%A4%A');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('#community-detail')).toContainText('Pattern unavailable');
});

const shareHash = (payload) => `#build=${encodeURIComponent(JSON.stringify(payload))}`;

async function drawUnsavedDraft(page, isMobile) {
  await page.goto('/studio');
  await clickBoard(page, isMobile, 0.46, 0.4);
  await page.locator('#project-title').fill('My unsaved draft');
  await page.locator('#project-title').blur();
  // Wait for the debounced recovery save to land.
  await expect.poll(() => page.evaluate(async (key) => {
    const { readRecovery } = await import('/src/local-database.js');
    return (await readRecovery(key))?.title || null;
  }, RECOVERY_KEY)).toBe('My unsaved draft');
}

test('a share link asks before replacing an unsaved Studio draft', async ({ page, isMobile }) => {
  watchErrors(page);
  await drawUnsavedDraft(page, isMobile);
  const link = shareHash({ title: 'Shared one', ownerName: 'Ann', rle: 'x = 1, y = 1\no!' });

  const declined = page.waitForEvent('dialog').then((dialog) => { const message = dialog.message(); dialog.dismiss(); return message; });
  await page.goto(`/${link}`);
  expect(await declined).toContain('replaces your unsaved Studio work');
  await expect(page.locator('#project-title')).toHaveValue('My unsaved draft');
  expect(await page.evaluate(() => location.hash)).toBe('');

  page.once('dialog', (dialog) => dialog.accept());
  await page.goto(`/${link}`);
  await expect(page.locator('#project-title')).toHaveValue('Shared one');
  await expect(page.locator('#toast')).toHaveText('Opened a pattern shared by Ann');
  expect(await page.evaluate(() => location.hash)).toBe('');
});

test('a wide share link gets a board that holds it, and a pasted link opens in an open tab', async ({ page }) => {
  watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#population')).toHaveText('5');
  const ownerName = 'Life Lab Team — your draft was moved, see evil.example for details';
  await page.evaluate((hash) => { location.hash = hash; },
    shareHash({ title: 'Wide', ownerName, rle: 'x = 452, y = 2\n2o448b2o$2o448b2o!' }));
  await expect(page.locator('#project-title')).toHaveValue('Wide');
  expect(await page.evaluate(() => location.pathname + location.hash)).toBe('/studio');
  const { width, population } = await snapshot(page);
  expect(width).toBeGreaterThanOrEqual(452);
  expect(population).toBe(8);
  const xs = [...new Set((await page.evaluate(() => window.__lifeLab.liveCells())).map(([x]) => x))].sort((a, b) => a - b);
  expect(xs[2] - xs[0]).toBe(450);
  const toast = await page.locator('#toast').textContent();
  expect(toast.length).toBeLessThanOrEqual('Opened a pattern shared by '.length + 40);
  expect(toast).toMatch(/…$/);
});

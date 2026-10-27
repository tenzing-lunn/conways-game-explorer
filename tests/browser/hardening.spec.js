import { expect, test } from '@playwright/test';
import {
  RECOVERY_KEY, clickBoard, closeSheets, openInspector, openMoreMenu, pickGate, snapshot, watchErrors,
} from './helpers.js';

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
  const link = shareHash({ title: 'Shared one', ownerName: '\u202EAnn\u200B\u0007', rle: 'x = 1, y = 1\no!' });

  const declined = page.waitForEvent('dialog').then((dialog) => { const message = dialog.message(); dialog.dismiss(); return message; });
  await page.goto(`/${link}`);
  expect(await declined).toContain('replaces your unsaved Studio work');
  await expect(page.locator('#project-title')).toHaveValue('My unsaved draft');
  expect(await page.evaluate(() => location.hash)).toBe('');

  page.once('dialog', (dialog) => dialog.accept());
  await page.goto(`/${link}`);
  await expect(page.locator('#project-title')).toHaveValue('Shared one');
  await expect(page.locator('#toast')).toHaveText('Opened a pattern shared by “Ann”');
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
  expect(toast.length).toBeLessThanOrEqual('Opened a pattern shared by “”'.length + 40);
  expect(toast).toMatch(/^Opened a pattern shared by “Life Lab Team.*…”$/);
});

// The toast is on top: the element at its centre is the toast itself.
const toastOnTop = (page) => page.evaluate(() => {
  const toast = document.querySelector('#toast');
  const box = toast.getBoundingClientRect();
  return toast.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
});

test('publish problems show on screen, including on a phone', async ({ page, isMobile }) => {
  watchErrors(page);
  await page.goto('/studio');
  await clickBoard(page, isMobile, 0.46, 0.4);
  await openInspector(page, isMobile);
  await page.locator('#project-description').fill('short');
  const publish = page.locator('#publish-project:visible, #publish-project-mobile:visible');
  const toast = page.locator('#toast');
  await publish.click();
  await expect(toast).toHaveText('Add a description of at least 20 characters.');
  await expect(toast).toBeInViewport();
  expect(await toastOnTop(page)).toBe(true);

  await page.locator('#project-description').fill('A single cell that dies at once.');
  await page.locator('#project-tags').fill('test');
  await page.evaluate(() => window.__lifeLab.resizeBoard(2100, 2100));
  await openInspector(page, isMobile);
  await publish.click();
  await expect(toast).toHaveText('Boards must fit within 2,048 × 2,048 to publish.');
  await expect(toast).toBeInViewport();
  expect(await toastOnTop(page)).toBe(true);
});

// Writes one record straight into a local IndexedDB store, before the app loads.
async function seedIndexedDB(page, database, key, value) {
  await page.route('/__seed', (route) => route.fulfill({ body: '<html></html>', contentType: 'text/html' }));
  await page.goto('/__seed');
  await page.evaluate(({ database, key, value }) => new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => {
      const tx = request.result.transaction('records', 'readwrite');
      tx.objectStore('records').put(value, key);
      tx.oncomplete = () => { request.result.close(); resolve(); };
      tx.onerror = reject;
    };
    request.onerror = reject;
  }), { database, key, value });
}

test('hostile numbers in stored projects never become markup', async ({ page, isMobile }) => {
  watchErrors(page);
  const payload = '"><img src=x onerror="window.__xss=(window.__xss||0)+1">';
  const version = (extra) => ({ id: 'v1', versionNumber: 1, rle: 'x = 3, y = 1, rule = B3/S23\nooo!', width: 40, height: 40, generation: 0, population: 3, ...extra });
  const creation = {
    id: 'c1', ownerId: 'profile-local', ownerName: 'Me', title: 'Hostile', description: '', tags: [],
    visibility: 'public', slug: 'hostile', publishedAt: '2026-01-01T00:00:00Z', starCount: payload,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    previewConfig: { version: 1, grid: { columns: 6, rows: 5 }, cells: [[payload, 0], [1, 1]] },
    currentVersion: version({ id: 'v2', width: payload, height: payload, versionNumber: payload }),
    versions: [version({ versionNumber: payload }), version({ id: 'v2', width: payload, height: payload, versionNumber: 2 })],
  };
  await seedIndexedDB(page, 'life-logic-community-v1-projects-v2', 'state', { profile: null, activeCreationId: null, creations: [creation] });

  await page.goto('/community');
  await expect(page.locator('#community-grid article[data-creation-id="c1"]')).toBeVisible();
  await page.locator('#community-grid [data-community-action="open"][data-creation-id="c1"]').click();
  await expect(page.locator('#detail-title')).toHaveText('Hostile');
  await page.goto('/studio');
  await page.locator('#projects-back').click();
  await expect(page.locator('#projects-list [data-project-id="c1"]')).toContainText('0 × 0');
  await page.locator('#projects-list [data-project-id="c1"]').click();
  // A hostile stored width falls back to a real board size.
  await expect.poll(async () => (await snapshot(page)).population).toBe(3);
  expect(Number.isInteger((await snapshot(page)).width)).toBe(true);
  await openInspector(page, isMobile);
  await expect(page.locator('#version-history .version-row')).toHaveCount(2);
  expect(await page.evaluate(() => ({ xss: window.__xss || 0, images: document.querySelectorAll('img[src="x"]').length })))
    .toEqual({ xss: 0, images: 0 });
});

test('Space presses a focused button instead of toggling Play', async ({ page }) => {
  watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#population')).toHaveText('5');
  await page.locator('#step').focus();
  await page.keyboard.press(' ');
  await expect(page.locator('#generation')).toHaveText('1');
  await page.locator('#more-menu-toggle').focus();
  await page.keyboard.press(' ');
  await expect(page.locator('#more-menu')).toBeVisible();
  expect((await snapshot(page)).playing).toBe(false);
  // Escape still closes the menu, and letter shortcuts still work.
  await page.keyboard.press('Escape');
  await expect(page.locator('#more-menu')).toBeHidden();
  await page.keyboard.press('n');
  await expect(page.locator('#generation')).toHaveText('2');
});

test('reduced motion turns off sheet and toast transitions', async ({ page }) => {
  watchErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/studio');
  const durations = await page.evaluate(() => ['#inspector', '#rail', '#toast', '#play-toggle']
    .map((selector) => getComputedStyle(document.querySelector(selector)).transitionDuration));
  expect(durations.every((duration) => duration.split(',').every((part) => part.trim() === '0s'))).toBe(true);
});

test('a reload straight after an edit keeps that edit', async ({ page, isMobile }) => {
  watchErrors(page);
  await page.goto('/studio');
  await clickBoard(page, isMobile, 0.46, 0.4);
  await clickBoard(page, isMobile, 0.56, 0.46);
  await expect(page.locator('#population')).toHaveText('2');
  // Inside the 500 ms recovery debounce.
  await page.reload();
  await expect(page.locator('#population')).toHaveText('2');
});

test('Undo after clearing a circuit brings the circuit back, and Redo clears it again', async ({ page, isMobile }) => {
  watchErrors(page);
  await page.goto('/studio');
  await pickGate(page, isMobile, 'and');
  const gate = await snapshot(page);
  expect(gate.circuit).not.toBeNull();
  await closeSheets(page, isMobile);
  await openMoreMenu(page);
  await page.locator('#clear-board').click();
  await expect(page.locator('#population')).toHaveText('0');
  expect((await snapshot(page)).circuit).toBeNull();

  await page.locator('#undo').click();
  await expect.poll(async () => (await snapshot(page)).circuit).toBe(gate.circuit);
  expect((await snapshot(page)).population).toBe(gate.population);
  await openInspector(page, isMobile);
  await expect(page.locator('#circuit-section')).toBeVisible();
  await expect(page.locator('#inputs-list [data-input]')).toHaveCount(2);
  await closeSheets(page, isMobile);

  await page.locator('#redo').click();
  await expect.poll(async () => (await snapshot(page)).circuit).toBeNull();
  await expect(page.locator('#circuit-section')).toBeHidden();
});

for (const [platform, expected] of [['Win32', ['Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+C', 'Ctrl + scroll']], ['MacIntel', ['⌘Z', '⇧⌘Z', '⌘C', '⌘ + scroll']]]) {
  test(`the shortcut list names the right modifier on ${platform}`, async ({ page }) => {
    watchErrors(page);
    await page.addInitScript((platform) => {
      Object.defineProperty(navigator, 'platform', { get: () => platform });
      Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
    }, platform);
    await page.goto('/');
    const text = (await page.locator('#shortcuts-dialog .shortcut-list').textContent()).replace(/\s+/g, ' ');
    for (const label of expected) expect(text).toContain(label);
  });
}

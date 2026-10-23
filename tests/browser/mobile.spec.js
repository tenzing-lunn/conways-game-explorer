import { expect, test } from '@playwright/test';
import { backend, num, openInspector, openPatterns, pickGate, pickPattern, watchErrors } from './helpers.js';

test.beforeEach(async ({ page, isMobile }) => {
  watchErrors(page);
  test.skip(!isMobile, 'Phone layout only.');
});

test.afterEach(async ({ page }) => expect(page.errors, 'browser runtime errors').toEqual([]));

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

test('no workspace scrolls horizontally, with sheets closed or open', async ({ page, isMobile }) => {
  await page.goto('/');
  await expect(page.locator('#population')).toHaveText('5');
  expect(await overflow(page)).toBe(false);
  await openPatterns(page, isMobile);
  expect(await overflow(page)).toBe(false);
  await page.locator('#rail-close').click();
  await expect(page.locator('#rail')).toHaveAttribute('data-open', 'false');

  await page.goto('/studio');
  await expect(page.locator('#project-header')).toBeVisible();
  expect(await overflow(page)).toBe(false);
  await openInspector(page, isMobile);
  expect(await overflow(page)).toBe(false);

  await page.goto('/community');
  await expect(page.locator('#community-grid .community-card').first()).toBeVisible();
  expect(await overflow(page)).toBe(false);
  await page.locator('#community-grid [data-community-action="open"]').first().click();
  await expect(page.locator('#community-detail')).toBeVisible();
  expect(await overflow(page)).toBe(false);
});

test('the board gets most of the screen, the transport is reachable, and the status reads above it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#population')).toHaveText('5');
  const viewport = page.viewportSize();
  const board = await page.locator('#world').boundingBox();
  expect(board.height).toBeGreaterThanOrEqual(viewport.height * 0.55);
  expect(board.width).toBeGreaterThanOrEqual(viewport.width - 2);
  for (const id of ['#play-toggle', '#step', '#reset', '#speed-toggle', '#patterns-open']) {
    const box = await page.locator(id).boundingBox();
    expect(box, `${id} has a box`).toBeTruthy();
    expect(box.y + box.height, `${id} fits the viewport`).toBeLessThanOrEqual(viewport.height);
    expect(box.height, `${id} is a 40px target`).toBeGreaterThanOrEqual(40);
  }
  await expect(page.locator('#status-mobile')).toBeVisible();
  await expect(page.locator('#status-mobile')).toHaveText('Gen 0 · 5 cells');
  await expect(page.locator('#zoom-label')).toBeHidden();
  await expect(page.locator('#how-life-works')).toBeHidden();
});

test('the patterns sheet opens, closes after a pick, and the picked stamp plays', async ({ page, isMobile }) => {
  await page.goto('/');
  await expect(page.locator('#population')).toHaveText('5');
  const rail = page.locator('#rail');
  const railTop = () => page.evaluate(() => Math.round(document.querySelector('#rail').getBoundingClientRect().top));
  expect(await railTop()).toBeGreaterThanOrEqual(page.viewportSize().height - 1);

  await page.locator('#patterns-open').click();
  await expect(rail).toHaveAttribute('data-open', 'true');
  await expect(page.locator('#patterns-open')).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(railTop).toBeLessThan(page.viewportSize().height * 0.5);
  await expect(page.locator('#sheet-backdrop')).toBeVisible();

  await pickPattern(page, isMobile, 'glider');
  await expect(rail).toHaveAttribute('data-open', 'false');
  await expect.poll(railTop).toBeGreaterThanOrEqual(page.viewportSize().height - 1);
  await expect(page.locator('#sheet-backdrop')).toBeHidden();
  await expect(page.locator('#tool-group [data-tool="stamp"]')).toHaveAttribute('aria-checked', 'true');

  const board = await page.locator('#world').boundingBox();
  await page.touchscreen.tap(board.x + board.width * 0.3, board.y + board.height * 0.3);
  await expect.poll(() => num(page, '#population')).toBeGreaterThanOrEqual(10);
  await page.locator('#play-toggle').click();
  await expect(page.locator('#play-label')).toHaveText('Pause');
  await expect.poll(() => num(page, '#generation')).toBeGreaterThan(0);
  await page.locator('#play-toggle').click();
  await expect(page.locator('#play-label')).toHaveText('Play');
});

test('Studio collapses to title + Save and opens the inspector as a sheet', async ({ page, isMobile }) => {
  await page.goto('/studio');
  await expect(page.locator('#project-header')).toBeVisible();
  await expect(page.locator('#project-title')).toBeVisible();
  await expect(page.locator('#save-project')).toBeVisible();
  await expect(page.locator('#publish-project')).toBeHidden();
  await expect(page.locator('#save-state')).toBeHidden();
  const inspector = page.locator('#inspector');
  await expect(inspector).toHaveAttribute('data-open', 'false');
  await expect(page.locator('#inspector-toggle')).toBeVisible();

  await pickGate(page, isMobile, 'and');
  await expect(page.locator('#rail')).toHaveAttribute('data-open', 'false');
  await openInspector(page, isMobile);
  await expect(page.locator('#circuit-section')).toBeVisible();
  await expect(page.locator('#inputs-list [data-input]')).toHaveCount(2);
  await expect(page.locator('#publish-project-mobile')).toBeVisible();
  const inspectorTop = () => page.evaluate(() => Math.round(document.querySelector('#inspector').getBoundingClientRect().top));
  await expect.poll(inspectorTop).toBeLessThan(page.viewportSize().height * 0.5);
  await page.locator('#inspector-close').click();
  await expect(inspector).toHaveAttribute('data-open', 'false');
});

test('theme and account move into the top ⋯ menu', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#theme-toggle')).toBeHidden();
  await expect(page.locator('#account-entry')).toBeHidden();
  await page.locator('#top-menu-toggle').click();
  await expect(page.locator('#top-menu')).toHaveAttribute('data-open', 'true');
  await expect(page.locator('#theme-toggle')).toBeVisible();
  // Local builds have no accounts, so the entry stays hidden even inside the menu.
  if ((await backend(page)) === 'local') await expect(page.locator('#account-entry')).toBeHidden();
  else await expect(page.locator('#account-entry')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#top-menu')).toHaveAttribute('data-open', 'false');
});

import { expect, test } from '@playwright/test';
import { clickBoard, num, openMoreMenu, openPatterns, pickPattern, snapshot, watchErrors } from './helpers.js';

test.beforeEach(async ({ page }) => {
  watchErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle('Life Lab');
  await expect(page.locator('#population')).toHaveText('5');
});

test.afterEach(async ({ page }) => expect(page.errors, 'browser runtime errors').toEqual([]));

test('draws cells, then plays, steps and resets from the transport', async ({ page, isMobile }) => {
  await clickBoard(page, isMobile);
  await expect.poll(() => num(page, '#population')).not.toBe(5);
  const drawn = await num(page, '#population');

  await page.locator('#play-toggle').click();
  await expect(page.locator('#play-label')).toHaveText('Pause');
  await expect.poll(() => num(page, '#generation')).toBeGreaterThan(0);
  await page.locator('#play-toggle').click();
  await expect(page.locator('#play-label')).toHaveText('Play');

  await page.locator('#reset').click();
  await expect(page.locator('#generation')).toHaveText('0');
  await page.locator('#step').click();
  await expect(page.locator('#generation')).toHaveText('1');
  await page.locator('#step').click();
  await expect(page.locator('#generation')).toHaveText('2');
  await page.locator('#reset').click();
  await expect(page.locator('#generation')).toHaveText('0');
  await expect(page.locator('#population')).toHaveText(String(drawn));
});

test('keyboard shortcuts step, reset, play, switch tools, undo and fit', async ({ page, isMobile }) => {
  await page.keyboard.press('n');
  await expect(page.locator('#generation')).toHaveText('1');
  await page.keyboard.press('n');
  await expect(page.locator('#generation')).toHaveText('2');
  await page.keyboard.press('r');
  await expect(page.locator('#generation')).toHaveText('0');

  await page.keyboard.press(' ');
  await expect(page.locator('#play-label')).toHaveText('Pause');
  await expect.poll(() => num(page, '#generation')).toBeGreaterThan(0);
  await page.keyboard.press(' ');
  await expect(page.locator('#play-label')).toHaveText('Play');

  for (const [key, tool] of [['2', 'select'], ['4', 'pan'], ['1', 'draw']]) {
    await page.keyboard.press(key);
    await expect(page.locator(`#tool-group [data-tool="${tool}"]`)).toHaveAttribute('aria-checked', 'true');
  }
  await page.keyboard.press('3');
  await expect(page.locator('#tool-group [data-tool="stamp"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#toast')).toHaveText('Pick a pattern to stamp');
  // On phones the stamp shortcut also opens the pattern sheet; the first Escape closes it.
  if (isMobile) await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tool-group [data-tool="draw"]')).toHaveAttribute('aria-checked', 'true');

  await page.keyboard.press('r');
  await clickBoard(page, isMobile);
  await expect.poll(() => num(page, '#population')).not.toBe(5);
  const drawn = await num(page, '#population');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#population')).toHaveText('5');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#population')).toHaveText(String(drawn));

  expect((await snapshot(page)).zoom).toBe(1);
  await page.keyboard.press('f');
  await expect.poll(async () => (await snapshot(page)).zoom).not.toBe(1);
});

test('stamps a pattern repeatedly, transforms the stamp, and leaves stamp mode on Done or workspace change', async ({ page, isMobile }) => {
  await pickPattern(page, isMobile, 'glider');
  await expect(page.locator('#tool-group [data-tool="stamp"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#stamp-group')).toBeVisible();
  await expect(page.locator('#stamp-name')).toHaveText('Stamping: Glider');
  await page.locator('#stamp-rotate-right').click();
  await expect(page.locator('#stamp-name')).toHaveText('Stamping: Glider · 90°');
  await page.locator('#stamp-flip').click();
  await expect(page.locator('#stamp-flip')).toHaveAttribute('aria-pressed', 'true');

  await clickBoard(page, isMobile, 0.45, 0.38);
  await expect.poll(() => num(page, '#population')).toBeGreaterThan(5);
  const afterFirstStamp = await num(page, '#population');
  await clickBoard(page, isMobile, 0.6, 0.5);
  await expect.poll(() => num(page, '#population')).toBeGreaterThan(afterFirstStamp);
  await expect(page.locator('#tool-group [data-tool="stamp"]')).toHaveAttribute('aria-checked', 'true');

  await page.locator('#stamp-done').click();
  await expect(page.locator('#tool-group [data-tool="draw"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#stamp-group')).toBeHidden();

  await pickPattern(page, isMobile, 'gosper-gun');
  await expect(page.locator('#stamp-name')).toHaveText('Stamping: Gosper glider gun');
  await page.locator('#mode-community').click();
  await expect(page.locator('#community-panel')).toBeVisible();
  await expect(page.locator('#tool-group [data-tool="draw"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator('#mode-playground').click();
  await expect(page.locator('#community-panel')).toBeHidden();
  await expect(page.locator('#stamp-group')).toBeHidden();
});

test('undo and redo work, the ⋯ menu clears the board, and Random soup fills it', async ({ page, isMobile }) => {
  await clickBoard(page, isMobile);
  await expect.poll(() => num(page, '#population')).not.toBe(5);
  const drawn = await num(page, '#population');
  await page.locator('#undo').click();
  await expect(page.locator('#population')).toHaveText('5');
  await page.locator('#redo').click();
  await expect(page.locator('#population')).toHaveText(String(drawn));

  await pickPattern(page, isMobile, 'random-soup');
  await expect.poll(() => num(page, '#population')).toBeGreaterThan(500);
  await expect(page.locator('#tool-group [data-tool="draw"]')).toHaveAttribute('aria-checked', 'true');
  const soup = await num(page, '#population');

  await openMoreMenu(page);
  await page.locator('#clear-board').click();
  await expect(page.locator('#more-menu')).toBeHidden();
  await expect(page.locator('#population')).toHaveText('0');
  await expect(page.locator('#toast')).toHaveText('Board cleared');
  await page.locator('#undo').click();
  await expect.poll(() => num(page, '#population')).toBe(soup);
});

test('exports the board as RLE and imports RLE text as a stamp', async ({ page, isMobile }) => {
  const dialog = page.locator('#rle-dialog');
  await openMoreMenu(page);
  await page.locator('#export-rle').click();
  await expect(dialog).toBeVisible();
  await expect(page.locator('#rle-dialog-title')).toHaveText('Export RLE');
  await expect(page.locator('#rle-note')).toHaveText('5 live cells as RLE text.');
  await expect(page.locator('#rle-field')).toHaveValue(/x = 3, y = 3[\s\S]*!$/);
  await expect(page.locator('#rle-copy')).toBeVisible();
  await expect(page.locator('#rle-stamp')).toBeHidden();
  await page.locator('#rle-close').click();
  await expect(dialog).toBeHidden();

  await openMoreMenu(page);
  await page.locator('#import-rle').click();
  await expect(dialog).toBeVisible();
  await expect(page.locator('#rle-dialog-title')).toHaveText('Import RLE');
  await expect(page.locator('#rle-copy')).toBeHidden();
  await page.locator('#rle-field').fill('this is not RLE');
  await page.locator('#rle-stamp').click();
  await expect(page.locator('#rle-error')).toBeVisible();
  await expect(dialog).toBeVisible();

  await page.locator('#rle-field').fill('x = 3, y = 1, rule = B3/S23\n3o!');
  await page.locator('#rle-stamp').click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#tool-group [data-tool="stamp"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#stamp-name')).toHaveText('Stamping: Imported RLE');
  await clickBoard(page, isMobile, 0.4, 0.4);
  await expect.poll(() => num(page, '#population')).toBeGreaterThanOrEqual(8);
});

test('"How Life works" explains the rules in a popover and Escape closes it', async ({ page, isMobile }) => {
  if (isMobile) {
    await openMoreMenu(page);
    await page.locator('#how-life-works-mobile').click();
  } else {
    await page.locator('#how-life-works').click();
  }
  const popover = page.locator('#rules-popover');
  await expect(popover).toBeVisible();
  await expect(popover).toContainText('8 neighbours');
  await expect(popover.locator('.rules-list li')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();

  if (!isMobile) {
    await openMoreMenu(page);
    await page.locator('#shortcuts').click();
    await expect(page.locator('#shortcuts-dialog')).toBeVisible();
    await expect(page.locator('#shortcuts-dialog')).toContainText('Play / pause');
    await page.locator('#shortcuts-close').click();
    await expect(page.locator('#shortcuts-dialog')).toBeHidden();
  }
});

test('pattern tabs switch groups, search filters cards, and card names are not clipped', async ({ page, isMobile }) => {
  await openPatterns(page, isMobile);
  await expect(page.locator('[data-pattern-tab="start"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#pattern-list [data-pattern-id]').first()).toHaveAttribute('data-pattern-id', 'random-soup');
  await expect(page.locator('#pattern-list [data-pattern-id="glider"]')).toBeVisible();

  await page.locator('[data-pattern-tab="motion"]').click();
  await expect(page.locator('[data-pattern-tab="motion"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#pattern-list [data-pattern-id="toad"]')).toBeVisible();
  await expect(page.locator('#pattern-list [data-pattern-id="random-soup"]')).toHaveCount(0);

  await page.locator('#pattern-search').fill('puls');
  await expect(page.locator('#pattern-tabs')).toBeHidden();
  const ids = await page.locator('#pattern-list [data-pattern-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.patternId));
  expect(ids).toContain('pulsar');
  expect(ids).not.toContain('glider');
  await page.locator('#pattern-search').fill('zzzz');
  await expect(page.locator('#pattern-list .card-empty')).toHaveText('No patterns match.');
  await page.locator('#pattern-search').fill('');
  await expect(page.locator('#pattern-tabs')).toBeVisible();

  const clipped = await page.locator('#pattern-list .card-name').evaluateAll((nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth + 1).length);
  expect(clipped).toBe(0);
});

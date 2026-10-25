import { expect, test } from '@playwright/test';
import { num, openPatterns, snapshot, watchErrors } from './helpers.js';

// The Masterworks group of the Library: loadable famous patterns that grow the
// board to fit, and reference-only cards that link to their source.

test.beforeEach(async ({ page }) => {
  watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#population')).toHaveText('5');
});

test.afterEach(async ({ page }) => expect(page.errors, 'browser runtime errors').toEqual([]));

const listMasterworks = (page) => page.evaluate(async () => {
  const { masterworks } = await import('/src/masterworks.js');
  return masterworks.map((work) => ({
    id: work.id,
    name: work.name,
    discoverer: work.discoverer,
    year: work.year,
    loadable: Boolean(work.loadable),
    size: work.size,
    board: work.board,
    reason: work.reason || '',
    url: work.source?.url || '',
  }));
});

async function openMasterworks(page, isMobile) {
  await openPatterns(page, isMobile);
  await page.locator('[data-pattern-tab="masterworks"]').click();
  await expect(page.locator('[data-pattern-tab="masterworks"]')).toHaveAttribute('aria-selected', 'true');
}

const liveBounds = (page) => page.evaluate(() => {
  const cells = window.__lifeLab.liveCells();
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  return { count: cells.length, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
});

test('the group lists every masterwork with its name, discoverer and year; reference cards link out', async ({ page, isMobile }) => {
  const works = await listMasterworks(page);
  expect(works.length).toBeGreaterThan(0);
  await openMasterworks(page, isMobile);
  const cards = page.locator('#pattern-list [data-masterwork-id]');
  await expect(cards).toHaveCount(works.length);
  for (const work of works) {
    const card = page.locator(`#pattern-list [data-masterwork-id="${work.id}"]`);
    await expect(card).toContainText(work.name);
    await expect(card).toContainText(work.discoverer);
    if (work.year) await expect(card).toContainText(String(work.year));
    if (work.loadable) {
      await expect(card).toHaveJSProperty('tagName', 'BUTTON');
      await expect(card).toContainText(`${work.size.width.toLocaleString('en-US')} × ${work.size.height.toLocaleString('en-US')}`);
    } else {
      await expect(card).toHaveClass(/card-reference/);
      const link = card.locator('a.card-link');
      await expect(link).toHaveText(/Read about it/);
      await expect(link).toHaveAttribute('href', work.url);
      await expect(link).toHaveAttribute('target', '_blank');
      if (work.reason) await expect(card).toContainText(work.reason);
      if (isMobile) expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(40);
    }
  }
});

test('a mid-size masterwork loads centred, fitted, and runs', async ({ page, isMobile }) => {
  const works = await listMasterworks(page);
  const work = works.filter((entry) => entry.loadable).sort((a, b) => a.size.width * a.size.height - b.size.width * b.size.height)[0];
  await openMasterworks(page, isMobile);
  await page.locator(`#pattern-list button[data-masterwork-id="${work.id}"]`).click();
  await expect(page.locator('#rail')).toHaveAttribute('data-open', 'false');
  await expect.poll(() => num(page, '#population')).toBeGreaterThan(5);

  const state = await snapshot(page);
  expect(state.width).toBeGreaterThanOrEqual(work.board.width);
  expect(state.height).toBeGreaterThanOrEqual(work.board.height);
  const bounds = await liveBounds(page);
  expect(bounds.maxX - bounds.minX + 1).toBe(work.size.width);
  expect(bounds.maxY - bounds.minY + 1).toBe(work.size.height);
  expect(Math.abs((bounds.minX + bounds.maxX) / 2 - state.width / 2)).toBeLessThanOrEqual(1.5);
  expect(Math.abs((bounds.minY + bounds.maxY) / 2 - state.height / 2)).toBeLessThanOrEqual(1.5);
  expect(state.tool).toBe('draw');

  await page.locator('#play-toggle').click();
  await expect.poll(() => num(page, '#generation')).toBeGreaterThan(3);
  await page.locator('#play-toggle').click();
  await expect(page.locator('#play-label')).toHaveText('Play');
});

// The largest loadable work (the OTCA metapixel once it ships as a lazy
// module; Breeder 1 until then) grows the board to its recommended size.
test('the largest masterwork grows the board, fits the view, explains in a toast, and Undo restores the old board', async ({ page, isMobile }) => {
  const works = await listMasterworks(page);
  const work = works.filter((entry) => entry.loadable && entry.board)
    .sort((a, b) => b.board.width * b.board.height - a.board.width * a.board.height)[0];
  expect(work, 'a loadable masterwork with a recommended board').toBeTruthy();
  const before = await snapshot(page);
  expect(before.width).toBeLessThan(work.board.width);
  expect(before.wrapping).toBe(true);

  await openMasterworks(page, isMobile);
  const started = Date.now();
  await page.locator(`#pattern-list button[data-masterwork-id="${work.id}"]`).click();
  await expect(page.locator('#toast')).toHaveText(`Board grew to ${work.board.width} × ${work.board.height} to fit ${work.name}. Undo to go back.`);
  expect(Date.now() - started, 'the board grows without a long freeze').toBeLessThan(2_500);
  await expect(page.locator(`#pattern-list button[data-masterwork-id="${work.id}"]`)).not.toHaveAttribute('aria-busy', 'true');

  const grown = await snapshot(page);
  expect(grown.width).toBe(work.board.width);
  expect(grown.height).toBe(work.board.height);
  expect(grown.population).toBeGreaterThan(1_000);
  expect(grown.wrapping, 'masterworks run on a bounded board').toBe(false);
  // Fitted: the pattern's cells all sit inside the canvas.
  const box = await page.locator('#world').boundingBox();
  const bounds = await liveBounds(page);
  const cell = grown.zoom * 10;
  expect(grown.panX + bounds.minX * cell).toBeGreaterThanOrEqual(-1);
  expect(grown.panY + bounds.minY * cell).toBeGreaterThanOrEqual(-1);
  expect(grown.panX + (bounds.maxX + 1) * cell).toBeLessThanOrEqual(box.width + 1);
  expect(grown.panY + (bounds.maxY + 1) * cell).toBeLessThanOrEqual(box.height + 1);
  expect(await page.evaluate(() => window.__lifeLab.renderTime(3))).toBeLessThan(40);
  if (!isMobile) await expect(page.locator('#grid-size')).toBeHidden();

  await page.locator('#undo').click();
  const restored = await snapshot(page);
  expect(restored.width).toBe(before.width);
  expect(restored.height).toBe(before.height);
  expect(restored.population).toBe(before.population);
  expect(restored.wrapping, 'Undo brings the previous edge mode back').toBe(before.wrapping);
  await expect(page.locator('#redo')).toBeEnabled();

  await page.locator('#redo').click();
  const redone = await snapshot(page);
  expect(redone.width).toBe(work.board.width);
  expect(redone.population).toBe(grown.population);
  expect(redone.wrapping, 'Redo makes the board bounded again').toBe(false);
});

test('search finds masterworks by discoverer', async ({ page, isMobile }) => {
  const works = await listMasterworks(page);
  const work = works.find((entry) => entry.discoverer);
  const word = work.discoverer.split(/[\s,]+/).find((part) => part.length > 3) || work.discoverer;
  await openPatterns(page, isMobile);
  await page.locator('#pattern-search').fill(word);
  await expect(page.locator('#pattern-tabs')).toBeHidden();
  await expect(page.locator(`#pattern-list [data-masterwork-id="${work.id}"]`)).toBeVisible();
  await expect(page.locator('#pattern-list .card-empty')).toHaveCount(0);

  await page.locator('#pattern-search').fill(work.name.slice(0, 4));
  await expect(page.locator(`#pattern-list [data-masterwork-id="${work.id}"]`)).toBeVisible();
  await page.locator('#pattern-search').fill('');
  await expect(page.locator('#pattern-tabs')).toBeVisible();
});

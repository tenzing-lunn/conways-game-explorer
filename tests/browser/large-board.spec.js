import { expect, test } from '@playwright/test';
import { openInspector, openMoreMenu, openPatterns, snapshot, watchErrors } from './helpers.js';

// Boards up to 3000 cells wide must fit the view, render inside the frame
// budget and pan cheaply on desktop and phone.
const FRAME_BUDGET_MS = 40;

test.beforeEach(async ({ page }) => {
  watchErrors(page);
  await page.goto('/');
  await expect(page.locator('#population')).toHaveText('5');
});

test.afterEach(async ({ page }) => expect(page.errors, 'browser runtime errors').toEqual([]));

async function fit(page, isMobile) {
  if (isMobile) {
    await openMoreMenu(page);
    await page.locator('#fit-mobile').click();
  } else {
    await page.locator('#fit').click();
  }
}

// The whole board sits inside the canvas with its fit padding.
async function expectBoardInsideView(page) {
  const state = await snapshot(page);
  const box = await page.locator('#world').boundingBox();
  const cell = state.zoom * 10;
  expect(state.panX).toBeGreaterThanOrEqual(0);
  expect(state.panY).toBeGreaterThanOrEqual(0);
  expect(state.panX + state.width * cell).toBeLessThanOrEqual(box.width + 1);
  expect(state.panY + state.height * cell).toBeLessThanOrEqual(box.height + 1);
  return state;
}

test('the default board keeps its 10% zoom floor', async ({ page }) => {
  expect((await snapshot(page)).minZoom).toBeCloseTo(0.1, 5);
});

test('a 3000-wide board fits the view and renders within the frame budget', async ({ page, isMobile }) => {
  const size = await page.evaluate(() => window.__lifeLab.resizeBoard(3000, 3000));
  expect(size).toEqual({ width: 3000, height: 3000 });
  await expect(page.locator('#toast')).toHaveText('Grid is now 3000 × 3000');

  await fit(page, isMobile);
  const fitted = await expectBoardInsideView(page);
  expect(fitted.zoom).toBeLessThan(0.1);
  expect(fitted.zoom).toBeGreaterThanOrEqual(fitted.minZoom - 1e-9);
  if (!isMobile) await expect(page.locator('#zoom-label')).not.toHaveText('100%');

  // Fill it: random soup on 9 million cells is the heaviest thing to draw.
  await openPatterns(page, isMobile);
  await page.locator('[data-pattern-tab="start"]').click();
  await page.locator('#pattern-list [data-pattern-id="random-soup"]').click();
  await expect.poll(async () => (await snapshot(page)).population).toBeGreaterThan(1_000_000);
  await fit(page, isMobile);
  await expectBoardInsideView(page);
  const full = await page.evaluate(() => window.__lifeLab.renderTime(5));
  const pan = await page.evaluate(() => window.__lifeLab.panFrameTime());
  expect(full, 'full render at fit zoom').toBeLessThan(FRAME_BUDGET_MS);
  expect(pan, 'pan frame reuses the bitmap').toBeLessThan(FRAME_BUDGET_MS);

  // Zooming in moves from the bitmap path to drawn cells; still within budget.
  const world = await page.locator('#world').boundingBox();
  if (!isMobile) {
    for (let step = 0; step < 10; step += 1) await page.locator('#zoom-in').click();
    await expect.poll(async () => (await snapshot(page)).zoom).toBeGreaterThan(0.15);
    const zoomed = await page.evaluate(() => window.__lifeLab.renderTime(5));
    expect(zoomed, 'zoomed-in render').toBeLessThan(FRAME_BUDGET_MS);
  }

  // Panning keeps the position honest: a drag moves the view by the drag.
  const before = await snapshot(page);
  await page.locator('#tool-group [data-tool="pan"]').click();
  await page.mouse.move(world.x + world.width / 2, world.y + world.height / 2);
  await page.mouse.down();
  await page.mouse.move(world.x + world.width / 2 + 120, world.y + world.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  const after = await snapshot(page);
  expect(Math.round(after.panX - before.panX)).toBe(120);
  expect(Math.round(after.panY - before.panY)).toBe(40);
});

test('Grid size → Custom… opens width and height fields that resize the board', async ({ page, isMobile }) => {
  await page.goto('/studio');
  await expect(page.locator('#project-header')).toBeVisible();
  await openInspector(page, isMobile);
  // The menu never repeats a preset's label for the custom choice.
  const labels = await page.locator('#grid-size option:not([hidden])').allInnerTexts();
  expect(new Set(labels).size).toBe(labels.length);
  expect(labels).toContain('Custom…');
  await expect(page.locator('#grid-custom')).toBeHidden();

  await page.locator('#grid-size').selectOption('custom');
  await expect(page.locator('#grid-custom')).toBeVisible();
  await expect(page.locator('#grid-width')).toHaveValue('300');
  await expect(page.locator('#grid-height')).toHaveValue('200');
  if (isMobile) {
    for (const selector of ['#grid-width', '#grid-height', '#grid-apply']) expect((await page.locator(selector).boundingBox()).height).toBeGreaterThanOrEqual(40);
  }
  // Out of range is refused with a reason; the board stays as it was.
  await page.locator('#grid-width').fill('5000');
  await page.locator('#grid-apply').click();
  await expect(page.locator('#toast')).toHaveText('Width and height must each be between 40 and 3,000 cells.');
  expect((await snapshot(page)).width).toBe(300);

  await page.locator('#grid-width').fill('3000');
  await page.locator('#grid-height').fill('2500');
  await page.locator('#grid-apply').click();
  await expect(page.locator('#toast')).toHaveText('Grid is now 3000 × 2500');
  await expect(page.locator('#grid-custom')).toBeHidden();
  const state = await snapshot(page);
  expect([state.width, state.height]).toEqual([3000, 2500]);
  await expect(page.locator('#grid-size option:checked')).toHaveText('3000 × 2500');
  // Back to a preset.
  await page.locator('#grid-size').selectOption('medium');
  await expect.poll(async () => (await snapshot(page)).width).toBe(300);
  await expect(page.locator('#grid-size option[value="current"]')).toBeHidden();
});

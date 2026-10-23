import { expect, test } from '@playwright/test';
import { boardPoint, tap, watchErrors } from './helpers.js';

test('selection commands move, copy, paste and transform cells, survive undo/redo, and feed Step', async ({ page, context, isMobile }) => {
  watchErrors(page);
  // Mirror what the simulation worker is told so the test can read the authored cells.
  await page.addInitScript(() => {
    const WorkerClass = window.Worker;
    window.Worker = class extends WorkerClass {
      postMessage(data, ...args) {
        if (data.type === 'load') window.editedCells = Array.from(data.board.cells).flatMap((v, i) => v ? [[i % data.board.width, Math.floor(i / data.board.width)]] : []);
        return super.postMessage(data, ...args);
      }
    };
  });
  await page.goto('/studio');
  await expect(page.locator('#project-header')).toBeVisible();
  await expect(page.locator('#population')).toHaveText('0');

  const point = await boardPoint(page, 0.55, 0.5);
  await tap(page, point, isMobile);
  await tap(page, { x: point.x + 10, y: point.y - 10 }, isMobile);
  await expect(page.locator('#population')).toHaveText('2');
  const initial = await page.evaluate(() => window.editedCells);
  expect(initial).toHaveLength(2);

  await page.locator('#tool-group [data-tool="select"]').click();
  await expect(page.locator('#tool-group [data-tool="select"]')).toHaveAttribute('aria-checked', 'true');
  const start = { x: point.x - 20, y: point.y - 20 };
  const end = { x: point.x + 20, y: point.y + 20 };
  if (isMobile) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [end] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y);
    await page.mouse.up();
  }
  // Selection commands only appear once there is a selection.
  await expect(page.locator('#selection-group')).toBeVisible();
  const command = (name) => page.locator(`#selection-group [data-selection-command="${name}"]`).click();

  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.editedCells)).toEqual(initial.map(([x, y]) => [x + 1, y]));
  await command('copy');
  await expect(page.locator('#toast')).toHaveText('Selection copied');
  await command('delete');
  await expect(page.locator('#population')).toHaveText('0');
  for (let index = 0; index < 6; index += 1) await page.keyboard.press('ArrowRight');
  await command('paste');
  await expect(page.locator('#population')).toHaveText('2');
  await expect.poll(() => page.evaluate(() => window.editedCells)).toEqual(initial.map(([x, y]) => [x + 7, y]));

  const beforeRotation = await page.evaluate(() => window.editedCells);
  await command('rotate');
  await expect.poll(() => page.evaluate(() => window.editedCells)).not.toEqual(beforeRotation);
  const beforeFlip = await page.evaluate(() => window.editedCells);
  await command('flip');
  await expect.poll(() => page.evaluate(() => window.editedCells)).not.toEqual(beforeFlip);
  await expect(page.locator('#population')).toHaveText('2');
  const transformed = await page.evaluate(() => window.editedCells);

  await page.locator('#undo').click();
  await expect.poll(() => page.evaluate(() => window.editedCells)).toEqual(beforeFlip);
  await page.locator('#redo').click();
  await expect.poll(() => page.evaluate(() => window.editedCells)).toEqual(transformed);
  await expect(page.locator('#selection-group')).toBeHidden();

  await page.locator('#step').click();
  await expect(page.locator('#generation')).toHaveText('1');
  await expect(page.locator('#population')).toHaveText('0');
  expect(page.errors).toEqual([]);
});

import { expect, test } from '@playwright/test';
import { openInspector, openTopMenu, watchErrors } from './helpers.js';

const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme);
const storedTheme = (page) => page.evaluate(() => localStorage.getItem('life-theme'));

async function toggleTheme(page, isMobile) {
  await openTopMenu(page, isMobile);
  await page.locator('#theme-toggle').click();
}

// Surfaces fade between themes over --motion; sample pixels only once every transition has finished.
const settled = (page) => page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));

// Screenshot blocks (32 CSS px) that are mostly near-white. Text and single cells never fill a block;
// a light panel, input or card in dark mode does.
async function lightBlocks(page) {
  const png = await page.screenshot({ scale: 'css' });
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const block = 32;
    const light = [];
    for (let blockY = 0; blockY < canvas.height; blockY += block) {
      for (let blockX = 0; blockX < canvas.width; blockX += block) {
        let bright = 0;
        let total = 0;
        for (let y = blockY; y < Math.min(blockY + block, canvas.height); y += 1) {
          for (let x = blockX; x < Math.min(blockX + block, canvas.width); x += 1) {
            const index = (y * canvas.width + x) * 4;
            total += 1;
            if (data[index] > 200 && data[index + 1] > 200 && data[index + 2] > 200) bright += 1;
          }
        }
        if (bright / total > 0.5) light.push(`${blockX},${blockY}:${Math.round((bright / total) * 100)}%`);
      }
    }
    return light;
  }, png.toString('base64'));
}

test.beforeEach(async ({ page }) => {
  watchErrors(page);
});

test.afterEach(async ({ page }) => expect(page.errors, 'browser runtime errors').toEqual([]));

test('theme toggle switches to dark, persists in localStorage, and survives reload and navigation', async ({ page, isMobile }) => {
  await page.goto('/');
  await expect(page.locator('#population')).toHaveText('5');
  expect(await theme(page)).toBe('light');
  expect(await storedTheme(page)).toBeNull();
  await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-pressed', 'false');

  await toggleTheme(page, isMobile);
  expect(await theme(page)).toBe('dark');
  expect(await storedTheme(page)).toBe('dark');
  await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-label', 'Switch to light theme');

  await page.reload();
  await expect(page.locator('#population')).toHaveText('5');
  expect(await theme(page)).toBe('dark');
  await expect(page.locator('#theme-toggle')).toHaveAttribute('aria-pressed', 'true');
  for (const path of ['/studio', '/community']) {
    await page.goto(path);
    expect(await theme(page), `${path} stays dark`).toBe('dark');
  }

  await toggleTheme(page, isMobile);
  expect(await theme(page)).toBe('light');
  expect(await storedTheme(page)).toBe('light');
  await page.reload();
  expect(await theme(page)).toBe('light');
});

test('dark theme leaves no light surfaces on the Playground, Studio or Community', async ({ page, isMobile }) => {
  await page.goto('/');
  await expect(page.locator('#population')).toHaveText('5');
  // Light theme has light surfaces by design; this proves the detector sees them.
  expect((await lightBlocks(page)).length).toBeGreaterThan(50);

  await toggleTheme(page, isMobile);
  expect(await theme(page)).toBe('dark');
  if (isMobile) await page.keyboard.press('Escape');
  await settled(page);
  const canvasCorner = await page.evaluate(() => {
    const canvas = document.querySelector('#world');
    const [r, g, b] = canvas.getContext('2d').getImageData(2, 2, 1, 1).data;
    return { r, g, b };
  });
  expect(Math.max(canvasCorner.r, canvasCorner.g, canvasCorner.b), 'board field is dark').toBeLessThan(80);
  expect(await lightBlocks(page), 'Playground').toEqual([]);

  await page.goto('/studio');
  await expect(page.locator('#project-header')).toBeVisible();
  await openInspector(page, isMobile);
  await settled(page);
  expect(await lightBlocks(page), 'Studio').toEqual([]);

  await page.goto('/community');
  await expect(page.locator('#community-grid .community-card').first()).toBeVisible();
  await settled(page);
  expect(await lightBlocks(page), 'Community').toEqual([]);
});

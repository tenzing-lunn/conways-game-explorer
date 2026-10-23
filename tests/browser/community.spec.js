import { expect, test } from '@playwright/test';
import { backend, loadLocalState, num, watchErrors } from './helpers.js';

test.beforeEach(async ({ page }) => {
  watchErrors(page);
});

test.afterEach(async ({ page }) => expect(page.errors, 'browser runtime errors').toEqual([]));

test('gallery renders library cards, search and filters narrow them, and Open shows the detail actions', async ({ page, context, baseURL }) => {
  await page.goto('/community');
  await expect(page).toHaveTitle('Community · Life Lab');
  await expect(page.locator('#community-panel')).toBeVisible();
  await expect(page.locator('#world')).toBeHidden();
  const cards = page.locator('#community-grid .community-card');
  await expect(cards).toHaveCount(6);
  await expect(page.locator('[data-community-filter="all"]')).toHaveAttribute('aria-selected', 'true');
  await expect(cards.first()).toContainText('Library · LifeWiki');

  await page.locator('#community-search').fill('gosper');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Gosper glider gun');
  await page.locator('#community-search').fill('zzzz');
  await expect(page.locator('#community-grid .community-empty')).toHaveText('No patterns match that search.');
  await page.locator('#community-search').fill('');
  await expect(cards).toHaveCount(6);

  await page.locator('[data-community-filter="famous"]').click();
  await expect(page.locator('[data-community-filter="famous"]')).toHaveAttribute('aria-selected', 'true');
  await expect(cards).toHaveCount(6);
  await page.locator('[data-community-filter="new"]').click();
  await expect(page.locator('#community-grid .community-empty')).toHaveText('No published projects yet.');
  await page.locator('[data-community-filter="all"]').click();
  await expect(cards).toHaveCount(6);

  await cards.filter({ has: page.locator('[data-creation-id="famous-glider"]') }).locator('[data-community-action="open"]').click();
  const detail = page.locator('#community-detail');
  await expect(detail).toBeVisible();
  await expect(page.locator('#community-gallery')).toBeHidden();
  await expect(page).toHaveURL(/\/c\/famous-glider$/);
  await expect(detail.locator('#detail-title')).toHaveText('Glider');
  await expect(detail.locator('#detail-author')).toHaveText('From the LifeWiki library');
  await expect(detail.locator('#detail-tags span')).toHaveCount(3);
  await expect(detail.locator('[data-community-action="play"]')).toBeVisible();
  await expect(detail.locator('[data-community-action="remix"]')).toBeVisible();
  await expect(detail.locator('[data-community-action="share"]')).toBeVisible();
  // Library patterns can only be starred against an account; a local build hides the button honestly.
  await expect(detail.locator('[data-community-action="star"]')).toHaveCount((await backend(page)) === 'local' ? 0 : 1);
  await expect(detail.locator('.comments')).toHaveCount(0);

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await detail.locator('[data-community-action="share"]').click();
  await expect(page.locator('#toast')).toHaveText('Link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(baseURL).origin}/c/famous-glider`);

  await detail.locator('#community-back').click();
  await expect(page.locator('#community-gallery')).toBeVisible();
  await expect(detail).toBeHidden();
});

test('Play loads a library pattern into the Playground and starts it', async ({ page }) => {
  await page.goto('/c/famous-gosper-gun');
  await expect(page.locator('#community-detail #detail-title')).toHaveText('Gosper glider gun');
  await page.locator('#community-detail [data-community-action="play"]').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#world')).toBeVisible();
  await expect(page.locator('#play-label')).toHaveText('Pause');
  await expect.poll(() => num(page, '#generation')).toBeGreaterThan(0);
  expect(await num(page, '#population')).toBeGreaterThan(30);
});

test('a public pattern URL reloads directly and guest Remix opens a private attributed Studio project', async ({ page }) => {
  await page.goto('/c/famous-glider');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'community');
  await expect(page).toHaveTitle('Glider by LifeWiki · Life Lab');
  await expect(page.locator('#community-detail')).toContainText('Glider');

  await page.locator('#community-detail [data-community-action="remix"]').click();
  await expect(page).toHaveURL(/\/studio$/);
  await expect(page.locator('#toast')).toHaveText('Remix ready in Studio');
  await expect(page.locator('#project-title')).toHaveValue('Glider Remix');
  await expect(page.locator('#population')).toHaveText('5');
  await expect(page.locator('#account-dialog')).toBeHidden();
  await expect(page.locator('#save-state')).toHaveAttribute('data-status', 'saved');

  const remix = (await loadLocalState(page)).creations.find((creation) => creation.title === 'Glider Remix');
  expect(remix).toMatchObject({ visibility: 'private', attribution: 'Remixed from Glider by LifeWiki.' });

  await page.locator('#step').click();
  await expect(page.locator('#generation')).toHaveText('1');
  await expect(page.locator('#population')).toHaveText('5');
  await page.reload();
  await expect(page.locator('#project-title')).toHaveValue('Glider Remix');
  await expect(page.locator('#population')).toHaveText('5');
});

test('an unknown public pattern and a creator page show honest states', async ({ page }) => {
  await page.goto('/c/not-a-real-pattern');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'community');
  await expect(page.locator('#community-detail h1')).toHaveText('Pattern unavailable');
  await page.locator('#community-detail [data-community-action="browse"]').click();
  await expect(page.locator('#community-gallery')).toBeVisible();

  await page.goto('/u/lifewiki');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'community');
  await expect(page.locator('#community-gallery')).toBeVisible();
  if ((await backend(page)) === 'local') {
    await expect(page.locator('#community-status')).toBeVisible();
    await expect(page.locator('#community-status')).toHaveText('Creator pages need the hosted Community service.');
    await expect(page.locator('#community-grid .community-card')).toHaveCount(6);
  }
});

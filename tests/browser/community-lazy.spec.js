import { expect, test } from '@playwright/test';
import { snapshot } from './helpers.js';

// Hosted feed rows carry only a preview. Opening, playing or remixing a
// pattern fetches the full creation (with its RLE) first.
const RLE = 'x = 7, y = 3, rule = B3/S23\n2o4bo$2o4bo$6bo!';
const summary = {
  id: '00000000-0000-4000-8000-0000000000c1',
  slug: 'block-and-blinker-c1',
  title: 'Block and blinker',
  description: 'A still life next to an oscillator.',
  tags: ['still-life'],
  visibility: 'public',
  ownerId: 'user-ada',
  ownerName: 'Ada',
  ownerUsername: 'ada',
  previewConfig: { version: 1, grid: { columns: 7, rows: 3 }, cells: [[0, 0], [1, 0], [0, 1], [1, 1], [6, 0], [6, 1], [6, 2]] },
  currentVersion: { id: 'v1', versionNumber: 1, width: 40, height: 40, generation: 0, population: 7, rule: 'B3/S23',
    settings: { gridPreset: 'custom', width: 40, height: 40 } },
  publishedAt: '2026-10-27T00:00:00.000Z',
  updatedAt: '2026-10-27T00:00:00.000Z',
};

async function hostedCommunity(page, { detail = 'ok' } = {}) {
  const fetched = [];
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.resourceType() === 'document') {
      const response = await route.fetch();
      const body = (await response.text()).replace('{"backend":"local"}', '{"backend":"postgres","apiBase":"/api/community","authBase":"/api/auth"}');
      return route.fulfill({ response, body });
    }
    if (url.pathname === '/api/auth/get-session') return route.fulfill({ json: null });
    if (url.pathname === '/api/community/feed') return route.fulfill({ json: { creations: [summary], cursor: null } });
    if (url.pathname === '/api/community/trending') return route.fulfill({ json: [summary] });
    if (url.pathname.endsWith('/comments')) return route.fulfill({ json: { comments: [], cursor: null } });
    if (url.pathname === `/api/community/public/${summary.slug}`) {
      fetched.push(url.pathname);
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (detail === 'fail') return route.fulfill({ status: 500, json: { error: 'Community request failed.', code: 'INTERNAL_ERROR' } });
      return route.fulfill({ json: { ...summary, currentVersion: { ...summary.currentVersion, rle: RLE }, source: null, remixes: [] } });
    }
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, json: { error: 'Not mocked.' } });
    return route.continue();
  });
  return fetched;
}

test('opening a feed card loads the full pattern, then Play runs its board', async ({ page }) => {
  const fetched = await hostedCommunity(page);
  await page.goto('/community');
  const card = page.locator(`[data-community-action="open"][data-creation-id="${summary.id}"]`);
  await expect(card).toBeVisible();
  expect(fetched).toEqual([]);

  await card.click();
  await expect(page.locator('#community-detail')).toContainText('Loading…');
  await expect(page.locator(`#community-detail [data-community-action="play"]`)).toBeVisible();
  expect(fetched).toEqual([`/api/community/public/${summary.slug}`]);

  await page.locator('#community-detail [data-community-action="play"]').click();
  await expect.poll(async () => (await snapshot(page)).width).toBe(40);
  expect((await snapshot(page)).population).toBe(7);
});

test('a failed detail load shows an error instead of an empty board', async ({ page }) => {
  await hostedCommunity(page, { detail: 'fail' });
  await page.goto('/community');
  await page.locator(`[data-community-action="open"][data-creation-id="${summary.id}"]`).click();
  await expect(page.locator('#community-detail')).toContainText('Pattern unavailable');
  await expect(page.locator('#community-detail [data-community-action="browse"]')).toBeVisible();
});

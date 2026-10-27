import { expect, test } from '@playwright/test';
import { openPatterns, watchErrors } from './helpers.js';

// The CSP must not break the app: collect every violation the browser reports
// while the main surfaces, the lazy OTCA module and the simulation worker run.
test.beforeEach(async ({ page }) => {
  watchErrors(page);
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
});

test('app pages load under the CSP without violations', async ({ page, isMobile }) => {
  const response = await page.goto('/');
  expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  await expect(page.locator('#population')).toHaveText('5');

  await openPatterns(page, isMobile);
  await page.locator('[data-pattern-tab="masterworks"]').click();
  await page.locator('#pattern-list button[data-masterwork-id="otca-metapixel"]').click();
  await expect(page.locator('#pattern-list button[data-masterwork-id="otca-metapixel"]')).not.toHaveAttribute('aria-busy', 'true');
  if (isMobile && (await page.locator('#rail').getAttribute('data-open')) === 'true') await page.keyboard.press('Escape');
  await page.locator('#play-toggle').click();
  await expect(page.locator('#play-label')).toHaveText('Pause');
  await page.locator('#play-toggle').click();

  for (const path of ['/studio', '/community']) {
    await page.goto(path);
    await expect(page.locator('body')).toHaveAttribute('data-mode', path.slice(1));
  }

  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
  expect(page.errors).toEqual([]);
});

test('trailing slashes redirect and unknown paths get a page with a way home', async ({ page }) => {
  await page.goto('/studio/');
  await expect(page).toHaveURL(/\/studio$/);

  const missing = await page.goto('/does-not-exist');
  expect(missing.status()).toBe(404);
  await page.getByRole('link', { name: 'Go to Life Lab' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#population')).toHaveText('5');
});

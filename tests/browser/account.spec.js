import { expect, test } from '@playwright/test';
import { backend, openTopMenu, watchErrors } from './helpers.js';

test.beforeEach(async ({ page }) => {
  watchErrors(page);
});

test.afterEach(async ({ page }) => expect(page.errors, 'browser runtime errors').toEqual([]));

test('account dialog opens from every workspace and is honest about availability', async ({ page, isMobile }) => {
  for (const path of ['/', '/studio', '/community']) {
    await page.goto(path);
    await openTopMenu(page, isMobile);
    await page.locator('#account-entry').click();
    const dialog = page.locator('#account-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#account-dialog-title')).toHaveText('Account');
    await expect(page.locator('#account-tabs [data-account-mode="sign-in"]')).toHaveAttribute('aria-selected', 'true');
    if ((await backend(page)) === 'local') {
      await expect(page.locator('#account-context')).toContainText('Accounts are not available in this local build');
      await expect(page.locator('#account-submit')).toBeDisabled();
    } else {
      await expect(page.locator('#account-context')).toContainText('Sign in to publish, star, and comment.');
      await expect(page.locator('#account-submit')).toBeEnabled();
    }
    await page.locator('#account-tabs [data-account-mode="sign-up"]').click();
    await expect(page.locator('#account-name')).toBeVisible();
    await expect(page.locator('#account-submit')).toHaveText('Create account');
    await page.locator('#account-close').click();
    await expect(dialog).toBeHidden();
  }
});

test('account dialog traps focus, closes with Escape, and restores its trigger', async ({ page, isMobile }) => {
  await page.goto('/');
  await openTopMenu(page, isMobile);
  await page.locator('#account-entry').focus();
  await page.keyboard.press('Enter');
  const dialog = page.locator('#account-dialog');
  await expect(dialog).toBeVisible();
  const focusInside = () => page.evaluate(() => document.querySelector('#account-dialog').contains(document.activeElement));
  await expect.poll(focusInside).toBe(true);
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab');
    expect(await focusInside(), `Tab ${index + 1} stays inside the dialog`).toBe(true);
  }
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press('Shift+Tab');
    expect(await focusInside(), `Shift+Tab ${index + 1} stays inside the dialog`).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect.poll(focusInside).toBe(false);
  // On phones the trigger is a menu item that closed with the menu; see the fixme below.
  if (!isMobile) await expect(page.locator('#account-entry')).toBeFocused();
});

test('phone: closing the account dialog returns focus to the top menu toggle', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone layout only.');
  test.fixme(true, 'App restores focus to #account-entry, which is display:none inside the closed top menu, so focus falls back to <body>.');
  await page.goto('/');
  await openTopMenu(page, isMobile);
  await page.locator('#account-entry').click();
  await expect(page.locator('#account-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#account-dialog')).toBeHidden();
  await expect(page.locator('#top-menu-toggle')).toBeFocused();
});

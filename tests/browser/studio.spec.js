import { expect, test } from '@playwright/test';
import {
  RECOVERY_KEY, backend, clickBoard, closeSheets, lampState, num, openInspector, pickGate, runCircuit, setSwitches, snapshot, truthRows, watchErrors,
} from './helpers.js';

test.beforeEach(async ({ page }) => {
  watchErrors(page);
  await page.goto('/studio');
  await expect(page).toHaveTitle('Studio · Life Lab');
  await expect(page.locator('#project-header')).toBeVisible();
  await expect(page.locator('#project-title')).toHaveValue('Untitled project');
  await expect(page.locator('#population')).toHaveText('0');
});

test.afterEach(async ({ page }) => expect(page.errors, 'browser runtime errors').toEqual([]));

test('project header shows save state, Save creates versions, and history restores as a new version', async ({ page, isMobile }) => {
  const saveState = page.locator('#save-state');
  await expect(saveState).toHaveAttribute('data-status', 'new');
  if (!isMobile) await expect(saveState).toHaveText('Not saved yet');

  await page.locator('#project-title').fill('Versioned browser project');
  await expect(saveState).toHaveAttribute('data-status', 'dirty');
  if (!isMobile) await expect(saveState).toHaveText('Unsaved');
  await expect(page.locator('#version-history')).toContainText('Save to create version 1.');

  await clickBoard(page, isMobile, 0.46, 0.4);
  await expect(page.locator('#population')).toHaveText('1');
  await page.locator('#save-project').click();
  await expect(page.locator('#toast')).toHaveText('Saved');
  await expect(saveState).toHaveAttribute('data-status', 'saved');
  await expect(page.locator('#version-history .version-row.current')).toContainText('Version 1');

  await clickBoard(page, isMobile, 0.56, 0.46);
  await expect(page.locator('#population')).toHaveText('2');
  await page.locator('#save-project').click();
  await expect(page.locator('#version-history .version-row.current')).toContainText('Version 2');
  await expect(page.locator('#version-history .version-row')).toHaveCount(2);

  await openInspector(page, isMobile);
  await page.locator('#version-history .version-row').filter({ hasText: 'Version 1' }).locator('[data-restore-version-id]').click();
  await expect(page.locator('#toast')).toHaveText('Restored as version 3');
  await expect(page.locator('#version-history .version-row.current')).toContainText('Version 3');
  await expect(page.locator('#population')).toHaveText('1');
  await expect(saveState).toHaveAttribute('data-status', 'saved');
  await closeSheets(page, isMobile);

  // Projects is a plain list page; opening a card returns to the project.
  await page.locator('#projects-back').click();
  await expect(page.locator('#projects-page')).toBeVisible();
  await expect(page.locator('#project-header')).toBeHidden();
  const card = page.locator('#projects-list .project-card[data-project-id]');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Versioned browser project');
  await expect(card).toContainText('Private');
  await card.click();
  await expect(page.locator('#project-header')).toBeVisible();
  await expect(page.locator('#project-title')).toHaveValue('Versioned browser project');
  await expect(page.locator('#population')).toHaveText('1');

  await page.locator('#projects-back').click();
  await page.locator('#new-project').click();
  await expect(page.locator('#project-title')).toHaveValue('Untitled project');
  await expect(page.locator('#population')).toHaveText('0');
  await expect(saveState).toHaveAttribute('data-status', 'new');
});

test('publish validates title, description, tags and a non-empty board, then exposes publish states', async ({ page, isMobile }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Publish state is covered once in Chromium.');
  const publish = page.locator('#publish-project');
  await expect(publish).toHaveText('Publish');
  await page.locator('#project-title').fill('Validated browser project');
  await page.locator('#project-description').fill('Too short');
  await page.locator('#project-tags').fill('browser, publish');

  await publish.click();
  // Validation keeps the plain label; only a real failed attempt reads "Retry publish".
  await expect(publish).toHaveText('Publish');
  await expect(page.locator('#toast')).toHaveText('Add a description of at least 20 characters.');
  await expect(page.locator('#project-description')).toBeFocused();

  await page.locator('#project-description').fill('A complete browser-tested publishing workflow.');
  await publish.click();
  await expect(publish).toHaveText('Publish');
  await expect(page.locator('#toast')).toHaveText('Add at least one live cell before publishing.');

  await clickBoard(page, isMobile, 0.46, 0.4);
  await expect(page.locator('#population')).toHaveText('1');
  await publish.click();
  if ((await backend(page)) !== 'local') {
    // A hosted build needs an account before anything becomes public.
    await expect(page.locator('#account-dialog')).toBeVisible();
    await expect(page.locator('#account-context')).toContainText('Sign in to publish this project');
    await expect(page.locator('#project-title')).toHaveValue('Validated browser project');
    await page.locator('#account-close').click();
    return;
  }
  await expect(publish).toHaveText('Published');
  await expect(publish).toBeDisabled();
  await expect(page.locator('#toast')).toHaveText('Published on this device');
  await expect(page.locator('#save-state')).toHaveAttribute('data-status', 'saved');

  // The published project appears under Community → New and can be starred locally.
  await page.locator('#mode-community').click();
  await page.locator('[data-community-filter="new"]').click();
  const card = page.locator('#community-grid .community-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Validated browser project');
  await card.locator('[data-community-action="open"]').click();
  await expect(page.locator('#community-detail #detail-title')).toHaveText('Validated browser project');
  const star = page.locator('#community-detail [data-community-action="star"]');
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(page.locator('#toast')).toHaveText('Starred');
  await expect(star).toHaveAttribute('aria-pressed', 'true');

  // Unpublish from the project menu makes it private again.
  await page.locator('#mode-studio').click();
  await expect(page.locator('#project-title')).toHaveValue('Validated browser project');
  await page.locator('#project-menu-toggle').click();
  await page.locator('#unpublish-project').click();
  await expect(page.locator('#toast')).toHaveText('Project is private again');
  await expect(publish).toHaveText('Republish');
  await expect(publish).toBeEnabled();
});

test('a debounced unsaved draft recovers after reload', async ({ page, isMobile }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Recovery is storage behavior covered once in Chromium.');
  await page.locator('#project-title').fill('Recovered browser draft');
  await clickBoard(page, isMobile, 0.48, 0.42);
  await expect(page.locator('#population')).toHaveText('1');
  await expect(page.locator('#save-state')).toHaveAttribute('data-status', 'dirty');
  // The recovery write is debounced; wait for it to land rather than for a fixed time.
  await expect.poll(() => page.evaluate(async (key) => {
    const { readRecovery } = await import('/src/local-database.js');
    const recovery = await readRecovery(key);
    return recovery ? { title: recovery.title, population: recovery.population } : null;
  }, RECOVERY_KEY)).toEqual({ title: 'Recovered browser draft', population: 1 });

  await page.reload();
  await expect(page.locator('#project-header')).toBeVisible();
  await expect(page.locator('#project-title')).toHaveValue('Recovered browser draft');
  await expect(page.locator('#population')).toHaveText('1');
  await expect(page.locator('#save-state')).toHaveAttribute('data-status', 'dirty');
  await expect(page.locator('#save-state')).toHaveText('Unsaved');
});

test('Logic lists only verified gates; a single AND gate run settles HIGH at generation 600 and targets that generation again after Step', async ({ page, isMobile }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Circuit runs are covered once on desktop; the phone flow lives in chain.spec.js.');
  await page.locator('[data-rail-tab="logic"]').click();
  await expect(page.locator('#rail-title')).toHaveText('Components');
  const gates = await page.locator('#logic-list [data-gate-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.gateId));
  expect(gates).toEqual(['and', 'or', 'not', 'half-adder']);
  await expect(page.locator('#logic-list')).not.toContainText('XOR');
  await expect(page.locator('#logic-list [data-gate-id="and"]')).toContainText('Outputs a signal only if both inputs are present');

  await pickGate(page, isMobile, 'and');
  await expect(page.locator('#logic-list [data-gate-id="and"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#circuit-name')).toContainText('AND');
  expect((await snapshot(page)).circuit).toBe('chain:and');
  expect(await num(page, '#population')).toBeGreaterThan(100);
  await expect(page.locator('#zoom-label')).not.toHaveText('100%');
  await expect(page.locator('#inputs-list [data-input]')).toHaveCount(2);
  await expect(page.locator('#run-progress')).toHaveAttribute('aria-valuemax', '600');
  await expect(page.locator('#run-progress')).toBeHidden();
  expect(await lampState(page)).toBe('unset');

  await setSwitches(page, { a: true, b: true });
  await page.locator('#run-circuit').click();
  await expect(page.locator('#run-circuit')).toBeDisabled();
  await expect(page.locator('#run-progress')).toBeVisible();
  await expect(page.locator('#run-progress-text')).toHaveText(/^generation [\d,]+ \/ 600$/);
  expect(await lampState(page)).toBe('settling');
  await expect(page.locator('#run-circuit')).toBeEnabled({ timeout: 90_000 });
  await expect(page.locator('#generation')).toHaveText('600');
  expect(await lampState(page)).toBe('high');
  await expect(page.locator('#outputs-list [data-output="out"]')).toHaveText('HIGH');
  await expect(page.locator('#toast')).toContainText('HIGH');

  // Run targets the absolute observe generation even after Reset and Step.
  await page.locator('#reset').click();
  await expect(page.locator('#generation')).toHaveText('0');
  expect(await lampState(page)).toBe('unset');
  await page.locator('#step').click();
  await expect(page.locator('#generation')).toHaveText('1');
  await runCircuit(page);
  await expect(page.locator('#generation')).toHaveText('600');
  expect(await lampState(page)).toBe('high');
});

test('truth table "Run all" measures all four AND rows and reports its progress', async ({ page, isMobile }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Circuit runs are covered once on desktop.');
  test.setTimeout(180_000);
  await pickGate(page, isMobile, 'and');
  await expect(page.locator('#truth-table caption')).toHaveText('Run all to measure every combination.');
  expect(await truthRows(page)).toEqual([['0', '0', '·'], ['0', '1', '·'], ['1', '0', '·'], ['1', '1', '·']]);

  await page.locator('#fill-truth-table').click();
  await expect(page.locator('#fill-truth-table')).toBeDisabled();
  await expect(page.locator('#run-circuit')).toBeDisabled();
  await expect(page.locator('#run-progress-text')).toHaveText(/^Row [1-4] of 4$/);
  await expect(page.locator('#truth-table caption')).toHaveText('Running every combination…');
  await expect(page.locator('#fill-truth-table')).toBeEnabled({ timeout: 150_000 });
  expect(await truthRows(page)).toEqual([['0', '0', '0'], ['0', '1', '0'], ['1', '0', '0'], ['1', '1', '1']]);
  await expect(page.locator('#truth-table caption')).toHaveText('Measured from real probe cells.');
  await expect(page.locator('#toast')).toHaveText('Truth table complete');
  // The authored gate is back on the board and ready to run again.
  await expect(page.locator('#generation')).toHaveText('0');
  await expect(page.locator('#run-circuit')).toBeEnabled();
});

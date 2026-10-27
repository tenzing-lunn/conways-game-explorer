import { expect, test } from '@playwright/test';

test.skip(process.env.R2_CLOUD_TEST !== '1', 'Requires the disposable PostgreSQL browser runner.');

test('failed activation retains the guest ID and edits; retry publishes once with a cloud ID', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await expect(page.locator('#population')).toHaveText('5');
  const localId = await page.evaluate(async () => {
    const { createLocalCommunityRepository } = await import('/src/community-repository.js');
    const repo = createLocalCommunityRepository();
    const project = await repo.saveCreation({ title: 'Guest refresh regression',
      description: 'A real guest build that must survive a failed cloud refresh.', tags: ['test'],
      rle: 'x = 40, y = 40\n10$10b2o$10b2o!', width: 40, height: 40, population: 4,
      settings: { gridPreset: 'custom', width: 40, height: 40 },
    });
    return project.id;
  });
  await page.goto('/studio');
  await expect(page.locator('#project-title')).toHaveValue('Guest refresh regression');
  if (await page.locator('#inspector-toggle').isVisible()) await page.locator('#inspector-toggle').click();
  const publish = page.locator('#publish-project:visible, #publish-project-mobile:visible');
  await page.locator('#project-description').fill('Unsaved authored description must survive the whole account transition.');
  await publish.click();
  await expect(page.locator('#account-dialog')).toBeVisible();
  let afterComplete = false;
  let refreshes = 0;
  page.on('response', (response) => { if (/\/imports\/[^/]+\/complete$/.test(response.url()) && response.ok()) afterComplete = true; });
  await page.route('**/api/community/state', async (route) => {
    if (afterComplete && ++refreshes === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Injected activation refresh failure' }) });
    } else await route.continue();
  });
  const email = `r2-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
  await page.locator('[data-account-mode="sign-up"]').click();
  await page.locator('#account-name').fill('R2 Builder');
  await page.locator('#account-email').fill(email);
  await page.locator('#account-password').fill('a-long-browser-test-password');
  await page.locator('#account-submit').click();
  await expect(page.locator('#account-output')).toContainText('Sync paused', { timeout: 30_000 });
  await page.locator('#account-close').click();
  // On a phone the inspector sheet is still open over the toolbar; close it.
  if (await page.locator('#sheet-backdrop').isVisible()) await page.locator('#sheet-backdrop').click({ position: { x: 10, y: 10 } });
  await page.locator('#save-project').click();
  await expect(page.locator('#save-state')).toHaveAttribute('data-status', 'saved');
  const retained = await page.evaluate(async (localId) => {
    const { createLocalCommunityRepository } = await import('/src/community-repository.js');
    const state = await createLocalCommunityRepository().loadCommunityState();
    const project = state.creations.find((item) => item.id === localId);
    return { id: project?.id, description: project?.description, mapping: state.importMappings?.[localId] };
  }, localId);
  expect(retained.id).toBe(localId);
  expect(retained.description).toContain('Unsaved authored description');
  expect(retained.mapping.cloudProjectId).toBeTruthy();
  await page.unroute('**/api/community/state');
  await page.reload();
  // The queued Publish resumes after successful activation, including reload.
  await expect(publish).toHaveText('Published', { timeout: 30_000 });
  const response = await page.request.get('/api/community/state');
  expect(response.ok()).toBeTruthy();
  const cloud = await response.json();
  const project = cloud.creations.find((item) => item.title === 'Guest refresh regression' && item.visibility === 'public');
  expect(project.id).not.toBe(localId);
  expect(project.description).toContain('Unsaved authored description');
  expect(cloud.creations.filter((item) => item.title === 'Guest refresh regression' && item.visibility === 'public')).toHaveLength(1);
  expect(cloud.creations.filter((item) => item.title === 'Guest refresh regression'),
    'Retry must preserve one project identity, including private imports').toHaveLength(1);
  await page.reload();
  await expect(page.locator('#project-title')).toHaveValue('Guest refresh regression');
});

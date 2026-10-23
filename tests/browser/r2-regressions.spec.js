import { expect, test } from '@playwright/test';
import { RECOVERY_KEY, openMoreMenu, snapshot, watchErrors } from './helpers.js';

test.beforeEach(async ({ page }) => {
  watchErrors(page);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.workerLoads = [];
    window.workerSnapshots = [];
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'snapshot') window.workerSnapshots.push({
            generation: data.board.generation, population: data.board.population,
            width: data.board.width, height: data.board.height,
          });
        });
      }
      postMessage(data, ...args) {
        if (data.type === 'load') window.workerLoads.push({
          width: data.board.width, height: data.board.height,
          generation: data.board.generation,
          population: data.board.cells.reduce((sum, cell) => sum + cell, 0),
        });
        return super.postMessage(data, ...args);
      }
    };
  });
  await page.goto('/');
  await expect(page.locator('#population')).toHaveText('5');
});
test.afterEach(async ({ page }) => expect(page.errors).toEqual([]));

test('actual IndexedDB serializes two-tab edits with import cleanup and rolls back aborted mappings', async ({ page, context }) => {
  const second = await context.newPage();
  await second.goto('/');
  const snapshot = await page.evaluate(async () => {
    const { createLocalCommunityRepository } = await import('/src/community-repository.js');
    window.importRepo = createLocalCommunityRepository({ key: 'r2-concurrency' });
    const project = await window.importRepo.saveCreation({ title: 'Concurrent', rle: 'x = 40, y = 40\no!', width: 40, height: 40 });
    return window.importRepo.captureImportSnapshot(project.id);
  });
  await second.evaluate(async (snapshot) => {
    const { createLocalCommunityRepository } = await import('/src/community-repository.js');
    const repo = createLocalCommunityRepository({ key: 'r2-concurrency' });
    await repo.saveVersion(snapshot.creation.id, { rle: 'x = 40, y = 40\n2o!', width: 40, height: 40 });
  }, snapshot);
  expect(await page.evaluate(async (snapshot) => (await window.importRepo.commitImportedSnapshot(snapshot.creation.id, snapshot, { cloudProjectId: 'cloud' })).removed, snapshot)).toBe(false);
  const verified = await page.evaluate(async (snapshot) => {
    const { localTransaction } = await import('/src/local-database.js');
    let aborted = false;
    try {
      await localTransaction('r2-concurrency-projects-v2', 'state', (current) => {
        current.creations = [];
        current.importMappings = { bad: 'must not commit' };
        // Structured cloning a function fails after the mutation is prepared.
        return { value: { ...current, uncloneable: () => {} } };
      });
    } catch { aborted = true; }
    const fresh = await window.importRepo.loadCommunityState();
    return { aborted, rle: fresh.creations[0].currentVersion.rle,
      mapping: fresh.importMappings[snapshot.creation.id].cloudProjectId,
      bad: fresh.importMappings.bad };
  }, snapshot);
  expect(verified).toEqual({ aborted: true, rle: 'x = 40, y = 40\n2o!', mapping: 'cloud', bad: undefined });
  // Concurrent writers each append to the current transactional history.
  await Promise.all([page, second].map((tab) => tab.evaluate(async (id) => {
    const { createLocalCommunityRepository } = await import('/src/community-repository.js');
    const repo = createLocalCommunityRepository({ key: 'r2-concurrency' });
    await repo.saveVersion(id, { rle: 'x = 40, y = 40\n3o!', width: 40, height: 40 });
  }, snapshot.creation.id)));
  expect(await page.evaluate(async () => (await window.importRepo.loadCommunityState()).creations[0].versions.length)).toBe(4);
  expect(await page.evaluate(async (id) => {
    const captured = await window.importRepo.captureImportSnapshot(id);
    const result = await window.importRepo.commitImportedSnapshot(id, captured, { cloudProjectId: 'cloud' });
    const reloaded = await window.importRepo.loadCommunityState();
    return { removed: result.removed, count: reloaded.creations.length, mapped: reloaded.importMappings[id].cloudProjectId };
  }, snapshot.creation.id)).toEqual({ removed: true, count: 0, mapped: 'cloud' });
  await second.close();
});

test('maximum-size binary recovery reloads and Step uses the recovered board', async ({ page }) => {
  test.setTimeout(90_000);
  await page.evaluate(async (key) => {
    const { writeRecovery } = await import('/src/local-database.js');
    await writeRecovery(key, {
      format: 'life-board-binary-v1', title: 'Maximum board', width: 2048, height: 2048,
      cells: new Uint8Array(2048 * 2048).fill(1), generation: 0, population: 2048 * 2048,
      settings: { gridPreset: 'custom', width: 2048, height: 2048, wrapping: true },
    });
  }, RECOVERY_KEY);
  // Recovered work lives in the Studio workspace; the Playground keeps its own board.
  await page.goto('/studio');
  await expect(page.locator('#population')).toHaveText('4,194,304');
  await page.locator('#step').click();
  await expect(page.locator('#generation')).toHaveText('1');
  await expect(page.locator('#population')).toHaveText('0');
  await page.locator('#reset').click();
  await expect(page.locator('#population')).toHaveText('4,194,304');
  const stored = await page.evaluate(async (key) => {
    const { readRecovery } = await import('/src/local-database.js');
    const value = await readRecovery(key);
    return { bytes: value.cells.byteLength, binary: value.cells instanceof Uint8Array, rle: value.rle };
  }, RECOVERY_KEY);
  expect(stored).toEqual({ bytes: 4194304, binary: true, rle: undefined });
});

test('Undo and Redo reload the worker, and Step after each respects its board', async ({ page }) => {
  await openMoreMenu(page);
  await page.locator('#clear-board').click();
  await expect(page.locator('#population')).toHaveText('0');
  await page.locator('#undo').click();
  await expect(page.locator('#population')).toHaveText('5');
  await page.locator('#step').click();
  await expect(page.locator('#generation')).toHaveText('1');
  await expect(page.locator('#population')).toHaveText('5');
  await page.locator('#redo').click();
  await expect(page.locator('#population')).toHaveText('0');
  await page.locator('#step').click();
  await expect(page.locator('#generation')).toHaveText('1');
  await expect(page.locator('#population')).toHaveText('0');
});

test('opening a saved project replaces the worker seed before Step', async ({ page }) => {
  await page.evaluate(async () => {
    const { createLocalCommunityRepository } = await import('/src/community-repository.js');
    await createLocalCommunityRepository().saveCreation({
      title: 'Stationary block', width: 40, height: 40, population: 4,
      rle: 'x = 40, y = 40\n10$10b2o$10b2o!',
      settings: { gridPreset: 'custom', width: 40, height: 40 },
    });
  });
  await page.goto('/studio');
  await expect(page.locator('#project-title')).toHaveValue('Stationary block');
  await expect(page.locator('#population')).toHaveText('4');
  await page.locator('#step').click();
  await expect(page.locator('#generation')).toHaveText('1');
  await expect(page.locator('#population')).toHaveText('4');
  expect(await snapshot(page)).toMatchObject({ width: 40, height: 40 });
});

test('clearing a large running board cancels stale Worker results', async ({ page }) => {
  test.setTimeout(60_000);
  await page.evaluate(async (key) => {
    const { writeRecovery } = await import('/src/local-database.js');
    const cells = new Uint8Array(1200 * 1200);
    for (let index = 0; index < cells.length; index += 2) cells[index] = 1;
    await writeRecovery(key, {
      format: 'life-board-binary-v1', title: 'Cancellation board', width: 1200, height: 1200,
      cells, generation: 0, population: 720_000,
      settings: { gridPreset: 'custom', width: 1200, height: 1200, wrapping: true, speed: 40 },
    });
  }, RECOVERY_KEY);
  await page.goto('/studio');
  await expect(page.locator('#population')).toHaveText('720,000');
  await page.locator('#play-toggle').click();
  await expect(page.locator('#play-label')).toHaveText('Pause');
  await openMoreMenu(page);
  await page.locator('#clear-board').click();
  await expect(page.locator('#population')).toHaveText('0');
  // Give any stale worker result time to arrive: it must be ignored.
  await page.waitForTimeout(750);
  await expect(page.locator('#population')).toHaveText('0');
  await expect(page.locator('#generation')).toHaveText('0');
  await expect(page.locator('#play-label')).toHaveText('Play');
});

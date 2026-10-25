import { expect, test } from '@playwright/test';
import {
  addGate, chips, chooseChipAction, formula, inputNames, lampState, loadLocalState, num, openChipMenu, openInspector, pickGate,
  runCircuit, setSwitches, snapshot, spec, watchErrors,
} from './helpers.js';

// Plain left-to-right chains: the simplest circuits the formula editor shows.

test.beforeEach(async ({ page }) => {
  watchErrors(page);
  await page.goto('/studio');
  await expect(page.locator('#project-header')).toBeVisible();
});

test.afterEach(async ({ page }) => expect(page.errors, 'browser runtime errors').toEqual([]));

test.describe('desktop', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'Chain runs are covered once on desktop; the phone composer has its own test.');

  test('AND → OR adds input C, labels the lanes, and settles HIGH at generation 900', async ({ page, isMobile }) => {
    test.setTimeout(240_000);
    await pickGate(page, isMobile, 'and');
    await expect(page.locator('#formula-list')).toBeVisible();
    expect(await chips(page)).toEqual(['and']);
    expect(await formula(page)).toEqual(['OUT = A AND B']);
    await expect(page.locator('#chain-note')).toBeHidden();

    await addGate(page, 'or');
    await expect.poll(() => chips(page)).toEqual(['and', 'or']);
    expect(await inputNames(page)).toEqual(['a', 'b', 'c']);
    expect(await page.locator('#inputs-list .switch-row small').allInnerTexts()).toEqual(['→ AND', '↑ AND', '↑ OR']);
    expect(await formula(page)).toEqual(['OUT = (A AND B) OR C']);
    await expect(page.locator('#outputs-list .lamp-row > span').first()).toHaveText('OUT');
    await expect(page.locator('#circuit-name')).toHaveText('2 gates. Choose any part of the formula to change it.');
    await expect(page.locator('#run-progress')).toHaveAttribute('aria-valuemax', '900');
    const state = await snapshot(page);
    expect(state.spec).toEqual(['OUT = (A AND B) OR C']);
    expect(state.gates).toEqual(['and', 'or']);
    expect(state.width).toBe(950);
    await expect(page.locator('#zoom-label')).not.toHaveText('100%');

    await setSwitches(page, { a: true, b: false, c: true });
    await runCircuit(page, { timeout: 180_000 });
    await expect(page.locator('#generation')).toHaveText('900');
    expect(await lampState(page)).toBe('high');

    await setSwitches(page, { c: false });
    expect(await lampState(page)).toBe('unset');
    await runCircuit(page, { timeout: 180_000 });
    await expect(page.locator('#generation')).toHaveText('900');
    expect(await lampState(page)).toBe('low');
  });

  test('removing the middle gate shrinks the inputs, and the half-adder stays standalone', async ({ page, isMobile }) => {
    await pickGate(page, isMobile, 'and');
    await addGate(page, 'or');
    await addGate(page, 'not');
    expect(await spec(page)).toEqual(['OUT = NOT ((A AND B) OR C)']);
    await expect(page.locator('#run-progress')).toHaveAttribute('aria-valuemax', '1320');
    expect(await chips(page)).toEqual(['not', 'and', 'or']);

    await openChipMenu(page, '#formula-list [data-chip="gate"][data-gate="or"]');
    await chooseChipAction(page, 'remove');
    await expect.poll(() => spec(page)).toEqual(['OUT = NOT (A AND B)']);
    expect(await inputNames(page)).toEqual(['a', 'b']);
    await expect(page.locator('#add-gate-out')).toBeEnabled();
    await expect(page.locator('#chain-note')).toBeHidden();
    expect((await snapshot(page)).gates).toEqual(['and', 'not']);

    await pickGate(page, isMobile, 'half-adder');
    await expect(page.locator('#formula-list')).toBeHidden();
    await expect(page.locator('#chain-note')).toHaveText('Standalone component.');
    expect(await page.locator('#outputs-list .lamp-row > span:first-child').allInnerTexts()).toEqual(['Sum', 'Carry']);
    expect(await inputNames(page)).toEqual(['a', 'b']);
    expect((await snapshot(page)).gates).toEqual(['half-adder']);
  });

  test('a saved chain and its switches survive Save and reload', async ({ page, isMobile }) => {
    await pickGate(page, isMobile, 'or');
    await addGate(page, 'and');
    await expect.poll(() => chips(page)).toEqual(['or', 'and']);
    await setSwitches(page, { a: true, c: true });
    const population = await num(page, '#population');
    await page.locator('#project-title').fill('Saved OR → AND chain');

    await page.locator('#save-project').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    await expect(page.locator('#save-state')).toHaveAttribute('data-status', 'saved');
    const saved = (await loadLocalState(page)).creations.find((creation) => creation.title === 'Saved OR → AND chain');
    expect(saved.previewConfig.circuit).toEqual({
      outputs: [{ id: 'out', label: 'OUT', tree: { gate: 'and', a: { gate: 'or', a: { input: 'a' }, b: { input: 'b' } }, b: { input: 'c' } } }],
      inputs: { a: true, b: false, c: true },
    });

    await page.goto('/studio');
    await expect(page.locator('#project-title')).toHaveValue('Saved OR → AND chain');
    await expect(page.locator('#circuit-section')).toBeVisible();
    await expect.poll(() => chips(page)).toEqual(['or', 'and']);
    const switches = await page.locator('#inputs-list [data-input]').evaluateAll((nodes) => nodes.map((node) => `${node.dataset.input}=${node.checked ? 1 : 0}`));
    expect(switches).toEqual(['a=1', 'b=0', 'c=1']);
    await expect(page.locator('#population')).toHaveText(population.toLocaleString('en-US'));
    await expect(page.locator('#save-state')).toHaveAttribute('data-status', 'saved');
    await expect(page.locator('#zoom-label')).not.toHaveText('100%');
  });

  test('an old saved chain in the gate-list form still opens', async ({ page, isMobile }) => {
    await pickGate(page, isMobile, 'and');
    await page.locator('#project-title').fill('Legacy chain');
    await page.locator('#save-project').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    // Rewrite the stored spec to the form earlier builds saved.
    await page.evaluate(async () => {
      const { createLocalCommunityRepository } = await import('/src/community-repository.js');
      const repo = createLocalCommunityRepository();
      const state = await repo.loadCommunityState();
      const creation = state.creations.find((entry) => entry.title === 'Legacy chain');
      await repo.updateCreationMetadata(creation.id, { previewConfig: { ...creation.previewConfig, circuit: { gates: ['and', 'or'], inputs: { a: true, b: false, c: true } } } });
    });
    await page.goto('/studio');
    await expect(page.locator('#project-title')).toHaveValue('Legacy chain');
    await expect.poll(() => spec(page)).toEqual(['OUT = (A AND B) OR C']);
    const switches = await page.locator('#inputs-list [data-input]').evaluateAll((nodes) => nodes.map((node) => `${node.dataset.input}=${node.checked ? 1 : 0}`));
    expect(switches).toEqual(['a=1', 'b=0', 'c=1']);
  });
});

test('phone: the composer works from the inspector sheet without horizontal overflow', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone layout only.');
  await pickGate(page, isMobile, 'and');
  await expect(page.locator('#rail')).toHaveAttribute('data-open', 'false');
  await openInspector(page, isMobile);
  await addGate(page, 'or');
  await expect.poll(() => chips(page)).toEqual(['and', 'or']);
  await page.locator('#inputs-list [data-input="c"]').click();
  await expect(page.locator('#inputs-list [data-input="c"]')).toBeChecked();
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth > window.innerWidth,
    inspector: (() => { const node = document.querySelector('#inspector'); return node.scrollWidth > node.clientWidth + 1; })(),
  }));
  expect(overflow).toEqual({ page: false, inspector: false });
  await page.locator('#inspector-close').click();
  await expect(page.locator('#inspector')).toHaveAttribute('data-open', 'false');
});

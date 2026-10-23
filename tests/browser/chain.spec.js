import { expect, test } from '@playwright/test';
import {
  chips, inputNames, lampState, loadLocalState, num, openInspector, pickGate, runCircuit, setSwitches, snapshot, watchErrors,
} from './helpers.js';

const outputLabel = (page) => page.locator('#outputs-list .lamp-row > span').first();

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
    await expect(page.locator('#chain-row')).toBeVisible();
    expect(await chips(page)).toEqual(['and']);
    await expect(page.locator('#chain-list [data-remove-gate]')).toHaveCount(0);
    await expect(page.locator('#chain-note')).toBeHidden();

    await page.locator('#add-gate').click();
    await expect(page.locator('#add-gate-menu')).toBeVisible();
    await page.locator('#add-gate-menu [data-add-gate="or"]').click();
    await expect(page.locator('#add-gate-menu')).toBeHidden();
    await expect.poll(() => chips(page)).toEqual(['and', 'or']);
    expect(await inputNames(page)).toEqual(['a', 'b', 'c']);
    expect(await page.locator('#inputs-list .switch-row small').allInnerTexts()).toEqual(['→ AND', '↑ AND', '↑ OR']);
    await expect(outputLabel(page)).toHaveText('(A AND B) OR C');
    await expect(page.locator('#circuit-name')).toHaveText('Each gate feeds the next.');
    await expect(page.locator('#run-progress')).toHaveAttribute('aria-valuemax', '900');
    const state = await snapshot(page);
    expect(state.circuit).toBe('chain:and>or');
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

  test('a third gate caps the chain, removing the middle gate shrinks the inputs, and the half-adder stays standalone', async ({ page, isMobile }) => {
    await pickGate(page, isMobile, 'and');
    await page.locator('#add-gate').click();
    await page.locator('#add-gate-menu [data-add-gate="or"]').click();
    await expect.poll(() => chips(page)).toEqual(['and', 'or']);
    await page.locator('#add-gate').click();
    await page.locator('#add-gate-menu [data-add-gate="not"]').click();
    await expect.poll(() => chips(page)).toEqual(['and', 'or', 'not']);
    await expect(page.locator('#add-gate')).toBeDisabled();
    await expect(page.locator('#chain-note')).toHaveText('Up to 3 gates.');
    await expect(outputLabel(page)).toHaveText('NOT ((A AND B) OR C)');
    await expect(page.locator('#run-progress')).toHaveAttribute('aria-valuemax', '1320');
    await expect(page.locator('#chain-list [data-remove-gate]')).toHaveCount(3);

    await page.locator('#chain-list [data-remove-gate="1"]').click();
    await expect.poll(() => chips(page)).toEqual(['and', 'not']);
    expect(await inputNames(page)).toEqual(['a', 'b']);
    await expect(page.locator('#add-gate')).toBeEnabled();
    await expect(page.locator('#chain-note')).toBeHidden();
    await expect(outputLabel(page)).toHaveText('NOT (A AND B)');
    expect((await snapshot(page)).circuit).toBe('chain:and>not');

    await pickGate(page, isMobile, 'half-adder');
    await expect(page.locator('#chain-row')).toBeHidden();
    await expect(page.locator('#chain-note')).toHaveText('Standalone component.');
    expect(await page.locator('#outputs-list .lamp-row > span:first-child').allInnerTexts()).toEqual(['Sum', 'Carry']);
    expect(await inputNames(page)).toEqual(['a', 'b']);
    expect((await snapshot(page)).circuit).toBe('half-adder');
  });

  test('a saved chain and its switches survive Save and reload', async ({ page, isMobile }) => {
    await pickGate(page, isMobile, 'or');
    await page.locator('#add-gate').click();
    await page.locator('#add-gate-menu [data-add-gate="and"]').click();
    await expect.poll(() => chips(page)).toEqual(['or', 'and']);
    await setSwitches(page, { a: true, c: true });
    const population = await num(page, '#population');
    await page.locator('#project-title').fill('Saved OR → AND chain');

    await page.locator('#save-project').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    await expect(page.locator('#save-state')).toHaveAttribute('data-status', 'saved');
    const saved = (await loadLocalState(page)).creations.find((creation) => creation.title === 'Saved OR → AND chain');
    expect(saved.previewConfig.circuit).toEqual({ gates: ['or', 'and'], inputs: { a: true, b: false, c: true } });

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
});

test('phone: the composer works from the inspector sheet without horizontal overflow', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone layout only.');
  await pickGate(page, isMobile, 'and');
  await expect(page.locator('#rail')).toHaveAttribute('data-open', 'false');
  await openInspector(page, isMobile);
  await page.locator('#add-gate').click();
  await page.locator('#add-gate-menu [data-add-gate="or"]').click();
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

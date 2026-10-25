import { expect, test } from '@playwright/test';
import {
  addGate, chooseChipAction, formula, inputNames, lampState, loadLocalState, openChipMenu, openInspector, pickGate, runAll,
  runUntilSettled, setSwitches, spec, truthRows, watchErrors,
} from './helpers.js';

// The Logic inspector as a formula editor: presets, branching trees built from
// chip menus, reusable inputs, two outputs, and persistence of the spec.

test.beforeEach(async ({ page }) => {
  watchErrors(page);
  await page.goto('/studio');
  await expect(page.locator('#project-header')).toBeVisible();
});

test.afterEach(async ({ page }) => expect(page.errors, 'browser runtime errors').toEqual([]));

const lampIds = (page) => page.locator('#outputs-list .lamp').evaluateAll((nodes) => nodes.map((node) => node.dataset.output));
const limits = (page) => page.evaluate(async () => {
  const { CIRCUIT_MAX_GATES } = await import('/src/circuits.js');
  return { maxGates: CIRCUIT_MAX_GATES };
});

test.describe('desktop', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'Measured runs are covered once on desktop; the phone editor has its own test.');

  test('the XOR preset opens as an editable formula with one lamp and a four-row truth table', async ({ page, isMobile }) => {
    test.setTimeout(600_000);
    await pickGate(page, isMobile, 'xor');
    await expect(page.locator('#logic-list [data-gate-id="xor"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#circuit-name')).toContainText('XOR');
    await expect(page.locator('#formula-list')).toBeVisible();
    expect(await formula(page)).toEqual(['OUT = (A OR B) AND (NOT (A AND B))']);
    expect(await spec(page)).toEqual(['OUT = (A OR B) AND (NOT (A AND B))']);
    expect(await inputNames(page)).toEqual(['a', 'b']);
    expect(await lampIds(page)).toEqual(['out']);
    await expect(page.locator('#truth-table tbody tr')).toHaveCount(4);
    await expect(page.locator('#truth-table thead th')).toHaveText(['A', 'B', 'OUT']);
    expect((await page.evaluate(() => window.__lifeLab.circuitGeometry())).tiles.length).toBeGreaterThanOrEqual(4);

    await runAll(page, { timeout: 540_000 });
    expect(await truthRows(page)).toEqual([['0', '0', '0'], ['0', '1', '1'], ['1', '0', '1'], ['1', '1', '0']]);
    await expect(page.locator('#truth-table caption')).toHaveText('Measured from real probe cells.');
  });

  test('the Full adder opens with Sum and Carry lamps, two probes, and an eight-row table that fills correctly', async ({ page, isMobile }) => {
    test.setTimeout(900_000);
    await pickGate(page, isMobile, 'full-adder');
    await expect(page.locator('#circuit-name')).toContainText('Full adder');
    expect(await lampIds(page)).toEqual(['sum', 'carry']);
    await expect(page.locator('#outputs-list .lamp-row > span:first-child')).toHaveText(['SUM', 'CARRY']);
    expect(await inputNames(page)).toEqual(['a', 'b', 'c']);
    expect(await page.locator('#formula-list .formula-row .formula-label').allInnerTexts()).toEqual(['SUM =', 'CARRY =']);
    await expect(page.locator('#add-gate-sum')).toBeVisible();
    await expect(page.locator('#add-gate-carry')).toBeVisible();
    const geometry = await page.evaluate(() => window.__lifeLab.circuitGeometry());
    expect(geometry.outputs.map((output) => output.id)).toEqual(['sum', 'carry']);
    expect(geometry.ports.filter((port) => port.type === 'input').length).toBeGreaterThanOrEqual(3);
    await expect(page.locator('#truth-table tbody tr')).toHaveCount(8);
    await expect(page.locator('#truth-table thead th')).toHaveText(['A', 'B', 'C', 'SUM', 'CARRY']);

    // Flip inputs, run: 1 + 1 + 0 = Sum 0, Carry 1.
    await setSwitches(page, { a: true, b: true, c: false });
    await runUntilSettled(page, { timeout: 540_000 });
    expect(await lampState(page, 'sum')).toBe('low');
    expect(await lampState(page, 'carry')).toBe('high');
    await expect(page.locator('#toast')).toHaveText('SUM: LOW · CARRY: HIGH');

    await runAll(page, { timeout: 840_000 });
    expect(await truthRows(page)).toEqual([
      ['0', '0', '0', '0', '0'],
      ['0', '0', '1', '1', '0'],
      ['0', '1', '0', '1', '0'],
      ['0', '1', '1', '0', '1'],
      ['1', '0', '0', '1', '0'],
      ['1', '0', '1', '0', '1'],
      ['1', '1', '0', '0', '1'],
      ['1', '1', '1', '1', '1'],
    ]);
  });

  test('(A AND B) OR (A AND C) can be built from the chip menus, measured, saved and reloaded', async ({ page, isMobile }) => {
    test.setTimeout(900_000);
    await pickGate(page, isMobile, 'and');
    expect(await formula(page)).toEqual(['OUT = A AND B']);
    await addGate(page, 'or');
    expect(await spec(page)).toEqual(['OUT = (A AND B) OR C']);
    await expect(page.locator('#circuit-name')).toHaveText('2 gates. Choose any part of the formula to change it.');

    // C becomes a gate of its own: C AND D.
    await openChipMenu(page, '#formula-list [data-chip="input"][data-input="c"]');
    await expect(page.locator('#chip-menu [data-chip-action="use"]')).toHaveText(['Use A', 'Use B', 'Use D (new)']);
    await chooseChipAction(page, 'grow', 'and');
    expect(await spec(page)).toEqual(['OUT = (A AND B) OR (C AND D)']);
    expect(await inputNames(page)).toEqual(['a', 'b', 'c', 'd']);

    // Reuse A in place of C, then rename D to C: (A AND B) OR (A AND C).
    await openChipMenu(page, '#formula-list [data-chip="input"][data-input="c"]');
    await chooseChipAction(page, 'use', 'a');
    expect(await spec(page)).toEqual(['OUT = (A AND B) OR (A AND D)']);
    expect(await inputNames(page)).toEqual(['a', 'b', 'd']);
    await openChipMenu(page, '#formula-list [data-chip="input"][data-input="d"]');
    await chooseChipAction(page, 'use', 'c');
    expect(await spec(page)).toEqual(['OUT = (A AND B) OR (A AND C)']);
    expect(await formula(page)).toEqual(['OUT = (A AND B) OR (A AND C)']);
    expect(await inputNames(page)).toEqual(['a', 'b', 'c']);
    // A feeds two gates: two lanes carry it on the board.
    const geometry = await page.evaluate(() => window.__lifeLab.circuitGeometry());
    expect(geometry.ports.filter((port) => port.type === 'input' && port.name === 'a').length).toBe(2);
    await expect(page.locator('#logic-list [aria-pressed="true"]')).toHaveCount(0);

    await runAll(page, { timeout: 840_000 });
    expect(await truthRows(page)).toEqual([
      ['0', '0', '0', '0'], ['0', '0', '1', '0'], ['0', '1', '0', '0'], ['0', '1', '1', '0'],
      ['1', '0', '0', '0'], ['1', '0', '1', '1'], ['1', '1', '0', '1'], ['1', '1', '1', '1'],
    ]);

    await setSwitches(page, { a: true, c: true });
    await page.locator('#project-title').fill('Branching circuit');
    await page.locator('#save-project').click();
    await expect(page.locator('#toast')).toHaveText('Saved');
    const saved = (await loadLocalState(page)).creations.find((creation) => creation.title === 'Branching circuit');
    expect(saved.previewConfig.circuit).toEqual({
      outputs: [{
        id: 'out',
        label: 'OUT',
        tree: { gate: 'or', a: { gate: 'and', a: { input: 'a' }, b: { input: 'b' } }, b: { gate: 'and', a: { input: 'a' }, b: { input: 'c' } } },
      }],
      inputs: { a: true, b: false, c: true },
    });

    await page.goto('/studio');
    await expect(page.locator('#project-title')).toHaveValue('Branching circuit');
    await expect(page.locator('#circuit-section')).toBeVisible();
    await expect.poll(() => spec(page)).toEqual(['OUT = (A AND B) OR (A AND C)']);
    const switches = await page.locator('#inputs-list [data-input]').evaluateAll((nodes) => nodes.map((node) => `${node.dataset.input}=${node.checked ? 1 : 0}`));
    expect(switches).toEqual(['a=1', 'b=0', 'c=1']);
    await expect(page.locator('#zoom-label')).not.toHaveText('100%');
  });

  test('a gate can be removed from its chip, the gate cap shows a note, and the half-adder stays standalone', async ({ page, isMobile }) => {
    test.setTimeout(300_000);
    await pickGate(page, isMobile, 'and');
    await addGate(page, 'or');
    await addGate(page, 'not');
    expect(await spec(page)).toEqual(['OUT = NOT ((A AND B) OR C)']);
    await expect(page.locator('#chain-note')).toBeHidden();
    // Remove the OR in the middle: NOT (A AND B), and C goes away.
    await openChipMenu(page, '#formula-list [data-chip="gate"][data-gate="or"]');
    await expect(page.locator('#chip-menu [data-chip-action="remove"]')).toHaveText('Remove this gate');
    await chooseChipAction(page, 'remove');
    expect(await spec(page)).toEqual(['OUT = NOT (A AND B)']);
    expect(await inputNames(page)).toEqual(['a', 'b']);

    // Keep wrapping the Full adder's Sum in NOT until the cap note appears.
    const { maxGates } = await limits(page);
    await pickGate(page, isMobile, 'full-adder');
    for (let attempt = 0; attempt < maxGates + 2; attempt += 1) {
      if (await page.locator('#chain-note').isVisible()) break;
      await addGate(page, 'not', 'sum');
    }
    await expect(page.locator('#chain-note')).toBeVisible();
    await expect(page.locator('#chain-note')).toContainText(`Up to ${maxGates} gates`);
    await openChipMenu(page, '#add-gate-sum');
    await expect(page.locator('#chip-menu [data-chip-action="wrap"][data-value="not"]')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('#chip-menu')).toBeHidden();

    await pickGate(page, isMobile, 'half-adder');
    await expect(page.locator('#formula-list')).toBeHidden();
    await expect(page.locator('#chain-note')).toHaveText('Standalone component.');
    expect(await lampIds(page)).toEqual(['sum', 'carry']);
    expect(await inputNames(page)).toEqual(['a', 'b']);
  });
});

test('phone: the formula editor works in the inspector sheet with 40px targets and no horizontal overflow', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone layout only.');
  await pickGate(page, isMobile, 'full-adder');
  await expect(page.locator('#rail')).toHaveAttribute('data-open', 'false');
  await openInspector(page, isMobile);
  await expect(page.locator('#formula-list')).toBeVisible();
  const chipHeights = await page.locator('#formula-list .chip').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  expect(Math.min(...chipHeights)).toBeGreaterThanOrEqual(40);
  expect(await lampIds(page)).toEqual(['sum', 'carry']);
  // Each input row is a 40px label: tapping the letter toggles the switch.
  const rowHeights = await page.locator('#inputs-list .switch-row').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  expect(Math.min(...rowHeights)).toBeGreaterThanOrEqual(40);
  const wasOn = await page.locator('#inputs-list [data-input="a"]').isChecked();
  await page.locator('#inputs-list .switch-row:has([data-input="a"]) > span').tap();
  await expect(page.locator('#inputs-list [data-input="a"]')).toBeChecked({ checked: !wasOn });

  await openChipMenu(page, '#formula-list [data-chip="input"][data-input="c"]');
  const menu = await page.locator('#chip-menu').boundingBox();
  const viewport = page.viewportSize();
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(viewport.width);
  expect(menu.y).toBeGreaterThanOrEqual(0);
  expect(menu.y + menu.height).toBeLessThanOrEqual(viewport.height);
  const itemHeights = await page.locator('#chip-menu button').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  expect(Math.min(...itemHeights)).toBeGreaterThanOrEqual(40);
  await page.keyboard.press('Escape');
  await expect(page.locator('#chip-menu')).toBeHidden();

  // A chain in the sheet: add a gate, then reuse A in place of C.
  await page.locator('#inspector-close').click();
  await pickGate(page, isMobile, 'and');
  await openInspector(page, isMobile);
  await addGate(page, 'or');
  expect(await spec(page)).toEqual(['OUT = (A AND B) OR C']);
  await openChipMenu(page, '#formula-list [data-chip="input"][data-input="c"]');
  await chooseChipAction(page, 'use', 'a');
  expect(await spec(page)).toEqual(['OUT = (A AND B) OR A']);
  expect(await inputNames(page)).toEqual(['a', 'b']);

  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth > window.innerWidth,
    inspector: (() => { const node = document.querySelector('#inspector'); return node.scrollWidth > node.clientWidth + 1; })(),
  }));
  expect(overflow).toEqual({ page: false, inspector: false });
  await page.locator('#inspector-close').click();
  await expect(page.locator('#inspector')).toHaveAttribute('data-open', 'false');
});

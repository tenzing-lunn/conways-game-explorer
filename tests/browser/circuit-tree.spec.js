import { expect, test } from '@playwright/test';
import {
  addGate, chooseChipAction, formula, inputNames, lampState, loadLocalState, openChipMenu, openInspector, pickGate, runAll,
  runUntilSettled, setSwitches, snapshot, spec, truthRows, watchErrors,
} from './helpers.js';

// The Logic inspector as a formula editor: the XOR preset, branching trees
// built from chip menus, reusable inputs, the two-lamp half-adder, the
// engine's limits, and persistence of the spec.

test.beforeEach(async ({ page }) => {
  watchErrors(page);
  await page.goto('/studio');
  await expect(page.locator('#project-header')).toBeVisible();
});

test.afterEach(async ({ page }) => expect(page.errors, 'browser runtime errors').toEqual([]));

const lampIds = (page) => page.locator('#outputs-list .lamp').evaluateAll((nodes) => nodes.map((node) => node.dataset.output));
const limits = (page) => page.evaluate(async () => {
  const { CIRCUIT_MAX_GATES, CIRCUIT_MAX_CHAIN_GATES } = await import('/src/circuits.js');
  return { maxGates: CIRCUIT_MAX_GATES, maxChain: CIRCUIT_MAX_CHAIN_GATES };
});

test.describe('desktop', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'Measured runs are covered once on desktop; the phone editor has its own test.');

  test('the XOR preset opens as an editable formula with one lamp, a turned tile, and a four-row truth table', async ({ page, isMobile }) => {
    test.setTimeout(600_000);
    await pickGate(page, isMobile, 'xor');
    await expect(page.locator('#logic-list [data-gate-id="xor"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#circuit-name')).toContainText('XOR');
    await expect(page.locator('#formula-list')).toBeVisible();
    expect(await formula(page)).toEqual(['OUT = (NOT (A AND B)) AND (A OR B)']);
    expect(await spec(page)).toEqual(['OUT = (NOT (A AND B)) AND (A OR B)']);
    // Presets open expanded into their tree, so the engine ids them as trees.
    expect((await snapshot(page)).circuit).toBe('tree:and(not(and(a,b)),or(a,b))');
    expect(await inputNames(page)).toEqual(['a', 'b']);
    expect(await lampIds(page)).toEqual(['out']);
    await expect(page.locator('#outputs-list .lamp-row > span:first-child')).toHaveText(['OUT']);
    await expect(page.locator('#truth-table tbody tr')).toHaveCount(4);
    await expect(page.locator('#truth-table thead th')).toHaveText(['A', 'B', 'OUT']);
    // Four tiles; the OR sits turned on its side, fed from the south and the west.
    const geometry = await page.evaluate(() => window.__lifeLab.circuitGeometry());
    expect(geometry.tiles.map((tile) => tile.gateId).sort()).toEqual(['and', 'and', 'not', 'or']);
    const turned = geometry.tiles.filter((tile) => tile.rotation === 90);
    expect(turned).toHaveLength(1);
    expect(geometry.ports.filter((port) => port.type === 'input')).toHaveLength(4);
    expect(geometry.ports.filter((port) => port.type === 'input' && port.tileIndex === turned[0].index).map((port) => port.side).sort()).toEqual(['south', 'west']);
    // Fitted: every tile and the input lanes' queued packets sit inside the canvas.
    const state = await snapshot(page);
    const box = await page.locator('#world').boundingBox();
    const cell = state.zoom * 10;
    for (const tile of geometry.tiles) {
      expect(state.panX + tile.x * cell).toBeGreaterThanOrEqual(-1);
      expect(state.panX + (tile.x + tile.width) * cell).toBeLessThanOrEqual(box.width + 1);
      expect(state.panY + (tile.y + tile.height) * cell).toBeLessThanOrEqual(box.height + 1);
    }

    await runAll(page, { timeout: 540_000 });
    expect(await truthRows(page)).toEqual([['0', '0', '0'], ['0', '1', '1'], ['1', '0', '1'], ['1', '1', '0']]);
    await expect(page.locator('#truth-table caption')).toHaveText('Each row was run on the board.');
  });

  test('the half-adder shows Sum and Carry lamps, two probes, and a four-row table with two output columns', async ({ page, isMobile }) => {
    test.setTimeout(600_000);
    await pickGate(page, isMobile, 'half-adder');
    await expect(page.locator('#logic-list [data-gate-id="half-adder"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#formula-list')).toBeHidden();
    await expect(page.locator('#chain-note')).toHaveText('Built as one fixed circuit with two outputs, so its gates cannot be changed here.');
    expect(await lampIds(page)).toEqual(['sum', 'carry']);
    await expect(page.locator('#outputs-list .lamp-row > span:first-child')).toHaveText(['Sum', 'Carry']);
    expect(await inputNames(page)).toEqual(['a', 'b']);
    const geometry = await page.evaluate(() => window.__lifeLab.circuitGeometry());
    expect(geometry.outputs.map((output) => output.id)).toEqual(['sum', 'carry']);
    await expect(page.locator('#truth-table tbody tr')).toHaveCount(4);
    await expect(page.locator('#truth-table thead th')).toHaveText(['A', 'B', 'Sum', 'Carry']);

    // Flip both inputs, run: 1 + 1 = Sum 0, Carry 1.
    await setSwitches(page, { a: true, b: true });
    await runUntilSettled(page, { timeout: 540_000 });
    expect(await lampState(page, 'sum')).toBe('low');
    expect(await lampState(page, 'carry')).toBe('high');
    await expect(page.locator('#toast')).toHaveText('Sum: LOW · Carry: HIGH');

    await runAll(page, { timeout: 540_000 });
    expect(await truthRows(page)).toEqual([
      ['0', '0', '0', '0'],
      ['0', '1', '1', '0'],
      ['1', '0', '1', '0'],
      ['1', '1', '0', '1'],
    ]);
    // After Run all the lamps show the measured row for the switches as set.
    expect(await lampState(page, 'sum')).toBe('low');
    expect(await lampState(page, 'carry')).toBe('high');
    await setSwitches(page, { b: false });
    expect(await lampState(page, 'sum')).toBe('high');
    expect(await lampState(page, 'carry')).toBe('low');

    // Opening another circuit from the rail shows its heading and formula.
    await page.locator('#inspector').evaluate((node) => { node.scrollTop = node.scrollHeight; });
    expect(await page.locator('#inspector').evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await pickGate(page, isMobile, 'xor');
    expect(await page.locator('#inspector').evaluate((node) => node.scrollTop)).toBe(0);
    await expect(page.locator('#circuit-heading')).toBeInViewport();
    await expect(page.locator('#formula-list')).toBeInViewport();
  });

  test('(A OR B) AND (A OR C) can be built from the chip menus, measured, saved and reloaded', async ({ page, isMobile }) => {
    test.setTimeout(900_000);
    await pickGate(page, isMobile, 'and');
    expect(await formula(page)).toEqual(['OUT = A AND B']);

    // A becomes a gate of its own: A OR C.
    await openChipMenu(page, '#formula-list [data-chip="input"][data-input="a"]');
    await expect(page.locator('#chip-menu [data-chip-action="use"]')).toHaveText(['Use B', 'Use C (new)']);
    await chooseChipAction(page, 'grow', 'or');
    expect(await spec(page)).toEqual(['OUT = (A OR C) AND B']);
    expect(await inputNames(page)).toEqual(['a', 'b', 'c']);
    await expect(page.locator('#circuit-name')).toHaveText('2 gates. Choose any part of the formula to change it.');

    // Reuse B in place of C, grow the right-hand B into B OR C, then reuse A: (A OR B) AND (A OR C).
    await openChipMenu(page, '#formula-list [data-chip="input"][data-input="c"]');
    await chooseChipAction(page, 'use', 'b');
    expect(await spec(page)).toEqual(['OUT = (A OR B) AND B']);
    expect(await inputNames(page)).toEqual(['a', 'b']);
    await openChipMenu(page, '#formula-list [data-chip="input"][data-path="b"]');
    await chooseChipAction(page, 'grow', 'or');
    expect(await spec(page)).toEqual(['OUT = (A OR B) AND (B OR C)']);
    await openChipMenu(page, '#formula-list [data-chip="input"][data-path="b.a"]');
    await chooseChipAction(page, 'use', 'a');
    expect(await spec(page)).toEqual(['OUT = (A OR B) AND (A OR C)']);
    expect(await formula(page)).toEqual(['OUT = (A OR B) AND (A OR C)']);
    expect(await inputNames(page)).toEqual(['a', 'b', 'c']);
    expect((await snapshot(page)).circuit).toBe('tree:and(or(a,b),or(a,c))');
    // A feeds two gates: two lanes carry it on the board.
    const geometry = await page.evaluate(() => window.__lifeLab.circuitGeometry());
    expect(geometry.ports.filter((port) => port.type === 'input' && port.name === 'a')).toHaveLength(2);
    expect(geometry.tiles).toHaveLength(3);
    await expect(page.locator('#logic-list [aria-pressed="true"]')).toHaveCount(0);

    await runAll(page, { timeout: 840_000 });
    expect(await truthRows(page)).toEqual([
      ['0', '0', '0', '0'], ['0', '0', '1', '0'], ['0', '1', '0', '0'], ['0', '1', '1', '1'],
      ['1', '0', '0', '1'], ['1', '0', '1', '1'], ['1', '1', '0', '1'], ['1', '1', '1', '1'],
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
        tree: { gate: 'and', a: { gate: 'or', a: { input: 'a' }, b: { input: 'b' } }, b: { gate: 'or', a: { input: 'a' }, b: { input: 'c' } } },
      }],
      inputs: { a: true, b: false, c: true },
    });

    await page.goto('/studio');
    await expect(page.locator('#project-title')).toHaveValue('Branching circuit');
    await expect(page.locator('#circuit-section')).toBeVisible();
    await expect.poll(() => spec(page)).toEqual(['OUT = (A OR B) AND (A OR C)']);
    const switches = await page.locator('#inputs-list [data-input]').evaluateAll((nodes) => nodes.map((node) => `${node.dataset.input}=${node.checked ? 1 : 0}`));
    expect(switches).toEqual(['a=1', 'b=0', 'c=1']);
    await expect(page.locator('#zoom-label')).not.toHaveText('100%');
  });

  test('a gate can be removed from its chip, and the engine\'s limits show as notes and disabled menu items', async ({ page, isMobile }) => {
    test.setTimeout(300_000);
    const { maxGates, maxChain } = await limits(page);
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

    // An OR gate may take only one gate as an input: growing C under the OR
    // of (A AND B) OR C is offered but disabled, with the reason as its title.
    await addGate(page, 'or');
    expect(await spec(page)).toEqual(['OUT = (NOT (A AND B)) OR C']);
    await openChipMenu(page, '#formula-list [data-chip="input"][data-input="c"]');
    const growAnd = page.locator('#chip-menu [data-chip-action="grow"][data-value="and"]');
    await expect(growAnd).toBeDisabled();
    expect(await growAnd.getAttribute('title')).toMatch(/OR gate/);
    // The reason is on screen inside the menu, not only in a tooltip.
    await expect(page.locator('#chip-menu .menu-reason')).toHaveText([/OR gate can take only one other gate/]);
    await expect(page.locator('#chip-menu .menu-reason')).toBeVisible();
    await page.keyboard.press('Escape');

    // A plain chain stops at the chain cap.
    await pickGate(page, isMobile, 'and');
    for (const gate of ['or', 'and', 'or', 'and', 'or']) await addGate(page, gate);
    expect((await snapshot(page)).gates).toHaveLength(maxChain);
    await expect(page.locator('#chain-note')).toHaveText(`Up to ${maxChain} gates in one chain.`);
    await openChipMenu(page, '#add-gate-out');
    await expect(page.locator('#chip-menu [data-chip-action="wrap"]')).toHaveText(['Wrap in AND', 'Wrap in OR', 'Wrap in NOT']);
    for (const item of await page.locator('#chip-menu [data-chip-action="wrap"]').all()) await expect(item).toBeDisabled();
    await expect(page.locator('#chip-menu .menu-reason')).toHaveText([`Up to ${maxChain} gates in one chain.`]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#chip-menu')).toBeHidden();

    // Wrapping the XOR tree in more gates stops at the overall gate cap.
    await pickGate(page, isMobile, 'xor');
    for (const gate of ['not', 'and', 'not', 'or', 'not', 'and', 'not', 'or']) {
      if (await page.locator('#chain-note').isVisible()) break;
      await addGate(page, gate);
    }
    await expect(page.locator('#chain-note')).toHaveText(`Circuits here can use up to ${maxGates} gates.`);
    await openChipMenu(page, '#add-gate-out');
    await expect(page.locator('#chip-menu [data-chip-action="wrap"][data-value="not"]')).toBeDisabled();
    await expect(page.locator('#chip-menu .menu-reason')).toHaveText([`Circuits here can use up to ${maxGates} gates.`]);
    await page.keyboard.press('Escape');
    await expect(page.locator('#chip-menu')).toBeHidden();
  });
});

test('phone: the formula editor works in the inspector sheet with 40px targets and no horizontal overflow', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Phone layout only.');
  await pickGate(page, isMobile, 'xor');
  await expect(page.locator('#rail')).toHaveAttribute('data-open', 'false');
  await openInspector(page, isMobile);
  await expect(page.locator('#formula-list')).toBeVisible();
  const chipHeights = await page.locator('#formula-list .chip').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  expect(Math.min(...chipHeights)).toBeGreaterThanOrEqual(40);
  expect(await lampIds(page)).toEqual(['out']);
  // Each input row is a 40px label: tapping the letter toggles the switch.
  const rowHeights = await page.locator('#inputs-list .switch-row').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  expect(Math.min(...rowHeights)).toBeGreaterThanOrEqual(40);
  const wasOn = await page.locator('#inputs-list [data-input="a"]').isChecked();
  await page.locator('#inputs-list .switch-row:has([data-input="a"]) > span').tap();
  await expect(page.locator('#inputs-list [data-input="a"]')).toBeChecked({ checked: !wasOn });

  await openChipMenu(page, '#formula-list [data-chip="input"][data-input="b"]');
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
  // No hover on a phone: the reason for greyed items reads inside the menu.
  await openChipMenu(page, '#formula-list [data-chip="input"][data-path="b"]');
  await expect(page.locator('#chip-menu [data-chip-action="grow"][data-value="and"]')).toBeDisabled();
  const reason = page.locator('#chip-menu .menu-reason');
  await expect(reason).toBeInViewport();
  await expect(reason).toContainText('OR gate');
  await page.keyboard.press('Escape');
  await expect(page.locator('#chip-menu')).toBeHidden();

  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth > window.innerWidth,
    inspector: (() => { const node = document.querySelector('#inspector'); return node.scrollWidth > node.clientWidth + 1; })(),
  }));
  expect(overflow).toEqual({ page: false, inspector: false });
  await page.locator('#inspector-close').click();
  await expect(page.locator('#inspector')).toHaveAttribute('data-open', 'false');
});

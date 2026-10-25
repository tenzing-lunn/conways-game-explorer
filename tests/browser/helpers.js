import { expect } from '@playwright/test';

export const RECOVERY_KEY = 'life-logic-dev-recovery-v1';

// Collect runtime problems so every spec can assert the app booted cleanly.
export function watchErrors(page) {
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') page.errors.push(message.text());
  });
  return page.errors;
}

export const num = async (page, selector) => Number((await page.locator(selector).innerText()).replace(/[^0-9]/g, ''));

export const snapshot = (page) => page.evaluate(() => window.__lifeLab.snapshot());

export const backend = async (page) => JSON.parse(await page.locator('#life-runtime-config').textContent()).backend;

// An unobstructed point on the board canvas, nearest to the given viewport ratios.
export async function boardPoint(page, xRatio = 0.5, yRatio = 0.44) {
  const point = await page.evaluate(({ xRatio, yRatio }) => {
    const candidates = [];
    for (let y = 20; y < innerHeight - 20; y += 12) {
      for (let x = 20; x < innerWidth - 20; x += 12) {
        if (document.elementFromPoint(x, y)?.id === 'world') candidates.push({ x, y });
      }
    }
    return candidates.sort((a, b) => Math.hypot(a.x - innerWidth * xRatio, a.y - innerHeight * yRatio)
      - Math.hypot(b.x - innerWidth * xRatio, b.y - innerHeight * yRatio))[0];
  }, { xRatio, yRatio });
  expect(point, 'an unobstructed part of the board must be reachable').toBeTruthy();
  return point;
}

export async function tap(page, point, isMobile) {
  if (isMobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

export async function clickBoard(page, isMobile, xRatio, yRatio) {
  const point = await boardPoint(page, xRatio, yRatio);
  await tap(page, point, isMobile);
  return point;
}

// The rail is a bottom sheet on phones; on desktop it is always open.
export async function openPatterns(page, isMobile) {
  if (!isMobile) return;
  if ((await page.locator('#rail').getAttribute('data-open')) !== 'true') await page.locator('#patterns-open').click();
  await expect(page.locator('#rail')).toHaveAttribute('data-open', 'true');
}

export async function pickPattern(page, isMobile, id) {
  await openPatterns(page, isMobile);
  await page.locator(`#pattern-list [data-pattern-id="${id}"]`).click();
}

export async function pickGate(page, isMobile, id) {
  await openPatterns(page, isMobile);
  await page.locator('[data-rail-tab="logic"]').click();
  await expect(page.locator('#logic-panel')).toBeVisible();
  await page.locator(`#logic-list [data-gate-id="${id}"]`).click();
  await expect(page.locator('#circuit-section')).toBeVisible();
}

// The inspector is a bottom sheet on phones; on desktop it is always open.
export async function openInspector(page, isMobile) {
  if (!isMobile) return;
  if ((await page.locator('#inspector').getAttribute('data-open')) !== 'true') await page.locator('#inspector-toggle').click();
  await expect(page.locator('#inspector')).toHaveAttribute('data-open', 'true');
}

export async function closeSheets(page, isMobile) {
  if (!isMobile) return;
  if ((await page.locator('#inspector').getAttribute('data-open')) === 'true') await page.locator('#inspector-close').click();
  if ((await page.locator('#rail').getAttribute('data-open')) === 'true') await page.locator('#rail-close').click();
  await expect(page.locator('#sheet-backdrop')).toBeHidden();
}

// Theme and account live in a popup menu on phones.
export async function openTopMenu(page, isMobile) {
  if (!isMobile) return;
  if ((await page.locator('#top-menu').getAttribute('data-open')) !== 'true') await page.locator('#top-menu-toggle').click();
  await expect(page.locator('#top-menu')).toHaveAttribute('data-open', 'true');
}

export async function openMoreMenu(page) {
  await page.locator('#more-menu-toggle').click();
  await expect(page.locator('#more-menu')).toBeVisible();
}

export async function setSwitches(page, values) {
  for (const [name, value] of Object.entries(values)) {
    const input = page.locator(`#inputs-list [data-input="${name}"]`);
    if ((await input.isChecked()) !== value) await input.click();
    await expect(input).toBeChecked({ checked: value });
  }
}

// Run until output: the button is disabled while the worker advances and comes back when the probe is read.
export async function runCircuit(page, { timeout = 90_000 } = {}) {
  await page.locator('#run-circuit').click();
  await expect(page.locator('#run-circuit')).toBeDisabled();
  await expect(page.locator('#run-progress')).toBeVisible();
  await expect(page.locator('#run-circuit')).toBeEnabled({ timeout });
}

// Gate chips in reading order of the formula lines.
export const chips = (page) => page.locator('#formula-list [data-chip="gate"]').evaluateAll((nodes) => nodes.map((node) => node.dataset.gate));
// The formula as plain text, one string per output: "OUT = (A AND B) OR C".
export const formula = (page) => page.locator('#formula-list .formula-row').evaluateAll((rows) => rows.map((row) => [...row.children]
  .filter((node) => !node.classList.contains('chip-add'))
  .map((node) => node.textContent.trim()).join(' ').replace(/\( /g, '(').replace(/ \)/g, ')')));
export const spec = async (page) => (await snapshot(page)).spec;
export const inputNames = (page) => page.locator('#inputs-list [data-input]').evaluateAll((nodes) => nodes.map((node) => node.dataset.input));
export const lampState = (page, id = 'out') => page.locator(`#outputs-list [data-output="${id}"]`).getAttribute('data-state');
export const truthRows = (page) => page.locator('#truth-table tbody tr').evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent.trim())));

// Every chip (input, gate, Add gate) opens the one floating #chip-menu.
export async function openChipMenu(page, selector) {
  await page.locator(selector).first().click();
  await expect(page.locator('#chip-menu')).toBeVisible();
}

export async function chooseChipAction(page, action, value = '') {
  const item = page.locator(`#chip-menu [data-chip-action="${action}"]${value ? `[data-value="${value}"]` : ''}`);
  await expect(item).toBeEnabled();
  await item.click();
  await expect(page.locator('#chip-menu')).toBeHidden();
}

// Wrap the whole expression of an output in a gate: "Add gate" → AND/OR/NOT.
export async function addGate(page, gate, outputId = 'out') {
  await openChipMenu(page, `#add-gate-${outputId}`);
  await chooseChipAction(page, 'wrap', gate);
}

// Fill the truth table and wait for every row to be measured (a short run can
// finish before a "disabled" check would see it, so wait for the outcome).
export async function runAll(page, { timeout = 240_000 } = {}) {
  await page.locator('#fill-truth-table').click();
  await expect(page.locator('#truth-table caption')).toHaveText('Measured from real probe cells.', { timeout });
  await expect(page.locator('#fill-truth-table')).toBeEnabled();
}

// Run until output and wait for every lamp to read HIGH or LOW.
export async function runUntilSettled(page, { timeout = 240_000 } = {}) {
  await page.locator('#run-circuit').click();
  for (const lamp of await page.locator('#outputs-list .lamp').all()) {
    await expect(lamp).toHaveAttribute('data-state', /^(high|low)$/, { timeout });
  }
  await expect(page.locator('#run-circuit')).toBeEnabled();
}

export async function loadLocalState(page) {
  return page.evaluate(async () => {
    const { createLocalCommunityRepository } = await import('/src/community-repository.js');
    return createLocalCommunityRepository().loadCommunityState();
  });
}

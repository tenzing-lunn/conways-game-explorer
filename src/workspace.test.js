import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatStatus,
  getCircuitMarkers,
  getFitZoom,
  getInputCombinations,
  getLampLabel,
  getLampState,
  getModeForPath,
  getPathForMode,
  getPublishLabel,
  getSaveStateText,
} from './workspace.js';

test('routes map to the three sections', () => {
  assert.equal(getModeForPath('/'), 'playground');
  assert.equal(getModeForPath('/studio'), 'studio');
  assert.equal(getModeForPath('/community'), 'community');
  assert.equal(getModeForPath('/community/favorites'), 'community');
  assert.equal(getModeForPath('/c/famous-glider'), 'community');
  assert.equal(getModeForPath('/u/ada'), 'community');
  assert.equal(getModeForPath('/unknown'), 'playground');
  assert.equal(getPathForMode('studio'), '/studio');
  assert.equal(getPathForMode('community'), '/community');
  assert.equal(getPathForMode('playground'), '/');
});

test('save state copy is plain and device-aware', () => {
  assert.equal(getSaveStateText('saved'), 'Saved on this device');
  assert.equal(getSaveStateText('saved', { cloud: true }), 'Saved to your account');
  assert.equal(getSaveStateText('dirty'), 'Unsaved');
  assert.equal(getSaveStateText('saving'), 'Saving…');
  assert.equal(getSaveStateText('failed'), 'Save failed');
});

test('publish label follows the publish lifecycle', () => {
  assert.equal(getPublishLabel('draft'), 'Publish');
  assert.equal(getPublishLabel('publishing'), 'Publishing…');
  assert.equal(getPublishLabel('published'), 'Published');
  assert.equal(getPublishLabel('published', { dirty: true }), 'Publish');
  assert.equal(getPublishLabel('failed'), 'Retry publish');
});

test('lamp state reads circuit outputs', () => {
  assert.equal(getLampState(null), 'unset');
  assert.equal(getLampState({ settled: false, high: null }), 'settling');
  assert.equal(getLampState({ settled: true, high: true }), 'high');
  assert.equal(getLampState({ settled: true, high: false }), 'low');
  assert.equal(getLampLabel('high'), 'HIGH');
  assert.equal(getLampLabel('low'), 'LOW');
});

test('status line uses a compact form on phones', () => {
  assert.equal(formatStatus(24, 5), 'Generation 24 · 5 cells');
  assert.equal(formatStatus(1200, 5000, { compact: true }), 'Gen 1,200 · 5,000 cells');
});

test('fit zoom fits a region inside the viewport with padding and clamps', () => {
  const zoom = getFitZoom({ viewportWidth: 1000, viewportHeight: 700, regionWidth: 300, regionHeight: 200, padding: 0 });
  assert.equal(zoom, 1000 / 300 / 10);
  assert.equal(getFitZoom({ viewportWidth: 100, viewportHeight: 100, regionWidth: 2000, regionHeight: 2000 }), 0.18);
  assert.equal(getFitZoom({ viewportWidth: 5000, viewportHeight: 5000, regionWidth: 2, regionHeight: 2 }), 3.6);
});

test('circuit markers describe gate tile, lanes, and a fit region', () => {
  const and = getCircuitMarkers('and');
  assert.deepEqual(and.origin, { x: 480, y: 20 });
  assert.equal(and.tile, 150);
  assert.deepEqual(and.lanes.map((lane) => `${lane.id}:${lane.direction}`), ['a:east', 'b:north']);
  assert.equal(and.fitRegion.x < 480, true);
  assert.equal(and.fitRegion.x + and.fitRegion.width > 630, true);

  assert.deepEqual(getCircuitMarkers('not').lanes.map((lane) => lane.id), ['a']);
  const half = getCircuitMarkers('half-adder');
  assert.equal(half.tile, 300);
  assert.deepEqual(half.lanes.map((lane) => lane.direction), ['east', 'east']);
});

test('input combinations enumerate every truth table row in order', () => {
  assert.deepEqual(getInputCombinations(['a', 'b']), [
    { a: false, b: false },
    { a: false, b: true },
    { a: true, b: false },
    { a: true, b: true },
  ]);
  assert.deepEqual(getInputCombinations(['a']), [{ a: false }, { a: true }]);
});

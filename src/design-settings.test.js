import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDesignSettings,
  getDesignSettingSummary,
  getGridDimensions,
  mergeDesignSettings,
  serializeDesignSettings,
} from './design-settings.js';

test('normalizes custom grid settings for saved Dev Studio designs', () => {
  const settings = createDesignSettings({
    gridPreset: 'custom',
    width: 480,
    height: 320,
    liveCellColor: '#ff00aa',
    renderStyle: 'glow',
    wrapping: false,
  });

  assert.equal(settings.gridPreset, 'custom');
  assert.equal(settings.width, 480);
  assert.equal(settings.height, 320);
  assert.equal(settings.liveCellColor, '#ff00aa');
  assert.equal(settings.renderStyle, 'glow');
  assert.equal(settings.wrapping, false);
});

test('clamps invalid custom dimensions and color values', () => {
  const settings = createDesignSettings({
    gridPreset: 'custom',
    width: 20,
    height: 2000,
    backgroundColor: 'not-a-color',
    liveCellColor: '#123456',
  });

  assert.equal(settings.width, 40);
  assert.equal(settings.height, 2000);
  assert.equal(settings.backgroundColor, '#07090f');
  assert.equal(settings.liveCellColor, '#123456');
});

test('accepts custom dimensions up to the 3000-cell edge', () => {
  const settings = createDesignSettings({
    gridPreset: 'custom',
    width: 2049,
    height: 3000,
  });

  assert.equal(settings.width, 2049);
  assert.equal(settings.height, 3000);
});

test('clamps custom dimensions above the supported 3000-cell edge', () => {
  const settings = createDesignSettings({
    gridPreset: 'custom',
    width: 3001,
    height: 9000,
  });

  assert.equal(settings.width, 3000);
  assert.equal(settings.height, 3000);
});

test('preset grid dimensions use named Dev Studio sizes', () => {
  assert.deepEqual(getGridDimensions(createDesignSettings({ gridPreset: 'small' })), {
    width: 120,
    height: 80,
  });
  assert.deepEqual(getGridDimensions(createDesignSettings({ gridPreset: 'large' })), {
    width: 420,
    height: 280,
  });
});

test('merges settings patches without dropping existing theme choices', () => {
  const base = createDesignSettings({
    liveCellColor: '#ff00aa',
    accentColor: '#22c55e',
    trailIntensity: 'high',
  });
  const merged = mergeDesignSettings(base, { renderStyle: 'dot', wrapping: false });

  assert.equal(merged.liveCellColor, '#ff00aa');
  assert.equal(merged.accentColor, '#22c55e');
  assert.equal(merged.trailIntensity, 'high');
  assert.equal(merged.renderStyle, 'dot');
  assert.equal(merged.wrapping, false);
});

test('serializes settings with stable replay metadata', () => {
  const serialized = serializeDesignSettings(createDesignSettings({
    gridPreset: 'medium',
    renderStyle: 'rounded',
    speed: 18,
    zoom: 1.35,
  }));

  assert.equal(serialized.width, 300);
  assert.equal(serialized.height, 200);
  assert.equal(serialized.renderStyle, 'rounded');
  assert.equal(serialized.speed, 18);
  assert.equal(serialized.zoom, 1.35);
});

test('summarizes settings for compact project cards', () => {
  const summary = getDesignSettingSummary(createDesignSettings({
    gridPreset: 'custom',
    width: 360,
    height: 240,
    renderStyle: 'glow',
    wrapping: false,
  }));

  assert.equal(summary, '360 x 240, bounded, glow cells');
});

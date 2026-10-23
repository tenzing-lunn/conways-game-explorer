import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getContextualGroup,
  getLiveToolAction,
  getPinchZoom,
  getToolAfterWorkspaceChange,
  getToolForKey,
  getWheelAction,
  getWheelZoomDelta,
} from './interaction.js';

test('live tool erases an already-live cell when paused', () => {
  assert.equal(getLiveToolAction({ playing: false, alive: true }), 'erase');
});

test('live tool draws on empty cells when paused or playing', () => {
  assert.equal(getLiveToolAction({ playing: false, alive: false }), 'draw');
  assert.equal(getLiveToolAction({ playing: true, alive: false }), 'draw');
});

test('live tool does not erase live cells while the simulation is playing', () => {
  assert.equal(getLiveToolAction({ playing: true, alive: true }), 'draw');
});

test('number keys map to the four tools', () => {
  assert.equal(getToolForKey('1'), 'draw');
  assert.equal(getToolForKey('2'), 'select');
  assert.equal(getToolForKey('3'), 'stamp');
  assert.equal(getToolForKey('4'), 'pan');
  assert.equal(getToolForKey('5'), null);
});

test('contextual tool group appears only when it can act', () => {
  assert.equal(getContextualGroup({ tool: 'stamp', hasSelection: false }), 'stamp');
  assert.equal(getContextualGroup({ tool: 'select', hasSelection: true }), 'selection');
  assert.equal(getContextualGroup({ tool: 'draw', hasSelection: true }), 'selection');
  assert.equal(getContextualGroup({ tool: 'draw', hasSelection: false }), null);
});

test('wheel navigation always returns a zoom delta', () => {
  assert.equal(getWheelZoomDelta({ deltaY: -100 }) > 1, true);
  assert.equal(getWheelZoomDelta({ deltaY: 100 }) < 1, true);
});

test('two-finger wheel movement pans the board by default', () => {
  assert.deepEqual(getWheelAction({ deltaX: 42, deltaY: -16, ctrlKey: false, metaKey: false }), {
    type: 'pan',
    panX: -42,
    panY: 16,
  });
});

test('pinch-style wheel movement still zooms around the pointer', () => {
  const action = getWheelAction({ deltaX: 0, deltaY: -80, ctrlKey: true, metaKey: false });

  assert.equal(action.type, 'zoom');
  assert.equal(action.zoomDelta > 1, true);
});

test('pinch zoom scales from the starting zoom and clamps', () => {
  assert.equal(getPinchZoom({ startDistance: 100, distance: 200, startZoom: 1 }), 2);
  assert.equal(getPinchZoom({ startDistance: 100, distance: 1, startZoom: 1 }), 0.18);
  assert.equal(getPinchZoom({ startDistance: 0, distance: 50, startZoom: 0.5 }), 0.5);
});

test('switching sections clears transient canvas tool state', () => {
  assert.equal(getToolAfterWorkspaceChange({ currentTool: 'stamp' }), 'draw');
  assert.equal(getToolAfterWorkspaceChange({ currentTool: 'pan' }), 'draw');
  assert.equal(getToolAfterWorkspaceChange({ currentTool: 'select' }), 'select');
});

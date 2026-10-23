// Pure pointer, keyboard, and tool-state helpers for the board.

export function getLiveToolAction({ playing, alive }) {
  if (!playing && alive) return 'erase';
  return 'draw';
}

export function getToolForKey(key) {
  return { 1: 'draw', 2: 'select', 3: 'stamp', 4: 'pan' }[key] || null;
}

export function getContextualGroup({ tool, hasSelection }) {
  if (tool === 'stamp') return 'stamp';
  if (hasSelection) return 'selection';
  return null;
}

export function getToolAfterWorkspaceChange({ currentTool }) {
  return currentTool === 'stamp' || currentTool === 'pan' ? 'draw' : currentTool;
}

export function getHapticPattern(action) {
  const patterns = {
    stampToggle: [12],
    stampPlace: [8],
    copy: [6, 24, 6],
    save: [10],
  };

  return patterns[action] || [];
}

export function getWheelZoomDelta({ deltaY }) {
  const sensitivity = deltaY > 0 ? 0.0032 : 0.0024;
  return Math.exp(-deltaY * sensitivity);
}

export function getWheelAction({ deltaX = 0, deltaY = 0, ctrlKey = false, metaKey = false }) {
  if (ctrlKey || metaKey) {
    return {
      type: 'zoom',
      zoomDelta: getWheelZoomDelta({ deltaY }),
    };
  }

  return {
    type: 'pan',
    panX: -deltaX,
    panY: -deltaY,
  };
}

export function getPinchZoom({ startDistance, distance, startZoom, minZoom = 0.18, maxZoom = 3.6 }) {
  if (!startDistance || !distance) return startZoom;
  return Math.min(maxZoom, Math.max(minZoom, startZoom * (distance / startDistance)));
}

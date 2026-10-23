// Pure presentation helpers for the Life Lab shell. No DOM access here so the
// routing, status copy, lamp states, and fit maths stay unit-testable.

export function getModeForPath(pathname) {
  const path = String(pathname || '/');
  if (path === '/studio') return 'studio';
  if (path === '/community' || path.startsWith('/community/')) return 'community';
  if (/^\/c\/[^/]+$/.test(path) || /^\/u\/[^/]+$/.test(path)) return 'community';
  return 'playground';
}

export function getPathForMode(mode) {
  if (mode === 'studio') return '/studio';
  if (mode === 'community') return '/community';
  return '/';
}

export function getSaveStateText(status, { cloud = false } = {}) {
  const savedLabel = cloud ? 'Saved to your account' : 'Saved on this device';
  const labels = {
    saved: savedLabel,
    new: 'Not saved yet',
    dirty: 'Unsaved',
    saving: 'Saving…',
    failed: 'Save failed',
    offline: 'Offline · kept on this device',
  };
  return labels[status] || savedLabel;
}

export function getPublishLabel(status, { dirty = false } = {}) {
  if (status === 'validating') return 'Validating…';
  if (status === 'publishing') return 'Publishing…';
  if (status === 'failed') return 'Retry publish';
  if (status === 'published' && !dirty) return 'Published';
  if (status === 'unpublished') return 'Republish';
  return 'Publish';
}

export function getLampState(output) {
  if (!output) return 'unset';
  if (output.settled === false || output.high === null || output.high === undefined) return 'settling';
  return output.high ? 'high' : 'low';
}

export function getLampLabel(state) {
  return { unset: '—', settling: 'settling', low: 'LOW', high: 'HIGH' }[state] || '—';
}

export function formatCellCount(population) {
  const count = Number(population || 0);
  return `${count.toLocaleString()} ${count === 1 ? 'cell' : 'cells'}`;
}

export function formatStatus(generation, population, { compact = false } = {}) {
  const gen = Number(generation || 0).toLocaleString();
  return `${compact ? 'Gen' : 'Generation'} ${gen} · ${formatCellCount(population)}`;
}

export function getFitZoom({
  viewportWidth,
  viewportHeight,
  regionWidth,
  regionHeight,
  baseCellSize = 10,
  padding = 24,
  minZoom = 0.18,
  maxZoom = 3.6,
}) {
  const availableWidth = Math.max(1, viewportWidth - padding * 2);
  const availableHeight = Math.max(1, viewportHeight - padding * 2);
  const cell = Math.min(availableWidth / Math.max(1, regionWidth), availableHeight / Math.max(1, regionHeight));
  return Math.min(maxZoom, Math.max(minZoom, cell / baseCellSize));
}

// UI-side geometry for the curated circuit experiments: where the gate tile
// sits, where the input lanes run, and how far to fit the camera. The numbers
// mirror the authored experiments in circuits.js.
const GATE_ORIGIN = { x: 480, y: 20 };

export function getCircuitMarkers(experimentId) {
  const halfAdder = experimentId === 'half-adder';
  const tile = halfAdder ? 300 : 150;
  const lanes = [{ id: 'a', label: 'A', direction: 'east', y: GATE_ORIGIN.y + 72.5 }];
  if (halfAdder) lanes.push({ id: 'b', label: 'B', direction: 'east', y: GATE_ORIGIN.y + 222.5 });
  else if (experimentId !== 'not') lanes.push({ id: 'b', label: 'B', direction: 'north', x: GATE_ORIGIN.x + 72.5 });
  return {
    origin: { ...GATE_ORIGIN },
    tile,
    lanes,
    fitRegion: {
      x: GATE_ORIGIN.x - 44,
      y: GATE_ORIGIN.y - 16,
      width: tile + 44 + 56,
      height: tile + 16 + (halfAdder ? 16 : 56),
    },
  };
}

export function getInputCombinations(inputNames) {
  const names = [...(inputNames || [])];
  const total = 2 ** names.length;
  const rows = [];
  for (let index = 0; index < total; index += 1) {
    const values = {};
    names.forEach((name, position) => {
      values[name] = Boolean((index >> (names.length - 1 - position)) & 1);
    });
    rows.push(values);
  }
  return rows;
}

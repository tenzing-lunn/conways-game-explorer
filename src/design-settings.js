const GRID_PRESETS = {
  small: { width: 120, height: 80 },
  medium: { width: 300, height: 200 },
  large: { width: 420, height: 280 },
};

const DEFAULT_SETTINGS = {
  gridPreset: 'medium',
  width: GRID_PRESETS.medium.width,
  height: GRID_PRESETS.medium.height,
  wrapping: true,
  speed: 10,
  zoom: 1,
  backgroundColor: '#07090f',
  gridColor: '#334155',
  liveCellColor: '#5eead4',
  trailCellColor: '#38bdf8',
  accentColor: '#2dd4bf',
  selectionColor: '#fbbf24',
  renderStyle: 'square',
  trailIntensity: 'medium',
  rule: 'B3/S23',
  camera: { x: 0, y: 0 },
};

const RENDER_STYLES = new Set(['square', 'rounded', 'glow', 'dot']);
const TRAIL_INTENSITIES = new Set(['off', 'low', 'medium', 'high']);

export function createDesignSettings(input = {}) {
  const gridPreset = normalizeGridPreset(input.gridPreset);
  const presetDimensions = getPresetDimensions(gridPreset);
  const width = gridPreset === 'custom'
    ? clampInteger(input.width, 40, 3000, DEFAULT_SETTINGS.width)
    : presetDimensions.width;
  const height = gridPreset === 'custom'
    ? clampInteger(input.height, 40, 3000, DEFAULT_SETTINGS.height)
    : presetDimensions.height;

  return {
    ...DEFAULT_SETTINGS,
    gridPreset,
    width,
    height,
    wrapping: input.wrapping === undefined ? DEFAULT_SETTINGS.wrapping : Boolean(input.wrapping),
    speed: clampInteger(input.speed, 1, 40, DEFAULT_SETTINGS.speed),
    zoom: clampNumber(input.zoom, 0.18, 3.6, DEFAULT_SETTINGS.zoom),
    backgroundColor: normalizeHexColor(input.backgroundColor, DEFAULT_SETTINGS.backgroundColor),
    gridColor: normalizeHexColor(input.gridColor, DEFAULT_SETTINGS.gridColor),
    liveCellColor: normalizeHexColor(input.liveCellColor, DEFAULT_SETTINGS.liveCellColor),
    trailCellColor: normalizeHexColor(input.trailCellColor, DEFAULT_SETTINGS.trailCellColor),
    accentColor: normalizeHexColor(input.accentColor, DEFAULT_SETTINGS.accentColor),
    selectionColor: normalizeHexColor(input.selectionColor, DEFAULT_SETTINGS.selectionColor),
    renderStyle: RENDER_STYLES.has(input.renderStyle) ? input.renderStyle : DEFAULT_SETTINGS.renderStyle,
    trailIntensity: TRAIL_INTENSITIES.has(input.trailIntensity) ? input.trailIntensity : DEFAULT_SETTINGS.trailIntensity,
    rule: typeof input.rule === 'string' && input.rule.trim() ? input.rule.trim() : DEFAULT_SETTINGS.rule,
    camera: normalizeCamera(input.camera),
  };
}

export function mergeDesignSettings(base, patch = {}) {
  return createDesignSettings({
    ...base,
    ...patch,
    camera: {
      ...(base?.camera || DEFAULT_SETTINGS.camera),
      ...(patch.camera || {}),
    },
  });
}

export function getGridDimensions(settings) {
  const normalized = createDesignSettings(settings);
  return {
    width: normalized.width,
    height: normalized.height,
  };
}

export function serializeDesignSettings(settings) {
  const normalized = createDesignSettings(settings);
  return {
    gridPreset: normalized.gridPreset,
    width: normalized.width,
    height: normalized.height,
    wrapping: normalized.wrapping,
    speed: normalized.speed,
    zoom: normalized.zoom,
    backgroundColor: normalized.backgroundColor,
    gridColor: normalized.gridColor,
    liveCellColor: normalized.liveCellColor,
    trailCellColor: normalized.trailCellColor,
    accentColor: normalized.accentColor,
    selectionColor: normalized.selectionColor,
    renderStyle: normalized.renderStyle,
    trailIntensity: normalized.trailIntensity,
    rule: normalized.rule,
    camera: normalized.camera,
  };
}

export function getDesignSettingSummary(settings) {
  const normalized = createDesignSettings(settings);
  const edgeLabel = normalized.wrapping ? 'wrapped' : 'bounded';
  return `${normalized.width} x ${normalized.height}, ${edgeLabel}, ${normalized.renderStyle} cells`;
}

export function getGridPresetOptions() {
  return [
    { id: 'small', label: 'Small', ...GRID_PRESETS.small },
    { id: 'medium', label: 'Medium', ...GRID_PRESETS.medium },
    { id: 'large', label: 'Large', ...GRID_PRESETS.large },
    { id: 'custom', label: 'Custom', width: DEFAULT_SETTINGS.width, height: DEFAULT_SETTINGS.height },
  ];
}

function normalizeGridPreset(value) {
  if (value === 'small' || value === 'medium' || value === 'large' || value === 'custom') {
    return value;
  }

  return DEFAULT_SETTINGS.gridPreset;
}

function getPresetDimensions(gridPreset) {
  return GRID_PRESETS[gridPreset] || GRID_PRESETS.medium;
}

function normalizeHexColor(value, fallback) {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : fallback;
}

function normalizeCamera(value) {
  return {
    x: Number.isFinite(value?.x) ? Number(value.x) : DEFAULT_SETTINGS.camera.x,
    y: Number.isFinite(value?.y) ? Number(value.y) : DEFAULT_SETTINGS.camera.y,
  };
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function getPatternBounds(coordinates) {
  if (coordinates.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [x, y] of coordinates) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function normalizeCoordinates(coordinates) {
  const bounds = getPatternBounds(coordinates);

  return coordinates
    .map(([x, y]) => [x - bounds.minX, y - bounds.minY])
    .sort(([ax, ay], [bx, by]) => ay - by || ax - bx);
}

export function transformCoordinates(coordinates, { rotation = 0, flipX = false } = {}) {
  const normalized = normalizeCoordinates(coordinates);
  const bounds = getPatternBounds(normalized);
  const quarterTurns = (((Math.round(rotation / 90) % 4) + 4) % 4);
  let transformed = normalized.map(([x, y]) => {
    if (quarterTurns === 1) return [bounds.height - 1 - y, x];
    if (quarterTurns === 2) return [bounds.width - 1 - x, bounds.height - 1 - y];
    if (quarterTurns === 3) return [y, bounds.width - 1 - x];
    return [x, y];
  });

  if (flipX) {
    const transformedBounds = getPatternBounds(transformed);
    transformed = transformed.map(([x, y]) => [transformedBounds.maxX - x + transformedBounds.minX, y]);
  }

  return normalizeCoordinates(transformed);
}

export function getPresetGroup(groups, groupId) {
  return groups.find((group) => group.id === groupId) ?? null;
}

export const RLE_LIMITS = Object.freeze({
  dimensionMax: 3000,
  textBytesMax: 5_000_000,
  coordinateCollectionMax: 200_000,
});

export function parseRle(input, {
  preserveOrigin = false,
  maxCoordinates = RLE_LIMITS.coordinateCollectionMax,
} = {}) {
  const coordinates = [];
  const parsed = scanRle(input, {
    maxCoordinates,
    onLiveCell(x, y) { coordinates.push([x, y]); },
  });
  return {
    ...parsed,
    coordinates: preserveOrigin ? coordinates : normalizeCoordinates(coordinates),
  };
}

// Direct board decoders use this scanner instead of parseRle(), so a valid
// dense 3000×3000 import never first becomes millions of [x, y] arrays.
export function forEachRleCell(input, onLiveCell, options = {}) {
  if (typeof onLiveCell !== 'function') throw new Error('RLE cell callback is required.');
  return scanRle(input, { ...options, maxCoordinates: null, onLiveCell });
}

function scanRle(input, {
  onLiveCell = null,
  maxCoordinates = RLE_LIMITS.coordinateCollectionMax,
} = {}) {
  if (typeof input !== 'string') throw new Error('RLE must be text.');
  if (new TextEncoder().encode(input).byteLength > RLE_LIMITS.textBytesMax) {
    throw new Error('RLE must be text under 5 MB.');
  }
  const lines = input.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  if (!lines.length) throw new Error('RLE is missing a header like "x = 3, y = 3".');

  const { width, height, rule } = readHeader(lines[0]);
  if (rule && rule.toUpperCase() !== 'B3/S23') throw new Error('This lab runs Conway’s B3/S23 rule.');
  const body = lines.slice(1).join('').replace(/\s/g, '');
  let x = 0;
  let y = 0;
  let run = '';
  let liveCount = 0;
  let terminated = false;

  for (const token of body) {
    if (terminated) throw new Error('RLE contains data after its terminator.');
    if (/\d/.test(token)) {
      run += token;
      continue;
    }
    if (token === '!') {
      if (run) throw new Error('RLE run length must be followed by a cell token.');
      terminated = true;
      continue;
    }
    const count = run ? Number(run) : 1;
    run = '';
    if (!Number.isSafeInteger(count) || count < 1 || count > width * height + height + width + 1) {
      throw new Error('Invalid RLE run length.');
    }
    if (token === 'b') {
      if (y >= height || x + count > width) throw new Error('RLE cells exceed the declared board.');
      x += count;
    } else if (token === 'o') {
      if (y >= height || x + count > width || liveCount + count > width * height) {
        throw new Error('RLE cells exceed the declared board.');
      }
      if (Number.isFinite(maxCoordinates) && liveCount + count > maxCoordinates) {
        throw new Error(`RLE has more than ${maxCoordinates.toLocaleString()} cells for a coordinate pattern.`);
      }
      for (let i = 0; i < count; i += 1) onLiveCell?.(x + i, y);
      liveCount += count;
      x += count;
    } else if (token === '$') {
      if (y + count > height) throw new Error('RLE rows exceed the declared board.');
      y += count;
      x = 0;
    } else {
      throw new Error(`Unsupported RLE token: ${token}`);
    }
  }
  if (!terminated) throw new Error('RLE is missing its ! terminator.');
  return { width, height, rule: 'B3/S23', population: liveCount };
}

export function encodeRle(coordinates) {
  const normalized = normalizeCoordinates(coordinates);
  const bounds = getPatternBounds(normalized);
  const alive = new Set(normalized.map(([x, y]) => `${x},${y}`));
  const rows = [];

  if (normalized.length === 0) {
    return 'x = 0, y = 0, rule = B3/S23\n!';
  }

  for (let y = 0; y < bounds.height; y += 1) {
    let row = '';
    let current = null;
    let run = 0;

    for (let x = 0; x < bounds.width; x += 1) {
      const token = alive.has(`${x},${y}`) ? 'o' : 'b';

      if (token === current) {
        run += 1;
      } else {
        row += encodeRun(run, current);
        current = token;
        run = 1;
      }
    }

    row += encodeRun(run, current);
    // `encodeRun` emits a numeric prefix (for example `298b`), so trimming
    // only the trailing letter leaves a bare run length before `$`/`!`.
    rows.push(row.replace(/(?:\d+)?b$/, ''));
  }

  return `x = ${bounds.width}, y = ${bounds.height}, rule = B3/S23\n${rows.join('$')}!`;
}

function readHeader(header) {
  const match = header.match(/^x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)(?:\s*,\s*rule\s*=\s*([^,\s]+))?$/i);
  if (!match) throw new Error('RLE is missing a valid x/y header.');
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 0 || height < 0 || width > RLE_LIMITS.dimensionMax || height > RLE_LIMITS.dimensionMax) {
    throw new Error(`RLE dimensions must be between 0 and ${RLE_LIMITS.dimensionMax}.`);
  }
  return { width, height, rule: match[3] || 'B3/S23' };
}

function encodeRun(run, token) {
  if (!token || run === 0) return '';
  return `${run === 1 ? '' : run}${token}`;
}

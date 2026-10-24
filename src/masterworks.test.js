import test from 'node:test';
import assert from 'node:assert/strict';
import { masterworks, getMasterwork, decodeMasterwork } from './masterworks.js';
import { parseRle, getPatternBounds, RLE_LIMITS } from './patterns.js';
import { createBoard, placePattern, createLifeStepper } from './life.js';

const BOARD_CEILING = 3000;
const MARGIN = 40;
const loadable = masterworks.filter((entry) => entry.loadable);
const referenceOnly = masterworks.filter((entry) => !entry.loadable);

function run(entry, generations, { wrapping = false } = {}) {
  const { coordinates } = decodeMasterwork(entry.id);
  const board = entry.board;
  const originX = Math.floor((board.width - entry.size.width) / 2);
  const originY = Math.floor((board.height - entry.size.height) / 2);
  const stepper = createLifeStepper(placePattern(createBoard(board.width, board.height), coordinates, originX, originY), { wrapping });
  let snapshot;
  for (let i = 0; i < generations; i += 1) snapshot = stepper.step();
  const live = [];
  for (let y = 0; y < board.height; y += 1) {
    for (let x = 0; x < board.width; x += 1) {
      if (snapshot.cells[y * board.width + x]) live.push([x - originX, y - originY]);
    }
  }
  return { population: snapshot.population, live, initial: coordinates };
}

function translation(initial, live) {
  const a = getPatternBounds(initial);
  const b = getPatternBounds(live);
  const dx = b.minX - a.minX;
  const dy = b.minY - a.minY;
  const moved = new Set(initial.map(([x, y]) => `${x + dx},${y + dy}`));
  const same = live.length === initial.length && live.every(([x, y]) => moved.has(`${x},${y}`));
  return { dx, dy, same };
}

test('ships at least six loadable and three reference-only masterworks with unique ids', () => {
  assert.ok(loadable.length >= 6, `loadable: ${loadable.length}`);
  assert.ok(referenceOnly.length >= 3, `reference-only: ${referenceOnly.length}`);
  assert.equal(new Set(masterworks.map((entry) => entry.id)).size, masterworks.length);
});

test('every entry carries attribution, a source page, a licence and a plain note', () => {
  for (const entry of masterworks) {
    assert.match(entry.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, entry.id);
    for (const field of ['name', 'note', 'discoverer', 'year', 'license']) {
      assert.equal(typeof entry[field], 'string', `${entry.id}.${field}`);
      assert.ok(entry[field].trim(), `${entry.id}.${field} is empty`);
    }
    assert.equal(typeof entry.source?.title, 'string', `${entry.id}.source.title`);
    assert.match(entry.source.url, /^https:\/\//, `${entry.id}.source.url`);
    assert.equal(typeof entry.loadable, 'boolean', `${entry.id}.loadable`);
    assert.ok(entry.note.endsWith('.'), `${entry.id}.note should be a sentence`);
  }
});

test('loadable entries parse within RLE limits and match their declared size', () => {
  for (const entry of loadable) {
    assert.notEqual(entry.license, 'reference-only', entry.id);
    assert.equal(typeof entry.rle, 'string', `${entry.id}.rle`);
    assert.ok(entry.size.width <= RLE_LIMITS.dimensionMax && entry.size.height <= RLE_LIMITS.dimensionMax, `${entry.id} size`);
    const text = `x = ${entry.size.width}, y = ${entry.size.height}, rule = B3/S23\n${entry.rle}`;
    assert.ok(new TextEncoder().encode(text).byteLength <= RLE_LIMITS.textBytesMax, `${entry.id} bytes`);
    const parsed = parseRle(text);
    assert.ok(parsed.coordinates.length <= RLE_LIMITS.coordinateCollectionMax, `${entry.id} cells`);
    assert.equal(parsed.population, entry.population, `${entry.id} population`);
    const bounds = getPatternBounds(parsed.coordinates);
    assert.deepEqual({ width: bounds.width, height: bounds.height }, entry.size, `${entry.id} bounds`);
  }
});

test('loadable entries recommend a board that fits the pattern with margin under the ceiling', () => {
  for (const entry of loadable) {
    assert.ok(entry.board.width >= entry.size.width + MARGIN, `${entry.id} board width`);
    assert.ok(entry.board.height >= entry.size.height + MARGIN, `${entry.id} board height`);
    assert.ok(entry.board.width <= BOARD_CEILING && entry.board.height <= BOARD_CEILING, `${entry.id} board ceiling`);
  }
});

test('reference-only entries explain why and carry no cell data', () => {
  for (const entry of referenceOnly) {
    assert.equal(entry.license, 'reference-only', entry.id);
    assert.equal(typeof entry.reason, 'string', `${entry.id}.reason`);
    assert.ok(entry.reason.trim(), `${entry.id}.reason is empty`);
    assert.equal(entry.rle, undefined, `${entry.id}.rle`);
    assert.equal(entry.board, null, `${entry.id}.board`);
  }
  assert.ok(referenceOnly.some((entry) => entry.id === 'gemini'));
  assert.ok(referenceOnly.some((entry) => entry.id === '0e0p-metacell'));
  assert.ok(referenceOnly.some((entry) => entry.id === 'pattern-of-the-year'));
});

test('getMasterwork and decodeMasterwork look entries up by id', () => {
  assert.equal(getMasterwork('loafer').name, 'Loafer');
  assert.equal(getMasterwork('nope'), null);
  const decoded = decodeMasterwork('loafer');
  assert.equal(decoded.coordinates.length, 20);
  assert.deepEqual(decoded.size, { width: 9, height: 9 });
  assert.throws(() => decodeMasterwork('nope'), /Unknown masterwork/);
  assert.throws(() => decodeMasterwork('gemini'), /reference-only/);
});

test('spaceships reappear translated after one period', () => {
  const expectations = [
    ['sir-robin', 6, 3],
    ['copperhead', 10, 1],
    ['loafer', 7, 1],
    ['two-engine-cordership', 96, 16],
  ];
  for (const [id, period, distance] of expectations) {
    const entry = getMasterwork(id);
    const { live, initial } = run(entry, period);
    const { dx, dy, same } = translation(initial, live);
    assert.ok(same, `${id} should be its own translate after ${period} generations`);
    assert.equal(Math.abs(dx) + Math.abs(dy), distance, `${id} moved (${dx}, ${dy})`);
  }
});

test('the Snark reflects the stamped glider and survives intact', () => {
  const entry = getMasterwork('snark');
  // The glider reaches the Snark after ~140 generations and the bounce is
  // complete by ~190; at 300 the outgoing glider is still on the 160x120 board.
  const { population, live, initial } = run(entry, 300);
  assert.equal(population, 57);
  const liveSet = new Set(live.map(([x, y]) => `${x},${y}`));
  const survivors = initial.filter(([x, y]) => liveSet.has(`${x},${y}`)).length;
  assert.equal(survivors, 52, 'the 52-cell reflector should be unchanged');
  const glider = live.filter(([x, y]) => !initial.some(([ix, iy]) => ix === x && iy === y));
  assert.equal(glider.length, 5);
  const bounds = getPatternBounds(glider);
  // The reflector occupies rows 0..22 at the right of the stamp; the glider
  // came in from the lower left and must now be right of the stamp and below the reflector.
  assert.ok(bounds.minX > entry.size.width && bounds.minY > 22, `glider should leave down-right, at ${bounds.minX},${bounds.minY}`);
});

test('the gun, puffer and breeder keep producing new cells', () => {
  const gun = run(getMasterwork('simkin-glider-gun'), 240);
  assert.ok(gun.population > 36, `gun population ${gun.population}`);
  const gunSet = new Set(gun.live.map(([x, y]) => `${x},${y}`));
  assert.equal(gun.initial.filter(([x, y]) => gunSet.has(`${x},${y}`)).length, 36, 'gun returns to its phase');

  const puffer = run(getMasterwork('puffer-1'), 128);
  assert.ok(puffer.population > 44, `puffer population ${puffer.population}`);

  const breeder = run(getMasterwork('breeder-1'), 128);
  assert.ok(breeder.population > 4060, `breeder population ${breeder.population}`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CIRCUIT_MAX_CHAIN_GATES,
  CIRCUIT_MAX_GATES,
  buildCircuit,
  buildCircuitChain,
  buildCircuitExperiment,
  circuitExperiments,
  circuitGateCatalog,
  circuitPresets,
  createCircuitStepper,
  getCircuitChainInputs,
  getCircuitChainTruthTable,
  getCircuitTruthTable,
  readCircuitOutputs,
  resetCircuitExperiment,
  runCircuitChainToObservation,
  validateCircuit,
  validateCircuitChain,
} from './circuits.js';
import { gateNode, inputNode } from './circuit-spec.js';

const CASES = [
  ['and', { a: false, b: false }, [false]],
  ['and', { a: false, b: true }, [false]],
  ['and', { a: true, b: false }, [false]],
  ['and', { a: true, b: true }, [true]],
  ['or', { a: false, b: false }, [false]],
  ['or', { a: false, b: true }, [true]],
  ['or', { a: true, b: false }, [true]],
  ['or', { a: true, b: true }, [true]],
  ['not', { a: false }, [true]],
  ['not', { a: true }, [false]],
  ['half-adder', { a: false, b: false }, [false, false]],
  ['half-adder', { a: false, b: true }, [true, false]],
  ['half-adder', { a: true, b: false }, [true, false]],
  ['half-adder', { a: true, b: true }, [false, true]],
];

test('curated circuits keep source, finite-signal, and port metadata', () => {
  assert.deepEqual(circuitExperiments.map((experiment) => experiment.id), ['and', 'or', 'not', 'half-adder']);
  for (const experiment of circuitExperiments) {
    assert.equal(experiment.finiteSignals, true);
    assert.match(experiment.source.url, /^https:\/\//);
    assert.ok(experiment.outputs.length > 0);
  }
});

test('circuit outputs are read from evolved probe cells for every input combination', () => {
  for (const [id, inputs, expected] of CASES) {
    const experiment = buildCircuitExperiment(id, inputs);
    const stepper = createCircuitStepper(experiment);
    let board = experiment.board;
    while (board.generation < experiment.observeGeneration) board = stepper.step();

    const observed = readCircuitOutputs(experiment, board);
    assert.equal(observed.every((output) => output.settled), true, `${id} settles at its documented generation`);
    assert.deepEqual(observed.map((output) => output.high), expected, `${id} ${JSON.stringify(inputs)}`);
    for (const output of observed) assert.equal(output.population, output.high ? 9 : 0);
  }
});

test('startup probe activity is not reported as a settled boolean and reset reconstructs cells', () => {
  const experiment = buildCircuitExperiment('half-adder', { a: false, b: false });
  const stepper = createCircuitStepper(experiment);
  let board = experiment.board;
  while (board.generation < experiment.observeGeneration - 1) board = stepper.step();

  const early = readCircuitOutputs(experiment, board);
  assert.deepEqual(early.map((output) => output.high), [null, null]);

  const reset = resetCircuitExperiment(experiment);
  assert.equal(reset.board.generation, 0);
  assert.deepEqual(reset.board.cells, experiment.authoredBoard.cells);
  assert.deepEqual(reset.inputs, experiment.inputs);
});

// Chains ------------------------------------------------------------------

function evaluateChain(gates, inputs) {
  const names = getCircuitChainInputs(gates);
  let next = 1;
  let signal = inputs[names[0]];
  for (const gate of gates) {
    if (gate === 'not') signal = !signal;
    else {
      const other = inputs[names[next]];
      next += 1;
      signal = gate === 'and' ? signal && other : signal || other;
    }
  }
  return signal;
}

function inputCombinations(names) {
  const rows = [];
  for (let mask = 0; mask < 1 << names.length; mask += 1) {
    const inputs = {};
    names.forEach((name, index) => { inputs[name] = Boolean(mask & (1 << index)); });
    rows.push(inputs);
  }
  return rows;
}

function assertChainTruthTable(gates, combinations = inputCombinations(getCircuitChainInputs(gates))) {
  for (const inputs of combinations) {
    const { experiment, outputs } = runCircuitChainToObservation(gates, inputs);
    const label = `${gates.join('→')} ${JSON.stringify(inputs)}`;
    assert.equal(outputs.length, 1, label);
    assert.equal(outputs[0].settled, true, label);
    assert.equal(outputs[0].high, evaluateChain(gates, inputs), label);
    assert.equal(outputs[0].population, outputs[0].high ? 9 : 0, label);
    assert.equal(experiment.observeGeneration, 600 + gates.slice(0, -1).reduce((sum, gate) => sum + (gate === 'and' ? 300 : 420), 0), label);
  }
}

test('gate catalog marks the three gates chainable anywhere and the half-adder standalone', () => {
  assert.deepEqual(circuitGateCatalog.map((gate) => [gate.id, gate.chainable, gate.chainPosition]), [
    ['and', true, 'any'],
    ['or', true, 'any'],
    ['not', true, 'any'],
    ['half-adder', false, 'standalone'],
  ]);
  for (const gate of circuitGateCatalog) {
    assert.ok(gate.title && gate.description);
    assert.ok(Array.isArray(gate.inputs) && gate.inputs.length >= 1);
  }
});

test('chain inputs are allocated in order: first gate consumes a (and b), later two-input gates add one name', () => {
  assert.deepEqual(getCircuitChainInputs(['and']), ['a', 'b']);
  assert.deepEqual(getCircuitChainInputs(['not']), ['a']);
  assert.deepEqual(getCircuitChainInputs(['and', 'or', 'not']), ['a', 'b', 'c']);
  assert.deepEqual(getCircuitChainInputs(['not', 'and']), ['a', 'b']);
  assert.deepEqual(getCircuitChainInputs(['and', 'and', 'and']), ['a', 'b', 'c', 'd']);
  assert.throws(() => getCircuitChainInputs(['xor']), /Unknown gate "xor"/);
});

test('unsupported chains are rejected with a reason, by validate and by build', () => {
  const rejected = [
    [[], /at least one gate/],
    [['and', 'half-adder'], /half-adder is standalone/],
    [['half-adder'], /half-adder is standalone/],
    [['and', 'xor'], /Unknown gate "xor"/],
    [Array(CIRCUIT_MAX_CHAIN_GATES + 1).fill('and'), /Up to 6 gates in one chain\./],
  ];
  for (const [gates, pattern] of rejected) {
    const result = validateCircuitChain(gates);
    assert.equal(result.ok, false);
    assert.match(result.reason, pattern);
    assert.throws(() => buildCircuitChain({ gates }), pattern);
    assert.throws(() => getCircuitChainTruthTable(gates), pattern);
  }
  assert.deepEqual(validateCircuitChain(['not', 'or', 'and']), { ok: true, reason: null });
  assert.equal(validateCircuitChain('and').ok, false);
});

test('a one-gate chain is the single-gate experiment with tile and port markers', () => {
  for (const id of ['and', 'or', 'not']) {
    const inputs = { a: true, b: true };
    const single = buildCircuitExperiment(id, inputs);
    const chain = buildCircuitChain({ gates: [id], inputs });
    assert.equal(chain.board.width, single.board.width);
    assert.equal(chain.board.height, single.board.height);
    assert.deepEqual(chain.board.cells, single.board.cells);
    assert.equal(chain.observeGeneration, single.observeGeneration);
    assert.deepEqual(chain.outputs.map(({ x, y, width, height }) => ({ x, y, width, height })), single.outputs.map(({ x, y, width, height }) => ({ x, y, width, height })));
    assert.equal(chain.wrapping, false);
    assert.equal(chain.finiteSignals, true);
    assert.deepEqual(chain.authoredBoard.cells, chain.board.cells);
  }
});

test('chain experiments expose tiles, input lane entry points, and the final output probe', () => {
  const chain = buildCircuitChain({ gates: ['and', 'or', 'not'], inputs: { a: true, b: false, c: true } });
  assert.equal(chain.id, 'chain:and>or>not');
  assert.deepEqual(chain.gates, ['and', 'or', 'not']);
  assert.deepEqual(chain.inputs, { a: true, b: false, c: true });
  assert.equal(chain.observeGeneration, 600 + 300 + 420);
  assert.equal(chain.outputs[0].label, 'NOT ((A AND B) OR C)');
  assert.deepEqual(chain.tiles.map((tile) => [tile.gateId, tile.index, tile.x, tile.y, tile.width, tile.height]), [
    ['and', 0, 480, 20, 150, 150],
    ['or', 1, 630, 20, 150, 150],
    ['not', 2, 780, 20, 150, 150],
  ]);
  assert.deepEqual(chain.tiles[0].inputs, [
    { name: 'a', side: 'west', x: 480, y: 92 },
    { name: 'b', side: 'south', x: 552, y: 170 },
  ]);
  assert.deepEqual(chain.tiles[1].inputs, [{ name: 'c', side: 'south', x: 702, y: 170 }]);
  assert.deepEqual(chain.tiles[2].inputs, []);
  assert.deepEqual(chain.ports.map((port) => port.type), ['input', 'input', 'input', 'output']);
  const output = chain.ports.at(-1);
  assert.deepEqual([output.x, output.y, output.width, output.height, output.tileIndex], [930, 95, 12, 12, 2]);
  // Board is wide enough for three tiles, the terminator, and 14 packets west of the first gate.
  assert.ok(chain.board.width >= 480 + 150 * 4);
  assert.ok(chain.board.height >= 650);
  // c's train is stamped further south than b's train because it must wait for the AND's latency.
  const column = (x) => {
    const ys = [];
    for (let y = 170; y < chain.board.height; y += 1) if (chain.board.cells[y * chain.board.width + x]) ys.push(y);
    return ys;
  };
  assert.equal(column(552).length, 0, 'b is low: no northbound train');
  // A standard B train starts at y = 180; c waits for the AND's 300-generation latency.
  assert.ok(Math.min(...column(702)) > 180, 'c train is delayed south of the standard position');

  const reset = resetCircuitExperiment(chain);
  assert.deepEqual(reset.gates, chain.gates);
  assert.deepEqual(reset.board.cells, chain.authoredBoard.cells);
});

test('every two-gate AND/OR chain and every NOT variant has the correct full truth table', () => {
  for (const gates of [
    ['and', 'and'], ['and', 'or'], ['or', 'and'], ['or', 'or'],
    ['not', 'and'], ['not', 'or'], ['and', 'not'], ['or', 'not'], ['not', 'not'],
  ]) {
    assertChainTruthTable(gates);
  }
});

test('three-gate chains have the correct truth table, including NOT in the middle and NOT feeding OR', () => {
  assertChainTruthTable(['and', 'not', 'and']);
  assertChainTruthTable(['not', 'or', 'and']);
  assertChainTruthTable(['and', 'and', 'and'], [
    { a: true, b: true, c: true, d: true },
    { a: true, b: true, c: false, d: true },
    { a: false, b: true, c: true, d: true },
  ]);
});

test('getCircuitChainTruthTable simulates every input combination', () => {
  const rows = getCircuitChainTruthTable(['not', 'and']);
  assert.deepEqual(rows, [
    { inputs: { a: false, b: false }, outputs: { out: false } },
    { inputs: { a: true, b: false }, outputs: { out: false } },
    { inputs: { a: false, b: true }, outputs: { out: true } },
    { inputs: { a: true, b: true }, outputs: { out: false } },
  ]);
  assert.deepEqual(getCircuitTruthTable({ gates: ['not', 'and'] }), rows);
});

// Branching circuits ---------------------------------------------------------

const g = gateNode;
const i = inputNode;

function hashBoard(experiment) {
  const hash = createHash('sha256');
  hash.update(`${experiment.board.width}x${experiment.board.height}:`);
  hash.update(experiment.board.cells);
  return hash.digest('hex');
}

function runSpec(spec) {
  const experiment = buildCircuit(spec);
  const stepper = createCircuitStepper(experiment);
  let board = experiment.board;
  while (board.generation < experiment.observeGeneration) board = stepper.step();
  return { experiment, board, outputs: readCircuitOutputs(experiment, board) };
}

function assertTruthTable(spec, rows = getCircuitTruthTable(spec)) {
  for (const row of rows) {
    const { outputs } = runSpec({ ...spec, inputs: row.inputs });
    const read = Object.fromEntries(outputs.map((output) => [output.id, output.high]));
    assert.deepEqual(read, row.outputs, JSON.stringify(row.inputs));
    for (const output of outputs) assert.equal(output.population, output.high ? 9 : 0);
  }
}

test('legacy chains build byte-identical boards, directly and through buildCircuit', () => {
  // SHA-256 of `${width}x${height}:` + cells, recorded before the branching engine existed.
  const snapshot = {
    'and|11': '1c7124ab75538bf626cb30f0ef2c09a7453b53a2558d6a342420870e15a60470',
    'or|11': '1d03fa7d7c235191c1fad3be929af95776a79c3749e95059c245483c66e9b427',
    'not|1': '9cab6c479b599e9e1068522a4ab4e6dafec99653ce92e9d2a15b0d8f838f8c1d',
    'and>or>not|101': '8b6a77c6b146a42cfbcc1161431a5ee6c260cfbe24802f7c6c0282227d5be7a7',
    'or>or>or|1111': '07565e9146af675905dc9764f1d46f2744ed4cfde2aa225174551f0106149e5c',
    'not>not>not|1': 'b2a380a9de647625f9bdecbb8b4c34b7086c7210c68f460cfdaf7dc43da546ce',
    'and>and>and|1111': 'c84a0a17361fbe6484b7bbe4b9304807949f06ecdafdacb25a5a060a513f6afc',
  };
  for (const [key, expected] of Object.entries(snapshot)) {
    const [chain, bits] = key.split('|');
    const gates = chain.split('>');
    const inputs = {};
    [...bits].forEach((bit, index) => { inputs[String.fromCharCode(97 + index)] = bit === '1'; });
    const direct = buildCircuitChain({ gates, inputs });
    const viaSpec = buildCircuit({ gates, inputs });
    assert.equal(hashBoard(direct), expected, key);
    assert.equal(hashBoard(viaSpec), expected, key);
    assert.equal(viaSpec.id, `chain:${gates.join('>')}`);
    assert.deepEqual(viaSpec.tiles, direct.tiles);
    assert.deepEqual(viaSpec.ports, direct.ports);
    assert.deepEqual(viaSpec.spec, { gates, inputs });
  }
  assert.equal(buildCircuit({ gates: ['and'], inputs: { a: true, b: true } }).id, 'chain:and');
});

test('validateCircuit explains every unsupported shape in plain English', () => {
  assert.equal(CIRCUIT_MAX_CHAIN_GATES, 6);
  assert.equal(CIRCUIT_MAX_GATES, 10);
  const cases = [
    [{ preset: 'nand' }, 'Unknown circuit preset "nand".'],
    [{ outputs: [{ tree: g('or', g('and', i('a'), i('b')), g('and', i('c'), i('d'))) }] }, 'An OR gate can take only one other gate as an input here; its other input must be a switch.'],
    [{ outputs: [{ tree: g('and', g('not', i('a')), g('not', i('b'))) }] }, 'An AND gate can take at most one input that runs through a NOT gate.'],
    [{ gates: Array(7).fill('or') }, 'Up to 6 gates in one chain.'],
    [{ outputs: [{ tree: Array(11).fill('and').reduce((tree, gate, index) => g(gate, tree, i(String.fromCharCode(98 + (index % 7)))), i('a')) }] }, 'Circuits here can use up to 10 gates.'],
    [{ preset: 'full-adder' }, 'Circuits here can use up to 10 gates.'],
  ];
  for (const [spec, reason] of cases) {
    assert.deepEqual(validateCircuit(spec), { ok: false, reason });
    assert.throws(() => buildCircuit(spec), new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  for (const spec of [
    { preset: 'xor' },
    { gates: ['half-adder'] },
    { gates: Array(6).fill('and') },
    { outputs: [{ tree: g('and', g('or', i('a'), i('b')), g('not', g('and', i('a'), i('b')))) }] }, // AND swaps its NOT operand to the A side
    { outputs: [{ tree: g('or', i('a'), g('and', i('b'), i('c'))) }] }, // OR swaps its gate operand to the A side
  ]) assert.deepEqual(validateCircuit(spec), { ok: true, reason: null }, JSON.stringify(spec));
});

test('presets carry ids, names, descriptions and expected truth tables', () => {
  assert.deepEqual(circuitPresets.map((preset) => [preset.id, preset.name]), [['xor', 'XOR'], ['full-adder', 'Full adder']]);
  for (const preset of circuitPresets) assert.match(preset.description, /^[A-Z].*\.$/);
  assert.deepEqual(getCircuitTruthTable({ preset: 'xor' }).map((row) => row.outputs.out), [false, true, true, false]);
  const adder = getCircuitTruthTable({ preset: 'full-adder' });
  assert.equal(adder.length, 8);
  for (const row of adder) {
    const total = Number(row.inputs.a) + Number(row.inputs.b) + Number(row.inputs.c);
    assert.deepEqual(row.outputs, { sum: total % 2 === 1, carry: total >= 2 });
  }
  assert.deepEqual(getCircuitTruthTable({ gates: ['half-adder'] }).map((row) => [row.outputs.sum, row.outputs.carry]), [[false, false], [true, false], [true, false], [false, true]]);
});

test('XOR preset builds a real four-tile circuit with one reflected tile and reads correctly for all four rows', () => {
  const experiment = buildCircuit({ preset: 'xor', inputs: { a: true } });
  assert.equal(experiment.id, 'preset:xor');
  assert.equal(experiment.title, 'XOR');
  assert.deepEqual(experiment.spec, { preset: 'xor', inputs: { a: true, b: false } });
  assert.deepEqual(experiment.inputs, { a: true, b: false });
  assert.equal(experiment.tiles.length, 4);
  assert.deepEqual(experiment.tiles.map((tile) => tile.gateId), ['and', 'not', 'and', 'or']);
  const reflected = experiment.tiles.filter((tile) => tile.mirrored);
  assert.equal(reflected.length, 1);
  assert.equal(reflected[0].rotation, 90);
  assert.equal(reflected[0].output.side, 'north');
  assert.deepEqual(reflected[0].inputs.map((input) => input.side), ['south', 'west']);
  assert.deepEqual(experiment.ports.filter((port) => port.type === 'input').map((port) => port.name), ['a', 'b', 'a', 'b']);
  assert.equal(experiment.ports.at(-1).type, 'output');
  assert.equal(experiment.outputs[0].label, 'A XOR B');
  assert.ok(experiment.board.width <= 3000 && experiment.board.height <= 3000);
  assertTruthTable({ preset: 'xor' });
});

test('a branching tree reads correctly for every row and resets to its authored board', () => {
  const spec = { outputs: [{ id: 'out', label: 'OUT', tree: g('and', i('a'), g('and', i('c'), i('d'))) }] };
  const experiment = buildCircuit({ ...spec, inputs: { a: true, c: true, d: true } });
  assert.equal(experiment.id, 'tree:and(a,and(c,d))');
  assert.deepEqual(experiment.tiles.map((tile) => [tile.gateId, tile.mirrored]), [['and', false], ['and', true]]);
  assert.equal(experiment.tiles[1].x, experiment.tiles[0].x - 4);
  assert.ok(experiment.tiles[1].y > experiment.tiles[0].y + 150);
  const reset = resetCircuitExperiment(experiment);
  assert.deepEqual(reset.board.cells, experiment.authoredBoard.cells);
  assert.equal(reset.observeGeneration, experiment.observeGeneration);
  assertTruthTable(spec);
});

test('two outputs share one observation generation and both probes read from real cells', () => {
  const spec = { outputs: [{ id: 'x', label: 'X', tree: g('and', g('and', i('a'), i('b')), i('c')) }, { id: 'y', label: 'Y', tree: g('or', i('a'), i('b')) }] };
  const { experiment, outputs } = runSpec({ ...spec, inputs: { a: true, b: true, c: false } });
  assert.deepEqual(outputs.map((output) => [output.id, output.high, output.population]), [['x', false, 0], ['y', true, 9]]);
  assert.equal(experiment.observeGeneration, 900);
  assert.equal(experiment.outputs[1].x - experiment.outputs[0].x, 150, 'the faster OR output spends its 300 spare generations as 150 cells of wire before its probe');
  assert.ok(experiment.outputs[1].y > experiment.outputs[0].y);
  assertTruthTable(spec, [{ inputs: { a: true, b: true, c: true }, outputs: { x: true, y: true } }]);
});

test('chains of four to six gates build through the branching engine with chain ids and tile positions', () => {
  const gates = ['and', 'or', 'and', 'or'];
  const experiment = buildCircuitChain({ gates, inputs: { a: true, b: true, c: false, d: true, e: false } });
  assert.equal(experiment.id, 'chain:and>or>and>or');
  assert.deepEqual(experiment.gates, gates);
  assert.deepEqual(experiment.tiles.map((tile) => [tile.gateId, tile.x, tile.y]), [['or', 930, 20], ['and', 780, 20], ['or', 630, 20], ['and', 480, 20]]);
  assert.equal(experiment.outputs[0].label, '((A AND B) OR C) AND D) OR E'.replace('((A AND B) OR C) AND D) OR E', '(((A AND B) OR C) AND D) OR E'));
  assert.equal(experiment.observeGeneration, 600 + 300 + 420 + 300);
  assert.ok(experiment.board.width <= 3000 && experiment.board.height <= 3000);
  assertTruthTable({ gates }, [
    { inputs: { a: true, b: true, c: false, d: true, e: false }, outputs: { out: true } },
    { inputs: { a: true, b: false, c: false, d: true, e: false }, outputs: { out: false } },
  ]);
  const six = buildCircuit({ gates: Array(6).fill('not') });
  assert.equal(six.tiles.length, 6);
  assert.ok(six.board.width <= 3000 && six.board.height <= 3000);
});

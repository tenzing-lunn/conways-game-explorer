import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCircuitChain,
  buildCircuitExperiment,
  circuitExperiments,
  circuitGateCatalog,
  createCircuitStepper,
  getCircuitChainInputs,
  getCircuitChainTruthTable,
  readCircuitOutputs,
  resetCircuitExperiment,
  runCircuitChainToObservation,
  validateCircuitChain,
} from './circuits.js';

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
    [['and', 'and', 'and', 'and'], /longer than 3 gates/],
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
});

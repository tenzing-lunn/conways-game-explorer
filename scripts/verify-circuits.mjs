#!/usr/bin/env node
// Exhaustive truth-table verification of circuits through the real Life engine.
//
//   node scripts/verify-circuits.mjs            full run (presets, every chain up to the cap,
//                                                depth-2 tree shapes, random trees)
//   node scripts/verify-circuits.mjs --quick    presets, chains up to 3 gates, a few trees
//   node scripts/verify-circuits.mjs --only=presets,chains,long,trees,random   chosen sections only
//
// Every row of every circuit is simulated to its observation generation and the
// probes are compared with the boolean evaluation of the spec, at the observation
// generation and 60/120/180 generations later (stability). Exits 1 on any mismatch.
import {
  CIRCUIT_MAX_CHAIN_GATES, CIRCUIT_MAX_GATES, buildCircuit, circuitPresets, createCircuitStepper, getCircuitTruthTable,
  readCircuitOutputs, validateCircuit,
} from '../src/circuits.js';
import { describeSpec, gateNode, inputNode } from '../src/circuit-spec.js';

const quick = process.argv.includes('--quick');
const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const sections = new Set(onlyArg ? onlyArg.slice('--only='.length).split(',') : ['presets', 'chains', 'long', 'trees', 'random']);
const GATES = ['and', 'or', 'not'];
const results = [];
let failures = 0;
const started = Date.now();

function verify(label, spec) {
  const validation = validateCircuit(spec);
  if (!validation.ok) {
    results.push({ label, rows: 0, mismatches: 0, seconds: 0, note: `rejected: ${validation.reason}` });
    return;
  }
  const table = getCircuitTruthTable(spec);
  const t0 = Date.now();
  let mismatches = 0;
  let board = null;
  let experiment = null;
  for (const row of table) {
    experiment = buildCircuit({ ...spec, inputs: row.inputs });
    const stepper = createCircuitStepper(experiment);
    board = experiment.board;
    while (board.generation < experiment.observeGeneration) board = stepper.step();
    for (let check = 0; check < 4; check += 1) {
      if (check > 0) for (let step = 0; step < 60; step += 1) board = stepper.step();
      for (const output of readCircuitOutputs(experiment, board)) {
        if (output.high !== row.outputs[output.id]) {
          mismatches += 1;
          console.log(`  MISMATCH ${label} ${JSON.stringify(row.inputs)} ${output.id} at generation ${board.generation}: read ${output.high} (population ${output.population}), expected ${row.outputs[output.id]}`);
        }
      }
    }
  }
  const seconds = (Date.now() - t0) / 1000;
  failures += mismatches;
  results.push({ label, rows: table.length, mismatches, seconds, note: `${experiment.board.width}x${experiment.board.height}, observe ${experiment.observeGeneration}, ${experiment.tiles.length} tiles` });
  console.log(`${mismatches ? 'FAIL' : 'ok  '} ${label}: ${table.length} rows, ${mismatches} mismatches, ${seconds.toFixed(1)}s`);
}

function* chains(maxLength) {
  for (let length = 1; length <= maxLength; length += 1) {
    for (let code = 0; code < GATES.length ** length; code += 1) {
      const gates = [];
      let rest = code;
      for (let index = 0; index < length; index += 1) { gates.push(GATES[rest % GATES.length]); rest = Math.floor(rest / GATES.length); }
      yield gates;
    }
  }
}

// Deterministic PRNG so the random sample is reproducible.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function randomTree(random, budget, names) {
  if (budget <= 0 || random() < 0.25) return inputNode(names[Math.floor(random() * names.length)]);
  const gate = GATES[Math.floor(random() * GATES.length)];
  if (gate === 'not') return gateNode('not', randomTree(random, budget - 1, names));
  const left = Math.floor(random() * budget);
  return gateNode(gate, randomTree(random, left, names), randomTree(random, budget - 1 - left, names));
}

console.log(`verify-circuits: ${quick ? 'quick' : 'full'} run, chain cap ${CIRCUIT_MAX_CHAIN_GATES}, gate cap ${CIRCUIT_MAX_GATES}\n`);

if (sections.has('presets')) for (const preset of circuitPresets) verify(`preset ${preset.id}`, preset.spec);

const chainCap = quick ? 3 : 4;
if (sections.has('chains')) for (const gates of chains(chainCap)) verify(`chain ${gates.join('>')}`, { gates });
if (!quick && sections.has('long')) {
  // Longer chains: every uniform chain plus a reproducible sample of mixed ones.
  const random = mulberry32(7);
  for (let length = 5; length <= CIRCUIT_MAX_CHAIN_GATES; length += 1) {
    const sample = GATES.map((gate) => Array(length).fill(gate));
    for (let count = 0; count < 4; count += 1) sample.push(Array.from({ length }, () => GATES[Math.floor(random() * 3)]));
    for (const gates of sample) verify(`chain ${gates.join('>')}`, { gates });
  }
}

// Depth-2 tree shapes: root(gateA(x, y), gateB(z, w)) with 4, 2 and 3 distinct inputs.
const leafSets = quick ? [['a', 'b', 'c', 'd']] : [['a', 'b', 'c', 'd'], ['a', 'b', 'a', 'b'], ['a', 'b', 'b', 'c']];
for (const root of sections.has('trees') ? ['and', 'or'] : []) {
  for (const gateA of GATES) {
    for (const gateB of GATES) {
      for (const [x, y, z, w] of leafSets) {
        const left = gateA === 'not' ? gateNode('not', inputNode(x)) : gateNode(gateA, inputNode(x), inputNode(y));
        const right = gateB === 'not' ? gateNode('not', inputNode(z)) : gateNode(gateB, inputNode(z), inputNode(w));
        const spec = { outputs: [{ id: 'out', tree: gateNode(root, left, right) }] };
        verify(`tree ${describeSpec(spec)[0]}`, spec);
        if (quick) break;
      }
      if (quick && gateB !== 'not') break;
    }
    if (quick) break;
  }
}

// Random trees within the gate cap.
const random = mulberry32(2026);
const wanted = sections.has('random') ? (quick ? 3 : 30) : 0;
let produced = 0;
let rejected = 0;
while (produced < wanted) {
  const tree = randomTree(random, 1 + Math.floor(random() * (quick ? 5 : 9)), ['a', 'b', 'c', 'd', 'e']);
  if (!tree.gate) continue;
  const spec = { outputs: [{ id: 'out', tree }] };
  const validation = validateCircuit(spec);
  if (!validation.ok) { rejected += 1; results.push({ label: `random ${describeSpec(spec)[0]}`, rows: 0, mismatches: 0, seconds: 0, note: `rejected: ${validation.reason}` }); continue; }
  produced += 1;
  verify(`random ${describeSpec(spec)[0]}`, spec);
}

console.log('\n| circuit | rows | mismatches | seconds | note |');
console.log('| --- | --- | --- | --- | --- |');
for (const row of results) console.log(`| ${row.label} | ${row.rows} | ${row.mismatches} | ${row.seconds.toFixed(1)} | ${row.note} |`);
const verified = results.filter((row) => row.rows > 0);
console.log(`\n${verified.length} circuits simulated, ${verified.reduce((sum, row) => sum + row.rows, 0)} rows, ${failures} mismatches, ${rejected} random trees rejected by validateCircuit, ${((Date.now() - started) / 1000).toFixed(0)}s total.`);
process.exit(failures ? 1 : 0);

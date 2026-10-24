import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chainToTree, treeToChain, normalizeCircuitSpec, validateCircuitSpecShape, getSpecInputs, countSpecGates,
  treeDepth, describeTree, describeSpec, getNode, setNode, nextFreeInput, wrapOutput, growLeaf, setLeafInput,
  removeGate, setInputValue, inputNode, gateNode,
} from './circuit-spec.js';

test('legacy chains convert to trees and back', () => {
  const tree = chainToTree(['and', 'or', 'not']);
  assert.equal(describeTree(tree), 'NOT ((A AND B) OR C)');
  assert.deepEqual(treeToChain(tree), ['and', 'or', 'not']);
  assert.deepEqual(treeToChain(chainToTree([])), []);
});

test('treeToChain rejects branching trees', () => {
  const branched = gateNode('or', gateNode('and', inputNode('a'), inputNode('b')), gateNode('and', inputNode('c'), inputNode('d')));
  assert.equal(treeToChain(branched), null);
  assert.equal(describeTree(branched), '(A AND B) OR (C AND D)');
  assert.equal(treeDepth(branched), 2);
});

test('normalizeCircuitSpec handles every spec form', () => {
  const chain = normalizeCircuitSpec({ gates: ['and', 'or'], inputs: { a: true, c: 1 } });
  assert.equal(chain.kind, 'tree');
  assert.deepEqual(chain.inputs, { a: true, b: false, c: true });
  assert.deepEqual(describeSpec(chain), ['OUT = (A AND B) OR C']);
  assert.deepEqual(normalizeCircuitSpec({ gates: ['half-adder'], inputs: { b: true } }), { kind: 'half-adder', inputs: { a: false, b: true } });
  assert.deepEqual(normalizeCircuitSpec({ preset: 'full-adder', inputs: { a: true } }), { kind: 'preset', id: 'full-adder', inputs: { a: true } });
  const tree = normalizeCircuitSpec({ outputs: [{ id: 'sum', tree: inputNode('a') }, { tree: inputNode('b') }] });
  assert.deepEqual(tree.outputs.map((output) => [output.id, output.label]), [['sum', 'SUM'], ['out2', 'OUT']]);
  assert.throws(() => normalizeCircuitSpec({}), /Unrecognised/);
});

test('validateCircuitSpecShape catches malformed trees', () => {
  assert.equal(validateCircuitSpecShape({ gates: ['and'] }).ok, true);
  assert.equal(validateCircuitSpecShape({ outputs: [] }).ok, false);
  assert.match(validateCircuitSpecShape({ outputs: [{ tree: { gate: 'nand', a: inputNode('a'), b: inputNode('b') } }] }).reason, /Unknown gate/);
  assert.match(validateCircuitSpecShape({ outputs: [{ tree: { gate: 'not', a: inputNode('a'), b: inputNode('b') } }] }).reason, /single input/);
  assert.match(validateCircuitSpecShape({ outputs: [{ tree: inputNode('z') }] }).reason, /Unknown input/);
});

test('inputs are collected in order of first appearance and may repeat', () => {
  const xor = { outputs: [{ tree: gateNode('and', gateNode('or', inputNode('a'), inputNode('b')), gateNode('not', gateNode('and', inputNode('a'), inputNode('b')))) }] };
  assert.deepEqual(getSpecInputs(xor), ['a', 'b']);
  assert.equal(countSpecGates(xor), 4);
  assert.equal(nextFreeInput(xor), 'c');
  assert.equal(describeSpec(xor)[0], 'OUT = (A OR B) AND (NOT (A AND B))');
});

test('editing operations return new specs and keep inputs tidy', () => {
  const start = { gates: ['and'], inputs: { a: true, b: true } };
  const wrapped = wrapOutput(start, 0, 'or');
  assert.deepEqual(describeSpec(wrapped), ['OUT = (A AND B) OR C']);
  assert.deepEqual(wrapped.inputs, { a: true, b: true, c: false });

  const grownB = growLeaf(wrapped, 0, ['a', 'b'], 'or');
  assert.deepEqual(describeSpec(grownB), ['OUT = (A AND (B OR D)) OR C']);

  const renamed = setLeafInput(grownB, 0, ['a', 'b', 'b'], 'a');
  assert.deepEqual(describeSpec(renamed), ['OUT = (A AND (B OR A)) OR C']);
  assert.deepEqual(Object.keys(renamed.inputs), ['a', 'b', 'c']);

  const removed = removeGate(renamed, 0, ['a']);
  assert.deepEqual(describeSpec(removed), ['OUT = A OR C']);
  assert.deepEqual(removed.inputs, { a: true, c: false });

  const notted = wrapOutput(removed, 0, 'not');
  assert.deepEqual(describeSpec(notted), ['OUT = NOT (A OR C)']);
  assert.deepEqual(setInputValue(notted, 'c', 1).inputs, { a: true, c: true });

  assert.throws(() => growLeaf(wrapped, 0, [], 'and'), /input slot/);
  assert.throws(() => removeGate(wrapped, 0, ['b']), /Only a gate/);
  assert.equal(getNode(wrapped.outputs[0].tree, ['b']).input, 'c');
  assert.equal(describeTree(setNode(wrapped.outputs[0].tree, ['b'], inputNode('a'))), '(A AND B) OR A');
  // The original was not mutated.
  assert.deepEqual(start, { gates: ['and'], inputs: { a: true, b: true } });
});

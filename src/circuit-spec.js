// Pure helpers for circuit specs: the data a user builds in the Logic
// inspector and that Studio persists in `creation.previewConfig.circuit`.
// No engine code here; src/circuits.js turns a spec into a board.
//
// Spec forms accepted by normalizeCircuitSpec:
//   legacy chain   { gates: ['and', 'or'], inputs: { a: true, b: false, c: true } }
//   half-adder     { gates: ['half-adder'], inputs: { a, b } }
//   preset         { preset: 'full-adder', inputs: { a, b, c } }
//   tree           { outputs: [{ id: 'out', label: 'OUT', tree: Node }], inputs: {...} }
// Node = { input: 'a' } | { gate: 'and' | 'or', a: Node, b: Node } | { gate: 'not', a: Node }
// External input names are single letters a..h and may be reused in a tree.

export const GATE_ARITY = Object.freeze({ and: 2, or: 2, not: 1 });
export const INPUT_NAMES = Object.freeze([...'abcdefgh']);
export const MAX_OUTPUTS = 2;

export function isGateNode(node) {
  return Boolean(node) && typeof node === 'object' && typeof node.gate === 'string';
}

export function isInputNode(node) {
  return Boolean(node) && typeof node === 'object' && typeof node.input === 'string';
}

export function inputNode(name) {
  return { input: name };
}

export function gateNode(gate, a, b) {
  return GATE_ARITY[gate] === 1 ? { gate, a } : { gate, a, b };
}

export function chainToTree(gates) {
  let tree = inputNode(INPUT_NAMES[0]);
  let next = 1;
  for (const gate of gates) {
    if (!GATE_ARITY[gate]) throw new Error(`Unknown gate "${gate}".`);
    if (GATE_ARITY[gate] === 2) {
      tree = gateNode(gate, tree, inputNode(INPUT_NAMES[next]));
      next += 1;
    } else {
      tree = gateNode(gate, tree);
    }
  }
  return tree;
}

// Returns the legacy gate list when the tree is a plain left-to-right chain
// (second operands are fresh inputs b, c, d… in order), otherwise null.
export function treeToChain(tree) {
  const gates = [];
  const operands = [];
  let node = tree;
  while (isGateNode(node)) {
    gates.push(node.gate);
    if (GATE_ARITY[node.gate] === 2) {
      if (!isInputNode(node.b)) return null;
      operands.push(node.b.input);
    }
    node = node.a;
  }
  if (!isInputNode(node) || node.input !== INPUT_NAMES[0]) return null;
  gates.reverse();
  operands.reverse();
  for (let index = 0; index < operands.length; index += 1) {
    if (operands[index] !== INPUT_NAMES[index + 1]) return null;
  }
  return gates;
}

export function normalizeCircuitSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('A circuit spec is an object.');
  if (typeof spec.preset === 'string') {
    return { kind: 'preset', id: spec.preset, inputs: booleanInputs(spec.inputs) };
  }
  if (Array.isArray(spec.gates)) {
    if (spec.gates[0] === 'half-adder') return { kind: 'half-adder', inputs: booleanInputs(spec.inputs, ['a', 'b']) };
    const outputs = [{ id: 'out', label: 'OUT', tree: chainToTree(spec.gates) }];
    return withInputValues({ kind: 'tree', outputs, inputs: booleanInputs(spec.inputs) });
  }
  if (Array.isArray(spec.outputs)) {
    const outputs = spec.outputs.map((output, index) => ({
      id: typeof output?.id === 'string' ? output.id : index === 0 ? 'out' : `out${index + 1}`,
      label: typeof output?.label === 'string' ? output.label : (typeof output?.id === 'string' ? output.id : 'out').toUpperCase(),
      tree: output?.tree,
    }));
    return withInputValues({ kind: 'tree', outputs, inputs: booleanInputs(spec.inputs) });
  }
  throw new Error('Unrecognised circuit spec.');
}

export function validateCircuitSpecShape(spec) {
  let normalized;
  try {
    normalized = normalizeCircuitSpec(spec);
  } catch (error) {
    return { ok: false, reason: error.message };
  }
  if (normalized.kind !== 'tree') return { ok: true, reason: null };
  if (normalized.outputs.length < 1 || normalized.outputs.length > MAX_OUTPUTS) {
    return { ok: false, reason: `A circuit has between 1 and ${MAX_OUTPUTS} outputs.` };
  }
  for (const output of normalized.outputs) {
    const problem = validateNode(output.tree);
    if (problem) return { ok: false, reason: problem };
  }
  return { ok: true, reason: null };
}

function validateNode(node) {
  if (isInputNode(node)) return INPUT_NAMES.includes(node.input) ? null : `Unknown input "${node.input}".`;
  if (!isGateNode(node)) return 'Every slot holds an input or a gate.';
  const arity = GATE_ARITY[node.gate];
  if (!arity) return `Unknown gate "${node.gate}".`;
  const first = validateNode(node.a);
  if (first) return first;
  if (arity === 2) return validateNode(node.b);
  if (node.b !== undefined) return 'NOT takes a single input.';
  return null;
}

export function getTreeInputs(tree) {
  const names = [];
  walkTree(tree, (node) => {
    if (isInputNode(node) && !names.includes(node.input)) names.push(node.input);
  });
  return names;
}

export function getSpecInputs(spec) {
  const normalized = normalizeCircuitSpec(spec);
  if (normalized.kind === 'half-adder') return ['a', 'b'];
  if (normalized.kind === 'preset') return Object.keys(normalized.inputs);
  const names = [];
  for (const output of normalized.outputs) {
    for (const name of getTreeInputs(output.tree)) if (!names.includes(name)) names.push(name);
  }
  return names;
}

export function countTreeGates(tree) {
  let count = 0;
  walkTree(tree, (node) => { if (isGateNode(node)) count += 1; });
  return count;
}

export function countSpecGates(spec) {
  const normalized = normalizeCircuitSpec(spec);
  if (normalized.kind !== 'tree') return normalized.kind === 'half-adder' ? 1 : 0;
  return normalized.outputs.reduce((sum, output) => sum + countTreeGates(output.tree), 0);
}

export function treeDepth(tree) {
  if (!isGateNode(tree)) return 0;
  const a = treeDepth(tree.a);
  const b = GATE_ARITY[tree.gate] === 2 ? treeDepth(tree.b) : 0;
  return 1 + Math.max(a, b);
}

export function describeTree(tree) {
  if (isInputNode(tree)) return tree.input.toUpperCase();
  if (tree.gate === 'not') return isInputNode(tree.a) ? `NOT ${describeTree(tree.a)}` : `NOT (${describeTree(tree.a)})`;
  return `${operand(tree.a)} ${tree.gate.toUpperCase()} ${operand(tree.b)}`;
}

function operand(node) {
  return isInputNode(node) ? describeTree(node) : `(${describeTree(node)})`;
}

export function describeSpec(spec) {
  const normalized = normalizeCircuitSpec(spec);
  if (normalized.kind === 'half-adder') return ['SUM = A XOR B', 'CARRY = A AND B'];
  if (normalized.kind === 'preset') return [normalized.id];
  return normalized.outputs.map((output) => `${output.label} = ${describeTree(output.tree)}`);
}

// Paths are arrays of 'a' | 'b' from an output's root node.
export function getNode(tree, path) {
  let node = tree;
  for (const step of path) {
    if (!isGateNode(node) || (step !== 'a' && step !== 'b')) return undefined;
    node = node[step];
  }
  return node;
}

export function setNode(tree, path, replacement) {
  if (path.length === 0) return replacement;
  const [step, ...rest] = path;
  if (!isGateNode(tree) || (step !== 'a' && step !== 'b')) throw new Error('Path does not lead to a slot.');
  return { ...tree, [step]: setNode(tree[step], rest, replacement) };
}

export function nextFreeInput(spec) {
  const used = getSpecInputs(spec);
  return INPUT_NAMES.find((name) => !used.includes(name)) ?? null;
}

// Editing operations: each returns a new normalized tree spec and never
// mutates its argument. Fresh second operands take the next unused letter.
export function wrapOutput(spec, outputIndex, gate) {
  const normalized = requireTree(spec);
  const root = normalized.outputs[outputIndex].tree;
  return replaceOutputTree(normalized, outputIndex, grown(normalized, root, gate));
}

export function growLeaf(spec, outputIndex, path, gate) {
  const normalized = requireTree(spec);
  const tree = normalized.outputs[outputIndex].tree;
  const leaf = getNode(tree, path);
  if (!isInputNode(leaf)) throw new Error('Only an input slot can grow into a gate.');
  return replaceOutputTree(normalized, outputIndex, setNode(tree, path, grown(normalized, leaf, gate)));
}

export function setLeafInput(spec, outputIndex, path, name) {
  const normalized = requireTree(spec);
  if (!INPUT_NAMES.includes(name)) throw new Error(`Unknown input "${name}".`);
  const tree = normalized.outputs[outputIndex].tree;
  if (!isInputNode(getNode(tree, path))) throw new Error('Only an input slot can be renamed.');
  return replaceOutputTree(normalized, outputIndex, setNode(tree, path, inputNode(name)));
}

export function removeGate(spec, outputIndex, path) {
  const normalized = requireTree(spec);
  const tree = normalized.outputs[outputIndex].tree;
  const node = getNode(tree, path);
  if (!isGateNode(node)) throw new Error('Only a gate can be removed.');
  return replaceOutputTree(normalized, outputIndex, setNode(tree, path, node.a));
}

export function setInputValue(spec, name, value) {
  const normalized = normalizeCircuitSpec(spec);
  return { ...normalized, inputs: { ...normalized.inputs, [name]: Boolean(value) } };
}

function grown(normalized, operand, gate) {
  if (!GATE_ARITY[gate]) throw new Error(`Unknown gate "${gate}".`);
  if (GATE_ARITY[gate] === 1) return gateNode(gate, operand);
  const fresh = nextFreeInput(normalized);
  if (!fresh) throw new Error(`All ${INPUT_NAMES.length} inputs are in use.`);
  return gateNode(gate, operand, inputNode(fresh));
}

function requireTree(spec) {
  const normalized = normalizeCircuitSpec(spec);
  if (normalized.kind !== 'tree') throw new Error('Only tree circuits can be edited.');
  return normalized;
}

function replaceOutputTree(normalized, outputIndex, tree) {
  const outputs = normalized.outputs.map((output, index) => (index === outputIndex ? { ...output, tree } : output));
  return withInputValues({ ...normalized, outputs });
}

// Keeps exactly the inputs the trees use, defaulting new ones to false.
function withInputValues(normalized) {
  const inputs = {};
  for (const output of normalized.outputs) {
    for (const name of getTreeInputs(output.tree)) inputs[name] = Boolean(normalized.inputs?.[name]);
  }
  return { ...normalized, inputs };
}

function booleanInputs(inputs, names = Object.keys(inputs ?? {})) {
  const values = {};
  for (const name of names) values[name] = Boolean(inputs?.[name]);
  return values;
}

function walkTree(node, visit) {
  if (!node) return;
  visit(node);
  if (isGateNode(node)) {
    walkTree(node.a, visit);
    if (node.b !== undefined) walkTree(node.b, visit);
  }
}

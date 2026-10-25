# Circuit research handoff

Research obtained in the preceding implementation session. Reproduce these
results against the final shipped engine before presenting them as verified
launch behavior. Nothing in this document grants upstream asset rights.

## Sources

- Carlini's gate construction and signal explanation:
  https://nicholas.carlini.com/writing/2021/improved-logic-gates-game-of-life.html
- CakeML gate coordinates and simulator recipe:
  https://github.com/CakeML/game-of-life/tree/master/gates and the repository's
  `gol_simLib.sml`.
- Myreen and Carneiro paper:
  https://research.chalmers.se/publication/548890/file/548890_Fulltext.pdf

The paper declares CC BY 4.0. An explicit license for the repository RLE assets
was not established; do not assume the paper's license covers every repository
file. Establish reuse terms or another appropriately licensed source before
shipping. Keep source/author credits with each curated experiment.

## T3 provenance check — 2026-09-08

The circuit recipe was reproduced against this repository's bounded B3/S23
engine using the upstream raw files. The truth tables and timing in this handoff
remain reproducible. The exact upstream commit inspected was
`c3439fc4c24948f93945c75c973e56ed4a001ad6` (2025-11-09). GitHub's repository
metadata reports `license: null`, and its license endpoint returns 404. Its
README identifies the RLE gates as designs in the repository but supplies no
reuse terms. The paper identifies the repository as supplementary software and
licenses the paper itself under CC BY 4.0; it does not explicitly grant a
license for the supplementary RLE assets.

Accordingly, do not copy these RLE strings into a shipped module yet. The
verified source file SHA-256 values are retained here for a future permission or
licensed-source audit:

| File | SHA-256 |
| --- | --- |
| `and-en-e.rle` | `0fef9d77de42e8d00241a985f4e14f53609d91838ae89e0935520b1739edb3be` |
| `or-en-e.rle` | `41db119b1cb47f8e674c884a7d753e291ca4fadafd33559ac606e8f7ff71f716` |
| `not-e-e.rle` | `1e54c37cc365ef65ef776f6679592e44c992af073e895d58395fb96349617842` |
| `half-adder-ee-ee.rle` | `4e44625cf8fc7657ca43f745d84dac83499579d0f4fd414fb8e45a01c4203795` |
| `terminator-e.rle` | `0ad47641ac6628e254f79fffcafadbeda1c93dfed3ca768b0d0823f69fb5b19e` |

## Reproducible geometry and observations

Downloaded research files: `and-en-e.rle`, `or-en-e.rle`, `not-e-e.rle`,
`half-adder-ee-ee.rle`, `terminator-e.rle`. Temporary copies existed in
`/private/tmp/` on 2026-09-08; the scratch verification program was
`/private/tmp/circuit-facts-final.mjs`. These paths are ephemeral; retrieve
upstream files if absent and record the commit/hash used for final validation.

Raw RLE has no headers. Preserve origin offsets, including isolated cells at
(0,0). OR can extend to x=151 and half-adder to x=301, outside nominal tile
dimensions. Do not crop to 150/300 or normalize away ports.

Use bounded B3/S23 boards, gate origin (480,20):

| Experiment | Board | Nominal tile size | Observe generation |
| --- | --- | --- | --- |
| AND, OR, NOT | 800×650 | 150×150 | 600 |
| Half-adder | 950×340 | 300×300 | 1200 |

Stamp the gate at origin. Stamp terminator at origin+(size,0); half-adder has
another terminator at origin+(300,150).

Eastbound LWSS raw RLE: `$5bo2bo$9bo$5bo3bo$6b4o!` (preserve leading offset).
Northbound LWSS raw RLE: `2b3o$bo2bo$4bo$4bo$bobo!`.

Initialize finite packet trains for k=1..14; no runtime signal injection:

- A=1: eastbound LWSS at origin+(-5-30k,70).
- Half-adder B=1: eastbound LWSS at origin+(-5-30k,220).
- AND/OR B=1: northbound LWSS at origin+(70,160+30(k-1)).
- A/B=0: omit that train.

Observe live-cell population in a 12×12 probe centered at
origin+(size,75). Half-adder carry probe is centered at origin+(300,225).
The prior scratch run observed population 0 for low, 9 for high:

| A | B | AND | OR | Half-adder sum | Half-adder carry |
| --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | 0 | 0 |
| 0 | 1 | 0 | 1 | 1 | 0 |
| 1 | 0 | 0 | 1 | 1 | 0 |
| 1 | 1 | 1 | 1 | 0 | 1 |

NOT: A=0 → high; A=1 → low. Half-adder observations were stable in the tested
1140–1440-generation interval. Show settling before the valid observation
window; startup pulses must not be reported as settled results. Signals are
finite and eventually expire. Reset rebuilds the selected input configuration.
Labels may explain expected results, but actual output indicators must observe
the cells and respect phase/timing.

## Round 4 — branching circuits (2026-10-24)

Engine: `src/circuits.js` (`buildCircuit`, `validateCircuit`, `getCircuitTruthTable`,
`circuitPresets`, `CIRCUIT_MAX_CHAIN_GATES = 6`, `CIRCUIT_MAX_GATES = 10`). Sweep:
`scripts/verify-circuits.mjs`. The lab harness and its logs lived in the
worktree's `.scratch/` (not committed); the numbers below are copied from those
runs. Every measurement used this repository's bounded B3/S23 engine and the
five already-shipped CakeML tiles. No additional upstream tiles were fetched.

### Measured facts about the tiles

- The NOT's built-in signal is a p60 gun, not a finite train: with A=0 a packet
  passes the output probe every 60 generations from generation 48 onward (66
  packets by generation 4000). NOT(A) is therefore "high everywhere except the
  14 slots where the A train arrives"; its output never ends.
- Output trains are exact. For AND (a=b=1), OR (any high input) and NOT (a=0)
  the cells east of the tile equal a standard eastbound train for the next tile
  delayed by the latency (AND 300, OR 420, NOT 420), cell for cell, at the same
  LWSS phase as the input stamps. An AND preserves its input phase (it is a
  transparent wire); OR and NOT regenerate phase 0 whatever the input phase.
- Gates run on a 60-generation clock. A lone OR or NOT with its A train delayed
  by 360/420/480 generations reads correctly; delayed by 400 or 440 it reads 3
  or 0 cells. The AND's B train must likewise sit on the clock: with the
  standard northbound stamp, B offsets 0 and 4 (mod 30 cells) work, every other
  offset breaks the tile or kills the output.
- The shipped OR B stamp (10 rows below the tile) is mis-phased by one cell.
  Sweeping the B offset with a 40-packet B train: offsets 3 and 5 (mod 30) leave
  the OR tile intact with nothing escaping; offset 0 drops still-lifes south of
  the tile (one in its own B column), fires gliders south-east and north-west,
  and a 40-packet train destroys the tile (438 cells to 359). The OR's B path is
  also two slots faster than its A path (B packet j appears at output slot j-2),
  so a B train aligned with A is stamped at +63 (3 for phase, 60 for the slot).
  At that stamp the OR output is exactly 14 packets for 14-packet inputs and 20
  for 20 (plus two startup packets at slots -6/-5 that every OR emits with no
  inputs). Legacy 1-3 gate chains keep the old offset-0 stamp and the
  `OR_SOUTH_DELAYS` lattice so their boards stay byte-identical; every new
  layout uses +63.
- The AND leaks after a long B stream stops: with a B train covering slots
  -10..0 and nothing after, A packets at slots 1 and 2 pass (4 packets or fewer
  do not trigger it). This is why a never-ending (NOT-driven) signal may not
  drive an AND's B input: the probe would read the leak.

### Feeding a gate's B input from another gate

The B child is the same layout reflected across the anti-diagonal
(x, y) -> (hx + 149 - y, hy + 149 - x). Its output then travels north into the
parent's B column, its own A chain grows south and its own B inputs arrive from
the west, so a whole tree only grows west and south of its root. The reflection
turns a phase-0 eastbound train into a phase-2 northbound train (checked:
M(E2) equals the NORTH stamp, M(EAST) equals NORTH evolved 2 generations), so
the parent's acceptance was calibrated directly (parent tile at (x, y)):

| parent | child | A delay tA | child tile x | child tile y | result |
| --- | --- | --- | --- | --- | --- |
| AND | AND | 420 | x-4 | y+194 | slot-exact with 20-packet trains, no debris, both tiles intact (also y+191, +193, +196, +199, +200) |
| AND | AND | 420 | x-4 | y+158..169 | 14-packet probe check passes but 30 packets give 29 slots: one slot early |
| AND | OR | 480 | x-4 | y+164 | passes the 14-packet check at the model position; confirmed by the XOR preset rows |
| AND | NOT | 480 | x-4 | model position | fails: the never-ending stream leaks (slots 1-5 and 7 read high when they should be low) |
| OR | AND | 420 | x-3 | y+228 | slot-exact for 14 packets, but 30-packet B streams damage the OR tile |

Shipped rule: child tile at (x - 4, y + (tA - childDelay)/2 + 134), where
childDelay is the child's own A delay plus its latency, tA >= childDelay + 60,
and all delays are multiples of 60. An OR's B input must be a switch (an OR with
one gate operand puts it on the A side; two gate operands are rejected). An
AND's B input must carry a signal that ends (an AND with one NOT-driven operand
puts it on the A side; two are rejected).

### Layout algorithm

`layoutTree` works in the root's frame. A operands sit to the west, output lane
to input lane; a gap is free wire (2 generations per cell) and is used to delay
A when the B child is slower. Leaf trains are 14 packets stamped `tA/2` cells
further out. Obstacles (tiles inflated by 3, train strips, corridors) are
rectangles; when an A subtree and a reflected B subtree overlap, both are pushed
30 cells (A west, B south) until they clear, which keeps the timing exact. An
AND with two gate operands tries both hangings and keeps the smaller footprint.
Two outputs are stacked top to bottom; the faster output's terminator and probe
sit `(delay difference)/2` cells further east so one observation generation
serves both. Chains of 4-6 gates go through this engine (tiles at 480+150i,
observe 600 + upstream latency as before); chains of 1-3 keep the legacy code.

### Caps and the full adder

- `CIRCUIT_MAX_CHAIN_GATES = 6`: six tiles plus trains fit in 1414 x ~1700.
- `CIRCUIT_MAX_GATES = 10`: the random-tree sweep below used up to 9 gates.
- The full adder preset is defined as the honest 16-gate two-output tree
  (sum = XOR(XOR(a,b),c) with XOR = (NOT(x AND y)) AND (x OR y); carry =
  (a OR b) AND ((a AND b) OR c)) and `getCircuitTruthTable` gives its table, but
  `validateCircuit` rejects it ("Circuits here can use up to 10 gates."). Built
  on its own, the 12-gate sum needs a 2554 x 2511 board and 4620 generations per
  row; stacked with the carry it exceeds the 3000-cell ceiling, and no
  reordering of the XOR operands helped (2542 x 2481 at best). Future work: use
  the half-adder tile as an internal XOR block (two switch inputs, sum output
  into a chain, carry terminated), which would make the full adder about six
  tiles; its sum-output phase and clock tolerance still need the slot-exact
  checks above before shipping.

### Verification run

See the table appended below by `scripts/verify-circuits.mjs` (date, counts,
timing).

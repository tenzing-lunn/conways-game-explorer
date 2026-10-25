# Implementation status

Updated 2026-09-13 after the user's live playability correction request.

Execution plan: [IMPLEMENTATION-HANDOFF.md](IMPLEMENTATION-HANDOFF.md).
Accepted scope: [launch-product-spec.md](launch-product-spec.md).

## Current position

**Post-release correction:** the user's playthrough request exposed visible
defects missed by the earlier completion assessment. The corrections are live
in Worker `2180e7ac-9b4f-4f6f-a60a-11c1fa075acf`, with four new live
desktop/mobile regressions passing. See `playability-review.md`. This supersedes
the earlier implication that only posting access remained; launch usability
must be assessed from the actual experience. LinkedIn remains on hold until
the user reviews and explicitly approves the final post.

**R1 is approved by Astra on 2026-09-08.** T0 and its correction pass are complete.
T1 through T6 are complete. The project owner confirmed permission to include
the verified CakeML gate coordinates, with source credit retained. Astra has
implemented and verified all six blockers from the earlier R2 rereview. The
subsequent selection, duplicate-import, and completion-order corrections now
pass their desktop/mobile and real PostgreSQL regressions. **R2 passes the
user-requested current-agent rereview on 2026-09-12**; no separate reviewer/model
was launched. See `r2-review.md` for scope, fresh evidence, and retained limits.
**T7 is complete.** The disposable database/browser acceptance journey passes
on desktop and mobile. T7 fixed account-dialog focus containment/restoration and
a direct creator-route rendering race. The release evidence is in
`release-verification.md`. **R3 passes the requested current-agent rereview:**
Worker authentication lifetime, direct-link redirects, and snapshot SQL CHECK
are corrected. Wrangler 4.131.1 bundles and runs the September configuration;
real Worker authentication and desktop/mobile database journeys pass. See
`r3-review.md`. **T8 is complete:** production migrations 0002/0003 are applied,
Worker version `c88e2698-d13f-42c9-838b-a9e82a438452` is live, the desktop and
mobile two-user journey passes, fixtures are removed, and backup/rollback
references are recorded in `t8-release.md`. **R4 correction rereview approves
the final copy and real launch screenshot.** The user confirmed their personal
LinkedIn identity. Posting access is the sole remaining blocker. See
`r4-review.md`. T9 publication remains paused.

| Task | Owner model | Status | Evidence |
| --- | --- | --- | --- |
| T0 | Sol | Complete; R1 approved | `integration-contracts.md`; unit baseline below |
| T1 | Terra | Complete | Strict scanner/direct decoder, history/selection primitives, worker client, performance baseline and tests |
| T2 | Sol | Complete | Durable API/import/auth lifecycle implemented; disposable PostgreSQL proof passes |
| T3 | Terra | Complete | `src/circuits.js`, engine truth-table tests, and circuit provenance/credits |
| T4 | Terra | Complete | Shared shell/editor, local recovery, authentic circuit UI, responsive validation and design-system mapping |
| T5 | Sol | Complete | Contextual account flow, staged guest claim, public routes/metadata, Community integration and browser coverage |
| T6 | Luna | Complete | `user-help.md`, `credits.md`, `operations.md`, and held LinkedIn draft |
| T7 | Sol | Complete; R3 corrections verified and rereview passed | `release-verification.md`; `r3-review.md` |
| T8 | Sol | Complete; R4 corrections pending | `t8-release.md`; `r4-review.md` |
| T9 | Sol | Pending, posting access unresolved | No LinkedIn post created |

## Gate ledger

| Gate | Status | Review packet | Astra decision |
| --- | --- | --- | --- |
| R1 Contracts | Passed, 2026-09-08 | `integration-contracts.md`, baseline below | Astra approved after final corrections |
| R2 Integrated experience | Passed requested rereview, 2026-09-12 | `r2-review.md` | Current-agent review requested by user; no separate model review claimed |
| R3 Release readiness | Passed requested rereview, 2026-09-12 | `r3-review.md`, `release-verification.md` | Three defects corrected; actual Worker/DB/browser verification passed; no separate model review claimed |
| R4 Announcement | Copy/image/identity ready; access blocked, 2026-09-13 | `r4-review.md`, `t8-release.md`, `linkedin-launch-post.md` | Personal account confirmed; supported sign-in/posting access unavailable |

## Evidence rules

For each task, record files/commit, checks with actual outcomes and environment,
remaining defects, decisions and next action. Historical test results in the
handoff are not current verification. Attach screenshots for visual work and
real database evidence for ownership/lifecycle claims. Record review requests
and actual Astra decisions here; a coding agent cannot self-approve a gate.

At every gate, explicitly notify the user in the conversation using the
handoff's “Astra review needed” template and pause dependent work. There is no
background notification service or automatic model switch configured.

## T0 baseline — 2026-09-08

- Branch `main`, inspected HEAD `43e7563` (`feat: enable password account
  authentication`). No fetch was performed, so remote divergence was not
  reasserted.
- Starting tree preserved: 23 tracked files modified, plus untracked product
  docs/design assets, migrations 0002/0003, two server modules and three engine/
  editor modules. Tracked diff at capture: 1,913 insertions and 270 deletions.
  Untracked file contents are additional and are not included in that diff stat.
- Initial `npm test`: 166 tests, 164 passed, 1 failed, 1 skipped. The failure was
  the stale custom-dimension assertion described below.
- Correction verification: `npm test` now discovers 167 tests: 166 passed,
  0 failed and 1 skipped, duration about 0.66 s. The valid input 2000 remains
  2000, and a new over-limit case verifies both axes clamp to 2048.
- Skip: legacy Supabase live repository contract lacks `SUPABASE_URL` and
  `SUPABASE_ANON_KEY`. Supabase is historical compatibility, not launch proof.
- Engine reference/random/wrapping and new board-tool tests passed in this suite.
  Worker integration, full browser journeys, Worker build and real PostgreSQL
  lifecycle/migration tests were outside T0 and remain unverified.
- `git diff --check` passed with no whitespace errors after the T0 documentation
  edit.

## T0 decisions and current gaps

The contract settles board/session ownership, worker cancellation, serialization
limits, immutable publication, atomic guest import, API error shapes, username/
slug stability, recovery/deletion behavior and modular UI boundaries. It chooses
a vanilla modular UI replacement while preserving the pure domain modules.

Current code does not yet satisfy several contracts: history budgets each stack
separately; selection transforms lose empty margins; worker ready/error/cancel
and its client are absent; guest migration imports only the current version;
browser API errors lose structured status/details; public comments use a bare
timestamp cursor/array response; public snapshot SQL needs stronger constraints;
Node origin construction uses `127.0.0.1`; and the UI still mixes local profiles,
account state and monolithic workspace state. These are assigned to T1/T2/T4/T5.

## Astra R1 correction pass

The contract now makes signed-out Remix create a local Studio project immediately.
Account gating begins only at cloud/shared actions. Guest-history claim uses
bounded resumable version chunks followed by atomic activation of complete history;
local data is deleted only when its revision and digest still match the captured
import state. Save persists the authored start, while an explicit “Use current
state as start” promotes an evolved frame; the glider/run/save/reset example is
normative. Full valid boards use binary local recovery independent of the 5 MB
private cloud-version limit and the stricter 200 KB/200,000-cell public limit.

### Final R1 approval

Astra corrected the remaining contract gaps directly: Play/Step continue the
accepted working generation; the 40-version/20 MiB limits apply to upload batches,
with complete history activated together; and local revision checks, mapping
writes and conditional cleanup share one IndexedDB transaction across tabs.
Oversized or failed imports preserve local work and cannot silently truncate it.

These contracts are approved for implementation. The preceding 167-test result
remains the latest executable baseline; this approval changed documentation only.
Pending later evidence includes circuit asset permission, real database behavior,
rendered UX and LinkedIn access. R2–R4 remain pending.

## T5 — accounts, Community, and public pages

Completed 2026-09-09. The shared account dialog is available from every
workspace and uses the same Better Auth browser-repository actions for signup,
signin, recovery-key recovery, recovery-key rotation, and password-confirmed
deletion. It validates locally before requests, preserves the current workspace,
and resumes one queued publish, favorite, pattern favorite, or comment action
after a successful login. When the Community service is not configured, it
plainly says that cloud accounts are unavailable and keeps device drafts local.

Guest claim now captures a revisioned local snapshot, uploads a canonical
manifest and sequential bounded RLE chunks, completes atomically, then removes
only the unchanged captured local revision. A local edit during transfer is
retained. Community adds a Favorites route/filter, public feed/profile/comment
calls, reporting, attributed guest remixes, publish preview/readiness, version
restore, unpublish and republish controls. Node and Worker direct requests for
`/c/:slug` and `/u/:username` serve the application shell and inject escaped
public metadata from the published projection only; private drafts have no
public route or metadata path.

Validation: `npm test` passed 190/192 (two environment-gated database tests
skipped); the full Playwright desktop/mobile suite passed 18/20 with two
intentional mobile skips. It exercised account gating, contextual local
availability, direct `/c/famous-glider` reload, guest remix/reload, verified
circuit controls, Community filters, editor publishing, local recovery and
mobile overflow. `npm run build:worker`, syntax checks and `git diff --check`
passed. Browser-plugin support is unavailable, so Playwright was used. Final
account/Community evidence is `/private/tmp/life-lab-t5-community.png`.

The actual configured PostgreSQL two-user account/import/publish/remix journey
is not inferred from local fallback tests; T2's disposable lifecycle proof
covers the data boundary, and T7 must run the complete browser-to-database
acceptance journey before R3. R2 remains gated on T6 as well.

## T4 — shared shell, Playground, and Studio

Completed 2026-09-08. The vanilla ES-module shell now keeps Playground, Studio
and Community sessions in one board-first charcoal interface. `docs/design/
design-system.md` records the accepted concept mapping, tokens, responsive
behavior, interaction states and the deliberate use of real Life geometry in
place of illustrative art.

The editor preserves an authored start, supports reset, undo/redo, selection
copy/paste/rotation, pan, zoom and fit, and retains local recovery across reload.
Studio now renders only the T3 verified AND, OR, NOT and half-adder experiments:
finite inputs are toggled in visible ports and a Worker-backed run-until-output
reports measured probe cells only after the documented settling generation.
The prior fabricated XOR claim was removed. Browser validation also found and
corrected a trailing-dead-run RLE serialization bug that prevented a second
saved version after sparse edits.

Correction pass: first visit now hides the optional rules layer immediately;
the visible shared shell is the approved Life Lab top header with Playground,
Studio and Community tabs, a left pattern/tool rail, central board and compact
transport. The stale loading screenshots must not be used as evidence. Final
reviewed captures are `/private/tmp/life-lab-final-desktop.png` and
`/private/tmp/life-lab-final-mobile.png`, compared against
`docs/design/playground-concept.png`. A Chromium direct-entry interaction check
confirmed both desktop and mobile hide the intro and change population to one
after a board click. `node --check src/app.js` and `git diff --check` passed.
The full browser suite remains T7's cross-account/release verification scope;
R2 waits for T5 and T6.

## T3 — authentic circuits

Started 2026-09-08. The documented AND, OR, NOT and binary half-adder recipe
was re-run with `createLifeStepper` in bounded B3/S23 mode using only initial
cells: AND/OR/NOT read at generation 600 and the half-adder at generation 1200
match the stated truth tables. The probes observe evolving live cells (nine for
high, zero for low); no boolean values were synthesized. The half-adder remains
stable through the documented 1140–1440 window, and reset must rebuild finite
input trains rather than inject a signal at runtime.

CakeML's exact `c3439fc4c24948f93945c75c973e56ed4a001ad6`
repository metadata has no license, its license endpoint is absent, and its
README provides attribution but no asset reuse permission. The CC BY 4.0 paper
links to it as supplementary software but does not expressly license the RLE
files. On 2026-09-08 the project owner confirmed permission to use these
coordinates. `src/circuits.js` therefore bundles the five verified assets with
source credit, exposes editable authored boards, finite A/B input trains,
visible probe metadata, bounded stepping, reset/rebuild, and cell-observed
outputs that remain unset until each experiment's documented measurement.

`src/circuits.test.js` evolves all fourteen AND/OR/NOT/half-adder input cases
through the shipped engine and asserts observed output populations of zero or
nine cells at generation 600/1200. It also proves startup pulses are not
reported as boolean values and reset rebuilds the authored board. Focused
validation passed 3/3 in about 4.2 seconds. Full `npm test` passed 181/183;
the two environment-gated disposable PostgreSQL and legacy Supabase tests
remained skipped, with no failures.
The source revision, evidence hashes and reproducible recipe remain in
`circuit-research-handoff.md`. This does not trigger R2.

## T1 — simulation and editor primitives

Completed 2026-09-08. `src/patterns.js` now performs strict B3/S23 RLE scanning
with required termination and bounds/run validation. `forEachRleCell` lets
`boardFromRle` decode a complete 2048² board without allocating coordinate pairs;
pattern coordinate collection remains capped for stamps. `src/board-tools.js`
now preserves rectangular selection margins during transforms, provides clipboard
geometry helpers and enforces one combined 24 MiB/40-entry undo-redo budget.

`src/simulation-client.js` owns loaded snapshots, uses epoch/request IDs and
rejects stale/cancelled/error operations. The Worker now signals readiness and
errors and accepts cancellation. The existing legacy animation loop also bounds
main-thread catch-up at four generations per frame until T4 connects the Worker
client to the redesigned editor.

Measured engine-only performance is in `docs/simulation-performance.md`:
Apple M2 medians range from 0.03 ms/generation for a sparse 300×200 board to
about 31–33 ms/generation for dense 2048² boards. Rendering and transfer costs
remain a T4/T7 verification concern.

Validation: focused engine/RLE/history/worker-client suite passed 32/32;
full `npm test` passed 174/175, with one expected legacy Supabase skip. Pending
T1 integration is intentional: T4 owns replacing the legacy app shell and
connecting the client to the visible editor. R2 is not due until T1–T6 integrate.

## T2 — data, accounts, and public API

Completed 2026-09-08. Migration `0003_public_lab.sql` closes JSON NULL/type
holes, makes usernames and creation slugs globally unique, proves current and
published versions belong to their creation, allows 5 MB private RLE, and adds
bounded import staging. Publication retains an immutable version and metadata
snapshot while later private saves advance only the editable head.

Every cloud version is strictly parsed as B3/S23. Dimensions and settings must
agree, population is derived, private and public byte limits remain separate,
and publication also caps live cells. Owner writes use row locks and stale-head
checks. Public reads expose one published snapshot, stable feed/comment cursors,
viewer booleans, public profile fields and public lineage without private
history. Comments, pattern favorites, reports, structured errors, request
limits, Node origin reconstruction and rate-limit cleanup share the Node/Worker
route layer.

Guest claim now uses durable start/manifest/version-chunk/complete endpoints.
Retries are content checked, imports activate all versions in one final
transaction, local parent IDs receive stable cloud mappings, incomplete staging
is invisible, and inactive staging expires after seven days. The client-facing
digest and route details are in `backend-api-contract.md`; T5 owns the IndexedDB
revision check and conditional local deletion transaction.

Recovery keys require the existing password, rotate on creation and use, reject
reuse, and revoke sessions after recovery. Better Auth password-confirmed
deletion uses database cascades: owned work and account records disappear while
comments on other creators' work remain with a null author. Current Better Auth
user/account docs and current Cloudflare Worker guidance/types were checked.
Worker compatibility is dated 2026-09-08 and creates its Hyperdrive-backed pool
per request.

Validation: `npm test` passed 178/180 with the disposable PostgreSQL and legacy
Supabase tests skipped when their environment variables are absent;
`npm run build:worker`, syntax checks and `git diff --check` passed. The explicit
disposable PostgreSQL harness created a random database, applied migrations
0001–0003, ran Better Auth signup/password deletion and the two-user ownership,
snapshot, stale-write, chunk-retry/import, recovery/session and deletion-policy
checks, then dropped the database. It passed 1/1 in about 3.9 seconds. Production
remains unchanged for T8. R2 is not due until T1–T6 are integrated.
## T6 — help, credits, operations, and launch draft

Completed 2026-09-09. Added [`user-help.md`](user-help.md) with the implemented
B3/S23 rules, simultaneous update explanation, Playground/Studio controls,
local versus cloud storage, recovery-key behavior, board/publication limits,
measured performance guidance, authentic circuit behavior and credits,
community/privacy boundaries, reporting, and account/project deletion behavior.
Added [`credits.md`](credits.md) with the CakeML provenance, inspected commit,
owner authorization, and the upstream licensing limitation. Added
[`operations.md`](operations.md) with server-secret boundaries, routine checks,
moderation boundaries, and a backup/restore/rollback procedure reserved for
T8.

Prepared [`linkedin-launch-post.md`](linkedin-launch-post.md) as a held draft
for R4. It describes the shipped scope without claiming launch success, a full
CPU/calculator, or a final deployment. The previously inspected Worker URL is
marked as needing final T8 verification before it can be used as a live link.

Documentation consistency validation: `rg` reviewed claims against
`launch-product-spec.md`, `integration-contracts.md`, `backend-api-contract.md`,
`simulation-performance.md`, `circuit-research-handoff.md`, the account
security module, and migrations; `git diff --check` passed. No application,
server, migration, deployment, or external publication files were changed for
T6. Remaining release facts belong to T7/T8: current full integrated evidence,
production backup/migration/deployment, live URL verification, and Astra R2.

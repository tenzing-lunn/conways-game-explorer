# Life Lab UI map

Stable ids and data attributes, by screen. Tests and later agents can rely on these.
`window.__lifeLab.snapshot()` returns `{ generation, population, width, height, tool, mode, zoom, minZoom, panX, panY, playing, circuit, gates, spec, inputs, selection }` (`spec` is the open circuit as formula strings, e.g. `["OUT = (A AND B) OR C"]`; `gates` is the gate list when it is a plain chain); `window.__lifeLab.liveCells()` returns live `[x, y]` pairs; `window.__lifeLab.circuitGeometry()` returns `{ tiles, ports, outputs }` in cells for the open circuit (or `null`). Test probes: `window.__lifeLab.renderTime(frames)` (average ms of a forced full render), `window.__lifeLab.panFrameTime()` (ms of a render after a 1px pan), `window.__lifeLab.resizeBoard(width, height)` (resizes the board like the Grid size control and returns the new size).

## Top bar (every screen)

- `#top-bar` — the 52px header.
- `#brand` — "Life Lab" home link.
- `#mode-playground`, `#mode-studio`, `#mode-community` — section tabs; the active one has `aria-current="page"`.
- `#top-menu-toggle` — phone-only ⋯ that opens `#top-menu`.
- `#top-menu` — theme and account group (`data-open` on phone).
- `#theme-toggle` — sun/moon; `aria-pressed="true"` in dark mode; persists in `localStorage["life-theme"]`.
- `#account-entry` / `#account-entry-label` — "Sign in" or the account name; hidden when the runtime backend is local.
- `body[data-mode]` — `playground | studio | community`; `body[data-studio-view]` — `project | projects`.

## Rail (Playground and Studio)

- `#rail` — left rail; on phone a bottom sheet with `data-open="true|false"`.
- `#rail-title` — "Patterns" or "Components".
- `#rail-close` — phone sheet close.
- `#rail-kind-tabs` with `[data-rail-tab="patterns|logic"]` — Studio only.
- `#pattern-panel`, `#pattern-search`, `.rail-panel-head` (sticky: search + tabs) > `.pattern-tabs-wrap` > `#pattern-tabs` (desktop: wraps so every tab shows; phone: one scrolling row where `data-overflow="start|end|start end|none"` fades the edge with more tabs) with `[data-pattern-tab="start|motion|basics|showcase|masterworks"]` (the Masterworks group is the last tab; search spans every group), `#pattern-list`.
- `[data-pattern-id="<preset id>"]` — pattern cards (`random-soup`, `glider`, `gosper-gun`, …); click enters Stamp; `aria-pressed` while stamping it.
- `[data-masterwork-id="<id>"]` — Masterworks cards (`.card-masterwork`): a `<button>` for loadable works (click replaces the board with the pattern centred on bounded edges, growing the board to the work's recommended size first; one undoable step; toast "Board grew to W × H to fit <name>. Undo to go back." when it grew; while cells are still arriving the card is disabled with `aria-busy="true"` and its size line reads "Loading…") or a `<div class="card-reference">` with `a.card-link` ("Read about it", opens the source in a new tab) and `.card-reason` for reference-only works. Text: `.card-name`, `.card-meta` (discoverer · year), `.card-note` (never clamped), `.card-size` ("W × H cells · Load"). Loadable thumbnails show the cells scaled down, or `.card-thumb-load` (play mark) for works fetched on demand; reference cards use the dashed `.card-thumb-link`.
- `#logic-panel`, `#logic-list` with `[data-gate-id="and|or|not|half-adder|xor"]` — gate and ready-made circuit cards (a preset the engine rejects, such as the 16-gate full adder, gets no card); `aria-pressed` on the card that matches the open circuit (a single gate, the half-adder, or an unedited XOR).
- `#sheet-backdrop` — dims the screen behind an open phone sheet; tap closes.

## Canvas frame (Playground and Studio)

- `#board-column`, `#canvas-frame`, `#canvas-host`, `#world` — the board canvas.
- `#tool-strip`
  - `#tool-group` with `[data-tool="draw|select|stamp|pan"]` (`role="radio"`, `aria-checked`).
  - `#selection-group` (shown with a selection) with `[data-selection-command="copy|paste|rotate|flip|delete|deselect"]`.
  - `#stamp-group` (shown in Stamp): `#stamp-name`, `#stamp-rotate-left`, `#stamp-rotate-right`, `#stamp-flip` (`aria-pressed`), `#stamp-done`.
  - `#undo`, `#redo`.
  - `#more-menu-toggle` → `#more-menu`: `#clear-board`, `#import-rle`, `#export-rle`, `#open-in-studio` (Playground only; starts a Studio project from the sketch), `#fit-mobile` and `#how-life-works-mobile` (phone), `#shortcuts` (desktop).
- `#status-mobile` — phone "Gen N · M cells" line.
- `#rules-popover` — "How Life works".
- `#circuit-bar` (phone, Studio with a circuit open): `#circuit-bar-lamps` with `.bar-lamp[data-bar-output]` (name + `.lamp[data-state]`), `#circuit-bar-progress`, `#run-circuit-bar` (40px). Run in the Experiment sheet closes the sheet on phones so the board shows the run.
- `#transport`: `#play-toggle` (`#play-label`), `#step`, `#reset`, `#speed-toggle` (`#speed-label`) → `#speed-menu` with `[data-speed="1|2|5|10|20|40"]` (`aria-checked`), `#zoom-out`, `#zoom-label`, `#zoom-in`, `#fit`, `#patterns-open` (phone sheet).
- Zoom floor: 10% for boards that fit at 10%; larger boards lower it so Fit always shows the whole board (`snapshot().minZoom`). Cells under 1.5 px on screen are drawn through a downsampled bitmap (a pixel lights when any cell under it is alive).
- `#status-line`: `#status-text`, `#generation`, `#population`, `#population-unit` ("cell"/"cells"), `#how-life-works`.

## Studio

### Project header
- `#project-header` — shown in Studio with a project open.
- `#projects-back` — "Projects" list.
- `#project-title` — editable title input.
- `#save-state` — `data-status="new|dirty|saving|saved|failed|offline"`; text "Not saved yet" until the first save.
- `#inspector-toggle` — phone "Experiment" button that opens `#inspector`.
- `#save-project`, `#publish-project` (desktop), `#publish-project-mobile` (in the inspector on phone).
- `#project-menu-toggle` → `#project-menu` — on desktop and phone, hidden until the project is saved: `#unpublish-project` (only when public), `#archive-project`, `#delete-project`.

### Inspector
- `#inspector` — right panel; on phone a bottom sheet with `data-open`; `#inspector-close`.
- `#experiment-heading` (desktop), `#grid-size` (`small|medium|large`, `current` = the board's own size when it matches no preset, `custom` = "Custom…" which opens `#grid-custom` with `#grid-width`, `#grid-height` (40–3000) and `#grid-apply`), `#edges` (`wrapped|bounded`).
- `#circuit-section` (shown with a gate loaded): `#circuit-heading`, `#circuit-name` (the card's note, or "N gates. Choose any part of the formula to change it.").
- `#formula-list` (hidden for the half-adder): one `.formula-row[data-output-index]` per output reading like algebra — `.formula-label` ("OUT =", "SUM =", "CARRY ="), chips and `.formula-paren` spans.
  - `.chip[data-chip="input"][data-output][data-path="a.b"][data-input="a"]` — an input letter; its menu offers "Use A/B/…" (reuse or add a letter) and "Replace with AND/OR/NOT" (grow a gate here).
  - `.chip[data-chip="gate"][data-output][data-path][data-gate="and|or|not"]` — a gate; its menu offers "Remove this gate".
  - `.chip-add#add-gate-<output id>` (`#add-gate-out`; `#add-gate-sum`/`#add-gate-carry` for a two-output tree; `data-chip="add"`) — "Add gate" wraps that output's whole expression in AND/OR/NOT.
  - Chips carry `aria-haspopup="menu"` and `aria-expanded`; `data-path` is the slot path from the output's root (`a`/`b` steps).
- `#chip-menu` — the one floating menu every chip opens (body-level, `position: fixed`); items `[data-chip-action="use|grow|wrap"][data-value="<letter or gate>"]` (wrap items read "Wrap in AND/OR/NOT") and `[data-chip-action="remove"]`; an item that cannot be built is `disabled`, and each group is followed by one `.menu-reason` line per distinct reason (also in `title`). Escape or a click elsewhere closes it.
- `#chain-note` — shown when no gate can wrap the first output, with the engine's reason ("Up to 6 gates in one chain.", "Circuits here can use up to 10 gates.") or for the half-adder ("Standalone component.").
- `#inputs-list` with `[data-input="a".."h"]` switches (`role="switch"`), one per distinct letter; each row's `<small>` names the gates it feeds ("feeds AND and OR"); `#inputs-note` appears when a gate is drawn on its side.
- `#outputs-list` with `.lamp-row` per output: the label ("OUT", "SUM", "CARRY"; "Sum"/"Carry" for the half-adder) and `.lamp[data-output="out|sum|carry"][data-state="unset|settling|low|high"]`. Once the truth table is filled, the lamps show the measured row for the switches as set.
- `#run-circuit`; `#run-progress` (`aria-valuemax` = observation generation, `aria-valuenow`), `#run-progress-bar`, `#run-progress-text` ("generation g / N", or "Row k of n" during Run all).
- `#fill-truth-table`, `#truth-table` (one column per input and per output; `td.high|low|pending`; the caption states the row count and a time estimate above four inputs, and Run all confirms before starting those).
- Persistence: Studio saves `creation.previewConfig.circuit` as `{ outputs: [{ id, label, tree }], inputs }` (or `{ gates: ['half-adder'], inputs }`); the older `{ gates: [...], inputs }` chain form and `{ preset, inputs }` still open.
- `#details-heading`, `#project-description`, `#project-tags`.
- `#history-heading`, `#version-history` with `[data-restore-version-id]`.

### Projects page
- `#projects-page`, `#new-project`, `#projects-list` with `[data-project-id]` cards.

## Community

- `#community-panel`, `#community-gallery`.
- `#community-search`; `#community-filters` with `[data-community-filter="all|famous|trending|new"]` (`aria-selected`).
- `#community-status`; `#community-grid` with `.community-card[data-creation-id]` and the Open button `[data-community-action="open"][data-creation-id]`.
- `#community-detail`: `#community-back`, `#detail-preview`, `#detail-title`, `#detail-author`, `#detail-description`, `#detail-tags`; actions `[data-community-action="play|remix|star|share|report|browse|creator"]` (`data-creation-id`, `data-username`); comments `#comments-list`, `#comment-body`, `#post-comment`.
- Routes: `/community`, `/c/<slug>` (public creation), `/u/<username>` (creator).

## Dialogs and feedback

- `#account-dialog`: `#account-dialog-title`, `#account-close`, `#account-context`, `#account-tabs` with `[data-account-mode]`, `#account-fields` with `[data-account-field]`, `#account-name`, `#account-email`, `#account-recovery-key`, `#account-password`, `#account-output`, `#account-recovery-output`, `#account-submit`, `#account-security`, `#account-create-recovery`, `#account-sign-out`, `#account-delete-confirmation`, `#account-delete`.
- `#rle-dialog`: `#rle-dialog-title`, `#rle-close`, `#rle-note`, `#rle-field`, `#rle-error`, `#rle-copy`, `#rle-stamp`.
- `#shortcuts-dialog`: `#shortcuts-title`, `#shortcuts-close`.
- `#toast` — `data-kind="info|success|error"`; outcome messages only, auto-dismiss 2.5s; sits above the transport (desktop) or above the bottom controls and any open sheet (phone).
- `#life-runtime-config` — JSON script tag the server fills with the backend config.

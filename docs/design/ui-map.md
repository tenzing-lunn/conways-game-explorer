# Life Lab UI map

Stable ids and data attributes, by screen. Tests and later agents can rely on these.
`window.__lifeLab.snapshot()` returns `{ generation, population, width, height, tool, mode, zoom, panX, panY, playing, circuit, gates, selection }`; `window.__lifeLab.liveCells()` returns live `[x, y]` pairs.

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
- `#pattern-panel`, `#pattern-search`, `#pattern-tabs` (group chips), `#pattern-list`.
- `[data-pattern-id="<preset id>"]` — pattern cards (`random-soup`, `glider`, `gosper-gun`, …); click enters Stamp; `aria-pressed` while stamping it.
- `#logic-panel`, `#logic-list` with `[data-gate-id="and|or|not|half-adder"]` — gate cards; `aria-pressed` when that single gate is loaded.
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
- `#transport`: `#play-toggle` (`#play-label`), `#step`, `#reset`, `#speed-toggle` (`#speed-label`) → `#speed-menu` with `[data-speed="1|2|5|10|20|40"]` (`aria-checked`), `#zoom-out`, `#zoom-label`, `#zoom-in`, `#fit`, `#patterns-open` (phone sheet).
- `#status-line`: `#status-text`, `#generation`, `#population`, `#how-life-works`.

## Studio

### Project header
- `#project-header` — shown in Studio with a project open.
- `#projects-back` — "Projects" list.
- `#project-title` — editable title input.
- `#save-state` — `data-status="new|dirty|saving|saved|failed|offline"`; text "Not saved yet" until the first save.
- `#inspector-toggle` — phone "Experiment" button that opens `#inspector`.
- `#save-project`, `#publish-project` (desktop), `#publish-project-mobile` (in the inspector on phone).
- `#project-menu-toggle` → `#project-menu` — hidden until the project is saved: `#unpublish-project` (only when public), `#archive-project`, `#delete-project`.

### Inspector
- `#inspector` — right panel; on phone a bottom sheet with `data-open`; `#inspector-close`.
- `#experiment-heading` (desktop), `#grid-size` (`small|medium|large|custom`), `#edges` (`wrapped|bounded`).
- `#circuit-section` (shown with a gate loaded): `#circuit-heading`, `#circuit-name`.
- `#chain-row` (AND/OR/NOT chains; hidden for the half-adder):
  - `#chain-list` with `.chain-chip[data-chain-gate="and|or|not"]` in order and `[data-remove-gate="<index>"]` (only when more than one gate).
  - `#add-gate` (`aria-expanded`, disabled at three gates) → `#add-gate-menu` with `[data-add-gate="and|or|not"]`.
  - `#chain-note` — "Up to 3 gates." or "Standalone component.".
- `#inputs-list` with `[data-input="a|b|c|d"]` switches (`role="switch"`); each row's `<small>` names the entry gate ("→ AND", "↑ OR").
- `#outputs-list` with `.lamp[data-output="out|sum|carry"][data-state="unset|settling|low|high"]`.
- `#run-circuit`; `#run-progress` (`aria-valuemax` = observation generation, `aria-valuenow`), `#run-progress-bar`, `#run-progress-text` ("generation g / N", or "Row k of n" during Run all).
- `#fill-truth-table`, `#truth-table` (`td.high|low|pending`).
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

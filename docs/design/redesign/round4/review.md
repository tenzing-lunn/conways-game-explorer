# Fresh-eyes review, round 6: snapshot of redesign/ui @ 441a064

I served the snapshot on PORT 4381 and stopped it when I was done.
- Screenshots: `S=/private/tmp/claude-501/-Users-tenzinglunn-Desktop-Code-Conway-s-Game/113e2a2e-ccea-4ed3-85a7-d81e843f06d9/scratchpad/review-r6`. The capture.mjs output is in `$S/shots/` and my walk-through shots are in `$S/w/`.
- Scripts: `$S/desk.mjs`, `t7.mjs`, `phone.mjs`, `misc.mjs`, `phone-top.mjs`, `contrast.mjs`, `chain6.mjs`. Logs: `$S/*.log`.
- Errors and scroll: I ran desktop 1440×900 and iPhone 13, in light and dark, on `/`, `/studio` and `/community`. Every run logged **zero page errors and zero console errors or warnings**, and `scrollWidth − innerWidth = 0` everywhere.

## Scores
Functionality: 9  Clarity: 8  Visual: 8  Mobile: 8  → PASS

## Previous round's 7 defects

| # | R5 defect | Status | Evidence |
|---|---|---|---|
| 1 | Desktop Masterworks tab invisible and out of reach | **Fixed** | The tab row now wraps. Masterworks sits on row 2 at (16, 177), 95 × 30, and is visible on first load in both themes, in Playground and in Studio's Patterns tab. Shots: `$S/w/desk-light-tabs.png`, `$S/shots/desktop-playground.png`, `$S/shots/desktop-dark-studio.png` |
| 2 | Phone `#grid-size`, `#edges` and `#project-title` are 32 px | **Fixed** | All three are 40 px or more. An automated audit of every visible button, link, select, input, switch, tab and chip found **zero** targets under 40 px. It covered the Playground, the Patterns sheet, the Studio header, the Logic sheet, the Experiment sheet and the Custom grid fields. Shot: `$S/w/phone-light-t6-ha-inspector.png` |
| 3 | Canvas label "OR (turned)" | **Fixed** | The tile now just reads "OR". The inspector explains: "Some gates are drawn on their side so a second gate can feed them." Shot: `$S/w/desk-light-t6-xor-open.png` |
| 4 | Toasts cover content in use | **Partly** | Fixed on desktop: the stale "Truth table complete" toast is cleared when you open XOR. Fixed on phone: the run toast is gone when you reopen the sheet. **Still open:** on phone, Run all's "Truth table complete" toast lands on top of the open Experiment sheet's formula chips and switch rows (new defect 2). |
| 5 | Phone status line sits on circuit lanes | **Fixed (cosmetic residue)** | `#status-mobile` now has an 85 % surface backing. A lane still faintly shows through the digits (new defect 6). Shot: `$S/w/phone-dark-t6-xor-closed.png` |
| 6 | Rail search and tabs scroll away | **Fixed** | `.rail-panel-head` (search and tabs) stays pinned: after scrolling to OTCA it is at y = 102–211. Cards slide under it, which is normal sticky behaviour. Shot: `$S/w/desk-light-t5-rail-scrolled.png` |
| 7 | Saved circuit reopens on the Patterns rail tab | **Fixed** | After Save and reload, `[data-rail-tab="logic"]` has `aria-selected="true"` and the formula is restored. Shot: `$S/w/desk-light-t7-after-reload.png` |

## Defects (ordered by severity; each with exact repro, viewport, and screenshot path)
1. **Dark theme: input switches in the off state are nearly invisible** (desktop and phone, dark only).
   - Repro: set dark theme → /studio → Logic → AND (or Half-adder) → look at the B switch (off). On phone, open Experiment.
   - The off track is `rgb(44,44,44)` on the inspector's `rgb(28,28,28)`, a contrast of about 1.2 : 1. WCAG non-text contrast needs 3 : 1.
   - The knob (`::after`) is `rgb(28,28,28)`, the exact surface colour, so it vanishes.
   - The control a T3/T6 user must find ("flip A and B on") reads as a faint smudge until it is turned on.
   - Shots: `$S/w/phone-dark-t6-ha-inspector.png` (both switches off), `$S/w/desk-dark-t6-xor-table.png` (B switch)
2. **Phone: the "Truth table complete" toast covers the sheet you are working in** (iPhone 13, both themes).
   - Repro: /studio → Patterns → Logic → XOR → Experiment → Run all, then wait about 8 s.
   - The sheet stays open. The toast appears at CSS y ≈ 492–527 and sits on top of the formula chips (A / OR / B) and, after scrolling, on the "A feeds AND and OR" / "B feeds…" rows for about 2.5 s.
   - Toasts should avoid the open sheet's content, or appear above the sheet's top edge.
   - Shots: `$S/w/phone-light-t9-grid-custom.png`, `$S/w/phone-light-t7-chip-menu.png`
3. **Auto-fit and Fit cut off a bottom input port's label after a branch edit** (desktop 1440×900, light; geometry-dependent).
   - Repro: /studio → Logic → AND → Add gate → Wrap in AND ×5. The 6th attempt is blocked with "Up to 6 gates in one chain.".
   - Then click the last input chip (G) → Replace with AND.
   - `circuitGeometry()` puts port G on the south side at (1663, 1263). At the fitted zoom (0.0506) that lands on the canvas's bottom edge, so the "G ↑" label is not drawn on screen. The new tile's bottom dashed edge touches the transport.
   - Pressing Fit changes nothing: zoom and pan are identical. A user can't see where input G enters.
   - Shots: `$S/w/desk-light-chain7.png`, `$S/w/desk-light-chain7-fit.png`
4. **Phone: after the first Save, the default title truncates to "Untitled p…"** (iPhone 13, light).
   - Repro: /studio → Save.
   - A ⋯ "Project options" button (`#project-menu-toggle`) appears in the header and squeezes `#project-title` to 103 px.
   - Round 5 fixed exactly this truncation for the unsaved state; it is back as soon as the project is saved.
   - Shot: `$S/w/phone-light-header-saved.png`
5. **Dark theme: the theme toggle is a filled blue tile** (desktop, dark).
   - `#theme-toggle[aria-pressed="true"]` gets the accent-soft fill. It is the only filled control in the top bar, and in light mode the same button is plain. It reads as "selected" rather than as a sun/moon switch.
   - Shots: `$S/w/desk-dark-topbar-toggle.png`, `$S/shots/desktop-dark-studio.png`
6. **Minor polish** (each small, listed for completeness):
   - **(a) Chip menu has no right gutter.** On desktop, the chip menu opened from an input chip near the inspector's right side runs flush to the viewport's right edge (x = 1207–1440), with no gutter. Shot: `$S/w/desk-light-t7-disabled-menu.png`
   - **(b) Lane shows through the phone status line.** The 85 % backing on `#status-mobile` still lets the "A ↑" lane show through the digits ("1,|394"), most visibly in dark. Shot: `$S/w/phone-dark-t6-xor-closed.png`
   - **(c) Uneven tab underline on desktop.** Masterworks sits alone on row 2. The active underline under "Start" (row 1) has no baseline, while the hairline runs under row 2, so the row looks slightly uneven. Shot: `$S/w/desk-light-tabs.png`
   - **(d) "Load" wraps on the OTCA card.** On desktop, the OTCA card's size line breaks "Load" onto its own line ("2,058 × 2,058 cells · / Load"). Shot: `$S/w/desk-light-t5-rail-scrolled.png`

## What is good (keep)
- **T1–T4 pass in every configuration.**
  - Drag-draw adds cells (desktop 5 → 20, phone 5 → 14).
  - Play advances (gen 12 in 1.2 s), and Pause stops it.
  - Glider search → card → stamp preview → place: +5 cells. On phone, picking the card closes the sheet and enters Stamp.
  - Community → Open → Play lands on `/` running the gun (gen 15, 42 cells).
- **T3/T6 lamps are correct.**

  | Circuit | Inputs | Lamps |
  |---|---|---|
  | AND | A=1 B=1 | HIGH |
  | AND | A=1 B=0 | LOW |
  | Half-adder | A=1 B=0 | Sum HIGH, Carry LOW |
  | Half-adder | A=1 B=1 | Sum LOW, Carry HIGH |
  | XOR | A=1 B=0 | HIGH |

  - Flipping a switch resets the lamp to unset.
  - Run all fills 4 correct rows: Half-adder in 3.6 s, XOR in 7.8 s, the same on phone.
  - There is no Full adder card (cards: and, or, not, half-adder, xor).
- **T7 works with four chip actions and no docs.** From the OR card: Add gate → Wrap in AND; C → Replace with OR; C → Use A; D → Use C (new). That gives `OUT = (A OR B) AND (A OR C)`.
  - The 8-row table is correct (= A or (B and C)) and fills in 15.4 s.
  - Save → "Saved on this device" → reload keeps the formula and the Logic tab.
  - Remove this gate works.
  - Blocked items are disabled with a reason shown in the menu:
    - OR with two gate operands: "An OR gate can take only one other gate as an input here; its other input must be a switch."
    - AND with two NOT-driven operands: "An AND gate can take at most one input that runs through a NOT gate."
    - Chain cap: "Up to 6 gates in one chain."
    - Circuit cap: "Circuits here can use up to 10 gates."
  - The cap reasons also show in `#chain-note`.
- **T5 Masterworks.**
  - All 13 notes are complete (0 clipped) and say why each work matters.
  - Loadable cards (solid box, "· Load") and reference cards (dashed box, external-link icon, "Too large to run here: …", "Read about it ↗", `target=_blank rel=noopener` to the matching conwaylife.com wiki page) are clearly different.
  - Sir Robin grows the board to 720 × 400, shows the toast "Board grew to 720 × 400 to fit Sir Robin. Undo to go back.", and runs.
  - OTCA grows the board to 2400 × 2400 (64,691 cells) and fits at 3 % on desktop and 1.6 % on phone. The longest frame gap was 217 ms, so nothing froze. It plays.
  - Undo restores 720 × 400 with the exact population; a second Undo restores 300 × 200 / 25.
- **Large boards.** Custom grid shows Width × Height, "40 to 3,000 cells on each side.", and Apply. 3000 × 3000 applies with the toast "Grid is now 3000 × 3000".
- **Phone.**
  - The Playground board takes 84 % of the viewport height, and Studio with a circuit bar 69 %.
  - The circuit bar shows lamps, Run and a generation counter while the board animates; Run inside the sheet closes the sheet.
  - Sheets open and close reliably.
  - The tab chips scroll with an edge fade.
- **Core controls.**
  - The Select group appears only with a selection, and Delete and ⌘Z work.
  - The ⋯ menu is plain.
  - 40 gen/s gives 41 gens in 1 s.
  - Theme persists across reload.
  - The look stays print-like in both themes: no glow, gradient or emoji, and the board stays the primary object.

## Verdict
All seven R5 defects are fixed or reduced to cosmetics. The R5 blocker, the hidden desktop Masterworks tab, is gone, and every T1–T8 path works with zero console errors on both viewports and in both themes.

What remains is polish:
- the dark-mode off-switch contrast (worth fixing first, because it hides the T3/T6 control in dark);
- the phone toast landing on the open sheet;
- one Fit edge case that clips a south port label;
- the post-save title truncation on phone.

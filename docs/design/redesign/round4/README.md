# Round 4: Masterworks, large boards and branching circuits (October 2026)

Round 4 restores the large-scale work that the first redesign dropped. It adds three things.

1. **Masterworks.** A Library group of famous large patterns with attributed, licence-checked data. Nine load onto
   the board, from the Simkin glider gun up to the 2058 × 2058 OTCA metapixel. Four are reference-only cards that
   link to LifeWiki. Sources and licence evidence are in `docs/masterworks-provenance.md` and `docs/credits.md`.
2. **Large boards.** The board ceiling is now 3000 × 3000, with a Custom grid size. Fit works at any size, and sub-pixel
   zoom draws through a cached bitmap.
3. **Branching circuits.** The Logic panel edits a formula instead of a straight chain. A chain can hold up to 6 gates,
   a circuit up to 10, inputs can be reused, and XOR is a ready-made card. The engine rules and verification runs are
   in `docs/circuit-research-handoff.md`.

## Review loop

| Round | Commit | Functionality | Clarity | Visual | Mobile | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 4 | 6446bd6 | 8 | 6 | 8 | 7 | Fail |
| 5 | 849724a | 9 | 7 | 8 | 8 | Fail |
| 6 | 441a064 | 9 | 8 | 8 | 8 | Pass |

`review.md` is the passing round-6 review. Commit 40ffa60 then fixed its remaining polish items: dark-theme switch
contrast, a toast over the open phone sheet, a label clipped by Fit, phone title truncation after Save, and the
dark theme toggle.

## Screenshots (commit 40ffa60)

| File | What it shows |
| --- | --- |
| desktop-masterworks-tab.png / phone-masterworks-tab.png | The Masterworks group in the Library |
| desktop-sir-robin.png | Sir Robin loaded on its grown board |
| desktop-otca.png / phone-otca.png | The OTCA metapixel fitted on a 2400 × 2400 board, with the growth toast |
| desktop-half-adder-table.png / phone-half-adder.png | The half-adder with its two lamps and truth table |
| desktop-xor.png / phone-xor.png | The XOR card opened as an editable formula |
| desktop-tree.png | `(A OR B) AND (A OR C)` built from chip menus, with a turned OR tile |
| desktop-or-rule.png | A blocked menu item showing its reason on screen |
| desktop-dark-studio.png / phone-studio.png | Studio in dark (desktop) and light (phone) |
| desktop-dark-switches.png | Off switches in the dark theme after the contrast fix |

## Known limits

- **No Full adder.** As a gate tree it needs 16 gates, beyond the 10-gate cap and the board. The compact half-adder
  construction is blocked on a mis-phased SUM lane; the handoff doc records the measurements and next steps.
- **Publishing.** Community publishing still caps boards at 2048 × 2048, which a PostgreSQL CHECK constraint enforces.
  A Studio project grown past that size, for example by OTCA or Breeder 1, is refused at publish time with a clear
  message.

# Credits and provenance

Life Lab is a Conway's Game of Life learning and construction workspace. The
simulation engine and editor in this repository implement the B3/S23 rule.

The curated AND, OR, NOT, and binary half-adder circuit geometries are based on
the CakeML Game of Life project:

- Project: CakeML Game of Life — <https://github.com/CakeML/game-of-life>
- Inspected source revision: `c3439fc4c24948f93945c75c973e56ed4a001ad6`
- Repository attribution identifies the CakeML project and credits Nicolas
  Loizeau and Nicholas Carlini for the gate work.

The project owner authorized this repository to include the verified gate
coordinates. The upstream repository did not publish an asset license in the
inspected revision, so this credit is not a claim of a broader upstream
license. The exact source files, hashes, and probe method are listed in
[`circuit-research-handoff.md`](circuit-research-handoff.md).

Branching circuits, longer chains and the XOR preset reuse the same five tile
files (AND, OR, NOT, half-adder, terminator from the revision above), placed,
delayed and in some positions reflected across the diagonal; no further
upstream tiles were fetched for them.

Research references used to explain the constructions include Nicholas
Carlini's gate article and the Myreen/Carneiro half-adder paper, both linked in
the research handoff. Their references should be consulted for the original
technical context and licensing terms of those publications.

## Masterworks

The Masterworks entries in `src/masterworks.js` reproduce famous large-scale
Life discoveries. Cell data comes from the LifeWiki pattern archive
(<https://conwaylife.com/patterns/>), whose content LifeWiki licenses under the
GNU Free Documentation License 1.2 or later with attribution satisfied by a
direct link back to the article. Each entry links its article; the cells are
unchanged apart from rotating some spaceships to travel rightward and, for the
Snark, adding a glider on its input lane. The quoted policy text, archive
captures and measurements are in
[`masterworks-provenance.md`](masterworks-provenance.md).

Loadable patterns and their discoverers:

- Simkin glider gun — Michael Simkin, 2015 — <https://conwaylife.com/wiki/Simkin_glider_gun>
- Snark — Mike Playle, 2013 — <https://conwaylife.com/wiki/Snark>
- Sir Robin — Adam P. Goucher and Tom Rokicki, 2018 — <https://conwaylife.com/wiki/Sir_Robin>
- Copperhead — zdr, 2016 — <https://conwaylife.com/wiki/Copperhead>
- Loafer — Josh Ball, 2013 — <https://conwaylife.com/wiki/Loafer>
- Breeder 1 — Bill Gosper, 1971 — <https://conwaylife.com/wiki/Breeder_1>
- Puffer 1 — Bill Gosper, 1971 — <https://conwaylife.com/wiki/Puffer_1>
- 2-engine Cordership — praosylen, 2017 — <https://conwaylife.com/wiki/2-engine_Cordership>
- OTCA metapixel — Brice Due, 2006 — <https://conwaylife.com/wiki/OTCA_metapixel>
  (cell data in `src/masterworks-data/otca-metapixel.js`, loaded on demand)

Reference-only entries (linked, no cell data shipped): Gemini (Andrew J. Wade,
2010), 0E0P metacell (Adam P. Goucher, 2018), Waterbear (Brett Berger and Ivan
Fomichev, 2014) and LifeWiki's Pattern of the Year page.

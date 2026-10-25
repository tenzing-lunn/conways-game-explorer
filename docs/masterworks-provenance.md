# Masterworks provenance

Evidence for the licence, source and attribution of every entry in
`src/masterworks.js`, plus the engine measurements that set the recommended
boards. Research date: 2026-10-24. Later the same day the OTCA metapixel moved
from reference-only to shipped after `RLE_LIMITS.dimensionMax` in
`src/patterns.js` rose from 2048 to 3000 (commit 30cd7a0 on `redesign/ui`).

## 1. Licence evidence

### 1.1 What was tried against the live site

conwaylife.com (LifeWiki and its pattern archive) sits behind a Cloudflare
managed challenge.

- `curl` to `https://conwaylife.com/patterns/snark.rle` (and
  `simkinglidergun`, `sirrobin`, `copperhead`, `loafer`) returned HTTP 403 with
  the "Just a moment..." challenge page, not the file.
- Headless Chromium through `@playwright/test` 1.61.1 (headless shell), three
  attempts per page with `waitForLoadState('networkidle')` and up to 30 s of
  polling, on `https://conwaylife.com/wiki/LifeWiki:Copyrights` and
  `https://conwaylife.com/wiki/LifeWiki:Pattern_files`: the page title stayed
  "Just a moment..." and the visible text was "Performing security
  verification ... This page is displayed while the website verifies you are
  not a bot." The challenge did not clear.
- Full Chromium in its new headless mode (`channel: 'chromium'`), two attempts
  with up to 60 s of polling on the Copyrights page: same result. The challenge
  did not clear.

Because the live policy page could not be read, the evidence below comes from
the Internet Archive. The LifeWiki:Copyrights page has revision id 1965 in the
capture; a request for the newest capture (`/web/2026/`) redirected to the
2024-11-18 capture, so that is the most recent archived text.

### 1.2 LifeWiki:Copyrights (archived 2024-11-18 20:08:53 UTC)

URL: <https://web.archive.org/web/20241118200853/https://conwaylife.com/wiki/LifeWiki:Copyrights>

Verbatim sentences:

> The license LifeWiki uses grants free access to our content. LifeWiki content
> can be copied, modified, and redistributed so long as the new version grants
> the same freedoms to others and acknowledges the authors of the LifeWiki
> article used (a direct link back to the article satisfies the attribution
> requirement). LifeWiki articles therefore will remain free under the GFDL and
> can be used by anybody subject to certain restrictions, most of which aim to
> ensure that freedom.

> To this end, the text contained in LifeWiki is copyrighted by LifeWiki
> contributors and licensed to the public under the GNU Free Documentation
> License (GFDL).

> Permission is granted to copy, distribute and/or modify this document under
> the terms of the GNU Free Documentation License, Version 1.2 or any later
> version published by the Free Software Foundation; with no Invariant
> Sections, with no Front-Cover Texts, and with no Back-Cover Texts.

> If you contribute material to LifeWiki, you thereby license it to the public
> under the GFDL (with no invariant sections, front-cover texts, or back-cover
> texts).

> If you want to use LifeWiki materials in your own books/articles/websites or
> other publications, you can do so -- but only in compliance with the GFDL.

> You may be able to partially fulfill the latter two obligations by providing
> a conspicuous direct link back to the LifeWiki article hosted on this
> website.

> Images will be assumed to under GDFL [sic] unless the user who uploaded the
> image says otherwise on the image's page.

The page does not mention pattern files (`.rle`) explicitly.
`LifeWiki:Pattern_files` and `Help:Uploading_pattern_files` are not in the
Internet Archive (HTTP 404), so no separate pattern-file policy could be read.

### 1.3 Golly pattern collection (cross-check only, not used as a source)

- `docs/License.html` in <https://github.com/AlephAlpha/golly> (fetched
  2026-10-24 from `raw.githubusercontent.com/AlephAlpha/golly/master/`):
  > This program is free software; you can redistribute it and/or modify it
  > under the terms of the GNU General Public License as published by the Free
  > Software Foundation; either version 2 of the License (see below), or (at
  > your option) any later version.
- `Help/credits.html`:
  > Dave Greene and Alan Hensel helped put together the pattern collection.
  > Thanks to everybody who allowed us to distribute their fantastic patterns,
  > especially Nick Gotts, Gabriel Nivasch, David Eppstein, Jason Summers,
  > Stephen Morley, Dean Hickerson, Brice Due, William R. Buckley, David Moore,
  > Mark Owen, Tim Hutton, Renato Nobili, Adam P. Goucher, David Bell and
  > Kenichi Morita.

  > Thanks to Nathaniel Johnston for creating the brilliant LifeWiki and for
  > making its patterns available to Golly users via an online archive.

Golly's collection is distributed under the GPL as part of Golly and relies on
per-author permission; it was not needed because every shipped pattern was
available from LifeWiki's own archive.

### 1.4 Decision

Cell data is shipped only for patterns whose RLE file comes from LifeWiki's
pattern archive (`conwaylife.com/patterns/<name>.rle`, linked from each
article's infobox under "Pattern files"), under the policy quoted above:
redistribution is permitted provided the result stays free and the LifeWiki
article is acknowledged with a direct link. Each loadable entry therefore
records `license: 'gfdl-1.2'`, names the discoverer, and links the article
(`source.url`). The RLE comment lines (`#N`, `#O`, `#C`) were removed and each
body was re-encoded with `encodeRle()` from `src/patterns.js`; the cells are
identical, so this is verbatim data, not a derivative.

Two caveats are recorded rather than hidden: the archived policy page does not
name pattern files specifically, and the live page could not be read on the
research date. Separately, a Life pattern is a mathematical configuration with
one functional expression, which is generally regarded as outside copyright;
the credits do not rely on that argument but it reduces the residual risk.

Patterns that could not be shipped are `license: 'reference-only'` with no cell
data and a `reason` that names the limit involved.

Small bodies are inline (`rle`). The OTCA metapixel's body (152,549
characters) lives in its own ES module, `src/masterworks-data/otca-metapixel.js`
(`export default '<headerless RLE body>'`), referenced from the entry as
`rleModule: './masterworks-data/otca-metapixel.js'` and imported on demand by
`loadMasterwork(id)`, so the Library does not download it until the pattern is
opened. The module's header comment repeats the licence, capture URL and
capture date.

## 2. Entries

Facts (discoverer, year, bounding box, population) were read from Internet
Archive captures of the LifeWiki articles listed in column "Article capture".

### 2.1 Loadable (GFDL 1.2+, LifeWiki pattern archive)

| id | Name | Discoverer, year | Archived RLE used | RLE header lines (verbatim) | Declared / shipped size | Cells | Rotation | Board |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `simkin-glider-gun` | Simkin glider gun | Michael Simkin, 2015 | [simkinglidergun.rle, 2025-05-26](https://web.archive.org/web/20250526150950id_/https://conwaylife.com/patterns/simkinglidergun.rle) | `#N Simkin glider gun` / `#O Michael Simkin` / `#C A true period 120 glider gun, found on April 28, 2015.` | 33×21 / 33×21 | 36 | none | 300×200 |
| `snark` | Snark | Mike Playle, 2013 | [snark.rle, 2026-02-05](https://web.archive.org/web/20260205081819id_/https://conwaylife.com/patterns/snark.rle) | `#N Snark` / `#O Mike Playle` / `#C The fastest and smallest 90-degree stable glider reflector (as of June 2013).` | 17×23 (57 cells: reflector + adjacent glider) / 41×50 | 57 | none; see note | 160×120 |
| `sir-robin` | Sir Robin | Adam P. Goucher and Tom Rokicki, 2018 | [sirrobin.rle, 2025-04-05](https://web.archive.org/web/20250405042330id_/https://conwaylife.com/patterns/sirrobin.rle) | `#N Sir Robin` / `#O Adam P. Goucher, Tom Rokicki; 2018` / `#C The first elementary knightship to be found in Conway's Game of Life.` | 31×79 / 79×31 | 282 | 90° clockwise | 720×400 |
| `copperhead` | Copperhead | zdr, 2016 | [copperhead.rle, 2024-11-20](https://web.archive.org/web/20241120001429id_/https://conwaylife.com/patterns/copperhead.rle) | `#N Copperhead` / `#O 'zdr'` / `#C An c/10 orthogonal spaceship found on March 5, 2016.` | 8×12 / 12×8 | 28 | 90° clockwise | 300×200 |
| `loafer` | Loafer | Josh Ball, 2013 | [loafer.rle, 2024-11-19](https://web.archive.org/web/20241119235908id_/https://conwaylife.com/patterns/loafer.rle) | `#N loafer.rle` / `#O Josh Ball` / `#C small c/7 orthogonal spaceship found 17 February 2013` | 9×9 / 9×9 | 20 | 180° | 300×200 |
| `breeder-1` | Breeder 1 | Bill Gosper, 1971 | [breeder1.rle, 2024-11-20](https://web.archive.org/web/20241120000004id_/https://conwaylife.com/patterns/breeder1.rle) | `#N Breeder 1` / `#O Bill Gosper` / `#C The first pattern to be found that exhibits quadratic growth. Found in the early 1970s.` | 749×338 / 749×338 | 4,060 | none | 2400×1000 |
| `puffer-1` | Puffer 1 | Bill Gosper, 1971 | [puffer1.rle, 2024-11-19](https://web.archive.org/web/20241119235849id_/https://conwaylife.com/patterns/puffer1.rle) | `#N Puffer 1` / `#O Bill Gosper` / `#C An orthogonal, period-128 puffer and the first puffer to be discovered` | 27×7 / 7×27 | 44 | 90° clockwise | 800×240 |
| `two-engine-cordership` | 2-engine Cordership | praosylen, 2017 | [2enginecordership.rle, 2025-04-22](https://web.archive.org/web/20250422081447id_/https://conwaylife.com/patterns/2enginecordership.rle) | `#N 2-engine Cordership` / `#O Aidan F. Pierce` / `#C The smallest known Cordership.` | 41×49 / 41×49 | 100 | none | 480×320 |
| `otca-metapixel` | OTCA metapixel | Brice Due, 2006 | [otcametapixel.rle, 2025-07-18](https://web.archive.org/web/20250718225406id_/https://conwaylife.com/patterns/otcametapixel.rle) | `#N OTCA metapixel` / `#O Brice Due` / `#C A unit cell that is capable of emulating any Life-like cellular automaton. Constructed in 2006.` | 2058×2058 / 2058×2058 | 64,691 | none; body in `src/masterworks-data/otca-metapixel.js` | 2400×2400 |

Notes:

- Snark: the LifeWiki file already contains a glider touching the reflector
  (57 cells; the article gives 52 for the reflector alone). The 52 still-life
  cells were separated by running the file for 200 generations and keeping the
  cells alive at generations 200 and 201. A glider was then placed on the only
  working input lane, found by trying every heading, glider phase and lane
  offset and keeping placements where the reflector was intact afterwards and
  a single glider left at 90°: heading up-right from offset (−16, 39) relative
  to the reflector's top-left corner, moved 8 cells further back along the same
  diagonal to (−24, 47) so the approach is visible (~140 generations) before
  the bounce. The shipped stamp is 41×50.
- Rotations: in the archived orientation Sir Robin travels up-left (1 left, 2
  up per 6 generations), Copperhead up, Loafer left and Puffer 1 up, which on a
  landscape board means hitting the top edge within a few hundred generations.
  Those four were rotated so every mover travels rightward; Breeder 1 (right)
  and the Cordership (down-right) were left as archived. Rotation is a rigid
  transform of the same cells.
- 2-engine Cordership: the archived RLE `#O` line names Aidan F. Pierce; the
  current article credits praosylen. The entry follows the article.
- Sir Robin: the article's infobox credits Adam P. Goucher and Tomas Rokicki
  (Goucher completed the ship from a partial by Rokicki). The entry credits
  both.
- OTCA metapixel: the article gives bounding box 2058×2058 and "cell size"
  2048×2048; the archived RLE declares `x = 2058, y = 2058` (`rule = b3/s23`)
  and its true bounding box is 2058×2058 (copies tile every 2048 cells and
  overlap by 5). It was reference-only while `RLE_LIMITS.dimensionMax` was
  2048; with the limit at 3000 `parseRle` accepts it and it ships unchanged.
  `loadMasterwork('otca-metapixel')` (dynamic import plus decode) took 24 ms
  in Node for 64,691 cells.
- Article captures used for facts: [Simkin glider gun](https://web.archive.org/web/20260628223231/https://conwaylife.com/wiki/Simkin_glider_gun),
  [Snark](https://web.archive.org/web/20260927215031/https://conwaylife.com/wiki/Snark),
  [Sir Robin](https://web.archive.org/web/20261011065557/https://conwaylife.com/wiki/Sir_Robin),
  [Copperhead](https://web.archive.org/web/20261011061540/https://conwaylife.com/wiki/Copperhead),
  [Loafer](https://web.archive.org/web/20260930212916/https://conwaylife.com/wiki/Loafer),
  [Breeder 1](https://web.archive.org/web/20260902181614/https://conwaylife.com/wiki/Breeder_1),
  [Puffer 1](https://web.archive.org/web/20260829052825/https://conwaylife.com/wiki/Puffer_1),
  [2-engine Cordership](https://web.archive.org/web/20261011061540/https://conwaylife.com/wiki/2-engine_Cordership),
  [OTCA metapixel](https://web.archive.org/web/20260923052505/https://conwaylife.com/wiki/OTCA_metapixel).

### 2.2 Reference-only

| id | Name | Discoverer, year | Article capture | Size (article) | Why not loadable |
| --- | --- | --- | --- | --- | --- |
| `gemini` | Gemini | Andrew J. Wade, 2010 | [Gemini](https://web.archive.org/web/20260913053552/https://conwaylife.com/wiki/Gemini) | 4,217,807 × 4,220,191; 846,278 cells | Far above the 3000-cell board ceiling and the 200,000-cell coordinate limit. |
| `0e0p-metacell` | 0E0P metacell | Adam P. Goucher, 2018 | [0E0P metacell](https://web.archive.org/web/20261014163730/https://conwaylife.com/wiki/0E0P_metacell) | 261,841 × 261,841; ~18,650,000 cells | Far above both limits. |
| `waterbear` | Waterbear | Brett Berger and Ivan Fomichev, 2014 | [Waterbear](https://web.archive.org/web/20260927080118/https://conwaylife.com/wiki/Waterbear) | 13,295 × 28,010; 197,896 cells | Above the 3000-cell board ceiling; its RLE is also not in the Internet Archive. Pattern of the Year 2014. |
| `pattern-of-the-year` | Pattern of the Year | ConwayLife.com forum vote, 2010 onward | [Pattern of the Year](https://web.archive.org/web/20251218082357/https://conwaylife.com/wiki/Pattern_of_the_Year) | n/a | A list page, not a pattern. Winners per the capture: 2010 Gemini, 2011 Fully universal Turing machine / Lobster, 2012 Statorless p3, 2013 Snark, 2014 Waterbear, 2015 Syringe, 2016 Caterloopillars, 2017 2-engine Cordership, 2018 Sir Robin, 2019 David Hilbert, 2020 Bandersnatch / Speed Demonoid, 2021 Self-synthesizing oblique loopship, 2022 Unsynthesizable and limited-ancestor objects / Explicit 15-glider reverse caber tosser, 2023 Spacefiller synthesis. |

Other Pattern of the Year large spaceships checked and rejected for size:
Caterpillar (2004, 4,195 × 330,721, 11,880,063 cells) and Half-baked
knightship (2014, 450,801 × 461,227, 1,049,395 cells).

## 3. Engine measurements

Apple M2 (8 logical CPUs), macOS arm64, Node v22.20.0. Each pattern was placed
centred on its recommended board with bounded edges, `createLifeStepper` ran
one warm-up generation, then 200 generations were timed in a single pass with
nothing else running. Every pattern, OTCA included, was decoded through
`loadMasterwork()`; OTCA's dynamic import plus `parseRle` took 24 ms for
64,691 cells. OTCA's 2400 × 2400 row is its shipped board; the 3000 × 3000
rows show the board ceiling. An earlier pass that overlapped with `npm test`
on the same machine gave 45–55 ms for OTCA and is discarded; an earlier
uncontended pass on a 2098 × 2098 board gave 15.0–15.3 ms.

| Pattern | Board | Edges | Population (start → after 200) | ms/generation |
| --- | --- | --- | --- | ---: |
| Simkin glider gun | 300 × 200 | bounded | 36 → 43 | 0.08 |
| Snark | 160 × 120 | bounded | 57 → 57 | 0.08 |
| Sir Robin | 720 × 400 | bounded | 282 → 303 | 0.10 |
| Copperhead | 300 × 200 | bounded | 28 → 30 | 0.05 |
| Loafer | 300 × 200 | bounded | 20 → 23 | 0.06 |
| Breeder 1 | 2400 × 1000 | bounded | 4,060 → 3,968 | 1.07 |
| Puffer 1 | 800 × 240 | bounded | 44 → 170 | 0.09 |
| 2-engine Cordership | 480 × 320 | bounded | 100 → 116 | 0.09 |
| OTCA metapixel | 2400 × 2400 | bounded | 64,691 → 54,889 | 17.11 |
| OTCA metapixel | 3000 × 3000 | bounded | 64,691 → 54,889 | 16.74 |
| OTCA metapixel | 3000 × 3000 | wrapped | 64,691 → 54,889 | 16.82 |

Reading: every inline pattern costs about 1 ms/generation or less. The OTCA
metapixel runs at about 17 ms/generation on its 2400 × 2400 board and on the
3000 × 3000 ceiling, under the 40 ms threshold set for shipping it, so it
ships as loadable. No change to `src/life.js` was needed.

Runway on the recommended boards (pattern centred, bounded edges): Breeder 1
reaches the right edge after about 1,650 generations and its glider wake
reaches the top after about 2,200; Sir Robin has roughly 950 generations
before the right edge; Puffer 1 about 790; the Cordership about 1,600 (its
bottom edge comes first); Copperhead about 1,440 and Loafer about 1,020. On
wrapped boards the gun, puffer and
breeder eventually collide with their own output; bounded edges are the
sensible default for these entries.

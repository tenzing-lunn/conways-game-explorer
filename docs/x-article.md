# X article draft

Status: draft, not posted. Only the text under "Article" is for X.

## Article

**Title:** I built a lab where four rules of life compute

**Cover image:** `design/life-lab-launch-playground.png` (eight pulsars on the Playground grid)

---

Conway's Game of Life has four rules, and they all fit on a napkin.

A dead cell with exactly three live neighbors is born. A live cell with two or three live neighbors survives. Everything else dies or stays dead. Every cell updates at the same time.

That's it. Nobody steers anything after you place the first cells. From that you get gliders that walk across the grid, oscillators that pulse forever, guns that fire an endless stream of gliders, and, if you arrange things carefully enough, working logic gates.

I wanted a place to play with all of that, so I built one. It's called **Life Lab**.

👉 https://conways-game-explorer.10zinglunn.workers.dev

### What it is

Life Lab has three workspaces:

**Playground.** Draw cells, stamp presets (Gosper glider gun, R-pentomino, Diehard, Acorn, pulsars), and hit play. A population chart shows patterns growing, collapsing, oscillating, or settling down. Age coloring tells newborn cells apart from old ones. The world wraps at the edges, so a glider can leave on the right and come back on the left.

**Studio.** This is for building. Edit a pattern, save immutable versions, restore old snapshots, write a description and tags, and choose the camera framing people see when they open your build.

**Community.** Publish what you made, favorite and comment on other people's builds, and remix them. A remix keeps attribution, so you can always trace a pattern back through the people who built on it.

### The part I find most interesting: computing with cells

Life is Turing complete. You can build a computer out of it. People have. But "Turing complete" is usually something you read about instead of something you watch.

Life Lab includes AND, OR, and NOT gates plus a binary half-adder, all built from real cells. Inputs are finite trains of spaceships fired at the gate. The output is read by a small probe that counts live cells in one region at a given generation: empty means 0, occupied means 1.

So timing matters. A signal that arrives one generation late is a different signal. Watching a half-adder work in Life shows you something a truth table hides: computation is physical, and it takes time.

The gate constructions come from the CakeML Game of Life project, which builds on work by Nicolas Loizeau and Nicholas Carlini. I re-ran their truth tables against my own engine before shipping them.

### How it's built

- **Engine:** a small, framework-free B3/S23 stepper that only tracks active tiles, so mostly empty worlds cost almost nothing. A sparse 2048×2048 board steps in about 0.5 ms per generation on an M2. A dense one takes about 31 ms, so simulation runs in a Web Worker and big boards get explicit speed limits. I'd rather say that up front than promise 60 fps on everything.
- **App:** vanilla ES modules and Canvas. No framework yet, on purpose.
- **Backend:** Cloudflare Workers serve the app and the API from one origin. Neon PostgreSQL sits behind Hyperdrive, and Better Auth handles accounts.
- **Testing:** around 200 Node tests plus Playwright journeys in desktop and mobile Chromium. Before launch, a full two-user flow ran against production: publish, favorite, comment, remix, unpublish, delete, clean up.

One deploy lesson: my first production version broke the homepage because the Worker wasn't handling `/` before static assets. A one-line routing fix sorted it out, but I only caught it because I tested the live URL and not just the local build.

### Why I made it

I like the place where computation and making things overlap. In Life, a pattern can be art, an experiment, or a machine, and the line between them is blurry. A remix gives the next person a place to start.

If you've never played with Life, open the Playground, load the R-pentomino, and press play. Five cells, more than a thousand generations of chaos before it settles.

Then tell me what you'd build: motion, art, or logic?

---

## Single post (≤280 characters, for a free account)

Conway's Game of Life has 4 rules and no player. You can still build working logic gates out of it: spaceships are the signals, timing is the wire.

I built a lab for it: draw patterns, run AND/OR/NOT gates and a half-adder, remix others' builds.

https://conways-game-explorer.10zinglunn.workers.dev

## Thread (each post ≤280 characters)

1/ Conway's Game of Life has 4 rules:
- dead cell + exactly 3 live neighbors → born
- live cell + 2 or 3 → survives
- everything else dies
- every cell updates at once

No player, no input after the first frame. And it's Turing complete. 🧵

2/ "Turing complete" is usually something you read about. I wanted to watch it happen, so I built Life Lab: a Playground to experiment, a Studio to build and version patterns, and a Community to publish and remix.

3/ The part I can't stop thinking about is logic gates made of cells. The inputs are trains of spaceships fired at a gate. The output is a small probe: empty = 0, alive = 1. There's AND, OR, NOT, and a half-adder that actually adds.

4/ Timing is everything. A signal one generation late is a different signal. A truth table hides that, but watching a half-adder in Life doesn't. Computation is physical, and it takes time.

5/ Under the hood: a framework-free engine that only steps active tiles (a sparse 2048² board takes ~0.5 ms/gen on an M2), simulation in a Web Worker, and Cloudflare Workers + Postgres. The gate designs come from the CakeML project, building on Loizeau & Carlini.

6/ Try it: load the R-pentomino and press play. 5 cells, 1,103 generations of chaos.

https://conways-game-explorer.10zinglunn.workers.dev

What would you build: motion, art, or logic?

## Notes (not part of the article)

- Length: the article is about 4,100 characters. X Articles allow about 100,000 and may require Premium+, and Premium long posts allow 25,000. Free accounts are capped at 280, so use the single post or the thread there.
- The title and the "four rules" hook can be swapped for "Five cells. 1,103 generations of chaos." if you want a sharper opening.
- Alt text for the cover: "Eight yellow pulsar oscillators arranged on Life Lab's dark grid, with the pattern library and simulation controls visible."

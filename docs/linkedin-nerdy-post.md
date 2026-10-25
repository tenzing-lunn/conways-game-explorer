# LinkedIn post: "something I've found fascinating"

Status: draft, not posted. Only the text under "Post" goes on LinkedIn.
This is the curiosity-first take; `linkedin-launch-post.md` is the launch
announcement. Post one or the other, not both.

## Post

Something I've been obsessed with lately: a grid of squares, four rules, no player, and it can compute.

Conway's Game of Life (1970). Each cell is alive or dead. A dead cell with exactly three live neighbors comes alive. A live cell with two or three survives. Everything else dies. Every cell updates at once.

That's the whole system. You set the first frame, and after that all you can do is watch.

What got me is that those rules are enough to build a computer. Life is Turing complete. A glider, five cells that crawl diagonally forever, can act as a bit moving down a wire. Collide streams of them in the right geometry and you get AND, OR and NOT gates. Combine gates and you get adders, memory, and eventually anything a CPU can do. People have even built Life inside Life.

I didn't want to just read about it, so I built a lab to watch it happen. In Life Lab you fire trains of spaceships at a gate and read the output from a small probe region: empty means 0, alive means 1. There's a working binary half-adder in there.

The thing a truth table never shows you is time. In Life, a signal that arrives one generation late is a different signal. Gates have propagation delay because the "electrons" are physical patterns that have to travel. It's the clearest picture I've found of why chip design is so obsessed with clocks.

A few other things I learned building it:

→ Most of a Life world is empty, so the engine only steps the active regions. A sparse 2048×2048 board takes about half a millisecond per generation. A dense one takes about 31 ms, so I'm upfront about the limits instead of promising 60 fps.
→ Five cells (the R-pentomino) take 1,103 generations of chaos before they settle. Small input, unpredictable output: that's cellular automata in one example.
→ The gate designs come from the CakeML Game of Life project, which builds on work by Nicolas Loizeau and Nicholas Carlini. I re-checked their truth tables against my own engine before shipping them.

You can draw patterns, run the gates, publish what you make, and remix other people's builds:
https://conways-game-explorer.10zinglunn.workers.dev

Curious which part hooks other people: the art, the chaos, or the fact that it computes?

#CellularAutomata #ComputerScience #CreativeCoding

## Publication notes (not part of the post)

- Image: `design/life-lab-launch-playground.png`, with the alt text from
  `linkedin-launch-post.md`. A short screen recording of the half-adder
  running would fit this angle better than a still, if you can capture one.
- LinkedIn cuts the preview off after about 3 lines, so the first two
  sentences are the hook.

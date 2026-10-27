# Conway Life Logic Lab

A Conway's Game of Life playground growing into a community lab for learning logic, building cellular machines, and remixing what other people discover.

The current app is a large, zoomable finite toroidal world. The board wraps at the edges, so patterns can travel continuously while still fitting inside a practical browser canvas. It now has three modes:

- **Playground**: draw cells, stamp presets, import/export RLE, and explore emergent behavior.
- **Dev Studio**: treat gliders as signals, stamp logic components, save immutable versions, and restore earlier snapshots as new versions.
- **Community**: create a local profile, save board states, publish builds, star them, clone/remix them, and view a trending list.

Community mode stays local-first by default. The cloud path is being migrated to
Better Auth + PostgreSQL: the browser uses server endpoints for email-and-
password sign-in, local-build claiming, and publish/star/clone authorization.

## Run

```bash
npm run dev
```

Open http://127.0.0.1:5173.

The stabilized workspace shell includes responsive Playground, Dev Studio, and
Community surfaces. Dev Studio keeps the active local editing session when you
visit another workspace and return.

## Community Cloud

Local drafts work with no network config. The cloud path uses a server-only
`DATABASE_URL` and `BETTER_AUTH_SECRET`.
Database credentials are never injected into the browser. The setup guide and
production password-account setup are in [postgres/README.md](postgres/README.md).

## Controls

- Play, pause, and step one generation at a time.
- Draw live cells, erase cells, stamp the selected preset, or pan around the world.
- Use the speed slider to change generations per second.
- Use the zoom slider or Ctrl-scroll/pinch to zoom around the pointer.
- Toggle age colors to see newborn, mature, and old live cells differently.
- Watch the population chart track growth, collapse, oscillation, and stabilization.
- Load curated presets with short explanations: still lifes, oscillators, gliders, growth seeds, Gosper glider gun, R-pentomino, Diehard, Acorn, and more.
- Import and export Conway RLE patterns from the RLE panel.
- Create a local community account, save the current board as a creation, publish it, copy a share payload, star builds, and clone/remix public experiments.
- In Dev Studio, edit description, tags, attribution, and tutorial references; save immutable versions; restore history; and unpublish, archive, or delete a project.

## Community Roadmap

The larger goal is a GitHub-like creative community for Game of Life machines:

1. Stabilize the current Playground, Dev Lab, and local-first Community MVP.
2. Complete the validated publishing workflow. Shared client/server readiness checks, deterministic owner-scoped slugs, explicit publish states, selectable camera framing, accessible deterministic previews, and PostgreSQL public-row constraints are implemented; live migration/contract verification still needs a disposable `DATABASE_URL`.
3. Move the app shell to Next.js while keeping the Life engine as pure reusable logic.
4. Add public `/c/[slug]` and `/u/[username]` pages for SEO-indexable builds and profiles.
5. Deploy through Cloudflare Workers with GitHub preview deployments.
6. Expand Logic Lab with reusable gates, clocks, signal lanes, calculators, tutorials, and featured builds.

LinkedIn launch shape:

> This started as a Conway's Game of Life explorer. The larger goal is a community lab where people can learn logic through living patterns, clone and remix each other's machines, and publish cellular automata experiments.

Call to action: try the playground, star the repo, and share a pattern or logic demo you want the community version to support.

## Verification

```bash
npm test
npm run test:e2e
node --check src/app.js
node --check src/community.js
node --check src/patterns.js
node --check src/presets.js
node --check server.mjs
node --check worker.mjs
```

The Playwright suite covers the three workspaces in desktop Chromium and an
iPhone-sized Chromium viewport. Install its browser runtime once with
`npx playwright install chromium`.

## License

Code is MIT licensed; see [LICENSE](LICENSE). Bundled pattern data from LifeWiki and the CakeML gate coordinates keep their own terms, listed there and in [docs/credits.md](docs/credits.md).

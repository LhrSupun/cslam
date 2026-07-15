# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

A single-file, no-build browser simulation of N drones doing frontier-based exploration, sharing occupancy maps when in comm range, then BFS-navigating to a clicked point. It is a simplified teaching illustration of ETH-PBL's Nano-C-SLAM, not a port of the real firmware (which is graph-SLAM + ICP in bare-metal C).

## Running and testing

- **Run**: open `index.html` directly in a browser. No server, no build step, no dependencies to install.
- **No test files are committed.** The established verification pattern (see CHANGELOG.md "Verification" sections) is:
  - Extract the pure logic (grid building, sensing, frontier search, merge, pathfinding) into a plain-Node script and simulate ticks headlessly. Past bugs were caught with a matrix asserting ≥95% team coverage across all 3 environments × drone counts 2/4/8 — the stuck-exploration bug only reproduced on one cell of that matrix (four-rooms, N=2), so run the full matrix, not one config.
  - Test the DOM lifecycle (reset, live drone-count/environment switches, click-to-navigate, record button states) with jsdom.
- MCAP recording is the only part needing network: `@mcap/core` is imported from jsDelivr's `+esm` endpoint at load. The sim itself runs offline; recording just fails with a mission-log message.

## Architecture

All code lives in one `<script type="module">` in `index.html`. Key structure:

- **Grid semantics**: per-drone `known` grids and the merged map use `-1` unknown, `0` free, `1` wall. `wallGrid` is ground truth (boolean). Coordinates convert to meters as `cell × 0.5 m` (`toMeters`).
- **Environments**: the `ENVIRONMENTS` array holds `{name, rows, cols, cell, build}` presets; each `build*` function returns a wall grid. Constraint learned the hard way: every enclosed region must have a door — the four-rooms generator originally sealed a quadrant and exploration correctly stalled at ~80%. Verify reachability of the whole free space when adding/changing a map.
- **Simulation loop**: `frame` → `update(dt)` at requestAnimationFrame rate, scaled by the speed slider. `simTimeNs` is simulated time (used as MCAP timestamps), not wall clock. Two phases: `mapping` → `navigate` (auto when every drone is `done`, or manual once team coverage ≥25%; both paths call `mergeAll` first).
- **Exploration** (`planNext` / `findFrontierPath`): frontier BFS **deliberately treats unknown cells as passable** — only confirmed walls (`1`) block it. This is a bug fix, not an oversight: coarse 12-ray sensing leaves unknown "shadow" cells between free patches, and refusing to route through them permanently strands drones. Don't "tighten" this to free-only. Drones exclude other drones' current `targetKey`s, and fall back to wandering to the farthest known cell (max 3 strikes via `wanderStrikes`) before declaring `done`.
- **Map sharing** (`checkCommRange` / `mergePair`): pairwise, distance-thresholded (`COMM_RANGE_CELLS`), triggered on range *entry* (edge-detected via `pairInRange`). Merging is an instant full-knowledge union — the bandwidth-limited protocol of the real system is intentionally not modeled.
- **MCAP recording**: `queueMessage` serializes writes through `drainPromise` (a promise chain) because `McapWriter.addMessage` calls must be awaited sequentially; don't fire them in parallel. Channels are lazily registered per topic, schemaless JSON encoding. Topic list and message shapes are documented in README.md — keep them in sync if you add topics.

## Conventions

- CHANGELOG.md is actively maintained (newest first) with **Added/Changed/Bugs/Known limitations/Verification** sections per version. Update it for notable changes, including how the change was verified.
- README.md documents controls, the real-vs-simplified comparison table, and MCAP topics — update alongside behavior changes.
- The code style inside the script is intentionally plain: `var`, no framework, no build tooling. Match it.

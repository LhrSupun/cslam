# Collaborative SLAM sim

A single-file, no-build browser simulation of N drones doing frontier-based exploration with noisy sensors and drifting odometry, correcting their pose estimates by scan matching and inter-drone ranging, sharing maps when in comm range, then navigating to a clicked point. A simplified illustration of the ideas in ETH-PBL's Nano-C-SLAM, not a port of the real firmware.

On the map, each drone's triangle is where it *believes* it is; the hollow circle is where it *actually* is. Watching the two separate and snap back together is the point of the demo.

## Running it

Open `index.html` directly in a browser. No server, no build step. Recording to MCAP needs internet access on first load (fetches `@mcap/core` from jsDelivr); everything else works fully offline.

## Controls

- **Drones** — number input, 2 to 8. Changing it resets the mission.
- **Environment** — dropdown with a few floor plans. Changing it resets the mission.
- **Pause / Resume** — freezes the simulation clock.
- **Reset** — re-rolls spawn points and restarts mapping on the current environment/drone count.
- **Switch to navigation** — unlocks once team coverage passes 25%; jumps straight to the navigate phase early (does a final full map sync first).
- **Speed** — simulation speed multiplier.
- **Record** — starts/stops MCAP recording. On stop, the browser downloads a `.mcap` file (see below).
- **Click the map** (once in the navigate phase) — sends every drone to that point via BFS over the shared map.

## What's simulated vs. simplified

This is a teaching/demo tool, not a port of the real algorithm:

| Real Nano-C-SLAM | This sim |
|---|---|
| Graph-based SLAM + ICP scan matching (`cslam-gap9-app/slam`, `icp/`), running on a GAP9 co-processor | Log-odds occupancy grid from noisy raycasts + per-scan beam matching against the drone's own map (translation-only, outlier-gated) — bounds drift, no loop closure or retroactive map correction |
| Flow-deck odometry with drift | Believed pose = actual displacement + per-drone bias + gaussian noise; true pose tracked separately for physics |
| UWB two-way ranging for inter-drone distance | True distance + noise, thresholded for comm range and used to nudge in-range drones' believed poses toward consistency |
| Bandwidth-limited swarm data protocol | Instant max-confidence log-odds union on any two drones coming into range |
| Real flight dynamics (Crazyflie + flow deck) | Point-to-point grid movement, no dynamics; true motion is blocked by real walls |

## MCAP recording

While recording, these topics are logged (schemaless JSON messages, one MCAP channel per topic):

- `/sim/drones/<id>/pose` — `{x, y, tx, ty, drift, heading, state}` (`x, y` believed, `tx, ty` true, `drift` in meters), ~10 Hz
- `/sim/drones/<id>/coverage` — `{pct}`, on change
- `/sim/team/coverage` — `{pct}`, on change
- `/sim/team/comm/<i>-<j>` — `{distance, inRange}`, on state change
- `/sim/goal` — `{x, y}`, when a target is set
- `/sim/events` — mission log text, one message per log line

Coordinates are in meters (grid cells scaled by the environment's cell size). Timestamps are simulated time (nanoseconds since recording start), not wall clock, so they reflect sim speed rather than real elapsed time.

Open the file with [Foxglove Studio](https://foxglove.dev/) (drag and drop, use the Raw Messages / Plot panels since topics are schemaless JSON), or read it with the `mcap` CLI / Python library.

## Testing

```
cd test && npm install && node run.mjs
```

The harness evals the real `<script>` from `index.html` inside jsdom and drives it headlessly: a 9-way coverage matrix (3 environments × 2/4/8 drones, asserting ≥95% team coverage and bounded drift), click-to-navigate, DOM lifecycle, and the MCAP record-button flow. Runs are deterministic — the sim reads `window.CSLAM_SEED` to seed its RNG; `SEED_BASE=<n> node run.mjs` re-rolls all noise.

## Known limitations

See `CHANGELOG.md` for the running list of what's implemented, what's simplified, and what broke along the way.

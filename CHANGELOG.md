# Changelog

All notable changes to the collaborative SLAM sim are logged here, newest first.

## 2026-07-04 — v0.3: noisy sensing, odometry drift, scan matching, UWB correction

This version removes the sim's three biggest cheats — perfect sensing, perfect localization, and ground-truth-only comm — turning it from a pathfinding demo into an actual SLAM illustration.

**Added**
- Probabilistic occupancy: each drone now builds a per-cell log-odds grid instead of a ternary known map. Sensor rays carry gaussian range noise (σ 0.12 cells), a 5% missed-wall rate, and 2% phantom returns; evidence accumulates and self-corrects. The ternary `known` grid still exists but is derived by thresholding log-odds, so the planners are unchanged. Free-cell rendering now shades by confidence.
- Odometry drift: every drone tracks a *true* pose (used for physics: raycasts, wall collisions, comm range) and a *believed* pose (used for planning and as the map frame). Belief integrates actual displacement plus a per-drone constant bias (1.2% of distance, random direction) and gaussian noise (2%), so it drifts. A hollow circle + tether line renders the true pose next to the believed-pose triangle.
- Scan matching: every 0.2 sim-seconds a drone compares each measured ray against the distance its own map predicts along that ray (beam model), rejects outlier rays (>0.9 cells residual, and requires a ≥50% inlier fraction), and applies a damped, capped correction to its believed pose. This bounds drift instead of eliminating it — corrections anchor to the drone's own map, which is itself imperfect.
- UWB-style inter-drone ranging (matching the real system's UWB two-way ranging): while any pair is in comm range, the measured (true + noise) inter-drone distance nudges both believed poses toward consistency, running before map merge so merges inject less-offset geometry.
- Committed test harness in `test/` (jsdom): extracts the real `<script>` from `index.html` and drives it headlessly — no more copy-paste logic extraction. Covers the 9-way coverage matrix, click-to-navigate, DOM lifecycle, and the record-button flow. `CSLAM_SEED` on `window` seeds the sim's RNG for deterministic runs; `SEED_BASE=<n> node run.mjs` re-rolls all noise.
- Physical wall collisions: true motion is blocked by real walls (with axis slide); a drone whose believed pose disagrees with physics stalls, then replans (mapping) or retries the goal up to 3 times before idling (navigate).

**Changed**
- Map merge (pairwise sync and the team map) is now a max-confidence union of log-odds rather than a copy of ternary values — idempotent, so repeated merges don't double-count evidence.
- `/sim/drones/<id>/pose` MCAP messages now include the true pose and drift: `{x, y, tx, ty, drift, heading, state}`.
- Mapping also ends when team coverage holds ≥97% for 5 sim-seconds (in addition to every drone declaring done). With noisy sensors, frontier cells flicker forever near full coverage; a sustained-coverage cutoff is the standard exploration-mission answer, and it also cuts end-of-mission wandering, which was the main remaining drift exposure.
- Wander fallback allows 5 strikes (was 3) before a drone declares done, since noise makes transient no-frontier states more common.
- Comm range and comm-link rendering use true positions (physics), not believed ones.

**Bugs found and fixed during this pass** (each found by the new matrix, worth recording since they're generic SLAM-sim traps)
- *X-ray coverage*: a missed-wall ray reports max range, so free-space evidence was marked straight through walls, inflating coverage ~15% and ending missions early. Fix: the free-space march stops at cells the drone already believes are strong walls (map-consistent integration).
- *Ghost walls hugging real walls*: range noise put ~⅓ of wall returns in the free cell in front of the wall; with any drift toward the wall this majority-votes a parallel ghost wall into the map, which then anchors scan matching to the drifted frame (sealing the 1-cell four-rooms doorways — 60% coverage stalls). Fix: bias the occupied-evidence cell half a ray-step into the wall; the return is from the surface, the occupied volume is behind it.
- *One-way ICP pull*: the first scan-matcher (point-to-nearest-wall-cell-rectangle) only ever pulled hits toward walls, so with asymmetric wall views the believed pose migrated until the whole frame locked in a stable multi-cell offset. Fix: beam-model residuals (map-predicted minus measured distance along each ray) are signed, so too-deep hits push back.
- *Aliasing runaway in the warehouse*: the regular block grid means a drifted drone's rays can hit one block physically but a different block in its map; clamping those huge residuals still let them vote, dragging belief away at the full correction rate (drift 4.5→8.9 cells in 20 sim-seconds). Fix: reject outlier rays entirely (classic ICP outlier gating) rather than clamping them.
- *End-game drift ladder*: after ~97% coverage, drones wandered the whole map chasing noise-flicker frontiers, re-anchoring their matcher to merged map patches written by other drones at slightly different offsets — stacking up to ~4 cells of drift in the final stretch. Fixed by the sustained-coverage mapping cutoff above.

**Known limitations / things to watch**
- Scan matching is translation-only (no heading error is modeled) and anchors to the drone's own imperfect map: absolute drift is bounded (sub-cell typically, ~2 cells worst-case per the matrix), not eliminated. There is no loop closure or retroactive map correction — that's the part of real graph-SLAM this sim still doesn't model.
- Merged maps combine per-drone frames that each carry residual drift, so slight double-wall smear near cell boundaries is expected and honest; occasionally a believed-free cell is unreachable in the merged map and drones will report "no known route".
- Coverage tops out at 97–100% rather than a guaranteed 100%: a few cells stay unknown behind residual believed walls. The matrix asserts ≥95%.
- The rendering changes (ghost markers, confidence shading) ran only against the harness's stub canvas; a live-browser visual pass wasn't possible from this sandbox. Logic and DOM behavior are covered by the suite.

**Verification**
- `cd test && npm install && node run.mjs` — 43 checks: the 9-way matrix (3 environments × 2/4/8 drones) asserting mapping completes, team coverage ≥95%, and max residual drift <3 cells; click-to-navigate arrival; DOM lifecycle (drone-count/env switches, pause, reset); record-button flow with a stub MCAP writer.
- The full suite was run under four different seed bases (1000/3000/5000/9000 via `SEED_BASE`) — all 43 checks pass under every seed set, so the tuning isn't overfit to one noise roll.

## 2026-07-03 — v0.2: N drones, environment switcher, MCAP recording

**Added**
- Configurable drone count (2-8). Spawn points are now chosen automatically with a farthest-point-sampling heuristic instead of hardcoded coordinates, so any drone count works on any map.
- Environment selector with three presets: "Two rooms" (original layout), "Open warehouse" (scattered obstacles, no bottleneck), "Four rooms" (cross-partition, four doorways). Canvas resizes to match each map's grid size.
- MCAP recording. Start/stop button records drone poses (~10 Hz), per-drone and team coverage, comm-range sync events, goal placements, and the mission log to topics in a `.mcap` file, downloaded via the browser on stop. Uses the official `@mcap/core` library (`TempBuffer` + `McapWriter`) loaded from jsDelivr's ESM CDN — requires internet access on first load, no install/build step.

**Changed**
- Comm-range sharing is now pairwise (any two drones in range merge with each other) instead of a single hardcoded pair-check, so it scales to N drones.
- Frontier assignment now excludes every other drone's current target, not just one.
- Frontier *pathing* now treats unknown cells as passable (only confirmed walls block the search), not just already-seen free cells. See bug below for why.
- Per-cell map tinting changed from "seen by A / seen by B" (only meaningful for exactly 2 drones) to "explored (1 drone) / shared (2+ drones)", since it needs to scale to N.

**Bugs found and fixed during this pass**
- *Exploration could get permanently stuck at ~80% coverage.* Root cause was actually two separate issues, found by writing a plain-Node test that logged "is there really no way to keep exploring here" whenever a drone declared itself done:
  1. The frontier search only ever pathed through cells already confirmed free. Coarse raycasting (12 rays) occasionally leaves a thin "shadow" of still-unknown cells between two known-free patches — geometrically walkable, but invisible to a planner that refuses to route through anything it hasn't already seen. Fix: allow the search to route through unknown cells (only actual known walls block it), which is also just a more accurate model of real frontier exploration.
  2. Added a fallback "wander to the farthest known cell and re-scan" behavior for when frontier search still comes up empty — a cheap way to shake loose any remaining shadowed pockets from a new vantage point, capped at 3 attempts before genuinely giving up.
  3. While chasing this, found the actual root cause was simpler than either of the above: my first "four rooms" map generator only cut door gaps at the center crossing, which fully sealed off one quadrant with no door at all — the algorithm was correctly reporting "nothing more I can reach," the map was just broken. Fixed the generator to cut one door per wall-half (4 doors total), which is the standard four-rooms topology. Kept the two algorithm-side fixes above anyway since they're a genuine robustness improvement independent of this specific bug.
- Caught via a 9-way test matrix (3 environments × drone counts 2/4/8) that asserts 95%+ team coverage — this specific failure only showed up on "four rooms" with N=2, since larger N or the other maps happened not to exercise the sealed room / shadow-gap paths.

**Known limitations / things to watch**
- MCAP writing requires the `@mcap/core` CDN module to load — if you're offline, recording will fail with a log message; the sim itself still runs fine without it.
- The live browser fetch of `@mcap/core` from jsDelivr's `+esm` endpoint isn't verifiable from this sandbox (no live browser+network path here). The library's own API contract *is* verified for real (see below) — only the CDN resolution step is unverified. If it ever fails to load, the error will show in the browser console and as a log line in the mission log.
- Comm-range lines are drawn for every pair of drones currently in range; with 8 drones and many simultaneous links this could look busy. Not a bug, just a visual density tradeoff.
- Environment switch and drone-count change both trigger a full reset (mapping restarts from scratch). There's no way yet to change these mid-mission.
- The exploration/coordination logic is still a simplified stand-in for the real Nano-C-SLAM algorithm (frontier-BFS + pairwise map merge), not a port of the actual graph-SLAM/ICP code. See the chat history for that discussion.

**Verification**
- 9-way matrix (2/4/8 drones × two-rooms/warehouse/four-rooms) run through a plain-Node harness: all 9 reach 95%+ team coverage with no thrown errors, confirming the stuck-at-80% bug is actually fixed and didn't just move to a different N/map combination.
- Full DOM lifecycle re-tested with jsdom for this version: default 2-drone run, live switch to 5 drones, live environment switch to four-rooms, click-to-navigate, reset into 8-drone warehouse — all reached 100% team coverage with no exceptions.
- MCAP integration verified two ways: (1) the exact calling pattern (queue → sequential awaited `addMessage` → `end` → download) tested in jsdom with a stub writer to confirm control flow and button-state transitions are correct; (2) the real `@mcap/core` package tested in plain Node — wrote 102 JSON messages across 4 topics, read them all back via `McapStreamReader`, topic and message counts matched exactly.

## 2026-07-03 — v0.1: initial 2-drone prototype

**Added**
- Single-file HTML/canvas simulation of two drones performing frontier-based exploration on a fixed two-room floor plan.
- Occupancy grid built via 12-ray raycasting per drone against ground-truth walls.
- Pairwise map merge when drones come within comm range (stand-in for UWB-triggered sync).
- Auto-transition to a "navigate" phase once both drones exhaust reachable frontiers, or manually via a button once team coverage crosses 25%.
- Click-to-navigate: BFS pathfinding over the merged map to a user-chosen point.

**Verification**
- Core exploration/merge/pathfinding logic unit-tested outside the DOM (plain Node script) for 4000 simulated ticks: both drones reached 100% coverage, two comm-range sync events fired near the doorway, and A→B pathfinding succeeded.
- Full DOM lifecycle (mapping → auto nav switch → click-to-navigate → reset → re-explore) tested headlessly with jsdom; no exceptions, coverage and phase transitions behaved as expected.

**Design note**
- This is a simplified illustration of the ideas behind ETH-PBL's Nano-C-SLAM (frontier exploration, limited-range collaborative map sharing, BFS navigation), built for exploring the concept in a browser — not a port of the actual firmware algorithm, which lives in `cslam-gap9-app/slam` and `icp/` in the [Nano-C-SLAM repo](https://github.com/ETH-PBL/Nano-C-SLAM) and is bare-metal C for an STM32 + GAP9 co-processor.

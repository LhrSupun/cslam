# Changelog

All notable changes to the collaborative SLAM sim are logged here, newest first.

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

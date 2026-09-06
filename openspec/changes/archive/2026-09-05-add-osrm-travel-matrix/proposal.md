# Proposal: add-osrm-travel-matrix

## Why

The travel-time heuristic (straight-line × detour factor) misestimates legs wherever rivers, rail lines or hills intervene — the spec's decision #2 says "trust the heuristic, make correction effortless", but v1 upgrades the cost function: real walking times from OSRM's `/table` API (one N×N call), cached, with seamless fallback to the heuristic. This is the biggest itinerary-quality win available and users immediately see more believable times.

## What Changes

- **OSRM matrix client** (new): one `/table/v1/foot/...` request per trip covering all places + bases, returning the full N×N matrix. Public demo server for dev (`router.project-osrm.org`), base URL configurable via a dev-panel flag so self-hosting needs no code change.
- **Solver integration**: matrix resolution order becomes override → cached API result → heuristic; API-sourced legs carry `source: "api"` and show the api badge/explanation in the timeline.
- **Persistent cache**: API results cached in IndexedDB keyed by rounded coordinates + profile, so reloads and re-solves don't re-hit the network; only new/moved places trigger a fetch.
- **Graceful degradation**: offline, rate-limited or failed OSRM → heuristic entries, plus a one-time toast noting fallback. Solve flow: heuristic itinerary renders immediately; the OSRM matrix fetches in the background and triggers one re-solve when it arrives.
- **Bounds**: only pairs within a configurable max table size (public demo ~100 nodes) — trips within limits get full matrices; oversize trips fall back to heuristic for now.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `itinerary-solver`: travel-time matrix gains a cached routing-API source between override and heuristic; solving SHALL NOT block on the network.
- `itinerary-view`: legs show api source badges; a toast indicates when the routing API was unavailable and heuristic times are in use.

## Impact

- New `packages/geo/src/osrm.ts` (typed `/table` client, injectable fetch, tests with mocked responses).
- `packages/solver/src/matrix.ts` (api layer + cache injection), `packages/solver/src/solve.ts` (accept prefetched matrix data).
- `apps/web`: `solverClient`/worker flow (fetch on main thread, pass durations into worker — workers stay network-free and deterministic), IndexedDB cache in `packages/storage`, dev-panel flag for OSRM base URL, toast wiring.
- Determinism preserved: solver output depends only on (trip, settings, seed, cached matrix) — network never inside the solver.
- External service: public OSRM demo server (usage-policy: light use; self-host flag provided).

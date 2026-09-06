# Tasks: add-trip-planner-mvp

## 1. Monorepo bootstrap

- [x] 1.1 Initialize pnpm workspace (pnpm-workspace.yaml, root package.json, tsconfig base, .gitignore) with packages `apps/web`, `packages/domain`, `packages/geo`, `packages/solver`, `packages/storage` and TypeScript project references
- [x] 1.2 Configure Vitest at root with per-package test scripts; `pnpm test` runs everything
- [x] 1.3 Scaffold Vite + React + TS app in `apps/web` with path aliases to packages

## 2. Domain model (packages/domain)

- [x] 2.1 Define zod schemas + TS types for `Trip`, `Place`, `Day`, `TravelOverride`, `TripSettings`, `Itinerary`/`DayPlan`/`Stop`/`Leg` per specification.md §4, including `schemaVersion` and nanoid ID helpers
- [x] 2.2 Time helpers: `"HH:mm"` ↔ minutes-since-midnight conversion; no `Date` in solver-facing types
- [x] 2.3 Round-trip serialization tests (parse/serialize, version check)

## 3. Geo (packages/geo)

- [x] 3.1 Haversine distance + unit tests
- [x] 3.2 Photon geocoding client: debounce, result cache interface, identifying headers where possible, typed results

## 4. Solver (packages/solver)

- [x] 4.1 Travel-time matrix: override-then-heuristic resolution, walk/transit threshold, detour factor, per-place incremental row/column update; unit tests
- [x] 4.2 Giant tour: nearest neighbour + 2-opt/Or-opt; unit tests
- [x] 4.3 Prins split DP into day segments with per-day budgets, bases (baseStart/baseEnd) and appointment-forced days; unit tests
- [x] 4.4 Day sequencing: Solomon I1 insertion with forward time propagation, hard appointment windows, pinned-order constraints, 2-opt/Or-opt improvement with O(1) feasibility checks; unit tests
- [x] 4.5 ALNS ruin-and-recreate with seeded RNG, time budget, ~100 ms progress callbacks, weighted objective (travel, wait, dropped must/nice, day imbalance); determinism test (same seed+input → same itinerary)
- [x] 4.6 Incremental re-solve API: place move/dwell change/drag-across-days affecting only touched days; locked days excluded; unscheduled pool with reasons `no_time | window_conflict | unreachable`
- [x] 4.7 Tokyo-like fixture (~30 places, 5 days) with regression assertions on score/totalTravelMin/unscheduled.length
- [x] 4.8 Performance tests: full solve and edit re-solve at N=50 within budget (generous CI margins)

## 5. Storage (packages/storage)

- [x] 5.1 `TripRepository` interface (list/get/put/delete/exportJson/importJson)
- [x] 5.2 Dexie `LocalRepository` with schema-version validation and migration hook; tests with fake-indexeddb
- [x] 5.3 JSON export/import with zod validation and clear rejection of invalid files; round-trip tests

## 6. Web worker bridge (apps/web)

- [x] 6.1 Comlink worker exposing `solve(snapshot, { onProgress, onDone })`; frozen snapshot in, itinerary out
- [x] 6.2 Zustand store: current trip, undo/redo stacks (immer snapshots), latest itinerary, solver status; swaps in progressive itineraries without blocking UI

## 7. Trip & place management UI (apps/web)

- [x] 7.1 Trip creation form (name, date range → generated days) and day settings editor (start/end times, baseStart/baseEnd hotels)
- [x] 7.2 Map with MapLibre + OpenFreeMap tiles, OSM attribution, click-to-add place
- [x] 7.3 Geocoding search box (debounced, cached via packages/geo) to add places
- [x] 7.4 Place editor: name, category, dwell, priority (3 tiers), appointment (day + start time), notes
- [x] 7.5 Trip list / open / delete using TripRepository; JSON export/import buttons with error display

## 8. Itinerary view UI (apps/web)

- [x] 8.1 Split view (map | timeline) on desktop, tabs on mobile; numbered per-day-coloured markers; hover cross-highlighting map ↔ timeline
- [x] 8.2 Timeline: per-day sections with stops (arrive/dwell/depart/wait) and legs (minutes, mode, source badge, explanation tooltip, inline override edit, Google Maps deep link)
- [x] 8.3 Unscheduled "couldn't fit" tray with per-place reason
- [x] 8.4 Progressive solve rendering: greedy itinerary immediately, improvements animate in, no blocking spinner

## 9. Manual tweaks (apps/web)

- [x] 9.1 Drag place between days (HTML5 DnD) + "move to day N" context-menu fallback; triggers incremental re-solve
- [x] 9.2 Pin place to position and lock day toggles; re-solve respects pins/locks
- [x] 9.3 Undo/redo buttons + keyboard shortcuts across all edits, with itinerary re-solve after restore

## 10. Polish & verification

- [x] 10.1 PWA manifest + service worker for app shell and trip data offline (no tile pre-caching)
- [x] 10.2 Hidden dev panel with heuristic-constant and solver-strategy feature flags
- [x] 10.3 `pnpm build` passes for all packages and the web app; `pnpm test` green; README with run instructions

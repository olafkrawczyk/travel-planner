# Design: add-trip-planner-mvp

Architecture follows `specification.md` (the authoritative product/architecture spec). This document records how the MVP maps to code and which spec decisions are binding.

## Monorepo layout

pnpm workspaces + TypeScript project references:

```
apps/web            React 18 + Vite + PWA (vite-plugin-pwa), Zustand UI state
packages/domain     types + zod schemas + schemaVersion + migrations, zero deps beyond zod/nanoid
packages/geo        haversine, geocoding client (Photon), OSM helpers
packages/solver     matrix, giantTour, split, tsptw, alns, incremental — zero DOM deps
packages/storage    TripRepository interface + Dexie LocalRepository
```

Path aliases `@app/domain` etc. via tsconfig `paths` + Vite resolve. Vitest at the root, per-package test scripts.

## Binding decisions (from specification.md §8 and §10)

1. **Route-first is the default solver strategy**; cluster-first is out of scope for MVP (feature-flag constant exists but only `routeFirst` implemented).
2. **Heuristic travel times** with effortless correction: every leg editable inline, Google Maps deep link, `source` badge, pair-level `TravelOverride` storage.
3. **Hotel-change days** via `Day.baseStartId`/`baseEndId`; check-out/check-in modelled as ordinary stops with dwell; luggage toggle deferred to v1.
4. **Priority is 3-tier stored data**; solver maps tiers to internal weights.
5. **Time = integer minutes-since-midnight** inside the solver; `"HH:mm"` strings at the boundary; no `Date` across the worker boundary; one `timezone` string on the trip.
6. **Deterministic solver**: seeded RNG (mulberry32 or similar) in solver input; same input → same itinerary.
7. **Client-generated IDs** (nanoid) everywhere.
8. **Solver input is a frozen snapshot**: worker receives `Trip + settings + seed`, returns `Itinerary` + progress events; no shared mutable state.
9. **Feature flags**: `solverStrategy` and heuristic constants in a hidden dev panel.
10. **Undo/redo**: immer-based immutable snapshots in memory; only the current snapshot persisted.
11. **Geocoding hygiene**: debounce, IndexedDB cache, 1 req/s, identifying User-Agent where possible, ODbL attribution on the map.
12. **PWA offline scope**: app shell + trip data only; no tile pre-caching.

## Solver pipeline (packages/solver)

Pure functions, each independently unit-tested with fixtures:

- `matrix(trip, settings) → T[i][j]`: override → heuristic (haversine × detourFactor; walk if ≤ walkMaxKm else transitOverhead + d/transitSpeed). Asymmetric-capable type; heuristic symmetric. Cache keyed by `(fromId, toId, settingsHash)`; single-place moves recompute one row+column.
- `giantTour(nodes, T)`: nearest neighbour + 2-opt/Or-opt.
- `split(tour, days, T)`: Prins split DP, O(N²); segment cost = baseStart → segment → baseEnd incl. dwell + travel; appointment-forced placements handled by constraining cut feasibility.
- `sequenceDay(day, places, T)`: Solomon I1 insertion with forward time propagation (`arrive = max(departPrev + T, windowOpen)`), hard windows for appointments, then 2-opt/Or-opt with precomputed earliest-arrival/latest-departure for O(1) feasibility checks.
- `alns(state, budgetMs, onProgress)`: ruin 10–20% (random / geographic / worst-detour), recreate via insertion across days, simulated-annealing acceptance, post best every ~100 ms.
- `resolve(trip, edit)`: incremental — affected days only; locked days excluded from ruin; pinned orders are insertion constraints; unscheduled pool participates in recreate.

Objective: `score = w1·travelMin + w2·waitMin + w3·mustDropped + w4·niceDropped + w5·dayImbalance`, weights in settings.

Time budget: initial solve 300–1000 ms ALNS after instant greedy+split result; edit re-solve ≤100 ms ALNS; N=50 target.

## Worker bridge (apps/web ↔ packages/solver)

Comlink-exposed `solve(snapshot, callbacks)` API. Callbacks: `onProgress(itinerary)`, `onDone(itinerary, stats)`. The Zustand store owns the worker client and swaps itineraries in place as progress arrives (never a spinner).

## UI structure (apps/web)

- `TripScreen`: split view (map | timeline) on desktop, tab bar on mobile.
- Map: MapLibre GL JS + OpenFreeMap vector tiles, numbered markers coloured per day, click-to-add, search box (Photon via packages/geo).
- Timeline: per-day columns/list; stop rows (arrive, dwell, depart, wait); leg rows (minutes, mode, source badge, explanation tooltip, inline override edit, Google Maps link).
- Unscheduled tray below timeline with reasons.
- Interactions: HTML5 drag-and-drop between days + "move to day" context menu fallback; pin toggle per stop; lock toggle per day header; undo/redo buttons + keyboard shortcuts.
- State: Zustand store holds current trip snapshot, undo/redo stacks, latest itinerary, solver status.

## Storage (packages/storage)

`TripRepository` interface: `list/get/put/delete/exportJson/importJson`. `LocalRepository` on Dexie; zod parse on read/write with `schemaVersion` check and migration hook (identity migration for v1). JSON export = schema-validated serialized trip; import validates and shows errors.

## Testing

- Vitest unit tests per solver stage (matrix, tour, split, sequencing, ALNS determinism, incremental edits, locks/pins).
- Fixture: a real-city place list (~30 places, 5 days) in `packages/solver/fixtures/` asserting `score`, `totalTravelMin`, `unscheduled.length` against recorded baselines (regression guard).
- Performance test: full solve and edit re-solve at N=50 complete within budget thresholds (generous CI margins).
- Domain round-trip tests (zod parse/serialize), storage round-trip via fake-indexeddb.

## Risks / trade-offs

- **Prins split + appointments interaction**: forced-day placements complicate the DP; fallback is post-split repair via insertion. Acceptable at MVP quality bar.
- **OpenFreeMap/Photon availability**: third-party free services; app degrades to manual map-click adding and cached data offline.
- **One giant change**: mitigated by tasks ordered so packages land bottom-up (domain → geo → solver → storage → web) and stay individually testable.

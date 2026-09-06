# Proposal: add-trip-planner-mvp

## Why

Trip planning across many places and days is a VRPTW/TOPTW (Tourist Trip Design Problem), and existing tools don't solve it. This repo currently contains only a product/architecture spec (`specification.md`); there is no code. This change bootstraps the full MVP: a browser-only app where a user enters places, dwell times, priorities, appointments and hotels, and gets a day-by-day itinerary that recalculates in well under a second on every edit.

## What Changes

- **Monorepo bootstrap**: pnpm workspaces + Vite + React + TypeScript with packages `packages/domain`, `packages/geo`, `packages/solver`, `packages/storage` and `apps/web` (PWA).
- **Domain model**: zod-validated, versioned schemas (`Trip`, `Place`, `Day`, `TravelOverride`, `TripSettings`, `Itinerary`) with client-generated IDs and integer minutes-since-midnight time representation.
- **Persistence**: Dexie (IndexedDB) behind a `TripRepository` interface (`LocalRepository` now), JSON export/import of trips, undo/redo via immutable snapshots.
- **Solver package** (zero DOM deps, runs in a Web Worker via Comlink):
  - Heuristic asymmetric-capable travel-time matrix (walk/transit threshold, detour factor, per-pair user overrides), cached and incrementally updated per moved place.
  - Route-first day assignment: giant TSP tour (nearest neighbour + 2-opt/Or-opt) + Prins split DP.
  - Within-day sequencing: Solomon I1 insertion with hard appointment windows, then 2-opt/Or-opt improvement.
  - Anytime ALNS ruin-and-recreate global improvement with time budget, seeded RNG (deterministic), and progress callbacks for live UI updates.
  - Incremental re-solve on edits (move place, drag across days, dwell change) respecting day locks and pinned orders.
  - Unscheduled pool with reasons (`no_time`, `window_conflict`, `unreachable`).
- **Web app UI**:
  - Trip creation (name, date range, base/hotel per day, day start/end times).
  - Map (MapLibre GL JS + OpenFreeMap vector tiles) with numbered per-day-coloured markers; add places by map click or geocoding search (Photon/Nominatim, debounced, cached).
  - Timeline itinerary view (split view with map on desktop, tabs on mobile) showing arrive/stay/depart, travel legs with source badge, wait time, and Google Maps deep link per leg; inline leg travel-time overrides.
  - Manual tweaks: drag place between days (with "move to day" menu fallback), pin a place to a position, lock a day — re-solve respecting constraints.
  - Unscheduled "couldn't fit" tray; live plan updates as ALNS improves (never a blocking spinner).
- **Tests**: Vitest across packages; solver fixtures (a real-city place list) with regression assertions on score/travel/unscheduled; performance sanity checks for the <1s edit re-solve budget at N=50.

Explicitly out of scope (v1/v2 per `specification.md`): routing-API matrices, opening-hours integration, drop-lowest-priority UI, hierarchical planning, share-by-URL, accounts/sync.

## Capabilities

### New Capabilities

- `trip-management`: creating/editing trips, days (start/end times, base/hotel per day), places (category, dwell, priority, notes), fixed appointments, per-pair travel-time overrides.
- `itinerary-solver`: travel-time matrix, day assignment (giant tour + Prins split), within-day sequencing with time windows, anytime ALNS improvement, incremental re-solve, deterministic seeded runs, unscheduled reporting.
- `itinerary-view`: map + timeline rendering of the solved itinerary, per-day colours, leg explanations with source badges, manual tweaks (drag/pin/lock) and live updates during solving.
- `trip-persistence`: IndexedDB storage via `TripRepository`, versioned schemas, JSON export/import, undo/redo.

### Modified Capabilities

(none — no existing specs)

## Impact

- **New code**: entire repo — `package.json` workspaces, `apps/web`, `packages/{domain,geo,solver,storage}`, Vitest config, worker bridge (Comlink).
- **Dependencies**: react, vite, zustand, dexie, zod, immer, maplibre-gl, comlink, nanoid, vitest (all dev/runtime; no backend).
- **External services**: public Photon/Nominatim geocoding and OpenFreeMap tiles (client-side, usage-policy compliant: debounce, cache, attribution).
- **Systems**: none (local-only PWA); architecture keeps solver and storage behind interfaces so v1/v2 (routing APIs, sync) plug in without UI changes.

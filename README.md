# Travel Planner

A browser-only, day-by-day trip planner with a real itinerary solver (aTourist Trip Design Problem / TOPTW). Enter places with dwell times, priorities and fixed appointments, and the app produces a multi-day plan that recalculates in well under a second on every edit. All data stays on your device.

## Features

- **Trip management** — create a trip from a date range (one day per date), configure each day's start/end times and wake-up/sleep bases (hotel changes supported), edit places (category, dwell, 3-tier priority, appointment day + time, notes).
- **Places** — add by geocoding search (Photon, debounced + cached) or by clicking the map (MapLibre GL JS + OpenFreeMap vector tiles, OSM attribution).
- **Solver** (Web Worker, deterministic seeded runs):
  - heuristic travel-time matrix (walk/transit threshold, detour factor, per-pair user overrides),
  - route-first day assignment (giant tour + Prins split),
  - within-day sequencing with hard appointment windows and pinned orders,
  - anytime ALNS ruin-and-recreate improvement with live progress updates,
  - incremental re-solve on edits (move, dwell change, drag across days) that respects day locks and pins,
  - honest unscheduled pool with reasons (`no_time`, `window_conflict`, `unreachable`).
- **Itinerary view** — split view (map | timeline) on desktop, tabs on mobile; numbered per-day-coloured markers with hover cross-highlighting; per-leg minutes, mode, source badge (heuristic/override), explanation tooltip, inline travel-time override and a Google Maps deep link.
- **Manual tweaks** — drag a place between days (HTML5 DnD) or use the "move to day N" menu, pin a place to a position, lock a whole day.
- **Undo/redo** — across all edits (buttons + Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y).
- **Persistence** — IndexedDB (Dexie) behind a `TripRepository` interface, versioned zod-validated schemas, JSON export/import with clear error display.
- **PWA** — installable, offline-capable app shell + trip data (map tiles are never pre-cached).
- **Hidden dev panel** — heuristic constants and solver-strategy flags; open with **Ctrl/Cmd+Alt+D**.

## Getting started

Requirements: Node.js 18+ and [pnpm](https://pnpm.io) 8+.

```bash
pnpm install
pnpm dev        # start the dev server (apps/web)
```

Open the printed URL (default http://localhost:5173).

### Other commands

```bash
pnpm build      # typecheck + build all packages and the web app (PWA output in apps/web/dist)
pnpm test       # run the full Vitest suite across all packages
pnpm typecheck  # TypeScript project-reference build (tsc -b)
```

## Repository layout

```
apps/web            React 18 + Vite PWA (Zustand store, Comlink worker bridge, MapLibre map, timeline)
packages/domain     zod schemas + types, schemaVersion, "HH:mm" ↔ minutes helpers
packages/geo        haversine distance, Photon geocoding client (debounce + cache)
packages/solver     matrix, giantTour, split, sequence, alns, incremental resolve — pure, zero DOM deps
packages/storage    TripRepository interface + Dexie LocalRepository (IndexedDB)
```

## Troubleshooting

- **`DataCloneError: ... could not be cloned` when solving** — callbacks across the Comlink worker bridge are marked with a per-module Symbol; a stale Vite pre-bundle of `comlink` (in `apps/web/node_modules/.vite`) can leave two copies in play so the marker mismatches and Comlink falls back to structured-cloning the raw function. Clear the stale pre-bundle and site data: `rm -rf apps/web/node_modules/.vite`, restart `pnpm dev`, and run devtools → Application → "Clear site data" once.

## External services

- [OpenFreeMap](https://openfreemap.org) — vector tiles (client-side, cached at runtime, never pre-cached).
- [Photon](https://photon.komoot.io) — geocoding (debounced, cached, identifying headers where possible). Map data © OpenStreetMap contributors, ODbL.

No backend, no accounts, no sync — everything runs and stays in the browser.

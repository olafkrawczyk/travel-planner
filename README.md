# Travel Planner

A browser-only, day-by-day trip planner with a real itinerary solver (aTourist Trip Design Problem / TOPTW). Enter places with dwell times, priorities and fixed appointments, and the app produces a multi-day plan: a usable itinerary appears in well under a second, and edits (move a place, change its dwell time, drag it to another day) re-solve in about that same time, well under a second. The solver then keeps refining the plan in the background for a few seconds more — see [Solver performance](#solver-performance) below for what that means in practice. All data stays on your device, with the caveats in [Privacy](#privacy).

## Features

- **Trip management** — create a trip from a date range (one day per date), configure each day's start/end times and wake-up/sleep bases (hotel changes supported), edit places (category, dwell, 3-tier priority, appointment day + time, notes).
- **Places** — add by geocoding search (Photon, debounced + cached) or by clicking the map (MapLibre GL JS + OpenFreeMap vector tiles, OSM attribution).
- **Solver** (Web Worker; deterministic for a given seed + input + time budget — the same trip and edit always produce the same itinerary, regardless of how fast or slow the machine running it is):
  - heuristic travel-time matrix (walk/transit threshold, detour factor, per-pair user overrides),
  - route-first day assignment (giant tour + Prins split),
  - within-day sequencing with hard appointment windows and pinned orders,
  - anytime ALNS ruin-and-recreate improvement with live progress updates, stopping early once it stops finding improvements rather than always spending its full time budget,
  - incremental re-solve on edits (move, dwell change, drag across days) that respects day locks and pins,
  - honest unscheduled pool with reasons (`no_time`, `window_conflict`, `unreachable`).
- **Itinerary view** — split view (map | timeline) on desktop, a persistent map with a resizable bottom sheet on mobile; numbered per-day-coloured markers with hover cross-highlighting; per-leg minutes, mode, source badge (heuristic/override), explanation tooltip, inline travel-time override and a Google Maps deep link.
- **Manual tweaks** — drag a place between days (HTML5 DnD) or use the "move to day N" menu, pin a place to a position, lock a whole day.
- **Undo/redo** — across all edits (buttons + Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y).
- **Persistence** — IndexedDB (Dexie) behind a `TripRepository` interface, versioned zod-validated schemas, JSON export/import with clear error display.
- **PWA** — installable, offline-capable app shell + trip data (map tiles are never pre-cached).
- **Hidden dev panel** — heuristic constants and solver-strategy flags; open with **Ctrl/Cmd+Alt+D**.

## Solver performance

The solver is *anytime*: it always has a feasible plan ready and improves it in place, so the app never blocks on "the solve" — it shows a plan immediately and a small non-blocking indicator (never a full-screen spinner) while it keeps improving.

- **First plan** (opening a trip, or a full re-solve): the initial route-first construction (matrix + giant tour + day split + per-day sequencing) typically finishes in well under half a second, even for a large (~100-place) trip — that initial plan is shown right away.
- **Edits** (move a place, change its dwell time, drag it to another day): only the affected day(s) are re-solved, typically in ~100-200ms — well under a second — regardless of trip size, because the incremental solve is capped at a fixed number of search iterations rather than a large time budget.
- **Background improvement**: after the first plan appears, an ALNS (ruin-and-recreate) search keeps improving it for up to several seconds, posting a better result roughly every 100ms, and stopping automatically once it stops finding improvements rather than always spending its full time allowance. For a large trip this settled result can take a few seconds to arrive; the itinerary shown at every point along the way is a valid, usable plan, not a placeholder.

These numbers come from `packages/solver/src/perf.test.ts` and manual profiling at the app's shipped time budgets, not aspirational targets; they will vary with hardware and trip size.

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

## Development troubleshooting

These affect `pnpm dev` only — a production build (`pnpm build`) has no dependency pre-bundling step, so a deployed/shipped app cannot hit them.

- **`DataCloneError: ... could not be cloned` when solving** — callbacks across the Comlink worker bridge are marked with a per-module Symbol; a stale Vite pre-bundle of `comlink` (in `apps/web/node_modules/.vite`) can leave two copies in play so the marker mismatches and Comlink falls back to structured-cloning the raw function. Clear the stale pre-bundle and site data: `rm -rf apps/web/node_modules/.vite`, restart `pnpm dev`, and run devtools → Application → "Clear site data" once.

## External services

Everything below is a direct call from your browser to a third-party service — there is no app backend in between, and nothing is proxied or logged by this project. Requests carry only what's needed for that lookup (a search string, or the coordinates of places you've added), never your whole trip.

- [OpenFreeMap](https://openfreemap.org) — vector map tiles (client-side, cached at runtime, never pre-cached). **Always on.**
- [Photon](https://photon.komoot.io) — geocoding search (debounced, cached, identifying headers where possible). Map data © OpenStreetMap contributors, ODbL. **Always on**, triggered as you type in the place search box.
- [Overpass API](https://overpass-api.de) — looks up OSM opening-hours tags to prefill a place's hours. **On by default**, one small request per place you add via search (not for places added by clicking the map). Requests are serialized and rate-limited client-side (never in parallel, at least 1 request/second, with backoff on 429/503) to stay within Overpass's fair-use policy. Turn it off in the hidden dev panel (`autoFetchOpeningHours`).
- [OSRM](http://project-osrm.org) — routing-API travel times (real walking/driving durations) instead of the built-in straight-line heuristic. **Off by default** — enable it in the hidden dev panel by pointing `osrmBaseUrl` at a server that actually serves the profile you need; see that flag's description in the dev panel for why the public demo server is not a safe default here. When enabled, a full solve sends the coordinates of every place and hotel in the trip to that server in one `/table` request (cached locally by coordinates+profile, so unchanged trips don't refetch); incremental edits don't call it.

No backend, no accounts, no sync — trip data itself is never sent anywhere by this app. See [Privacy](#privacy) for the nuances that come with the external services above and with sharing a trip link.

## Privacy

Trip data is stored only in your browser (IndexedDB) and is never uploaded by this app — there is no backend to send it to. Two things to be aware of:

- **Third-party lookups.** Adding a place, searching, or panning the map sends typed search text, place coordinates, or map-tile requests to the external services listed above (Photon, Overpass, OpenFreeMap, and OSRM if you enable it). See that section for exactly what each one receives.
- **Share links.** "Share trip" encodes your entire trip (places, notes, dates) into the URL's `#trip=...` fragment — the link itself *is* your data, compressed and base64-encoded, not a pointer to something stored on a server. Anywhere you paste that link (chat, email, a URL shortener) can see the trip's contents, and browser history keeps it too.

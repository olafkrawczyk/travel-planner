# Trip Route Planner — Product & Architecture Spec (v0.1)

Working ref: `2e5243c5bf8feffd63845ce850a2543b956bab86`

## 1. One-paragraph pitch

You give it a pile of places you want to see on a trip (30 spots, 5 days), how long you want to spend at each, any fixed appointments, and where you sleep. It hands back a day-by-day itinerary: which places on which day, in what order, with estimated arrival/departure times, starting and ending at your hotel. A usable plan appears in well under a second, and edits recalculate in about that same time; the solver then keeps improving the plan in the background for a few seconds more (see §5.4-5.6). Runs entirely in the browser; accounts and sync come later.

## 2. Problem framing (this matters for algorithm choice)

This is **not** a shortest-path problem. Shortest path (Dijkstra, bidirectional Dijkstra, A*, contraction hierarchies — what Google/OSRM do) answers "how do I get from A to B on the road network". You need that only as a *black-box cost function\*. The actual problem is:

> **Multi-day Vehicle Routing Problem with Time Windows (VRPTW)**, where each day is one "vehicle", the hotel is the depot, each place has a service time (dwell) and optional time windows, and days have a start/end time budget. When not everything fits, it becomes a **Team Orienteering Problem with Time Windows (TOPTW)** — pick the subset of places that maximizes value. In the literature this exact application is called the **Tourist Trip Design Problem (TTDP)**.

Good news: N is tiny (30–100 places). Heuristics that would be "slow" in logistics (10k stops) run in milliseconds here. You do not need OR-Tools, you can write the solver in ~1–2k lines of TypeScript.

## 3. Scope

### MVP (single user, local-only)

- Create a trip: name, date range, home base (hotel) per day (allows hotel change mid-trip).
- Add places: search (geocoding) or click on map; set category, dwell time, priority (must / want / nice-to-have), optional notes.
- Day settings: start time, end time, optional fixed start/end location (airport, station).
- Fixed appointments: "Kusama Museum at 14:00, 90 min" → hard time window.
- Per-pair travel time override: "Hotel → Fuji day trip = 2h by bus".
- Solve: cluster into days, order within day, compute timeline.
- Itinerary view: map with numbered markers per day + timeline list (arrive, stay, depart, travel leg, waiting).
- Manual tweaks: drag a place to another day, pin a place to a position, lock a whole day → re-solve respecting locks.
- Persist trips in IndexedDB; export/import JSON.

### v1

- Opening hours (OSM `opening_hours` syntax, prefilled from OSM data when available) as time windows.
- Real travel-time matrix from a routing API (OSRM / Valhalla / openrouteservice) instead of pure heuristic; walking vs transit mode per leg.
- "Doesn't fit" handling: drop lowest-priority places, show what was dropped and why.
- Hierarchical planning: country level (cities as nodes, hotels per city) → city level.
- Share trip via URL (compressed JSON in fragment) — cheap collaboration before accounts.

### v2

- Accounts + backend + sync across devices.
- Multi-user editing of the same trip.
- Real transit routing (GTFS) — out of scope until v2+, explicitly.
- Weather / lunch-slot heuristics, "cafe near the museum" suggestions.

### Explicit non-goals for now

- Turn-by-turn navigation.
- Booking anything.
- True optimality proofs.

## 4. Domain model

Keep the solver's model independent of the UI model. Versioned schemas (zod) from day one so IndexedDB data and later DB rows migrate cleanly.

```ts
type Id = string;

interface Trip {
  id: Id;
  version: number;
  name: string;
  days: Day[];
  places: Place[];
  travelOverrides: TravelOverride[];
  settings: TripSettings;
  createdAt: string;
  updatedAt: string;
}

interface Place {
  id: Id;
  name: string;
  lat: number;
  lng: number;
  category:
    | "museum"
    | "viewpoint"
    | "cafe"
    | "restaurant"
    | "shop"
    | "park"
    | "temple"
    | "other";
  dwellMin: number; // desired time on site
  priority: 1 | 2 | 3; // 1 = must
  timeWindows?: TimeWindow[]; // opening hours, converted per day
  appointment?: { dayId: Id; start: string }; // hard fixed time
  region?: Id; // for hierarchical planning (city)
  osmId?: string;
  notes?: string;
}

interface Day {
  id: Id;
  date: string;
  start: string;
  end: string; // "09:00", "21:00"
  startLocation: Id | "base"; // place id (airport) or the day's base
  endLocation: Id | "base";
  baseStartId: Id; // hotel you wake up in
  baseEndId: Id; // hotel you sleep in (differs on change days)
  luggageForwarded?: boolean; // v1: if false, solver visits baseEnd early to drop bags
  locked?: boolean; // don't touch on re-solve
  pinnedOrder?: Id[]; // user-forced sequence (partial allowed)
}

interface TravelOverride {
  fromId: Id;
  toId: Id;
  minutes: number;
  mode?: Mode;
  symmetric: boolean;
}

interface TripSettings {
  walkSpeedKmh: number; // default 4.5
  walkMaxKm: number; // above this assume transit, default 1.5
  transitSpeedKmh: number; // default 18 (urban door-to-door effective)
  transitOverheadMin: number; // default 8 (wait + walk to station)
  detourFactor: number; // straight-line → street distance, default 1.3
  lunchWindow?: TimeWindow; // v1
}

// Solver output — derived, never hand-edited, recomputed on every change
interface Itinerary {
  days: DayPlan[];
  unscheduled: {
    placeId: Id;
    reason: "no_time" | "window_conflict" | "unreachable";
  }[];
  stats: { totalTravelMin: number; totalWaitMin: number; score: number };
}
interface DayPlan {
  dayId: Id;
  stops: Stop[];
  legs: Leg[];
  slackMin: number;
}
interface Stop {
  placeId: Id;
  arrive: string;
  depart: string;
  waitMin: number;
}
interface Leg {
  fromId: Id;
  toId: Id;
  minutes: number;
  mode: Mode;
  source: "heuristic" | "api" | "override";
}
```

## 5. Solver pipeline

All stages are pure functions over the domain model; run in a Web Worker; each stage can be unit-tested with fixtures (e.g. a real Tokyo list).

### 5.1 Travel-time matrix (cost function)

Build `T[i][j]` in minutes for all nodes (places + bases + airports). N=50 → 2500 entries, negligible.

Priority of sources per pair:

1. User override.
2. Cached routing-API result (v1).
3. Heuristic:
   - `d = haversine(i, j) * detourFactor`
   - if `d <= walkMaxKm` → `d / walkSpeed`
   - else → `transitOverhead + d / transitSpeed` (+ small walk at both ends)

The matrix is **asymmetric-capable** (one-way streets, uphill) but the heuristic is symmetric. Cache by `(fromId, toId, settingsHash)`; only recompute rows for a place that moved. This is the single biggest lever for "recalculation is instant".

Route-engine note: if you ever self-host OSRM for the walking matrix, its `/table` endpoint gives you an N×N matrix in one call (it uses contraction hierarchies / MLD internally — that's where "double Dijkstra"-style tech lives, and you never touch it).

### 5.2 Day assignment (clustering)

Goal: partition places into `|days|` groups, each fitting its day's time budget, geographically compact, respecting appointments (a place with an appointment on day 3 is forced into day 3).

Two approaches — build both, benchmark on real lists:

**A. Cluster-first, route-second (your instinct)**

- k-medoids (k = number of days) on travel-time matrix, not on lat/lng — a river or a rail line makes two close points far apart.
- Capacity-aware: after initial clustering, run a balancing pass moving places from over-budget days to the nearest under-budget day.
- Weakness: clusters can be geographically nice but time-infeasible.

**B. Route-first, cluster-second (giant tour + split) — recommended default**

- Build one giant TSP tour over all places (nearest neighbour + 2-opt/Or-opt).
- Split the tour into consecutive day segments with **Prins' split DP**: `O(N²)` dynamic programming that finds the optimal cut points given each day's time budget, where the cost of a segment = base → segment → base with dwell and travel. Guarantees feasibility w.r.t. time budgets by construction.
- Then re-optimize each day and do inter-day local search (see 5.4).
- This handles "1 area per day or multiple areas per day" naturally — the split decides.

Hierarchical (country level): identical pipeline where nodes = cities, base changes per night, and the travel matrix uses a rail/flight heuristic. City-level solve runs per city with that city's days.

### 5.3 Within-day sequencing (TSP with time windows)

Per day, nodes = base (start) + assigned places + base/end location.

1. Construction: **Solomon I1 insertion** — insert places one by one in the cheapest feasible position, checking time windows/appointments, using forward time propagation (`arrive = max(depart_prev + T, windowOpen)`; wait = the difference).
2. Improvement: 2-opt / Or-opt moves accepted only if still feasible. Use the classic trick of precomputing earliest-arrival / latest-departure per position so feasibility checks are O(1).
3. Appointments are hard windows with zero slack; opening hours are hard windows with slack; lunch is a soft window (penalty).

Objective (weighted, tunable in settings):

```
score = w1 * travelMin + w2 * waitMin + w3 * (must-visit dropped) + w4 * (nice-to-have dropped) + w5 * dayImbalance
```

### 5.4 Global improvement (anytime)

**ALNS / ruin-and-recreate**: repeatedly remove 10–20% of places (random, or a geographic cluster, or the "worst" ones by detour), re-insert with the insertion heuristic across all days, accept if better (or with simulated-annealing probability). Run for a time budget (shipped: 10s for a full solve, 5s for an edit — see §5.6) or until an improvement-stall early exit fires, whichever comes first. Because it's anytime, the worker posts the current best every ~100 ms and the UI updates live — the user sees a good plan instantly and a better one a moment later.

Same loop handles "doesn't fit": an unscheduled pool is just another place the recreate step may insert if a slot opens.

### 5.5 Incremental re-solve

On edit, don't start from scratch:

- Place moved / dwell changed → recompute its matrix row+column, re-run 5.3 on affected day(s), run a short ALNS.
- Drag to another day → remove from source day, insert into target day (cheapest feasible position), re-optimize both days.
- Locked days are excluded from ruin; pinned orders are constraints in insertion.
  Typical edit → new itinerary in ~100-200 ms for N=50, independent of the ALNS time budget below: an edit's search is capped at a fixed iteration count (300 by default) that finishes well before the budget's wall-clock allowance is used — see `packages/solver/src/perf.test.ts`.

### 5.6 Performance budget

- Matrix: O(N²) ≈ instant.
- Giant tour + split: O(N²) ≈ instant — the tour-improvement step evaluates each candidate move as an O(1) edge-cost delta rather than re-scoring the whole tour, which is what keeps this instant at N≈100 (previously ~3s; see `giantTour.ts`).
- Insertion per day: O(n³) worst case, n≈10 → instant.
- ALNS: shipped as a generous wall-clock ceiling (10s initial solve, 5s on edit) that is rarely reached in practice — a fixed iteration cap binds first on edits (~100-200ms), and an improvement-stall early exit typically stops a full solve well before its ceiling too.
- All in a Web Worker via Comlink; UI never blocks.

## 6. Technology

| Concern                 | Choice                                                                                            | Why                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| App                     | React + TypeScript + Vite, PWA                                                                    | Your stack; offline in a foreign country is a real feature                                                                    |
| Map                     | MapLibre GL JS with vector tiles (OpenFreeMap or Protomaps PMTiles)                               | Free, no key, fast, good labels in Japan. Leaflet + raster is simpler but tile.openstreetmap.org forbids production-scale use |
| Geocoding / POI search  | Photon (Komoot) or Nominatim; Overpass for "museums near here"                                    | Free; respect rate limits; cache results                                                                                      |
| Opening hours           | `opening_hours` npm lib                                                                           | Parses OSM `opening_hours` strings into time windows per date                                                                 |
| Routing matrix (v1)     | OSRM `/table` (walking) — public demo for dev, self-host for prod; or openrouteservice matrix API | One call for N×N                                                                                                              |
| State                   | Zustand (UI) + `@tanstack/query` later for sync                                                   | Simple, worker-friendly                                                                                                       |
| Persistence             | Dexie (IndexedDB), not localStorage                                                               | Structured, large enough, transactions, easy migration                                                                        |
| Persistence abstraction | `TripRepository` interface with `LocalRepository` now, `RemoteRepository` later                   | Swap without touching UI or solver                                                                                            |
| Solver                  | separate package `@app/solver`, zero DOM deps                                                     | Runs in worker today, in Node on the backend tomorrow, benchmarkable in CI                                                    |
| Worker bridge           | Comlink                                                                                           | Typed RPC, streaming progress via callbacks                                                                                   |
| Schema                  | zod, `schemaVersion` on every stored record                                                       | Migrations for IndexedDB and DB                                                                                               |
| Tests                   | Vitest; solver benchmarks with fixture cities                                                     | Regressions in route quality are silent otherwise                                                                             |
| Backend (v2)            | NestJS + Postgres (PostGIS) or Supabase                                                           | You know NestJS; PostGIS if you ever do server-side geo queries                                                               |
| Sync (v2)               | Per-record `updatedAt` + last-write-wins; trip-level revision counter; conflicts surfaced in UI   | CRDTs are overkill for a two-person use case                                                                                  |

Monorepo layout:

```
apps/web          React app
packages/domain   types, zod schemas, migrations
packages/solver   matrix, cluster, split, tsptw, alns, incremental
packages/geo      haversine, OSM helpers, opening_hours adapter
packages/storage  TripRepository + Dexie impl (later: remote impl)
```

## 7. UX principles

- Map and timeline are always both visible: split view on desktop, a persistent map with a resizable bottom sheet for the timeline on mobile (not tabs — the map stays visible while browsing the timeline); hovering a stop highlights the marker and vice versa.
- One colour per day everywhere.
- Every solver decision is explainable: tooltip on a leg shows "18 min — transit heuristic (2.9 km)"; click to override.
- Never a *blocking* spinner for the solve — show the greedy plan immediately (a small non-blocking indicator shows while the solver keeps improving it in the background), then animate improvements in.
- Unscheduled places are shown as a visible "couldn't fit" tray, never silently dropped.
- Undo/redo for all edits (state is immutable snapshots, cheap).

## 8. Decisions (2026-09-05)

1. **Route-first (giant TSP + split) is the default.** Cluster-first stays as an optional strategy to benchmark later.
2. **Trust the travel-time heuristic, make correction effortless.** Users verify timings in Google Maps and adjust. Consequences:
   - Every leg in the timeline is editable inline; each has a "check in Google Maps" deep link (`maps/dir/?api=1&origin=..&destination=..&travelmode=transit`).
   - Legs show a `source` badge (heuristic / api / override) so verified vs estimated is visible.
   - Overrides are stored on the pair (`TravelOverride`), not on the itinerary, so they survive re-solves and apply wherever that pair appears.
   - "Take a different route" = pinned sub-sequences (`Day.pinnedOrder`) that the solver treats as constraints, never overwrites.
   - Optional per-city calibration factor for the transit heuristic.
3. **Public OSRM demo is fine for now**; self-host when it becomes a problem.
4. **Hotel-change days are supported in the model**: `Day.baseStart` / `Day.baseEnd` (usually equal). Check-out and check-in are ordinary stops with dwell. Later: a "luggage forwarded" toggle (takkyubin) that controls whether the solver must visit the new hotel early to drop bags.
5. **Priority is a 3-tier field in the data model** (must / want / nice-to-have); the solver maps tiers to weights internally so tuning doesn't touch stored data.

## 9. Suggested build order

1. Domain model + Dexie repo + JSON import/export.
2. Map + add places + dwell/priority editing.
3. Matrix (heuristic) + giant tour + split + per-day 2-opt → first real itinerary. Ship to yourselves.
4. Time windows + appointments (insertion heuristic).
5. ALNS + incremental re-solve + live updating UI.
6. Overrides, locks, pins, drag between days.
7. OSRM matrix, opening hours from OSM.
8. Share-by-URL, then accounts/sync.

## 10. Implementation notes (parking lot — not design decisions)

Things that are cheap to get right on day one and painful to retrofit.

- **Time representation:** the solver works in minutes-since-midnight per day, integers only. UI stores `"HH:mm"` strings plus one `timezone` on the trip. Never pass `Date` objects across the worker boundary or store them.
- **Deterministic solver:** seeded RNG (`seed` in solver input); a time budget is converted up front into a fixed iteration count rather than checked live against the clock during the search, so the same seed + input + budget → the same itinerary regardless of machine speed. (A wall-clock safety valve exists as a last resort against a badly under-costed iteration estimate; it is sized to never engage in normal operation, and a run where it does engage falls outside this guarantee.) Needed for tests, for "why did my plan change?", and for reproducing bugs users report.
- **Client-generated IDs** (nanoid/UUID v7) so places can be created offline and synced later without remapping.
- **Fixtures from real trips:** save every real trip list you plan as JSON in `packages/solver/fixtures/`. They become the benchmark suite; track `score`, `totalTravelMin`, `unscheduled.length` per fixture in CI so a solver change that degrades quality fails the build.
- **Solver input is a snapshot:** the worker receives a frozen `Trip` + settings, returns an `Itinerary`. No shared mutable state, no incremental protocol until the full re-solve is measurably too slow.
- **Place names:** store `name` and `nameLocal` (OSM `name:en` / `name:ja`); showing the Japanese name is what you'll hand to a taxi driver.
- **Geocoding hygiene:** debounce search, cache results in IndexedDB, honour Nominatim/Photon usage policies (1 req/s, identifying User-Agent), show OSM attribution on the map (ODbL requirement).
- **PWA offline scope:** app shell + trip data + already-viewed map tiles only. Don't pre-download tile regions in v0.
- **Feature flags** for solver strategy (`routeFirst` | `clusterFirst`) and heuristic constants, exposed in a hidden dev panel — you'll be tuning these on the road.
- **Undo/redo:** immutable trip snapshots in memory (structural sharing via immer); persist only the current one.
- **Degenerate inputs to handle from the start:** place with no coordinates, more must-visits than time allows, appointment outside the day's hours, two appointments that can't both be reached. Each maps to an `unscheduled.reason`.
- **Mobile drag-between-days** is the hardest UI interaction; design the timeline so a "move to day N" menu exists as a fallback.

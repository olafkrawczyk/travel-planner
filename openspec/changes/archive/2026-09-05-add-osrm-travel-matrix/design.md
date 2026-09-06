# Design: add-osrm-travel-matrix

## Key architectural constraint: network stays out of the worker

The solver worker is deterministic and network-free. Therefore the OSRM fetch happens on the **main thread** before/at solve time, and fetched durations flow INTO the solver as data:

```
store.requestSolve()
  ├─ solve immediately with heuristic matrix (existing path, instant)
  ├─ osrmClient.fetchTable(coords)  (main thread; cache-first)
  │    └─ on arrival → solverClient.solve(trip, { apiMatrix }) → re-solve
  └─ on failure/oversize → toast "using estimated times", done
```

Determinism preserved: solver output depends only on (trip, settings, seed, apiMatrix data).

## Components

### 1. `packages/geo/src/osrm.ts`
- `OsrmClient { fetchTable(coords: {lat,lng}[]): Promise<number[][] /* minutes */> }` — GET `{base}/table/v1/foot/{lng,lat;…}?annotations=duration`, parse `durations` (seconds → minutes, round to 1 decimal). Injectable `fetchFn` for tests. Throws typed errors (http, malformed, oversize).
- Base URL: default `https://router.project-osrm.org`, overridable via dev-panel flag `osrmBaseUrl` (empty = disabled → heuristic only).
- Max nodes guard: `osrmMaxNodes` flag (default 100, public demo limit); oversize → typed `oversize` error → fallback.

### 2. Cache — `packages/storage`
New Dexie table `matrixCache`: key = sha-stable string of rounded coords (4 decimals ≈ 11 m) + profile + osrmBaseUrl; value = { durations: number[][], fetchedAt }. Lookup before fetch; store on success. `MatrixCache` interface in storage package; tests via fake-indexeddb.

### 3. Solver integration — `packages/solver/src/matrix.ts`
- `buildProblem(trip, apiDurations?)`: when provided, entries for known pairs use `apiDurations[i][j]` minutes with `source: "api"`, explanation `"OSRM walking (X km)"` (distance still haversine for display). Node order of apiDurations matches the problem node list (bases + places, documented).
- Precedence: override > api > heuristic (override map consulted first — already the case in `entryFor`; api layer slots between).

### 4. App flow — `apps/web`
- `solverClient.solve(trip, req)` gains optional `apiMatrix` in the (pure-data) request object.
- Store: `requestSolve` kicks the immediate heuristic solve; then (async) ensures the OSRM table: cache lookup → fetch → cache write; on success triggers exactly one follow-up solve with `apiMatrix`; on failure sets toast "Routing API unavailable — times are estimates" (only when it actually tried and failed).
- Race safety: the existing `resolveCounter` already invalidates stale results — the follow-up solve is just another solve in the sequence.
- Worker: unchanged except passing `apiMatrix` through to `buildProblem`.

## Testing

- `osrm.test.ts`: mocked fetch — parses durations, seconds→minutes, error paths (http 500, malformed JSON, oversize guard).
- `matrix.test.ts`: api layer precedence (override > api > heuristic), source badges.
- Cache round-trip test (fake-indexeddb), key stability.
- Existing fixture tests must stay green (they pass no apiMatrix → pure heuristic).

## Risks

- Public demo server reliability/rate limits → mitigated by cache + fallback + toast + self-host flag.
- Foot profile ignores transit: distances > walk threshold may be better served by the heuristic's transit estimate — mitigation: for pairs where heuristic says "transit" (d > walkMaxKm), prefer max(api walking, heuristic transit)? No — keep it simple and predictable: API wins for ALL non-override pairs when available (it's the "real walking time" the spec asks for); users keep effortless override. Record this as an accepted trade-off to revisit with real usage.

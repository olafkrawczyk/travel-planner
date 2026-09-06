# Tasks: add-osrm-travel-matrix

## 1. OSRM client (packages/geo)

- [x] 1.1 `OsrmClient.fetchTable(coords)` → minutes matrix; typed errors (http/malformed/oversize); injectable fetchFn; mocked unit tests (success, seconds→minutes, failure paths)

## 2. Persistent matrix cache (packages/storage)

- [x] 2.1 Dexie `matrixCache` table + `MatrixCache` interface (get/put by key of rounded coords + profile + base URL); fake-indexeddb round-trip test

## 3. Solver integration

- [x] 3.1 `buildProblem(trip, apiDurations?)`: api layer between override and heuristic, `source: "api"`, explanation with distance; precedence unit tests

## 4. App flow (apps/web)

- [x] 4.1 Dev-panel flags: `osrmBaseUrl` (default public demo, empty = disabled) and `osrmMaxNodes` (default 100)
- [x] 4.2 Store requestSolve: immediate heuristic solve; then cache-first OSRM fetch on the main thread; exactly one follow-up solve with apiMatrix on success; toast on failure ("Routing API unavailable — times are estimates")
- [x] 4.3 Worker bridge: pass `apiMatrix` through the pure-data request to `buildProblem` (no network in worker)
- [x] 4.4 Timeline: "api" source badge already exists — verify explanation text names OSRM for api legs

## 5. Verify

- [x] 5.1 `pnpm build` passes; `pnpm test` green incl. existing Tokyo/Warsaw fixture regressions (no apiMatrix path unchanged)

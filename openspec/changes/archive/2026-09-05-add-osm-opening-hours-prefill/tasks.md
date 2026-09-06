# Tasks: add-osm-opening-hours-prefill

## 1. Overpass client (packages/geo)

- [x] 1.1 `fetchOsmTags(osmId)` returning `opening_hours` (+ `name:en`/`name:ja`); base URL flag, injectable fetch, in-memory cache; mocked unit tests (tags, missing element, http error)

## 2. opening_hours adapter (packages/geo)

- [x] 2.1 Add `opening_hours` dependency; `expandOpeningHours(expr, dates)` → per-date TimeWindow[] or null; tests incl. weekday ranges, `24/7`, multi-interval days, unparseable input

## 3. UI (apps/web)

- [x] 3.1 PlaceEditor: "Fetch opening hours from OSM" button (visible when osmId set) filling the window rows for all trip dates; inline note when no tag / unparseable
- [x] 3.2 Auto-prefill after search-add behind `autoFetchOpeningHours` flag (default on): fire-and-forget, only when place has osmId and no windows yet; silent failure
- [x] 3.3 DevPanel flags: `overpassBaseUrl`, `autoFetchOpeningHours`

## 4. Verify

- [x] 4.1 `pnpm build` passes; `pnpm test` green (fixtures unaffected)

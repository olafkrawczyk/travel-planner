# Design: add-osm-opening-hours-prefill

## Components

### 1. Overpass client (packages/geo/src/overpass.ts)
- `fetchOsmTags(osmId: string /* "N/123" | "W/123" | "R/123" */): Promise<Record<string,string> | null>` — POST/GET `{base}/api/interpreter?data=[out:json];(node(id);way(id);relation(id););out tags;` restricted to the right element type. Base URL flag `overpassBaseUrl` default `https://overpass-api.de`. Injectable fetchFn, typed errors. Small in-memory cache keyed by osmId.
- Return only tags relevant now: `opening_hours`, `name:en`, `name:ja` (future use), raw `opening_hours` string.

### 2. opening_hours adapter (packages/geo/src/openingHours.ts)
- Dep: `opening_hours` npm lib (mature, OSM-expression parser).
- `expandOpeningHours(expr: string, dates: string[] /* YYYY-MM-DD */): Record<string, TimeWindow[]> | null`:
  - `24/7` → null (always open).
  - Use the lib's `getOpenIntervals(from, to)` per trip date range → map to per-date `{start,end}` windows (clip to day bounds; merge same-date intervals).
  - Try/catch around parse — return null on failure (caller informs user).
- Unit tests with recorded expressions incl.: `Mo-Fr 09:00-17:00; Sa 10:00-14:00`, `24/7`, `Tu-Su 09:30-17:30; Th 09:30-20:00` (Tokyo National Museum style), unparseable garbage, `sunrise-sunset` (rule out: treat as unparseable for MVP).

### 3. UI (apps/web)
- PlaceEditor: when `place.osmId` exists → "Fetch opening hours from OSM" button in the Opening hours section: fetch tags → expand over the trip's dates → fill the editor's window rows (not saved until Save). Failure/absence → inline note "No opening hours on OSM / couldn't parse".
- Auto-prefill on search-add behind flag `autoFetchOpeningHours` (default true): fire-and-forget after `addPlace` — fetch+expand; on success `mutateTrip` to set `openingHours` (full re-solve). Failures silent.
- DevPanel flags: `overpassBaseUrl`, `autoFetchOpeningHours`.

## Constraints

- No solver changes (windows already enforced from v1.2).
- Network only from main thread; solver unaffected.
- Rate hygiene: one Overpass request per explicit click; auto-prefill only for places with osmId and without existing windows.
- Timezone note: OSM hours are local to the POI; our trip timezone is a single string — MVP assumes trip-local (record as known limitation for multi-timezone trips).

## Tests

- Adapter: recorded-expression matrix incl. tricky cases + date clipping + multi-interval days.
- Overpass client: mocked fetch (tags extraction, 404/no-element, http error).
- Keep fixtures green (no openingHours in samples).

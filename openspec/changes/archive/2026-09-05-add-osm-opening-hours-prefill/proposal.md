# Proposal: add-osm-opening-hours-prefill

## Why

v1.2 added manual per-date opening windows — accurate but tedious to fill in by hand. Most POIs in OSM carry an `opening_hours` tag; places added via search already store their `osmId`. This change closes the loop: fetch the OSM tag, parse it, and prefill the trip's per-date windows automatically — with the manual editor remaining the source of truth afterward.

## What Changes

- **Overpass tag fetch** (packages/geo): given an `osmId` (`N|W|R/id`), fetch the element's tags from Overpass and return `opening_hours` (plus `name:en`/`name:ja` for later use). Cached in-memory + respect for usage policy (single requests, no bulk).
- **Parser adapter** (packages/geo): wrap the `opening_hours` npm library; expand an OSM expression into concrete per-date `TimeWindow[]` for the trip's date range. Unparseable or "24/7" / absent tags degrade gracefully (no windows = always open).
- **Prefill UX**: a "Fetch opening hours from OSM" button in the place editor (enabled when the place has an `osmId`): fills the opening-hours section for all trip dates; the user reviews and can edit; saving writes `openingHours`. On import-by-search, optionally auto-prefill (fire-and-forget, non-blocking) — flag-controlled, default on.
- **Attribution**: OSM usage stays attributed (existing map attribution covers ODbL).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trip-management`: opening windows SHALL be prefillable from OSM data for places with an `osmId`, with user review before saving.
- `itinerary-solver`: no change (windows already enforced) — noting explicitly so the capability boundary stays clean.

## Impact

- New deps: `opening_hours` npm package (packages/geo).
- `packages/geo/src/overpass.ts` (new), `packages/geo/src/openingHours.ts` (new adapter), tests with recorded OSM expressions (incl. tricky ones: `Mo-Fr 09:00-17:00; Sa 10:00-14:00; PH off`, `24/7`).
- `apps/web`: PlaceEditor prefill button + auto-prefill on search-add behind flag `autoFetchOpeningHours` (default true); non-blocking, failure silent (manual entry unaffected).
- External service: Overpass API (public; single small queries; identifying requests).

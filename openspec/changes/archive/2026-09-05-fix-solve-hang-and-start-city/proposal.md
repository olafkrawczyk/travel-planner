# Proposal: fix-solve-hang-and-start-city

## Why

Three reported defects make the MVP unusable in practice: every solve hangs on a forever "solving…" spinner (broken Comlink callback passing), adding places appears broken as a consequence, and the default home base is hardcoded to Tokyo Station with no way to choose a starting city at trip creation.

## What Changes

- **Fix solve hang**: wrap worker progress/done callbacks with `Comlink.proxy()` so they survive structured cloning, and make every solve invocation failure-proof (rejection clears the solving state and surfaces an error instead of hanging).
- **Search hygiene**: debounce the geocoding query at the UI so at most one request is in flight per debounce window; surface fetch failures visibly instead of silently showing "No results."
- **Starting city input**: trip creation takes a starting city alongside the name; it is geocoded and its coordinates seed the default home-base place and map center, with a graceful fallback when geocoding fails.
- **Worker logging**: structured, toggleable logging across the worker boundary (main → worker requests, worker → main progress/done/errors) so message flow is inspectable in devtools.
- **Null-field fix**: find and fix the source of worker-side "Expected value to be of type number, but found null" validation errors so invalid places cannot reach the solver (defensive validation at the solver input boundary too).
- **Map marker UX**: hovering a map marker shows the place name (tooltip), and markers are colour-coded by place category (distinct from the per-day numbering colour coding, e.g. category colour as the marker with a day-number badge).
- **Right-click to add place**: right-clicking the map opens a context menu at the cursor with an "Add place here" action that starts place creation at those coordinates (equivalent to click-to-add, but discoverable and precise).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trip-management`: trip creation now includes a starting city that determines the default home base location.
- `itinerary-solver`: solve invocation SHALL deliver callbacks reliably and SHALL surface failures (no silent hang).
- `itinerary-view`: geocoding search SHALL debounce to a single trailing request and SHALL show an error on fetch failure; the map SHALL support right-click context-menu place creation and markers SHALL identify places on hover with category colours.

## Impact

- `apps/web/src/worker/solverClient.ts` (Comlink.proxy), `apps/web/src/store.ts` (rejection handling), `apps/web/src/components/SearchBox.tsx` (debounce + error state), `apps/web/src/components/TripList.tsx` (starting-city field), `apps/web/src/tripFactory.ts` (base coords parameter), `apps/web/src/components/MapView.tsx` (marker tooltips + category colours, initial center), worker + client logging, solver input validation in `packages/solver`.
- No dependency or schema changes. Existing trips remain valid (their stored hotel place is untouched).

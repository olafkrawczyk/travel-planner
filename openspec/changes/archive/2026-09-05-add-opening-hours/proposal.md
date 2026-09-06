# Proposal: add-opening-hours

## Why

Places' `timeWindows` exist in the domain schema but the solver ignores them and there's no UI to set them — so a museum closed on Monday can land on Monday. Opening hours as hard time windows is a headline v1 feature; it makes itineraries actually trustworthy.

## What Changes

- **Manual time windows UI**: the place editor allows adding per-date opening windows (e.g. "2026-04-02: 09:00–17:00"), multiple windows per day, stored as concrete per-date windows on the place.
- **Solver enforcement**: during sequencing, a place with windows on a given day can only be scheduled inside a window (arrive ≥ open, depart ≤ close); waits before opening are counted; places that fit no window on any day go to the unscheduled tray with `window_conflict`.
- **Domain model**: per-date windows map (`Record<date, TimeWindow[]>`) replaces the unused date-less `timeWindows` field (schema v1 → v2 migration: old field dropped, nothing was ever written to it).
- **Deferred** (recorded, not built): automatic `opening_hours` prefill from OSM/Overpass and the `opening_hours` expression parser UI — needs network lookups per place; next change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `itinerary-solver`: time-window enforcement in sequencing and unscheduled reporting.
- `trip-management`: editing a place's opening windows per date.
- `itinerary-view`: timeline shows when a stop waits for opening; window conflicts visible in the unscheduled tray (already) with the conflict reason.

## Impact

- `packages/domain`: `Place.timeWindows` → `Place.openingHours?: Record<string, TimeWindow[]>` (date → windows), schemaVersion bump 1→2 + migration, `windowsForDate(place, date)` helper.
- `packages/solver/src/sequence.ts`: window-aware propagation (arrive at open if early = wait; infeasible if arrive+ dwell > close), insertion feasibility checks; ALNS/insertion already route through sequencing.
- `apps/web/src/components/PlaceEditor.tsx`: window editor (per date of the trip: add window rows start/end, remove).
- Tests: sequencing with windows (early arrival waits, after-close rejected, multi-window), migration test, fixture baselines unaffected (fixtures have no windows).

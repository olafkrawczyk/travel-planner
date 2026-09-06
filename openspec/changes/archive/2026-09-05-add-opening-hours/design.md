# Design: add-opening-hours

## Domain change (schema v1 → v2)

`Place.timeWindows: TimeWindow[]` (unused, date-less) → `Place.openingHours?: Record<string /* YYYY-MM-DD */, TimeWindow[]>`. Concrete per-date windows avoid shipping an `opening_hours` expression parser for MVP; OSM prefill comes later. Migration: v1 records gain `schemaVersion: 2`, old field dropped (nothing was ever stored in it). Bump `schemaVersion` in packages/domain; `parseTrip` migrates.

Helper: `windowsForDate(place, date): TimeWindow[] | undefined` in domain.

## Solver (packages/solver/src/sequence.ts)

`computeTimes` currently propagates `arrive = departPrev + travel`, applying appointments. Extend:
- Look up `windowsForDate(place, day.date)`.
- If windows exist: find the first window where `arrive + dwell <= window.end`; if `arrive < window.start`, wait = start − arrive and arrive = start. If no window fits → stop infeasible (existing dropped/infeasible path reports it; ensure reason resolves to `window_conflict` via `reasonFor` — extend `reasonFor` to check windows when the place has them).
- Solomon insertion feasibility checks must use the same window logic (single source: refactor a `feasibleVisit(problem, day, place, earliestArrive)` helper used by both construction and improvement).
- Appointments remain the hardest constraint (zero slack) — appointment AND windows both apply (appointment start must fall inside a window if windows exist; keep it simple: check both).

## UI (PlaceEditor)

Below the appointment section: "Opening hours" — rows per trip date (date label + start/end time inputs + remove), "add window" control with a date select. Writes to `place.openingHours`. Keep compact; empty = always open (current behaviour).

## Tests

- sequence: early arrival waits, after-close infeasible, second window used when first missed, window + appointment interaction.
- domain: migration v1→v2, windowsForDate.
- Fixture baselines unchanged (no windows in fixtures) — must stay green.

## Deferred (next change)

OSM `opening_hours` string prefill via Overpass + `opening_hours` npm lib expansion to concrete dates.

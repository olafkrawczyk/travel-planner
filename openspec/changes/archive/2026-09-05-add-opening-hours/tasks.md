# Tasks: add-opening-hours

## 1. Domain

- [x] 1.1 Replace `Place.timeWindows` with `Place.openingHours?: Record<date, TimeWindow[]>`; bump schemaVersion to 2 with migration; `windowsForDate(place, date)` helper; migration + helper tests

## 2. Solver

- [x] 2.1 Window-aware time propagation in `computeTimes` (wait before opening, reject visits ending after close, multiple windows); shared feasibility helper used by insertion too
- [x] 2.2 `reasonFor` returns `window_conflict` for window-infeasible places; unit tests (early wait, after-close reject, second window, window+appointment)

## 3. UI

- [x] 3.1 PlaceEditor: opening-hours editor — per trip date, add/remove window rows (start/end), empty = always open

## 4. Verify

- [x] 4.1 `pnpm build` passes; `pnpm test` green incl. Tokyo/Warsaw fixtures (baselines unchanged)

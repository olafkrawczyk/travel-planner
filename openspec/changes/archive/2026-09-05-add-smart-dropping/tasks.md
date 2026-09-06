# Tasks: add-smart-dropping

## 1. Priority-ordered repair pass (packages/solver)

- [x] 1.1 Final repair pass after ALNS in `solve()` and `resolve()`: try strict feasible insertion for pool places in priority order (nice dropped first; must dropped only if infeasible everywhere allowed); unit test: must not dropped while a nice place occupies a day where the must fits

## 2. Explanations

- [x] 2.1 Domain: `UnscheduledEntry.explanation?: string` (additive, no migration)
- [x] 2.2 `explainUnscheduled` helper producing quantified explanations per reason (no_time shortfall, window_conflict detail, unreachable guidance); tests per reason

## 3. Force-insert

- [x] 3.1 Domain: `Place.forceDayId?: Id` (additive); repair pass treats it as allowed-day + relaxed budget for that place
- [x] 3.2 New `Edit` variant `forceInsert`; resolve inserts at cheapest hard-feasible position allowing over-budget; DayPlan slack can go ≤ 0; tests (over-budget scheduled; hard window still blocks)

## 4. Tray UX (apps/web)

- [x] 4.1 Unscheduled tray rows: explanation, priority badge, day-select + "Force" button, "Raise to must" button; store actions `forceInsert`, `raisePriority`
- [x] 4.2 Day header shows "⚠ over by N min" when slack < 0

## 5. Verify

- [x] 5.1 `pnpm build` passes; `pnpm test` green incl. unchanged fixture baselines

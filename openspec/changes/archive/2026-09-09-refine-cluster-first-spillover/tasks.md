## 1. Unscheduled Diagnostic Fix

- [x] 1.1 Update `fitsIgnoringWindow` in `packages/solver/src/explain.ts` to accept `respectRegions` parameter.
- [x] 1.2 Update `classifyUnscheduled` in `packages/solver/src/explain.ts` to pass `respectRegions` as true when `clusterFirst` is active (excluding priority 1 places).
- [x] 1.3 Verify that places blocked by region coherence are now reported as `no_time` instead of `window_conflict`.

## 2. Cluster Spillover Rules

- [x] 2.1 Update `regionCompatible` in `packages/solver/src/alns.ts` to accept `utilizationThreshold` bypass logic for under-utilized days.
- [x] 2.2 Implement the utilization calculation in `regionCompatible` (e.g. sum of dwell time for current occupants / day window duration < 0.65).
- [x] 2.3 Verify `regionCompatible` allows low-priority places on under-utilized days, even with mismatched regions.

## 3. Testing and Validation

- [x] 3.1 Update `packages/solver/src/explain.test.ts` (if exists) or related unit tests to cover the new region constraints behavior in `classifyUnscheduled`.
- [x] 3.2 Update `packages/solver/src/alns.test.ts` or related unit tests to assert region compatibility allows spillover on < 65% loaded days.
- [x] 3.3 Verify Tokyo regression test (`packages/solver/src/tokyo.test.ts`) passes with the new spillover rules. Note any scoring improvements.
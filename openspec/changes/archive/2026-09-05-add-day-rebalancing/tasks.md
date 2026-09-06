# Tasks: add-day-rebalancing

## 1. Objective penalty

- [x] 1.1 `TripSettings.weights.overBudget` (additive, default ~3); `evaluate` adds `overBudget * Σ max(0, endMin − dayEnd)` per day, exempting force-relaxed days; unit tests

## 2. Balance operators (packages/solver)

- [x] 2.1 relocate-day operator: move a non-pinned/non-forced/non-appointment place from the most over-budget day to the cheapest hard-feasible position on an unlocked under-budget day, accepted on objective improvement; deterministic via seeded RNG
- [x] 2.2 swap-days operator for the relocation-alone-insufficient case; pinned/appointment/forced/locked never touched; tests for both operators and constraint respect

## 3. Fixtures

- [x] 3.1 Re-record Tokyo/Warsaw baselines (expect improvement); add assertion: total over-budget minutes == 0 for both fixtures

## 4. Verify

- [x] 4.1 `pnpm build` passes; `pnpm test` green

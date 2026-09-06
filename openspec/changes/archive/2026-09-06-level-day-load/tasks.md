# Tasks: level-day-load

## 1. Load measurement

- [x] 1.1 `evaluate` (alns.ts): replace the end-time-range `imbalance` term with per-day utilisation (`committed / window`), total absolute deviation from the mean, scaled to minutes by the mean window length; preserve the existing finite-endMin exclusion for infeasible days
- [x] 1.2 Add a diagnostic-only `utilisationSpread` field to `Evaluation` (max-min utilisation, not weighted into the objective) for reporting/testing
- [x] 1.3 Unit coverage: `evaluate` over-budget penalty tests still pass unchanged (delta is purely the over-budget term)

## 2. Balance operators generalised to load imbalance

- [x] 2.1 `mostLoadedDay`: worst over-budget active day when one exists (top priority, unchanged), else the highest-utilisation active day; locked days excluded
- [x] 2.2 `candidateRecipient`: donor-over-budget case keeps the legacy "any non-over-budget day" rule; ordinary-imbalance case requires the target to trail the donor's utilisation by `MIN_LOAD_GAP` (0.15)
- [x] 2.3 `relocateDay`/`swapDays` updated to use `mostLoadedDay`/`candidateRecipient`; all existing protections (pinned, appointment, forced, drag-pinned, locked) unchanged; existing tests (over-budget donor, swap-only-succeeds, protections, locked days) pass unmodified

## 3. Gating against ruin-and-recreate starvation

- [x] 3.1 `loadSpread` helper: max-min utilisation among unlocked active days
- [x] 3.2 `alns()` main loop: attempt balancing when over budget (always) or when `loadSpread >= IMBALANCE_GATE_THRESHOLD` (0.2) and a seeded `rng() < BALANCE_ATTEMPT_PROBABILITY` (0.3) draw succeeds; verified determinism is preserved (same seed ⇒ same result)
- [x] 3.3 Tune the two constants against the Tokyo/Warsaw fixtures and the new regression test; document the reasoning inline

## 4. Empty-day behaviour

- [x] 4.1 Measure whether the generalised load measure + operators already prevent empty days surviving when work could fill them (no separate term added — see design.md §4 and the new regression test)

## 5. Regression test for the reported complaint

- [x] 5.1 `alns.test.ts`: synthetic 3-day, 7-place clustered trip whose route-first split (demonstrated directly via `split()`) crams everything onto day one
- [x] 5.2 Full solve, 3 fixed seeds: assert zero unscheduled, every day non-empty, and `utilisationSpread` below a sensible threshold

## 6. Fixtures

- [x] 6.1 Re-record Tokyo/Warsaw baselines with explanatory header comments (score moved; travel and unscheduled counts checked to not regress — Tokyo's travel improved, Warsaw's schedule is byte-for-byte unchanged)

## 7. Spec and verify

- [x] 7.1 Update `itinerary-solver`'s "Day assignment" requirement (delta in `specs/itinerary-solver/spec.md`) from over-budget-only rebalancing to general load levelling
- [x] 7.2 `pnpm test` (full suite) and `pnpm typecheck` (`tsc -b`) pass

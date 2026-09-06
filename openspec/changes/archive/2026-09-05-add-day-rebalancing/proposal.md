# Proposal: add-day-rebalancing

## Why

The solver can overload one day (negative slack, e.g. −75 min) while other days sit nearly free: the Prins split optimizes the tour's cut points but doesn't move work between days afterwards, and the objective's day-imbalance weight is too weak to matter against travel savings. The result is a plan that looks impossible on one day and empty on another.

## What Changes

- **Over-budget days become properly expensive in the objective** (penalty proportional to overrun minutes, comparable to travel cost) instead of practically free.
- **Inter-day rebalancing move** in the improvement loop: relocate a place from an over-budget (or longest) day to the cheapest feasible position on an under-budget day, and accept when it improves the objective. This is the cluster-first balancing pass from the spec, applied post-split as local search.
- **Swap move**: exchange two places between an over-full and an under-full day when relocation alone doesn't fit (handles cases where moving one place breaks the other's budget).
- Appointments, force-inserts, pins and locks are respected: pinned/appointment/forced places are never relocated; locked days are untouched.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `itinerary-solver`: day assignment SHALL balance load across days — over-budget days carry a meaningful objective penalty, and the improvement loop SHALL rebalance work between over-full and under-full days while respecting hard constraints.

## Impact

- `packages/solver/src/alns.ts`: objective gains an over-budget penalty term; new relocate-between-days and swap-between-days operators in the ruin/recreate (or a dedicated balance pass before ALNS).
- `packages/solver/src/solve.ts`: wiring; fixtures: baseline scores will shift (improve) — baselines re-recorded deliberately with a note.
- No UI, no schema changes.

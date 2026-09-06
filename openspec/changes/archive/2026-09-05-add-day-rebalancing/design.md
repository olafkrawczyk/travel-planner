# Design: add-day-rebalancing

## Root cause

`evaluate()` (alns.ts) treats an over-budget day as feasible-with-late-end: `endMin > dayEnd` produces no penalty (only `!times.feasible` — which means hard-constraint breakage — costs `BIG_PENALTY`). So a day ending 75 min late costs **nothing** in the objective, while moving a place to a free day costs travel minutes. The solver rationally chooses the overloaded plan. `dayImbalance` (weight 1, on end-time spread) is too weak and measures the wrong thing.

## Changes (packages/solver)

### 1. Objective: over-budget penalty
`computeTimes` already returns `endMin`. In `evaluate`, per day: `overMin = max(0, endMin − parseHHMM(day.end))` (0 for force-relaxed days — they opted in). New weight `overBudget` in `TripSettings.weights` (additive optional, default ~3 — each overrun minute costs like 3 travel minutes; tune in dev panel). Objective adds `w.overBudget * Σ overMin`. Also add a mild `slackBonus`/keep imbalance as-is — the overBudget term is the fix; imbalance stays for aesthetics.

### 2. Balance operators in ALNS
Two new operators in the improvement loop (alongside ruin/recreate), chosen when some day has overMin > 0:
- **relocate-day**: pick a non-pinned, non-forced, non-appointment place from the worst over-budget day; try cheapest feasible insertion into every unlocked under-budget day; apply if objective improves.
- **swap-days**: pick place A from the over-budget day and place B from an under-budget day (same constraints); swap their day assignments, re-sequence both days, apply if improved.

Both go through existing insertion/sequencing helpers (hard constraints enforced by `feasibleVisit`). Deterministic: selection uses the seeded RNG.

### 3. Baselines
Tokyo/Warsaw fixture scores will change (should improve: same or fewer over-budget minutes). Re-record baselines; assert additionally: `max(0, -slackMin)` summed over days is 0 for both fixtures (they fit, so the invariant "no avoidable overbooking" is testable).

## Tests

- evaluate: over-budget day adds penalty; force-relaxed day exempt.
- relocate: constructed 2-day scenario (day 1 overloaded, day 2 free) → final solve moves work to day 2.
- swap: relocation alone impossible, swap succeeds.
- pinned/appointment/locked untouched by balance operators.
- Fixtures: re-recorded baselines + zero-overrun assertion.

## Notes

- This is deliberately local search over the split, not full k-medoids clustering — cheap, incremental-friendly, and uses the travel matrix (cluster-first's key insight) for the cost of moving a place to another day.
- A day can legitimately be over budget after a force-insert; that path stays exempt from the penalty.

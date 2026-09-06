# Design: level-day-load

## Context

See proposal.md for the three compounding causes (weak measurement, operators that only fire on overrun, no empty-day term). All three live in `packages/solver/src/alns.ts`; `sequence.ts::computeTimes` and `split.ts` are read but not changed.

## Goals / Non-Goals

**Goals:**
- Measure per-day load in a way that's comparable across days with different `start`/`end` windows, gives every day a gradient (not just the min/max pair), and stays finite.
- Make `relocateDay`/`swapDays` fire on ordinary load imbalance, not only over-budget days, without letting them starve ruin-and-recreate.
- Fix the concrete regression (empty day next to a crammed one) without a special-cased "empty day" term, if the general measure already covers it.

**Non-Goals:**
- Full re-clustering / k-medoids day assignment — this stays local search over the existing split, same as the change it supersedes.
- Retuning `travel`/`wait`/`mustDropped`/`niceDropped` weights or the split DP itself.
- Perfect balance — the objective still trades balance against travel; a large, isolated cluster that's genuinely cheapest to visit in one trip may legitimately stay concentrated (see Risks).

## Decisions

### 1. Load measure: per-day utilisation, total absolute deviation, scaled to minutes

`dayUtilisation(day, order) = (endMin - dayStart) / (dayEnd - dayStart)` — committed time (travel + dwell + wait, i.e. `endMin - dayStart`) over the day's own window. This makes days with different windows comparable, unlike the old `endMin` range. Non-finite `endMin` (hard-infeasible order) yields `null` and is excluded, preserving the invariant that infeasible days are graded solely by `BIG_PENALTY`.

`imbalance = (Σ |utilisation_d - mean|) × meanWindow` across all days with finite `endMin` (mean windowMin across the same days). Locked days are included — they're part of the trip the user sees.

**Total vs. mean absolute deviation**: tried mean first (dividing by day count), since it keeps the term's scale independent of trip length. Measured failure: on a 4-day synthetic trip with one packed day and three empty ones, mean absolute deviation divides the benefit of fixing *one* day by the day count, so moving a single place off the packed day only nudges the *average* — not enough to outweigh that place's now-solo round trip, and `relocateDay` correctly declined (the objective would have gotten worse). Total absolute deviation doesn't dilute: fixing one day's deviation counts in full no matter how many other days are still off. Switching to total fixed the case and, as a side effect, reproduced the Warsaw fixture's exact prior schedule (mean picked a very slightly different, marginally-more-imbalanced local optimum there — see tasks.md verification notes) while keeping Tokyo's improvement. Trade-off: total's scale grows with active day count, so a 12-day trip's imbalance term outweighs a 3-day trip's for the same per-day unevenness; checked against both fixtures, it's a minority share of the objective next to travel — revisit if a much longer trip shows the opposite problem.

Scaling by *mean* window (rather than each day's own window) turns a dimensionless deviation into minutes with one representative conversion factor, per the brief; per-day scaling was rejected as it would let a single long-window day's deviation dominate the sum disproportionately.

A diagnostic-only field, `utilisationSpread` (max − min utilisation, unscaled), is also returned from `evaluate` for reporting/testing "how uneven is this trip" independent of the objective's travel/balance trade-off — it is not weighted into the objective.

### 2. Donor/recipient selection: most-loaded, meaningfully-less-loaded

`mostLoadedDay`: the worst over-budget active day when one exists (top priority, unchanged from the superseded change), else the highest-utilisation active day. Locked days are never donors.

`candidateRecipient`: never the donor day itself, never locked, never a day already over budget. When the donor is over budget, any remaining day qualifies (legacy behaviour, kept exactly — a genuine overrun outranks how evenly the rest compares). When the donor is not over budget, a candidate must trail the donor's utilisation by at least `MIN_LOAD_GAP` (0.15) — otherwise ordinary balancing would shuffle two near-identical days for a sliver of improvement.

Both `relocateDay` and `swapDays` keep every existing protection unchanged: pinned (`day.pinnedOrder`), appointment-bound, force-inserted (`forceDayId`), and drag-pinned (`pinnedToDay`) places are never candidates; only strictly-improving moves are applied; selection order is shuffled via the seeded RNG for determinism.

### 3. Gating in `alns()`: threshold + seeded coin flip, over-budget exempt

Once the operators can fire on ordinary imbalance, they find *some* improving move almost every iteration for as long as any two active days differ at all (moving anything toward the mean helps a little). Unthrottled, `balanced || ruin/recreate` would pick balancing nearly every iteration and starve the generic search — measured directly: an early, ungated version of this change made both fixture scores *worse* than a hand-computed reference (the schedule ruin-and-recreate alone would have found).

Fix: an iteration only attempts balancing when there's something over budget (always — same as before) **or** the load spread among active days clears `IMBALANCE_GATE_THRESHOLD` (0.2 utilisation) **and** a seeded `rng() < BALANCE_ATTEMPT_PROBABILITY` (0.3) draw succeeds. This keeps ruin-and-recreate the dominant search even while a real, above-threshold imbalance persists across many iterations, while still giving balancing a fair, deterministic shot. Determinism is preserved (same seed ⇒ same draws ⇒ same result); the two constants were tuned against the Tokyo/Warsaw fixtures and the new regression test (see tasks.md).

### 4. No separate empty-day term

Checked directly: with the operators generalised to fire on load imbalance, an empty day (utilisation 0) already pulls hard on the total-absolute-deviation term once anything could fill it — the regression test (`alns.test.ts`, "regression: no empty days...") demonstrates a route-first split that crams 7 places onto day one of three, and a full solve spreads them 3/2/2 across three seeds, unscheduled 0. No second, empty-day-specific penalty was added.

## Risks / Trade-offs

- **A genuinely isolated cluster may still concentrate on one day.** If a cluster of places sits far enough from base that a solo round trip costs much more than the imbalance term's benefit, `relocateDay` will correctly decline (confirmed against an 8 km-from-base variant of the regression scenario before switching to total absolute deviation, which resolved even that case at the fixture's day count). This is arguably correct behaviour, not a bug — mitigation is the total (not mean) absolute deviation choice above, not a hard cap.
- **Locked-day skew** → a locked day's fixed load contributes to the mean/deviation but can never be changed by the operators; if it's extreme, the achievable minimum imbalance among unlocked days has a nonzero floor. This does not cause thrashing: the gate's `loadSpread` and the operators' donor/recipient search both range only over unlocked days, and the strict-improvement acceptance rule (plus a cooling SA schedule) means there's no oscillation, just a floor the search settles at.
- **Stochastic gating changes the RNG draw sequence** → for a fixed seed, results are still deterministic (`alns.test.ts`'s determinism test unchanged), but the *specific* schedule found for a trip near the gate threshold can differ run-to-run across code versions. Observed on the Warsaw fixture under the (rejected) mean-based formula: a ~0.5% score difference from a different local optimum, not a systemic regression — resolved by switching to total absolute deviation, which reproduced Warsaw's exact prior schedule.
- **Score baselines move** (expected, per proposal) — re-recorded with explanatory header comments in `tokyo.test.ts`/`warsaw.test.ts`; travel and unscheduled counts were checked to not regress.

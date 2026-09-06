## Why

Empty days are currently allowed and the solver produces them: a route-first split can legitimately cram a whole cluster of places onto one day and leave others untouched, because (1) the objective measures "load" as a day's end clock time, which conflates "full" with "ends late" and is insensitive to every day but the two extremes; (2) the balance operators (`relocateDay`/`swapDays`) only ever fire when a day is literally over budget, so ordinary imbalance — including an empty day sitting next to a packed one — is never even proposed as a fix; and (3) cheapest-insertion (the fallback, generic search) actively prefers inserting into an already-dense day over an empty one, since an empty day's insertion cost is a full base round trip. The result, in the product owner's words: "do nothing for 1 day and then spend 24h rushing."

## What Changes

- **Load is measured honestly.** `evaluate`'s `imbalance` term becomes a per-day *utilisation* measure (committed time as a fraction of that day's own start/end window) rather than a raw end-time range, so days with different windows are comparable and every day — not just the min/max pair — contributes a gradient. The term is the total absolute deviation from mean utilisation, scaled to minutes by the mean window length, so the existing `dayImbalance` weight (default 1) stays commensurate with travel/wait without re-tuning.
- **The balance operators fire on ordinary load imbalance, not just over-budget days.** `relocateDay`/`swapDays` now select the most-loaded active day as donor (a genuinely over-budget day still takes top priority when one exists) and only consider meaningfully-less-loaded days as recipients.
- **A gate protects ruin-and-recreate.** Once the balance operators can fire on ordinary imbalance, they find *some* improving move almost every iteration — left unthrottled, they starve the generic ruin-and-recreate search that does the rest of the quality work. Ordinary (non-over-budget) imbalance must clear a utilisation-gap threshold and win a seeded coin flip before an iteration spends itself on balancing instead of ruin-and-recreate; a genuine over-budget day always attempts balancing.
- **No new empty-day-specific penalty.** Measured before/after: once the operators fire on the new load measure, empty days are already strongly disfavoured (an empty day's utilisation of 0 pulls hard on the deviation term once anything is available to fill it) — no second mechanism was needed.
- Fixture baselines (Tokyo, Warsaw) move and are re-recorded with an explanation; unscheduled counts do not increase and no must-priority place becomes unscheduled.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `itinerary-solver`: the "Day assignment" requirement changes from over-budget-only rebalancing to general load levelling — the improvement loop SHALL rebalance load between days whenever a day is meaningfully more loaded than another, not only when a day is literally over budget, while preserving every existing protection (appointments, pins, forced placements, locked days).

## Impact

- `packages/solver/src/alns.ts`: `evaluate`'s imbalance term replaced (utilisation-based, total absolute deviation); `Evaluation` gains a diagnostic `utilisationSpread` field; `relocateDay`/`swapDays` donor/recipient selection generalised from over-budget-only to most-loaded/meaningfully-less-loaded; `alns`'s main loop gates the balance operators behind a threshold + seeded-RNG probability for the ordinary-imbalance case.
- `packages/solver/src/alns.test.ts`: new regression test for the product owner's scenario (a small clustered trip whose route-first split crams everything onto one day); existing balance-operator tests unchanged in behaviour (over-budget-donor path untouched).
- `packages/solver/src/tokyo.test.ts`, `packages/solver/src/warsaw.test.ts`: baselines re-recorded with explanatory header comments.
- No schema changes (`dayImbalance`/`overBudget` weights keep their names and defaults), no UI changes.

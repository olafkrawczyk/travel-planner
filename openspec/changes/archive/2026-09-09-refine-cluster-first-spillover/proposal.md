## Why

The `clusterFirst` solver strategy intentionally leaves some days under-utilized to preserve region coherence, locking out lower priority places from mixing into unrelated geographical districts. However, when the solver drops a place in this scenario, the `classifyUnscheduled` logic mistakenly attributes the failure to a `window_conflict` (opening hours or appointments) instead of a region conflict because its time probe (`fitsIgnoringWindow`) ignores `regionCompatible` restrictions. Furthermore, we can safely allow `clusterFirst` to spill low-priority places onto under-utilized days (e.g. < 65% load), giving users a more complete itinerary without sacrificing the strategy's primary intent, provided those places are added optimally.

## What Changes

- **Fix the Unscheduled Reason Diagnostic**: Update `fitsIgnoringWindow` or `classifyUnscheduled` to respect `regionCompatible` when `clusterFirst` is active. This ensures the solver accurately reports `no_time` (or introduces a new `region_conflict` reason) rather than a false opening hours conflict when region coherence is the actual blocker.
- **Add Cluster Spillover Rules**: Permit low-priority places to be assigned to geographically distant days when a day is utilized under 65%, adding these places in an optimal way to avoid naïve insertion.

## Capabilities

### New Capabilities
None

### Modified Capabilities
- `itinerary-solver`: Modify ALNS constraints to permit spillover for low-priority places under a load threshold (e.g., < 65% utilization), and update the reason explainer logic to correctly account for region coherence limits.

## Impact

- `packages/solver/src/explain.ts`: Modifying `classifyUnscheduled` and `fitsIgnoringWindow`.
- `packages/solver/src/alns.ts` or `packages/solver/src/solve.ts`: Updating `clusterFirst` constraints/repair pass logic to support under-utilized day spillover.
- `packages/domain/src/schema.ts`: (Optional) Exposing new UI string or unscheduled reason taxonomy for region constraints if necessary.
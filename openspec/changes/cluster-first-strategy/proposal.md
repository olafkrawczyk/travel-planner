## Why

The current `routeFirst` solver strategy builds a single TSP tour over all places and splits it into days. For trips with large geographical gaps (e.g., Tokyo and Hakone), this forces the tour to cross the gap and arbitrarily chops clustered places across day boundaries, leading to expensive and unnecessary round trips. A `clusterFirst` strategy—which partitions places geographically first, routes within each cluster, and assigns clusters to nearby days—natively avoids this problem and produces human-like, coherent daily itineraries (e.g., one district per day).

## What Changes

- Implement the `clusterFirst` construction strategy in the solver as a genuine alternative to `routeFirst`.
- The `clusterFirst` strategy will:
  1. Rely strictly on the `region` field on `PlaceSchema` as the user-facing grouping handle ("these places belong together").
  2. The frontend web application will auto-derive `region` (cluster membership) using K-means for places where it is missing, making the assignment visible and editable to the user.
  3. The solver will strictly route (TSP) within each assigned region and assign those regions to the nearest days.
  4. ALNS's day-balancing operators are constrained to never introduce cross-region mixing in this mode, and `dayImbalance` is disabled, so the search does not dismantle the user's geographic districts just to balance time or hours.
- Keep this behind the existing `solverStrategy: "clusterFirst"` feature flag so both strategies can be measured side-by-side using existing fixtures before considering it as a default. A P0 review found the three declarations of that flag's default (`packages/domain/src/schema.ts`, `apps/web/src/store.ts`, `apps/web/src/tripFactory.ts`) had drifted out of agreement — the zod schema silently defaulted stored trips to `clusterFirst` while the UI and trip factory both claimed `routeFirst`. This change also fixes that: `routeFirst` is confirmed as the sole default everywhere.
- Enhance the UI/DevPanel to stop claiming "clusterFirst" is not implemented once it is functional.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities
- `itinerary-solver`: The construction strategy can now be configured to use `clusterFirst` (geographic clustering prior to routing) in addition to the default `routeFirst` strategy.

## Impact

- **Solver Core**: `solve.ts` and new files for clustering logic. Region protection is implemented as a `clusterFirst`-gated constraint on the ALNS insertion operators (`recreate`, `relocateDay`, `swapDays`), not as an objective-function penalty — an unconditional, badly-scaled objective penalty was found and removed during this phase (see `design.md` Decision 2.5).
- **Domain**: `PlaceSchema.region` gets active semantic meaning in the solver. `solverStrategy`'s zod default is corrected to `routeFirst` to match the rest of the codebase.
- **UI**: The DevPanel feature flag becomes functional. The frontend's auto-clustering (`autoClusterTrip`) only runs for `clusterFirst` trips and goes through the normal undoable edit path.
- **Tests**: New tests for the cluster-first pipeline, maintaining side-by-side compatibility with route-first baseline tests. New tests cover the region-protection operator constraint through the real `solve()` path, and the consolidated k-means implementation.

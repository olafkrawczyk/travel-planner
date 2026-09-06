## Why

The current `routeFirst` solver strategy builds a single TSP tour over all places and splits it into days. For trips with large geographical gaps (e.g., Tokyo and Hakone), this forces the tour to cross the gap and arbitrarily chops clustered places across day boundaries, leading to expensive and unnecessary round trips. A `clusterFirst` strategy—which partitions places geographically first, routes within each cluster, and assigns clusters to nearby days—natively avoids this problem and produces human-like, coherent daily itineraries (e.g., one district per day).

## What Changes

- Implement the `clusterFirst` construction strategy in the solver as a genuine alternative to `routeFirst`.
- The `clusterFirst` strategy will:
  1. Rely strictly on the `region` field on `PlaceSchema` as the user-facing grouping handle ("these places belong together").
  2. The frontend web application will auto-derive `region` (cluster membership) using K-means for places where it is missing, making the assignment visible and editable to the user.
  3. The solver will strictly route (TSP) within each assigned region and assign those regions to the nearest days.
  4. ALNS balancing will be constrained (or imbalance penalties disabled) in this mode so that it does not dismantle the user's geographic districts just to balance time.
- Keep this behind the existing `solverStrategy: "clusterFirst"` feature flag so both strategies can be measured side-by-side using existing fixtures before considering it as a default.
- Enhance the UI/DevPanel to stop claiming "clusterFirst" is not implemented once it is functional.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities
- `itinerary-solver`: The construction strategy can now be configured to use `clusterFirst` (geographic clustering prior to routing) in addition to the default `routeFirst` strategy.

## Impact

- **Solver Core**: `solve.ts` and new files for clustering logic.
- **Domain**: `PlaceSchema.region` gets active semantic meaning in the solver.
- **UI**: The DevPanel feature flag becomes functional.
- **Tests**: New tests for the cluster-first pipeline, maintaining side-by-side compatibility with route-first baseline tests.

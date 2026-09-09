## 1. Centroid Adjacency Precomputation

- [x] 1.1 In `packages/solver/src/cluster.ts`, modify `clusterPlaces` to return an adjacency set for each cluster (e.g. `Cluster.adjacentRegions: Set<string>`).
- [x] 1.2 Implement a travel time/distance check between cluster centroids in `clusterPlaces`. Two regions are adjacent if their centroids are within the defined threshold (e.g., 3 km or 15 mins).
- [x] 1.3 Expose the adjacency mapping so it can be passed via `Problem` or utilized locally when verifying region bounds.

## 2. Base Camp Grouping & Splitting

- [x] 2.1 In `packages/solver/src/cluster.ts`, refactor `assignClustersToDays`. Group the trip's `dayList` into consecutive "base camps" that share the same `baseStartId` and `baseEndId`.
- [x] 2.2 Change the greedy packing to assign each cluster to the nearest base camp group, rather than a single tied day.
- [x] 2.3 Refactor `clusterFirstSequence`: For each base camp group that receives clusters, perform a localized DP split (using the existing `split` module or equivalent logic) across the days in that base camp to respect their time windows, instead of dumping all places onto the first day.

## 3. Set-Based Region Compatibility

- [x] 3.1 In `packages/solver/src/alns.ts`, rewrite `regionCompatible` to gather all existing regions present on `state.days[dayIdx]`.
- [x] 3.2 Update `regionCompatible` to return `true` if the candidate place's `region` is already in the day's region set, resolving the mixed-day lockout issue.
- [x] 3.3 Integrate the centroid adjacency check into `regionCompatible`: return `true` if the candidate place's `region` is geographically adjacent to *any* of the regions currently established on the day.

## 4. Tests and Validation

- [x] 4.1 Update `packages/solver/src/regionProtection.test.ts` to assert that a day mixed with "Region A" and "Region B" accepts a new place from "Region A", and rejects "Region C" (unless adjacent).
- [x] 4.2 Update `packages/solver/src/clusterFirst.test.ts` to verify that a large cluster assigned to a 3-day base camp is correctly split across multiple days based on time budgets rather than being dumped entirely onto day 1.
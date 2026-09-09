## Why

The `clusterFirst` solver strategy successfully isolates geographically distant places, but its construction pipeline (greedily packing monolithic clusters onto single days) and restrictive region boundaries (blocking ALNS moves if a day contains more than one region) create brittle schedules. This leads to dropped places, massive time-budget violations on single days, and a failure to naturally spill places across neighboring days. Refining these behaviors will make `clusterFirst` more robust and realistic.

## What Changes

- **Base Camp Grouping**: Modify `assignClustersToDays` to assign clusters to groups of consecutive days sharing the same base accommodation, rather than locking them to a single tied day.
- **Localized Splitting**: Implement a localized tour-and-split during construction (running a TSP over the cluster and slicing it across the base camp's days using their available time windows) instead of dumping the monolithic region onto one day.
- **Set-Based Region Compatibility**: Relax the `regionCompatible` check in ALNS so a day can accept new places that match *any* of its currently assigned regions, fixing the "mixed day lockout" bug.
- **Centroid Adjacency Graph**: Introduce a spatial slack threshold (e.g. 15 minutes of travel time) that permits geographically adjacent regions to share a day without triggering a region compatibility failure.

## Capabilities

### New Capabilities
None

### Modified Capabilities
- `itinerary-solver`: Modifying `clusterFirst` construction strategy requirements (to split clusters across multiple days) and ALNS region coherence requirements (to permit set-based mixed regions and spatial adjacency).

## Impact

- `packages/solver/src/cluster.ts`: Rewriting cluster assignment and introducing localized tour-and-split.
- `packages/solver/src/alns.ts`: Updating `regionCompatible` logic and adjacency checks.
- `packages/solver/src/regionProtection.test.ts`: Updating constraint tests.
- `packages/solver/src/clusterFirst.test.ts`: Adding tests for multi-day region splits.
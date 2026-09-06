## 1. Domain and Foundation

- [x] 1.1 Create basic distance clustering helper in `packages/solver/src/cluster.ts` to assign places without regions to new regions based on a 25km distance threshold.
- [x] 1.2 Make `solverStrategy` in DevPanel (in `apps/web/src/components/DevPanel.tsx`) functional by removing the "(not implemented)" warning.

## 2. Solver Core - Cluster Assignment

- [x] 2.1 Extract the core single-day routing logic (from `split.ts`/`giantTour.ts`) so it can be applied to a specific sequence of places (rather than global TSP).
- [x] 2.2 Implement greedy cluster-to-day assignment logic in `cluster.ts` (calculate cluster centroid, match against day base locations).
- [x] 2.3 Implement the `clusterFirst` sequence builder which runs the clustering, assigns clusters to days, and creates the initial `State.days` arrays.

## 3. Wiring and Validation

- [x] 3.1 Modify `packages/solver/src/solve.ts` to check `problem.settings.solverStrategy`. If `clusterFirst`, dispatch to the new sequence builder. Otherwise, use `routeFirst`.
- [x] 3.2 Add a unit test `clusterFirst.test.ts` to verify the strategy groups distant points to appropriate days.
- [x] 3.3 Ensure existing `tokyo.test.ts` and `warsaw.test.ts` baseline tests remain green when using the default `routeFirst`.
## 4. Semantic Regions and UI

- [ ] 4.1 Rip ephemeral clustering out of `packages/solver/src/cluster.ts` so the solver strictly relies on the provided `Place.region` strings.
- [ ] 4.2 Move the Capacity-Constrained K-Means logic to the frontend (`apps/web/src/tripFactory.ts` or similar) to auto-populate empty `Place.region` fields when creating/updating a trip.
- [ ] 4.3 Expose the `region` field in the UI (e.g., inside the Place editor or place card) so the user can manually control which places belong together.
- [ ] 4.4 Modify `packages/solver/src/alns.ts` to protect clusters: when `clusterFirst` is active, restrict ALNS operators from crossing region boundaries, or disable `dayImbalance`.

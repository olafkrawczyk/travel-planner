## 1. Coarse Clustering (Scale B)

- [x] 1.1 Implement distance-based coarse clustering algorithm (e.g. 25km threshold) in `packages/solver` to group places into regional base areas.
- [x] 1.2 Implement candidate base location selection (e.g. weighted geometric median of the cluster).
- [x] 1.3 Add unit tests for coarse clustering verifying multi-city separation and single-city collapsing.

## 2. Speculative Stay Generation

- [x] 2.1 Implement workload estimator (sum of dwell time + internal travel estimate) for a cluster.
- [x] 2.2 Implement candidate stay builder that maps cluster workload to suggested night counts and builds speculative `Stay[]` arrays.
- [x] 2.3 Add unit tests for speculative stay generation ensuring stay validity, bounds clamping, and coverage of all trip days.

## 3. Worker Shadow Solve Pipeline

- [x] 3.1 Add support in solver Web Worker protocol for background shadow solve jobs.
- [x] 3.2 Implement candidate evaluation loop: run counterfactual solves using `seed: 42` and compare transit times against the baseline itinerary.
- [x] 3.3 Hook shadow solving into store's `requestSolve` on full Regenerate, keeping shadow solves cancellable if a new edit occurs.
- [x] 3.4 Add integration tests verifying shadow solve comparison and transit savings detection.

## 4. Stays Panel UI Rework

- [x] 4.1 Remove per-stay-row recommendation components from `StaysPanel.tsx`.
- [x] 4.2 Create top-level "Suggested Bases" card in `StaysPanel.tsx` showing verified transit time savings and recommended nights.
- [x] 4.3 Implement "Apply" handler to create the new hotel place, apply the candidate `Stay[]` configuration, and trigger itinerary re-solve.
- [x] 4.4 Add UI tests verifying display of suggestions and state changes when applying a base.

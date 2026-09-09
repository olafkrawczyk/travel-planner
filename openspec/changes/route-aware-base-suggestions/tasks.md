## 1. Commute-Relief Discovery

- [x] 1.1 Implement `findStrainedPlaces` to identify places with commute times exceeding a threshold from the nearest active base.
- [x] 1.2 Implement `discoverReliefClusters` to cluster strained places and pull in nearby places that the new base would naturally serve.
- [x] 1.3 Add unit tests for `discoverReliefClusters` verifying that it detects strained areas even when places are scheduled.

## 2. Workload Sizing & Route Ordering

- [x] 2.1 Implement `calculateWorkloadNights` to proportionally divide the trip's total nights among bases based on place dwell and intra-cluster transit.
- [x] 2.2 Implement `orderBasesByRoute` using nearest-neighbor and 2-opt TSP pinned to the trip's initial base.
- [x] 2.3 Refactor `buildSpeculativeStays` and `createSpeculativeTrip` to apply the route-ordered stays and proportional nights instead of appending to the end.
- [x] 2.4 Add unit tests for proportional night allocation and route ordering.

## 3. Permissive Acceptance Gate

- [x] 3.1 Update `evaluateBaseSuggestions` to surface candidates that either rescue unscheduled places or do not regress overall travel time by more than the configured threshold (60 minutes).
- [x] 3.2 Update candidate rationale messages to communicate both commute relief and capacity expansion.
- [x] 3.3 Ensure existing single-city and multi-hotel trips (Tokyo, Warsaw fixtures) do not regress.

## 4. End-to-End Verification

- [x] 4.1 Write an integration test for the Iceland Ring Road sample confirming that sequential base addition progressively lowers travel time toward the target without getting stuck.
- [x] 4.2 Verify Stays Panel UI handles the updated multi-night route-ordered suggestions cleanly.

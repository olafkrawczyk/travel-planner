## 1. Anchor & Pull Discovery

- [x] 1.1 Add a function that extracts anchor places from `baselineItinerary.unscheduled`, filtering to `reason === "no_time" || reason === "unreachable"` (excluding `window_conflict`).
- [x] 1.2 Cluster anchor places using the existing `coarseClusterPlaces` machinery; keep clusters with at least `MIN_RESCUED_PLACES` (1) place.
- [x] 1.3 For each qualifying anchor cluster, pull in scheduled places within the clustering threshold and merge them into the cluster (recompute center via `weightedGeometricMedian` over the combined set).
- [x] 1.4 Add unit tests: cluster of 5 dropped places forms a candidate; a single dropped place also forms one; a `window_conflict`-only cluster does not; a nearby scheduled place is pulled into a qualifying cluster's centroid calculation.

## 2. Travel-Time Based Separation

- [x] 2.1 Add a `MIN_BASE_SEPARATION_MIN` constant (starting value 45) alongside `MIN_TRANSIT_SAVINGS_MIN`.
- [x] 2.2 Replace `findExternalClusters`'s haversine-distance separation check with a travel-time check using `heuristicEntry`, comparing the candidate cluster's center (wrapped as a synthetic `Place`) against each active base's location.
- [x] 2.3 Add unit tests: two places close in km but >45 min apart by the heuristic model are treated as distinct bases; two places close in both km and travel time are not.
- [x] 2.4 Verify existing `tokyo.test.ts` / `warsaw.test.ts` / `shadowSolve.test.ts` fixtures still pass unchanged (their known-good separations should hold under the travel-time check).

## 3. Capacity-Expander Evaluation

- [x] 3.1 In `evaluateBaseSuggestions`, run the Anchor & Pull discovery (task 1) alongside the existing geography-based `findExternalClusters` discovery, deduplicating clusters that are found by both paths, and cap the combined candidate count at `maxCandidates`.
- [x] 3.2 For each candidate sourced from Anchor & Pull, compute `rescuedCount = baseline.unscheduled.length - candidate.unscheduled.length` from the shadow-solve result.
- [x] 3.3 Surface the candidate when `rescuedCount >= MIN_RESCUED_PLACES` AND `candidate.stats.score <= baseline.stats.score`; keep the existing `savingsMin >= MIN_TRANSIT_SAVINGS_MIN` path independently applicable for geography-only candidates.
- [x] 3.4 Add a regression test asserting a speculative candidate hotel co-located with the existing base yields a score within a small tolerance of the baseline (guards the score-comparability assumption in design.md Decision 3).
- [x] 3.5 Add an island-shaped fixture (one hotel, ~15 places within haversine threshold but far by travel time, several dropped) verifying a capacity-expander suggestion is surfaced end-to-end.

## 4. Suggestion Shape & Rationale

- [x] 4.1 Add `kind: "transit-saver" | "capacity-expander"` and `rescuedCount: number` to `SuggestedBase`.
- [x] 4.2 Generate a distinct `rationale` string for capacity-expander suggestions (e.g. "Lets you fit N more places").
- [x] 4.3 Sort suggestions with capacity-expander candidates first, preserving existing intra-kind ordering.
- [x] 4.4 Update unit tests covering `SuggestedBase` shape and sorting for mixed-kind result sets.

## 5. Stays Panel UI

- [x] 5.1 Update `StaysPanel.tsx`'s "Suggested Bases" card to render the capacity-expander rationale (and not `savingsMin`) when `kind === "capacity-expander"`.
- [x] 5.2 Add/update UI tests verifying both suggestion kinds render correctly and "Apply" behaves identically regardless of kind.

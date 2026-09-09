## MODIFIED Requirements

### Requirement: Cluster-first construction strategy
The solver SHALL support a `clusterFirst` construction strategy as an alternative to the default `routeFirst` strategy. When activated, this strategy MUST partition places geographically into clusters. It SHALL then assign each cluster to the base camp (a group of consecutive days sharing the same base accommodation) nearest to the cluster center. Finally, it SHALL perform a localized route-first assignment across that base camp, slicing a local TSP tour over the cluster into the available time windows of those days, preventing monolithic cluster dumping onto a single day.

#### Scenario: Clustering by region
- **WHEN** the trip is configured with `solverStrategy: "clusterFirst"`
- **THEN** the solver groups places strictly by their `Place.region` value; it does not perform its own geographic clustering. Auto-derivation of `region` for places missing it (e.g. via k-means) is the frontend's responsibility, not the solver's — the solver only ever consumes `Place.region`.

#### Scenario: Fallback grouping for a still-unregioned place
- **WHEN** a place reaches the solver with no `region` at all
- **THEN** the solver assigns it a construction-time-only grouping (used solely to decide which day it starts on) rather than treating it as a hard region boundary; this fallback grouping is never written to `Place.region` and never participates in the region-protection constraint below.

#### Scenario: Base camp assignment and splitting
- **WHEN** using `clusterFirst`
- **THEN** clusters are assigned to the group of days sharing the nearest base accommodation, and are split proportionally into the available time budgets of those specific days.

### Requirement: Anytime improvement
The solver SHALL improve the initial solution via ruin-and-recreate within a bounded time budget, reporting the current best solution periodically so the UI can update live, and SHALL be deterministic for a given seed and input. When `solverStrategy` is `clusterFirst`, the improvement loop's insertion operators (ruin-and-recreate's re-insertion, and the day-balancing relocate/swap operators) SHALL NOT move a place into a day that already contains regions UNLESS the candidate place's `region` is already present on that day, or is geographically adjacent (e.g. centroid travel time within a configurable threshold) to a region on that day; a place with no `region` is never constrained by this rule and never constrains other places. This constraint applies only to those search operators — it SHALL NOT block the final priority-ordered repair pass or an explicit user "force insert", so a must-priority place is never left unscheduled, and a forced insertion never fails, purely because of region coherence.

#### Scenario: Deterministic output
- **WHEN** the solver runs twice with the same trip snapshot and seed
- **THEN** both runs produce identical itineraries

#### Scenario: Progressive improvement
- **WHEN** the solver runs with its time budget
- **THEN** it emits an initial feasible solution promptly and at least one improved or equal final solution before the budget expires

#### Scenario: Region protection during search
- **WHEN** `solverStrategy` is `clusterFirst` and a day's scheduled places already contain a set of regions
- **THEN** the search operators never move a place carrying a non-matching, non-adjacent `region` onto that day, even if doing so would otherwise improve the objective

#### Scenario: Relaxed set-based region mixing
- **WHEN** a day already contains places from both "Shibuya" and "Harajuku"
- **THEN** the search operators MAY move additional "Shibuya" or "Harajuku" places onto the day, instead of rejecting them as mixed.

#### Scenario: Adjacent regions allowed
- **WHEN** "Shibuya" and "Harajuku" are geographically adjacent (centroids are close)
- **THEN** the search operators MAY move a "Shibuya" place onto a day that currently only contains "Harajuku" places.

#### Scenario: Region protection does not block must-see repair or force-insert
- **WHEN** a must-priority place would otherwise go unscheduled, or the user explicitly forces a place onto a day
- **THEN** the region-protection constraint does not prevent the repair pass or the forced insertion from placing it there, even if that place's `region` differs from the day's

#### Scenario: Region protection still applies to lower-priority repair
- **WHEN** a want- or nice-priority place remains unscheduled after the search and no compatible day has room for it
- **THEN** the repair pass does not place it on a day dedicated to a different region merely because it fits in time — it stays unscheduled, same as if no day had physical room

#### Scenario: Region is inert under routeFirst
- **WHEN** `solverStrategy` is `routeFirst`
- **THEN** `Place.region` has no effect on clustering, day assignment, or the search operators

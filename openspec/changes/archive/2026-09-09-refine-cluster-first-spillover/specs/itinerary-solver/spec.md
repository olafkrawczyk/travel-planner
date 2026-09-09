## MODIFIED Requirements

### Requirement: Anytime improvement
The solver SHALL improve the initial solution via ruin-and-recreate within a bounded time budget, reporting the current best solution periodically so the UI can update live, and SHALL be deterministic for a given seed and input. When `solverStrategy` is `clusterFirst`, the improvement loop's insertion operators (ruin-and-recreate's re-insertion, and the day-balancing relocate/swap operators) SHALL NOT move a place into a day that already contains regions UNLESS the candidate place's `region` is already present on that day, is geographically adjacent (e.g. centroid travel time within a configurable threshold) to a region on that day, OR the day's utilization is below a configured under-load threshold (e.g., 65%) and the move strictly improves the objective without violating time windows; a place with no `region` is never constrained by this rule and never constrains other places. This constraint applies only to those search operators — it SHALL NOT block the final priority-ordered repair pass or an explicit user "force insert", so a must-priority place is never left unscheduled, and a forced insertion never fails, purely because of region coherence.

#### Scenario: Deterministic output
- **WHEN** the solver runs twice with the same trip snapshot and seed
- **THEN** both runs produce identical itineraries

#### Scenario: Progressive improvement
- **WHEN** the solver runs with its time budget
- **THEN** it emits an initial feasible solution promptly and at least one improved or equal final solution before the budget expires

#### Scenario: Region protection during search
- **WHEN** `solverStrategy` is `clusterFirst` and a day's scheduled places already contain a set of regions and its utilization is above the under-load threshold
- **THEN** the search operators never move a place carrying a non-matching, non-adjacent `region` onto that day, even if doing so would otherwise improve the objective

#### Scenario: Relaxed set-based region mixing
- **WHEN** a day already contains places from both "Shibuya" and "Harajuku"
- **THEN** the search operators MAY move additional "Shibuya" or "Harajuku" places onto the day, instead of rejecting them as mixed.

#### Scenario: Adjacent regions allowed
- **WHEN** "Shibuya" and "Harajuku" are geographically adjacent (centroids are close)
- **THEN** the search operators MAY move a "Shibuya" place onto a day that currently only contains "Harajuku" places.

#### Scenario: Spillover into under-utilized day
- **WHEN** `solverStrategy` is `clusterFirst`, a day's utilization is below the under-load threshold (e.g., 65%), and a low-priority place has no compatible day with room
- **THEN** the search operators MAY place it on that under-utilized day even if its region does not match, adding it optimally to improve the objective without wasting schedule capacity

#### Scenario: Region protection does not block must-see repair or force-insert
- **WHEN** a must-priority place would otherwise go unscheduled, or the user explicitly forces a place onto a day
- **THEN** the region-protection constraint does not prevent the repair pass or the forced insertion from placing it there, even if that place's `region` differs from the day's

#### Scenario: Region protection still applies to lower-priority repair
- **WHEN** a want- or nice-priority place remains unscheduled after the search and no compatible (or under-loaded) day has room for it
- **THEN** the repair pass does not place it on a day dedicated to a different region merely because it fits in time — it stays unscheduled, same as if no day had physical room

#### Scenario: Region is inert under routeFirst
- **WHEN** `solverStrategy` is `routeFirst`
- **THEN** `Place.region` has no effect on clustering, day assignment, or the search operators


### Requirement: Unscheduled reporting
The solver SHALL never silently drop places: every place that cannot be scheduled SHALL appear in an unscheduled list with a reason of `no_time`, `window_conflict`, or `unreachable`, plus a human-readable explanation of why it does not fit. Dropping SHALL be priority-ordered: the solver SHALL prefer dropping nice-to-have places over want, and want over must; a must-priority place SHALL only be unscheduled when no feasible insertion exists on any allowed day. The diagnosis of the unscheduled reason SHALL respect the active solver strategy: when `clusterFirst` region protection blocks an insertion, the diagnostic logic SHALL recognize it and report `no_time` (or a dedicated region mismatch reason) rather than falsely attributing the failure to an opening window conflict on a day that had time but was region-incompatible.

#### Scenario: More must-visits than time
- **WHEN** the total dwell and travel of must-visit places exceeds available day budgets
- **THEN** overflow places appear in the unscheduled list with reason `no_time` and an explanation quantifying the shortfall

#### Scenario: Unreachable appointment
- **WHEN** two fixed appointments cannot both be reached within their windows
- **THEN** at least one appears unscheduled with reason `window_conflict` and an explanation naming the conflict

#### Scenario: Priority-ordered dropping
- **WHEN** a trip cannot fit all places
- **THEN** nice-to-have places are dropped before want, and want before must — no must place is dropped while a lower-priority place remains scheduled on a day where the must place would fit

#### Scenario: Region coherence properly attributed
- **WHEN** `clusterFirst` is active and a want/nice priority place is left unscheduled because no region-compatible day has room (even if an incompatible day does)
- **THEN** it appears unscheduled with reason `no_time` (or a dedicated region reason) rather than `window_conflict`
## ADDED Requirements

### Requirement: Cluster-first construction strategy
The solver SHALL support a `clusterFirst` construction strategy as an alternative to the default `routeFirst` strategy. When activated, this strategy MUST partition places geographically into clusters and assign them to days based on the nearest base location, preserving regional coherence.

#### Scenario: Clustering unassigned regions
- **WHEN** the trip is configured with `solverStrategy: "clusterFirst"` and places do not have a user-assigned `region`
- **THEN** the solver automatically derives clusters geographically (e.g., via distance threshold or k-means) before routing.

#### Scenario: Assigning clusters to days
- **WHEN** using `clusterFirst`
- **THEN** clusters of places are assigned to the day(s) whose base locations are nearest to the cluster center, preventing fragmented cross-gap daily itineraries.

## MODIFIED Requirements
<!-- None -->

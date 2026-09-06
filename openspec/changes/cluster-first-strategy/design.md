## Context

See `proposal.md` for the motivation to add `clusterFirst` as a distinct construction strategy. The solver currently builds a TSP cycle across all places, which handles geographically uniform trips well but breaks on trips with large geographical gaps.

## Goals / Non-Goals

**Goals:**
- Provide a `clusterFirst` initial state generator in the solver that honors geographical boundaries.
- Utilize the existing `Place.region` schema field to logically group places.
- Use a distance heuristic to cluster any places missing a `region`.

**Non-Goals:**
- Modifying ALNS operators. This change focuses purely on *constructing* the initial state (`State` object) before the ALNS loop takes over.
- Changing `routeFirst`. Both strategies must remain distinct for comparative benchmarking.

## Decisions

### Decision 1: Clustering Unassigned Places
**Choice**: Move the clustering heuristic (Capacity-Constrained K-Means) out of the solver and into the frontend application. It will explicitly write to `Place.region` so the user can see and modify the assignments.
**Rationale**: Makes `region` the true user-facing handle for clustering ("these places belong together"). The solver should not use ephemeral black-box regions that the user cannot control.

### Decision 2: Assigning Clusters to Days
**Choice**: The solver's `clusterFirst` simply groups places by `Place.region` and greedily assigns these clusters to the nearest base.
**Rationale**: This guarantees that remote clusters (like Hakone) are assigned to the day where the user is staying nearby (like the Hakone Ryokan), completely avoiding cross-gap round trips.

### Decision 2.5: Protecting Clusters in ALNS
**Choice**: When `clusterFirst` is active, the ALNS objective must respect the user's regions. We will prevent ALNS operators from moving places across regions, or zero out `dayImbalance` so it drops places rather than dismantling districts to balance hours.
**Rationale**: ALNS's default behavior dismantles unbalanced geographic districts. Since a human planner prefers a slightly unbalanced but contiguous district over a perfectly balanced zigzag, `clusterFirst` must enforce this preference.

### Decision 3: Routing within the Day
**Choice**: Once a day's places are assigned, use the existing TSP logic (`giantTour` equivalent, but scoped only to that day's places and its specific start/end base) to sequence them.
**Rationale**: `routeFirst` does a global TSP and cuts it; `clusterFirst` does geographical assignment first, then local TSPs. This produces an initial `State` that is highly coherent and ready for ALNS balancing.

## Risks / Trade-offs

- **Risk:** Auto-clustering might incorrectly split dense cities if the threshold is poorly tuned.
  **Mitigation:** Provide a reasonable default threshold (e.g., 20-30km) and rely on the explicit `region` field as an override if the heuristic fails.
- **Risk:** Assigning a massive cluster to a single day might violate time budgets heavily.
  **Mitigation:** `clusterFirst` only creates the *initial state*. The existing ALNS loop and imbalance penalty will naturally spread an oversized cluster to adjacent days sharing the same base if it overflows.

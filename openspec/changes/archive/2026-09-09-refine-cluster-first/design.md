## Context

See `proposal.md` for motivation. The current `clusterFirst` solver treats regions as monolithic and assigns them greedily to a single day, relying entirely on the ALNS stage to redistribute the overflow. The ALNS stage's region protection is strictly exclusive: any day that has a region pinned to it rejects any other region. This combination creates brittle scenarios where large regions are dumped onto one day and are subsequently locked out from spilling to neighboring days if those days contain even a single place from a different region.

## Goals / Non-Goals

**Goals:**
- Dynamically split large geographic clusters across multiple days associated with the same base accommodation.
- Allow mixed regions to coexist safely during ALNS balancing without locking out valid relocations.
- Allow naturally adjacent geographic regions to share days.

**Non-Goals:**
- Altering the global `routeFirst` strategy.
- Introducing complex multi-region clustering heuristic engines inside the solver; clustering itself remains a frontend responsibility via `Place.region`.

## Decisions

### Decision 1: Base Camp Grouping & Localized Splitting
**Choice**: `assignClustersToDays` will identify "base camp" groups (contiguous days with the same base start/end). Clusters assigned to that base camp will undergo a localized DP `split` across the available windows of those days.
**Rationale**: Replaces the monolithic region dump on a single day with a capacity-aware distribution using the existing robust `split.ts` logic.

### Decision 2: Set-Based Region Compatibility
**Choice**: Update `alns.ts`'s `regionCompatible` to allow insertion if the candidate's region matches *any* region currently on the day, or if the day is empty. 
**Rationale**: Fixes the "Mixed Day Lockout" bug. A day that is initialized with two regions (e.g., Shibuya and Harajuku) will now freely accept more places from either of those regions, instead of acting as a black hole.

### Decision 3: Centroid Adjacency Graph
**Choice**: In `cluster.ts`, construct an adjacency set for each region based on a configurable travel time or distance threshold between region centroids. Pass this mapping into the `Problem` state so `regionCompatible` can authorize moves between adjacent regions.
**Rationale**: Eliminates the rigid boundary restriction (where 100 meters of separation between different string names prevents scheduling) without degrading the core `clusterFirst` value of preventing cross-country travel.

## Risks / Trade-offs

- **Risk:** Base camp splitting might leave small stranded clusters on days that they shouldn't occupy. 
  **Mitigation:** DP split naturally avoids fragmenting tiny clusters if their cost overweighs the balance constraints.
- **Risk:** Centroid adjacency threshold tuning. If set too high, it degenerates into `routeFirst`.
  **Mitigation:** Keep the threshold conservative (e.g., 3-5 km or <15 minutes) specifically to catch near-neighbor overlaps.
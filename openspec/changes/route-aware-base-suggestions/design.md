## Context

See `proposal.md` for motivation. The previous engine's placement policy ("append at end" and fixed 1-night duration) causes disastrous >60h travel time inflations on ring road or multi-region itineraries. The engine also stalled after 1 or 2 bases because its acceptance gate demanded immediate score improvements or huge transit savings, failing to recognize that a complete, comfortable road trip requires progressively adding 5-10 bases.

## Goals / Non-Goals

**Goals:**
- Replace append-at-end logic with route-ordered geographic sequencing of stays.
- Sizing stays proportionally so large regions (e.g. North Iceland) receive multiple nights automatically.
- Ensure the base discovery and validation loop can successfully rebuild a complete multi-base road trip (e.g. 10-12 bases) incrementally.

**Non-Goals:**
- Modifying the ALNS solver engine (the change is contained to how candidate trips are constructed and gated).
- Real-time pathfinding during discovery (we continue to use the offline `heuristicEntry` travel matrix).

## Decisions

### Decision 1: Commute-Relief Discovery Trigger
- **Choice**: Instead of clustering *only* unscheduled places, we identify *strained* places: any place (scheduled or unscheduled) whose estimated travel time from the nearest active base is $\ge 45$ minutes. These strained places are coarse-clustered, and the most severe cluster (by workload $\times$ excess travel time) forms the candidate region.
- **Rationale**: This finds the regions where the user is suffering the worst commutes, regardless of whether the solver managed to force them into the itinerary. 
- **Alternatives considered**: Haversine distance from existing bases (rejected because it fails on coastal/mountain trips where short distances mean long drives).

### Decision 2: Workload-Proportional Night Allocation
- **Choice**: Distribute the trip's total nights among all bases (existing + candidate) proportionally to their local workload. Workload is defined as the sum of dwell times plus a greedy nearest-neighbor tour connecting the places closest to that base.
- **Rationale**: Ensures a dense region with 15 places gets 3–4 nights, rather than being clamped to 1 night at the expense of an over-allocated primary base. The fractional nights are rounded using largest-remainder to ensure the sum exactly matches the trip length.
- **Alternatives considered**: Fixed 1-night insertions (rejected, root cause of the bug).

### Decision 3: Route-Ordered Geographic Sequencing
- **Choice**: Re-sequence the active bases (including the candidate) to minimize base-to-base travel jumps. We use a nearest-neighbor + 2-opt TSP sort over the base coordinates (using `heuristicEntry`), pinned to the trip's original starting base. The new stays are then assigned chronologically (e.g. Base A for 4 nights, then Base B for 3 nights, etc.).
- **Rationale**: Replaces the "append-at-end" behavior that caused the hotel sequence to ping-pong across the country.
- **Alternatives considered**: Smart insertion (finding a single split point for the new base). Rejected because allocating multiple nights changes the boundaries for *all* bases, making a global TSP re-sort much simpler and more robust.

### Decision 4: Permissive Acceptance Gate
- **Choice**: A speculative base is accepted and surfaced to the user if it either:
  1. Reduces the number of `unscheduled` places.
  2. Does not inflate `totalTravelMin` by more than a configurable allowance (e.g., 60 minutes).
- **Rationale**: Building a 12-base road trip incrementally means intermediate steps might temporarily increase overall travel slightly as the trip restructures. The previous strict rule (`savingsMin >= 45`) prematurely halted discovery.
- **Alternatives considered**: Score-based gate. Rejected because the ALNS score heavily penalizes unscheduled places but handles pure travel-time shifts unpredictably across differently-shaped trips.

## Risks / Trade-offs

- **[Risk] High TSP cost for many bases** → Mitigation: 2-opt is extremely fast for $N \le 60$ days/bases.
- **[Risk] User confusion from entire timeline shifting** → Mitigation: When the user accepts a base, the Stays Panel will naturally update to reflect the new chronological flow. The Stays panel already handles multi-stay trips cleanly.
- **[Trade-off] Discovery runs more often**: Because the gate is permissive, the worker may surface up to 10-15 base suggestions sequentially. The shadow solve budget remains bounded (e.g. 100-300ms) to ensure background UI performance remains snappy.

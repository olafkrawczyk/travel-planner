## Context

See `proposal.md` for the motivation to add `clusterFirst` as a distinct construction strategy. The solver currently builds a TSP cycle across all places, which handles geographically uniform trips well but breaks on trips with large geographical gaps.

## Goals / Non-Goals

**Goals:**
- Provide a `clusterFirst` initial state generator in the solver that honors geographical boundaries.
- Utilize the existing `Place.region` schema field to logically group places.
- Use a distance heuristic to cluster any places missing a `region`.

**Non-Goals:**
- Broadly modifying ALNS's operator set, its objective structure, or its balancing strategy. The only ALNS change this phase makes is the narrow, `clusterFirst`-gated region-compatibility guard on insertion described in Decision 2.5 below — everything else about *constructing* the initial state (`State` object) before the ALNS loop takes over, and about how ALNS explores from there, is unchanged.
- Changing `routeFirst`. Both strategies must remain distinct for comparative benchmarking, and `region` stays inert for `routeFirst` (no clustering, no protection, no gating).

## Decisions

### Decision 1: Clustering Unassigned Places
**Choice**: Move the clustering heuristic (Capacity-Constrained K-Means) out of the solver and into the frontend application. It will explicitly write to `Place.region` so the user can see and modify the assignments.
**Rationale**: Makes `region` the true user-facing handle for clustering ("these places belong together"). The solver should not use ephemeral black-box regions that the user cannot control.

### Decision 2: Assigning Clusters to Days
**Choice**: The solver's `clusterFirst` simply groups places by `Place.region` and greedily assigns these clusters to the nearest base.
**Rationale**: This guarantees that remote clusters (like Hakone) are assigned to the day where the user is staying nearby (like the Hakone Ryokan), completely avoiding cross-gap round trips.

### Decision 2.5: Protecting Clusters in ALNS
**Choice (revised — a P0 review found the original implementation of this decision unworkable and it was rebuilt)**: When `clusterFirst` is active, region protection is enforced at the **operator level**, not the objective level. `insertPlace` (the shared insertion primitive used by the ALNS search operators `recreate`, `relocateDay`, and `swapDays`) gains an opt-in region-compatibility check: a day that has already established a single region from its current occupants refuses a place carrying a *different* region; a place with no `region` is always compatible (a free agent); a day with no established region yet accepts anything; a day that construction already left mixed (see Decision 2) is not penalized further but the operators will not make it worse. This check is applied only when `problem.settings.solverStrategy === "clusterFirst"`, and only from those three search operators. `dayImbalance` continues to be zeroed for `clusterFirst` (unchanged, already correctly gated) so the balance operators don't fight the districts on hours either.

Two call sites deliberately bypass the region check even under `clusterFirst`: the final `repairPass` (`solve.ts`) and the explicit user "force insert" edit. Both exist specifically to place a should-be-scheduled or user-forced place somewhere, hard constraints aside — blocking them on region would risk silently dropping a must-see place or making "force insert" not actually force, regressing the pre-existing `itinerary-solver` spec guarantees that a must-priority place is only left unscheduled when no feasible slot exists anywhere, and that a forced insertion always finds the cheapest hard-feasible slot. Region coherence is a quality preference; it must yield to those correctness guarantees. `forceInsert` bypasses unconditionally (it is always an explicit, place-and-day-specific user action). `repairPass` bypasses *only for must-priority places* — it processes every leftover pooled place regardless of priority, but only `priority === 1` carries the "never silently drop while a feasible slot exists" guarantee; a want/nice-priority leftover still respects region compatibility in the repair pass and stays pooled if no same-region slot fits, rather than being dumped onto an unrelated district purely because it fits in time.

**Rationale**: The first implementation of this decision added an unconditional `regionMixing` term to the ALNS objective, weighted at the same `BIG_PENALTY` (1e9/mismatch) used for hard infeasibility — roughly six orders of magnitude above `mustDropped` (1000/place). In practice this made ALNS prefer dropping essentially unlimited must-see places over accepting a single region-mixed day, and it fired for every solve regardless of strategy (the `clusterFirst` gate present on the neighboring `dayImbalance` term was missing here). An objective penalty is also the wrong shape for this preference in general: it only discourages a state *after* the search has already spent an iteration constructing it, and any weight big enough to reliably prevent mixing is by construction big enough to swamp the other terms next to it — there is no well-scaled weight that both respects "district coherence beats a few minutes of balance" and "a must-see place is essentially never worth dropping for coherence". Constraining the operators avoids the weighting problem entirely: an incompatible move is simply never offered, so it costs nothing to always disallow it, and there is no scale to tune against the rest of the objective. This is the mechanism the original Goals/Non-Goals section already pointed at ("prevent ALNS operators from moving places across regions") — this revision is what actually implements that clause; the objective-penalty half of the original "or" was tried, found broken, and dropped rather than reweighted, since the operator constraint alone fully satisfies the goal.

### Decision 3: Routing within the Day
**Choice**: Once a day's places are assigned, use the existing TSP logic (`giantTour` equivalent, but scoped only to that day's places and its specific start/end base) to sequence them.
**Rationale**: `routeFirst` does a global TSP and cuts it; `clusterFirst` does geographical assignment first, then local TSPs. This produces an initial `State` that is highly coherent and ready for ALNS balancing.

### Decision 4: The solver's own fallback for a still-unregioned place
**Choice**: `packages/solver/src/cluster.ts`'s `clusterPlaces` is a thin group-by on `Place.region`. A place that reaches the solver with no `region` at all (the frontend failed to run, a test constructs one directly, etc.) is *not* distance-clustered — it is given its own singleton, solver-internal grouping id purely so `clusterFirstSequence` has something to compute a centroid from and assign to a day. That id is never written back to `Place.region` and is never consulted by the Decision 2.5 region-protection check, which reads `Place.region` directly and treats "no region" as "free agent, never constrained". The two concepts (a construction-time grouping label vs. the user-facing `region` field) are intentionally kept separate so the fallback can never be mistaken for real region data.
**Rationale**: A P0 review found `tasks.md` had claimed this fallback performs 25km distance-threshold clustering — it never did, and the reviewer flagged that if it *had* assigned each unregioned place a distinct pseudo-region, that would have been actively harmful once combined with Decision 2.5's protection: every unregioned place would become an unmovable, un-shareable island, and any day mixing several unregioned places would read as maximally region-mixed. Building real distance clustering into the solver was considered and rejected — Decision 1 already put that responsibility in the frontend (where the user can see and correct it), and the solver having its own competing heuristic would reintroduce exactly the "ephemeral black-box region" problem Decision 1 exists to avoid. The fix is documentation/task-accuracy plus keeping the fallback id and `Place.region` clearly non-interchangeable, not a new clustering algorithm.

## Risks / Trade-offs

- **Risk:** The frontend's capacity-constrained k-means (Decision 1) might produce a cluster count/shape that doesn't match how the user actually thinks about the trip's districts.
  **Mitigation:** The assignment writes to the ordinary, user-editable `Place.region` field (task 4.3 exposes it in the UI), so a bad auto-assignment is a one-field edit, not a solver re-run.
- **Risk:** Assigning a massive cluster to a single day might violate time budgets heavily.
  **Mitigation:** `clusterFirst` only creates the *initial state*. `assignClustersToDays` packs clusters against an estimated dwell+travel load compared to each day's actual window length (not raw dwell minutes) to reduce this up front, and the repair pass / force-insert can still place overflow with the day's soft budget relaxed if needed.
- **Risk:** `autoClusterTrip` relabelling places' `region` is a real mutation of user data, not a derived/cached value.
  **Mitigation:** It now runs only for `clusterFirst` trips (not on every solve) and goes through the store's normal undoable `mutateTrip` path, so an unwanted auto-assignment is a normal `Cmd+Z` away instead of a silent, un-undoable write.

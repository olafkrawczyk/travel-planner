## Context

See `proposal.md` for motivation. The relevant existing machinery lives in `packages/solver/src/hotelArea.ts`:

- `coarseClusterPlaces(places, thresholdKm)` — union-find clustering over all eligible places at `DEFAULT_COARSE_THRESHOLD_KM` (25 km haversine).
- `findExternalClusters(trip, thresholdKm)` — keeps clusters that are >25 km (haversine) from every active base, plus a special case for a "stranded" base.
- `buildSpeculativeStays(...)` — converts a cluster's workload into nights via `DAILY_BUDGET_MIN`, shrinks existing stays from the back (each keeps ≥1 night), appends the candidate stay last.
- `evaluateBaseSuggestions(trip, baselineItinerary, options)` — for each external cluster, builds a speculative trip, runs `solveTrip` with a fixed seed, and keeps the candidate only when `baselineTravelMin - candidateTravelMin >= MIN_TRANSIT_SAVINGS_MIN` (45).

The failing case: one hotel on an island, ~15 places dropped. `findExternalClusters` returns nothing (the dropped places are within 25 km haversine of the hotel), and even if it did, the transit-savings gate would reject the candidate because scheduling 12 more places raises `totalTravelMin`.

Note that `Itinerary` today exposes `unscheduled: { placeId, reason, explanation? }[]` and `stats: { totalTravelMin, totalWaitMin, score }`. Both are already available to `evaluateBaseSuggestions` via its `baselineItinerary` argument — no new solver output is needed.

## Goals / Non-Goals

**Goals:**
- Discover candidate bases from what the baseline solve *failed* to schedule, not only from raw geography.
- Make the "is this region already covered by an existing base?" test reflect real travel effort.
- Gate capacity-expander suggestions on a criterion that cannot be gamed by trading away high-priority places.
- Reuse the existing shadow-solve pipeline, stay-building, and worker plumbing rather than adding a parallel one.

**Non-Goals:**
- Smart timeline placement of the new stay (explicitly deferred — see Decision 5).
- Suggesting more than one new base at a time, or nested/recursive base discovery.
- Changing `recommendHotelAreas` (the per-stay-segment "where should I look for a hotel" path) — this change only affects proactive whole-trip base suggestions.
- Reworking the objective function or the `no_time` / `unreachable` classification.

## Decisions

### Decision 1: Anchor & Pull discovery, as an additional source of candidate clusters

**Choice**: Add a discovery path that starts from `baselineItinerary.unscheduled`:

1. **Anchors** — take unscheduled places whose `reason` is `no_time` or `unreachable`. Exclude `window_conflict`.
2. **Cluster** the anchor places with the existing `coarseClusterPlaces` machinery.
3. **Qualify** — keep every anchor cluster (threshold is `MIN_RESCUED_PLACES` = 1 place).
4. **Pull** — for each surviving anchor cluster, add any *scheduled* place within the clustering threshold of the cluster, producing a combined cluster.
5. **Locate** — the candidate hotel sits at the weighted geometric median of the combined cluster (unchanged from today; `weightForPlace` already biases toward must-see and long-dwell places).

The result is a `CoarseCluster` of exactly the same shape the existing pipeline already consumes, so `buildSpeculativeStays` / `createSpeculativeTrip` / the shadow solve need no changes to accept it.

**Rationale**: The dropped list is the most direct evidence available that the current base geometry is failing the user. Clustering the whole place list (today's approach) cannot distinguish "a distant region we're comfortably visiting" from "a distant region we're silently skipping."

**Why exclude `window_conflict`**: a place unscheduled because of opening hours is not helped by sleeping closer to it — the constraint is temporal, not spatial. Including it would produce suggestions that a shadow solve then fails to justify, wasting shadow-solve budget.

**Why pull in scheduled places**: without it, the candidate hotel is placed at the median of only the dropped subset. In the island case, the 2 places that *were* scheduled (at brutal commute cost) are exactly the ones the new base should also relieve. Pulling them in both improves the hotel's location and lets the shadow solve show the relief.

**Alternatives considered**:
- *Pure travel-time isochrone from the existing hotel* (flag every place >45 min away, cluster those): catches the geometry problem but not the capacity problem, and fires on trips where the user is happily doing a long day trip. Rejected as the primary trigger; its useful half is absorbed into Decision 2.
- *Cluster dropped places only, no pull*: simpler, but mislocates the hotel and understates the benefit. Rejected.

### Decision 2: Travel-time separation instead of haversine separation

**Choice**: Replace the `haversineKm(...) > thresholdKm` test in `findExternalClusters` with a travel-time test between the candidate cluster's center and each active base, using the same offline heuristic travel model the rest of the solver uses (`heuristicEntry`). A candidate is "distinct" when its estimated one-way travel time from *every* active base exceeds `MIN_BASE_SEPARATION_MIN`.

**Rationale**: `heuristicEntry` already applies `settings.detourFactor` and mode selection, so it reflects the real cost of getting there far better than raw great-circle distance. This is what unblocks islands and mountain roads, where 15 km is 75 minutes.

**Threshold**: `MIN_BASE_SEPARATION_MIN` is a new constant. A defensible starting value is 45 minutes one-way — roughly the point at which a round-trip commute (~1.5 h) eats a meaningful fraction of `DAILY_BUDGET_MIN` (450). It should be tuned against the existing solver fixtures before landing; the value is not load-bearing for the design.

**Note**: `heuristicEntry` takes two `Place` objects, so the candidate center must be wrapped in a synthetic `Place` (the pipeline already builds one — `candidateHotel` — for the shadow solve; the check can reuse that construction).

**Alternatives considered**: using the API-backed `TravelMatrix` where available. Rejected for now — discovery must stay offline and synchronous (the existing recommendation path guarantees "no network request"), and the heuristic is the model the shadow solve itself will use, so the two stay consistent.

### Decision 3: Hybrid surfacing criterion for capacity-expander candidates

**Choice**: A candidate discovered via Anchor & Pull is surfaced when **both** hold:

- `rescuedCount = baseline.unscheduled.length - candidate.unscheduled.length >= MIN_RESCUED_PLACES` (1), and
- `candidate.stats.score <= baseline.stats.score` (the solver's objective is minimized, so this is "not worse").

The existing transit-savings criterion is untouched and continues to govern candidates found by the geography-only path. A candidate satisfying either criterion is surfaced.

**Rationale**: The count is what the user actually cares about and what the UI can state honestly ("lets you fit 12 more places"). The score guard is what makes the count safe: `evaluate()` weights `mustDropped` at 1000/place versus `niceDropped` at 100/place and includes travel and imbalance terms, so a shadow solve that rescues 3 nice-to-haves by dropping a must-see, or by ballooning travel, will have a worse score and be rejected. Neither half is sufficient alone — count alone permits priority regressions, score alone is not explainable in the UI and can be satisfied by tiny travel wins.

**Comparability caveat**: `score` comes from `evaluate(problem, state)` over a *different* problem (the speculative trip has one extra place — the candidate hotel — and different day bases). The hotel is a base node with `dwellMin: 0` and does not enter the dropped counts, and the weights are identical, so the two objectives are on the same scale. This is the same assumption the existing `totalTravelMin` comparison already makes. Worth an assertion in tests rather than a runtime guard.

**Alternatives considered**:
- *Count only*: rejected, permits priority regressions.
- *Score only*: rejected, not explainable and fires on noise.
- *Weighted "rescued value"* (sum of `weightForPlace` over rescued places): more principled than a raw count but produces a number with no natural threshold and nothing meaningful to show the user. Rejected as premature.

### Decision 4: Distinguish suggestion kind on `SuggestedBase`

**Choice**: Add to `SuggestedBase` a discriminator plus the evidence behind it — a `kind: "transit-saver" | "capacity-expander"` field and a `rescuedCount: number`. `savingsMin` stays as-is (it will typically be negative for a capacity expander; the UI must not render it for that kind). `rationale` is generated per kind.

**Rationale**: The UI needs to say something structurally different for the two cases, and silently reusing `savingsMin` for a negative number would be a trap. An explicit discriminator keeps `StaysPanel` honest and makes the two paths testable in isolation.

**Ordering**: when both kinds are present, sort capacity expanders first — rescuing 12 places is a larger change to the user's trip than saving 45 minutes. Within a kind, keep today's ordering (savings desc / rescued count desc).

### Decision 5: Keep the existing append-at-end night placement

**Choice**: No change to `buildSpeculativeStays`. The candidate stay is appended after existing stays, existing stays shrink from the back with a ≥1-night floor, and ALNS re-sequences everything.

**Rationale**: The solver reassigns places to days freely, so placement mostly affects which physical nights the user spends where, not whether the places get visited. Smart splicing would need a notion of "when did the dropped places want to be visited," which does not exist for places that were never scheduled at all — the information is definitionally absent. Deferred until the simple version demonstrably produces bad itineraries.

**Trade-off accepted**: on a trip with an existing multi-stay structure, appending may produce an odd-looking night order (e.g. city → island when the user's flights imply the reverse). The user can adjust check-in dates manually — the Stays panel already supports this.

## Risks / Trade-offs

- **[Risk] Shadow-solve budget blowup** — a second discovery path can double the number of candidates evaluated. → Keep the existing `maxCandidates` (3) as a cap across *both* paths combined, and deduplicate: if a cluster surfaces via both paths, evaluate it once and let it satisfy either criterion.
- **[Risk] Score comparison across differently-shaped problems** (Decision 3's caveat) — a subtle mismatch would silently mis-gate suggestions. → Add a test asserting that a no-op speculative change (candidate hotel co-located with the existing base) yields a score within noise of the baseline.
- **[Risk] `MIN_BASE_SEPARATION_MIN` mis-tuned** — too low and every neighbourhood becomes a "distinct base"; too high and the island case still fails. → Tune against the existing `tokyo.test.ts` / `warsaw.test.ts` fixtures, which have known-good behavior, and add an island-shaped fixture with a deliberately unfavourable distance-to-time ratio.
- **[Risk] Suggestion churn between solves** — the dropped list is stochastic at the margin, so a cluster sitting exactly at 3 dropped places could appear and disappear across regenerates. → The `MIN_RESCUED_PLACES` floor of 3 applies to both discovery and surfacing, which damps this; if churn is observed in practice, raise the surfacing threshold above the discovery threshold rather than adding hysteresis state.
- **[Trade-off] Discovery now depends on baseline solve output**, so capacity-expander suggestions cannot appear before a first solve. This is consistent with the existing shadow-solve pipeline (which already requires a baseline) and is reflected in the spec change.

## Open Questions

- Exact value of `MIN_BASE_SEPARATION_MIN` (45 min is a starting point, to be confirmed against fixtures).
- Whether the "pull" radius for nearby scheduled places should be the clustering threshold (25 km) or a tighter one. Starting with the clustering threshold keeps it to one constant.

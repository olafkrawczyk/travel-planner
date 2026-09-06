## Context

See `proposal.md` for motivation. Relevant existing machinery this design builds on (all read during research, not re-explained here):

- `packages/solver/src/matrix.ts`: `heuristicEntry(a, b, settings)` — the offline travel-time heuristic (walk/transit/regional-rail curves, each documented as non-decreasing in great-circle distance). `buildProblem` derives `stayGroups: number[][]` inline by walking `trip.days` and grouping on `day.stayStart` / changes in `day.baseEndId`.
- `packages/geo/src/haversine.ts`: `haversineKm`.
- `packages/solver/src/kmeans.ts`: `kMeans(places, k, { capacity? })` — deterministic k-means++ with optional capacity cap; already shared between the solver's (unused) internal grouping and `apps/web/src/clustering.ts`'s `Place.region` auto-assignment.
- `apps/web/src/stays.ts` / `StaysPanel.tsx`: `Stay { hotelId, checkInDayIdx, nights }`, derived from `Day.stayStart`/`baseEndId` via `staysFor(trip)`; `hotelNeedsLocation(place)` flags a hotel whose `notes` field exactly equals the `AUTO_HOTEL_NOTES` sentinel stamped by `addHotelForStay`.
- `apps/web/src/store.ts`: `addHotelForStay(idx, name?)` — the one existing undoable mutation that creates a hotel place and assigns it to a stay via `applyStaysToDays`.
- `Place` (`packages/domain/src/schema.ts`): `priority: 1|2|3` (1 = must), `dwellMin`, `lat`/`lng`, optional `appointment.dayId`, `forceDayId`, `region`. `Day`: `baseStartId`, `baseEndId`, `stayStart?`.

Trips always have a base per day, even before the user picks a real hotel (trip creation seeds a geocoded default base — see `trip-management` spec's "Trip creation and day settings"). That default base's coordinates are used below only as a disambiguation anchor for multi-segment place assignment, never as part of the recommendation itself — the whole point of this feature is to recommend somewhere better than that default.

## Goals / Non-Goals

**Goals:**
- Compute a defensible "search here" area per stay segment, pre-solve, from places + day/stay structure only.
- Make the weighting and the trade-off-vs-single-pin decisions explicit and testable.
- Reuse existing tested primitives (`heuristicEntry`, `kMeans`, `haversineKm`, `addHotelForStay`) rather than inventing parallel machinery.

**Non-Goals:**
- Any real hotel inventory, pricing, or availability data.
- Any new network call (Overpass, OSRM, reverse geocoding) in this path.
- Drawing the candidate area on the map (`MapView.tsx`) — text/numbers in the Stays panel are sufficient for v1, and there is no component-render harness to test a new map layer.
- Nights-proportional k-means capacity across multiple stay segments (uniform capacity is used; see Decisions).
- Any new persisted schema field.

## Decisions

### 1. Live in `packages/solver`, not `apps/web`
The computation touches only `Trip`/`Place`/`Day` and the existing heuristic travel model — no DOM, no store. `packages/solver` is already the home for exactly this kind of pure, fixture-testable geometry (`kmeans.ts`, `cluster.ts`, `matrix.ts`). Putting it there also gets it the same "runs in Node, benchmarkable in CI" property the rest of the solver has. `apps/web` only calls it and renders the result.

### 2. Weighting: `weight(place) = (4 - priority) * max(dwellMin, 15)`
Two signals are available (`priority`, `dwellMin`) and both must matter per the brief. Priority maps to a 3:2:1 multiplier (`4 - priority`, since priority 1 = must) — simple, monotonic, and mirrors the existing must/want/nice ordering used elsewhere (e.g. the solver's own drop-ordering weights). `dwellMin` is floored at 15 minutes rather than used raw: a place is never zero-weight (a 0-dwell quick photo stop still has a real location that matters to the area choice), and a longer planned visit is treated as a larger investment the user is more committed to, so it should pull the recommendation somewhat harder too. Multiplying (not adding) the two keeps a single must-see anchor from being drowned out by many short nice-to-have stops, while still letting a long-dwell nice-to-have (e.g. a day-trip destination) register more than a five-minute one.

Alternative considered: priority-only weighting. Rejected because the brief explicitly calls out both fields, and dwell carries real signal (a place worth hours of your day is worth optimizing travel to, even at "want" priority).

### 3. Segment derivation: extract, don't duplicate
`buildProblem` already computes exactly the day-index groups this feature needs (`stayGroups`), from the same `stayStart`/`baseEndId` fields `apps/web/src/stays.ts`'s `staysFor` reads. Extracting that loop into a standalone exported `staySegments(days: Day[]): number[][]` and having `buildProblem` call it is a pure refactor (identical output, same iteration) — it must not move the `tokyo.test.ts`/`warsaw.test.ts` fixture baselines, and a task explicitly verifies that. This keeps exactly one implementation of "what are the stay segments" in the solver package, and guarantees the recommendation's segment boundaries always agree with the Stays panel's own (`staysFor` in `apps/web`), since both encode the same two conditions (`stayStart` flag, or a `baseEndId` change from the previous day).

### 4. Assigning places to segments pre-solve
Without a solved itinerary there is no ground truth for "which places are visited during which stay." Two signals are used, in order:

1. **Explicit day hints.** A place with `appointment.dayId` or `forceDayId` names a concrete day, hence a concrete segment — assigned there directly, no guessing.
2. **Geography, for everything else.** The remaining schedulable places (excluding `category === "hotel"` and places with non-finite coordinates) are split into `numSegments` groups via the existing `kMeans` with a capacity cap (same style as `clustering.ts`'s auto-cluster: `capacity = ceil(remaining.length / numSegments * 1.5)`), then each resulting cluster is matched to a specific segment by nearest-centroid-to-segment-anchor, greedy nearest-first (segment anchor = the place at that segment's first day's `baseStartId` — always present). `numSegments` is small (almost always 1, rarely more than 2-3), so greedy matching is exact enough and trivially cheap.

When there is only one segment (the common case — no hotel changes yet), this whole step is skipped: every valid place belongs to that one segment. This keeps the single-hotel path (the overwhelming majority of trips) simple and untouched by clustering noise.

Alternative considered: solve a lightweight day-assignment (reuse `giantTour`/`split`) to get real per-day place lists. Rejected — that's exactly "requires a solved plan," which design decision 1 rules out, and it would tie this feature's output to solver internals it doesn't need.

Explicitly deferred: nights-proportional k-means capacity (weighting cluster size by how many nights each segment covers). Uniform capacity is simpler, and segment place-counts are inherently approximate here anyway (this is a pre-solve estimate, not a real assignment) — not worth the added complexity for a number that's already a heuristic input to another heuristic.

### 5. Candidate center: weighted geometric median over great-circle distance
The true objective (design decision 2) is the sum of each day's base→first-stop and last-stop→base legs. Pre-solve we don't know which places are which day's endpoints, so the proxy used is: minimize the weighted sum of one-way distance from the candidate to *every* place in the segment. This is the classical weighted Fermat–Weber / geometric median problem, solved via Weiszfeld's algorithm (iterative reweighting, seeded at the weighted arithmetic mean, ~50 iterations or convergence to ~1e-6 degrees) over `haversineKm` distance.

Using plain great-circle distance for the *search* (rather than the full mode-mixing `heuristicEntry` curve) is deliberate: every curve `heuristicEntry` mixes (walk/urban-transit/regional-rail) is documented in `matrix.ts` as non-decreasing in distance, so a location that minimizes weighted distance also minimizes (or nearly minimizes) weighted heuristic minutes, and distance has the smooth, single-minimum structure Weiszfeld's algorithm needs — the true heuristic's `min()`-of-curves shape does not. Once a candidate location is found this way, its *reported* numbers always come from the real `heuristicEntry` (called with the candidate as a minimal synthetic `Place`-shaped object `{id, name: "", lat, lng, category: "other", dwellMin: 0, priority: 3}`), so what the user sees is never a distance approximation — only the search step is.

### 6. Candidate cost: always evaluated against the whole segment
Alternatives (see Decision 7) are only informative if their cost is comparable on the same basis. A candidate near sub-cluster A is scored by its weighted average one-way `heuristicEntry` minutes to **every** place in the segment (not just cluster A) — because staying near A doesn't exempt the trip from still reaching cluster B on some day. This is what makes a trade-off like "20 min/day more" honest rather than cherry-picked.

### 7. Multiple candidates: primary + competitive sub-cluster alternatives
The primary candidate is the segment-wide weighted geometric median. To find real alternatives (not manufactured ones), the segment's own places are split with unweighted `kMeans(places, 2)`; each non-empty resulting sub-cluster gets its own weighted geometric median, scored against the whole segment (Decision 6). Candidates within ~0.05 km of each other are deduplicated (this is what collapses "all places at the same point" or "one dominant cluster" back down to a single candidate — `kMeans` splitting duplicate points doesn't produce a second real option). Results are sorted by cost ascending; the best is always kept; additional candidates are kept only when competitive — cost within `max(10 minutes, 35%)` of the best — and the list is capped at 3. This directly implements design decision 6 (show the shape of the choice, not one over-precise pin) while never inventing an alternative the data doesn't support.

Alternative considered: always show exactly the top-3 nearest-neighbor candidates regardless of cost. Rejected — that would present clearly-worse options as if they were live choices, the "false precision" problem in reverse.

### 8. Radius and label
Radius = weighted RMS great-circle distance from the candidate center to the segment's places, floored at 0.3 km (so a single place or a tight cluster still reads as "look right around here" rather than a meaningless zero). Label = `"Near <name of the closest actual place to the candidate>"`, deterministic tie-break (closest by distance, then by place id). This never fabricates a neighbourhood name and needs no reverse geocoding — it's an honest anchor drawn from data already in the trip.

### 9. Rationale text lives in the pure solver function
`packages/solver/src/explain.ts`'s `explainUnscheduled` already generates human-readable, quantified strings inside this package (not deferred to the UI). The new module follows the same precedent: each candidate carries a `rationale: string` built from its own numbers (place count, priority mix, average one-way minutes) so the UI only has to render it, and the wording is covered by the same pure-function tests as everything else here.

### 10. UI surface: inside `StaysPanel.tsx`, computed inline
The Stays panel is already the trip's hotel-management surface and already has an empty-state hint for "no hotels yet" (`AUTO_HOTEL_NOTES`/`hotelNeedsLocation`) — the natural, already-discovered place for a first-time user with places but no hotel to be told where to look. The panel already calls `staysFor(trip)` directly in the render body with no memoization; the new recommendation is computed the same way (`recommendHotelAreas(trip)` called inline, index-aligned with `staysFor(trip)`'s stay rows) — no new store state, no new persisted field, cheap enough at trip scale (same O(N) to O(N log N) cost class as everything else already computed inline here). This answers "on demand vs. reactive": it's reactive, matching the codebase's existing convention for this exact panel.

Alternative considered: a dedicated empty-state banner above the whole Timeline, or a MapView overlay. Rejected for v1 — the Stays panel is where the user already goes to manage bases, and putting it there keeps one place to both see *and* act on the recommendation (Decision 11) rather than splitting the flow across two surfaces. Nothing here precludes adding a map visualization later.

### 11. Accepting a recommendation: extend `addHotelForStay`, don't add a new action
`addHotelForStay(idx, name?)` already does exactly "create a hotel place, assign it to stay `idx`, one undoable mutation" — the only thing it lacks is a way to say where. It gains a third, optional parameter: `location?: { lat: number; lng: number }`. When provided, the hotel is created at that location instead of copying the current (possibly-placeholder) base, and it is **not** stamped with `AUTO_HOTEL_NOTES` — that sentinel string is `hotelNeedsLocation`'s only signal that a hotel's location was never deliberately set, and a recommendation-derived location is the opposite of that by construction. Concretely: when `location` is passed, `notes` is left unset (or set to a distinct, non-matching string) so `hotelNeedsLocation` returns `false` for it. This is additive to an already-optional-parameter call signature, so every existing call site and test is unaffected.

### 12. No schema change
Every input (`priority`, `dwellMin`, `lat`/`lng`, `appointment.dayId`, `forceDayId`, `stayStart`, `baseStartId`/`baseEndId`) already exists on `Place`/`Day`. The recommendation itself is never persisted — it's recomputed on render, like `staysFor`. `schemaVersion` stays at 3.

## Risks / Trade-offs

- **Distance-based search vs. minute-based objective** (Decision 5) → the found center is provably optimal for weighted distance, not for weighted heuristic minutes; mitigated by the mode curves' documented monotonicity (a distance optimum is at worst a close approximation of the minutes optimum) and by always reporting real `heuristicEntry` minutes for the final numbers, so the *displayed* figures are never approximate even if the *search* used a proxy.
- **Pre-solve segment place assignment is a guess** (Decision 4) → explicitly a heuristic, not a real per-day assignment; mitigated by using explicit day hints (appointments/forced days) first, and by the whole feature being framed to the user as a search-area suggestion, not a scheduled fact.
- **Uniform k-means capacity across segments** → a segment with disproportionately many nights could be under- or over-served relative to a nights-weighted split; accepted as a deliberate simplification (see Decision 4's "explicitly deferred") since the input to this step is already an estimate.
- **No map visualization** → a purely textual radius/center is less immediately graspable than a drawn circle; accepted for v1 given the lack of a render-test harness and to keep this change's surface area contained to one panel.

## Open Questions

None — every decision above was resolvable now without changing the spec, approach, or task breakdown.

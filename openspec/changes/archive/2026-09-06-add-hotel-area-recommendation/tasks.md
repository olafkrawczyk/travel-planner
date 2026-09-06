## 1. Solver: segment derivation refactor (behavior-preserving)

- [x] 1.1 In `packages/solver/src/matrix.ts`, extract the inline `stayGroups` derivation loop inside `buildProblem` into a standalone exported function `staySegments(days: Day[]): number[][]`; have `buildProblem` call it in place of the inline loop.
- [x] 1.2 Run `packages/solver/src/tokyo.test.ts` and `packages/solver/src/warsaw.test.ts` and confirm baselines are byte-for-byte unchanged (score, totalTravelMin, unscheduled count). If anything moves, the refactor introduced a behavior change — fix it, don't re-record.
- [x] 1.3 Export `staySegments` from `packages/solver/src/index.ts`.

## 2. Solver: hotel-area recommendation engine

- [x] 2.1 Create `packages/solver/src/hotelArea.ts` with:
  - `weightForPlace(place: Place): number` implementing `(4 - priority) * max(dwellMin, 15)`.
  - A weighted geometric median function (Weiszfeld's algorithm) over `{lat, lng, weight}` points using `haversineKm`, seeded at the weighted arithmetic mean, iterating to convergence (or a fixed cap), degenerate-safe for 0/1 points and coincident points.
  - A segment-place-assignment function: places with `appointment.dayId`/`forceDayId` resolve to their day's segment directly; remaining eligible places (exclude `category === "hotel"`, exclude non-finite `lat`/`lng`) are split via `kMeans` (capacity-constrained, same style as `apps/web/src/clustering.ts`) when `numSegments > 1`, with clusters matched to segments via greedy nearest-centroid-to-segment-anchor (segment anchor = the place at that segment's first day's `baseStartId`); skipped entirely (single group) when there is only one segment.
  - A candidate-cost function: weighted average one-way `heuristicEntry` minutes from a candidate location to every place in the (whole) segment, using a minimal synthetic `Place`-shaped object for the candidate.
  - A radius function: weighted RMS `haversineKm` distance from a candidate to the segment's places, floored at 0.3 km.
  - A label function: `"Near <name>"` using the closest actual segment place to the candidate, deterministic tie-break.
  - A per-segment candidate-generation function: primary = segment-wide weighted geometric median; alternatives = weighted geometric median of each non-empty cluster from unweighted `kMeans(segmentPlaces, 2)`; dedup candidates within ~0.05 km; sort by cost ascending; keep the best always, keep others only within `max(10 min, 35%)` of the best; cap at 3.
  - A rationale-string builder per candidate (place count, priority mix, average one-way minutes) following the plain-language style of `explain.ts`.
  - The top-level `recommendHotelAreas(trip: Trip): HotelAreaSegment[]` orchestrator tying the above together, using `staySegments(trip.days)` for segment boundaries. Handle zero days (return `[]`) and zero eligible places in a segment (return that segment with `candidates: []` and a clear "not enough places yet" note) without throwing.
- [x] 2.2 Export the new public types/functions (at minimum `recommendHotelAreas`, `HotelAreaSegment`, `HotelAreaCandidate`) from `packages/solver/src/index.ts`.

## 3. Solver: tests

- [x] 3.1 `packages/solver/src/hotelArea.test.ts`: weighting (`weightForPlace` priority/dwell interaction, dwell floor).
- [x] 3.2 Weighted geometric median: converges to the single point for identical/near-identical inputs; pulls toward the heavier-weighted cluster for two clusters of unequal weight.
- [x] 3.3 Degenerate cases: zero places in a segment; exactly one place; all places at the same coordinates; a place with missing/non-finite coordinates (excluded, doesn't throw); a trip with zero days (`recommendHotelAreas` returns `[]`, doesn't throw).
- [x] 3.4 Two distant, similarly-weighted clusters produce ≥2 competitive candidates with sane comparative costs; one tight cluster produces exactly 1 candidate (no manufactured alternatives).
- [x] 3.5 Multi-segment trip (reuse or adapt the Tokyo→Hakone multi-hotel sample shape): each segment's recommendation is influenced only by that segment's own places, and a place with an `appointment.dayId` in one segment is not pulled into another segment's candidate generation.
- [x] 3.6 A must-see cluster outranks a same-size nice-to-have cluster (top candidate is nearer the must-see cluster).

## 4. Store: extend `addHotelForStay`

- [x] 4.1 In `apps/web/src/store.ts`, extend `addHotelForStay(idx, name?, location?)` to accept an optional `{ lat: number; lng: number }`; when provided, use it for the created hotel's coordinates instead of copying the current base, and do NOT stamp the `AUTO_HOTEL_NOTES` sentinel (leave `notes` unset, or set a distinct, non-matching note).
- [x] 4.2 Extend `apps/web/src/store.test.ts`'s existing `addHotelForStay` describe block: a call with `location` creates the hotel at that location and `hotelNeedsLocation` (imported from `StaysPanel.tsx`) returns `false` for it; existing no-location calls are unaffected (still flagged as needing a location).

## 5. UI: surface the recommendation in the Stays panel

- [x] 5.1 Add a `HotelAreaPanel` section (new sub-component in `StaysPanel.tsx` or a new file, per what reads cleaner alongside the existing stay-row markup) that, per stay row, calls `recommendHotelAreas(trip)` (index-aligned with `staysFor(trip)`) and renders that segment's candidate(s): center/area description, radius, rationale text, and (when more than one candidate) a clear side-by-side comparison of the trade-off.
- [x] 5.2 Each candidate gets a keyboard-operable "Use this area" control wired to `addHotelForStay(idx, undefined, { lat, lng })`, and an outbound "Search hotels here" link built the same way as `Timeline.tsx`'s `gmapsLink` (Google Maps, clearly marked as external, opens in a new tab/context).
- [x] 5.3 Handle the empty/degenerate states in the UI (no places yet, single precise candidate) with copy consistent with the panel's existing "No hotels yet" hint tone.
- [x] 5.4 Style with `apps/web/src/styles/stays.css` using only existing tokens from `apps/web/src/styles/tokens.css` (no hardcoded colors/spacing); verify keyboard operability and that any new labels/controls are properly associated (`aria-label`/`<label>`), consistent with the rest of the panel.
- [x] 5.5 If any new state change here should be announced, route it through `apps/web/src/components/LiveRegion.tsx`'s existing polite/assertive mechanism (e.g. an accepted recommendation triggering a re-solve is already covered by the existing "Itinerary updated" announcement — confirm this rather than adding a redundant one).

## 6. UI: tests

- [x] 6.1 Add/extend `apps/web/src/components/StaysPanel.test.ts` for any new pure helpers introduced (e.g. label/formatting helpers used by `HotelAreaPanel`), following the existing pure-exported-helper test pattern (no component-render harness in this repo).

## 7. Verification

- [x] 7.1 `npx tsc -b --force` reports 0 errors.
- [x] 7.2 `pnpm test` passes in full (397 existing + new tests), including unchanged `tokyo.test.ts`/`warsaw.test.ts` baselines.
- [x] 7.3 `pnpm build` succeeds.
- [x] 7.4 Manually trace through: a fresh trip with 12 places and no hotel shows a recommendation in the Stays panel; a multi-hotel (Tokyo→Hakone-shaped) trip shows one recommendation per stay; accepting a recommendation creates a hotel that does NOT show the "needs location" badge.

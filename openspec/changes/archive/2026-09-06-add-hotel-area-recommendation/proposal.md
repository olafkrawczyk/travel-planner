## Why

The user has a pile of places they want to visit and has not booked accommodation yet. Nothing in the app today tells them where to even start looking for a hotel — the solver requires a base to run, but choosing that base is exactly the decision the user is stuck on. They're left eyeballing their pinned places on the map and guessing a neighbourhood. The app already has all the ingredients (places with priority/dwell, the heuristic travel model, multi-stay support) to answer "which area?" honestly, without needing a solved itinerary, hotel inventory, or any new network call.

## What Changes

- **New pure recommendation engine** (`packages/solver`): given a trip's places and day/stay structure — no solved itinerary required — compute one or more candidate hotel-search areas per stay segment, each a center + radius + plain-language rationale, weighted toward must-see places and away from the middle of a segment's geography rather than toward its whole-day traffic.
- **Multi-segment aware**: a trip with multiple hotel stays (mid-trip hotel changes) gets one recommendation per stay segment, computed from only the places geographically/appointment-relevant to that segment's days.
- **Honest trade-offs, not one pin**: when a segment's places form more than one plausible geographic base, up to three competitive candidate areas are surfaced with comparable "average one-way minutes" numbers, instead of a single false-precision point.
- **Surfaced in the Stays panel**: a new recommendation section appears per stay row in `StaysPanel.tsx` (the existing hotel-management surface), most valuable to a first-time user who has places but no hotel yet.
- **One-click acceptance reuses the existing stay-creation path**: accepting a recommended area creates a hotel place and assigns it to that stay via the store's existing `addHotelForStay` mutation (extended with an optional explicit location), rather than a new store action. Because the location is deliberate, the resulting hotel is **not** flagged with the existing "needs location" badge (that badge is reserved for the placeholder-location case).
- **No new external service call, no new persisted schema field, no map changes** — see design.md for the reasoning behind each of those calls.

## Capabilities

### New Capabilities
- `hotel-area-recommendation`: computing honest, non-solved-plan-dependent hotel search areas per stay segment (weighting, candidate generation, trade-off presentation) and surfacing them in the Stays panel with a one-click "use this area" action that creates a correctly-flagged hotel/stay.

### Modified Capabilities
(none — this is purely additive: it introduces a new capability surfaced inside the existing Stays panel without changing any existing requirement's observable contract. The Stays panel's existing `itinerary-view` requirement is unaffected: it continues to hold exactly as specified, this change only adds new content inside it.)

## Impact

- `packages/solver/src/hotelArea.ts` (new): weighting, segment-aware place assignment, weighted geometric median, candidate generation/dedup/ranking, rationale text.
- `packages/solver/src/matrix.ts`: extract the existing stay-grouping logic (`buildProblem`'s inline `stayGroups` derivation) into a standalone exported `staySegments(days)` function; `buildProblem` calls it — behavior-preserving refactor, no fixture-baseline changes.
- `packages/solver/src/index.ts`: export the new module's public API.
- `packages/solver/src/hotelArea.test.ts` (new): weighting, segment derivation, candidate generation, and every degenerate case (zero places, one place, identical coordinates, missing coordinates, two distant clusters, zero-day trip).
- `apps/web/src/store.ts`: `addHotelForStay` gains an optional explicit `{lat, lng}` parameter; when provided, the created hotel does not get the placeholder "needs location" notes sentinel.
- `apps/web/src/components/StaysPanel.tsx` (+ new `HotelAreaPanel` sub-component or inline section): renders the recommendation(s) per stay row and wires "use this area" to `addHotelForStay`.
- `apps/web/src/components/StaysPanel.test.ts`, `apps/web/src/store.test.ts`: extended coverage for the above.
- `apps/web/src/styles/stays.css`: new styles, tokens-only.
- No schema change, no new external service, no `MapView.tsx` change.

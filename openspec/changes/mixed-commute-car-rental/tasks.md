## 1. Domain model

- [x] 1.1 Add `CarRentalSchema` (`{id, startDate, endDate}`) and `Trip.carRentals` (default `[]`) to `packages/domain/src/schema.ts`; bump `schemaVersion` to 4
- [x] 1.2 Add/extend zod migration in `packages/storage` so existing persisted trips (v3) load with `carRentals: []`; add round-trip persistence test (save/reload/export/import keeps rentals)
- [x] 1.3 Update stale `matrix.ts` doc comment claiming `Mode` is only `walk | transit`

## 2. Solver: mode-aware matrix

- [x] 2.1 Extract the car cost curve (60 km/h + 5 min parking, walk wins ≤ `walkMaxKm`) from `heuristicEntry`'s `carOnly` branch into a shared candidate-selection path; exported `heuristicEntry` signature unchanged (`carOnly` ⇒ car available)
- [x] 2.2 Add matrix unit tests: car-day candidate set is `{car, walk}`; non-car day set unchanged; monotonicity invariant holds with the car curve; fixture baselines still pass byte-identically for trips without rentals
- [x] 2.3 Build a lazy car entries matrix when the trip has rentals or `carOnly`; share the overrides map and resolution precedence (override > cached API > heuristic; foot-profile API durations usable only as the walk candidate)
- [x] 2.4 Expose `getForDay(fromId, toId, dayIdx)` dispatching on per-day car availability; default `get` keeps current behaviour

## 3. Solver: per-day availability and solving

- [x] 3.1 Add `carByDay: boolean[]` (+ `hasAnyCar`) to `Problem`, derived in `buildProblem` from `Trip.carRentals` date ranges clipped to trip days
- [x] 3.2 Switch per-day matrix access in `split`, `sequence`, ALNS operators, and the repair pass to `getForDay(..., dayIdx)`; leave day-agnostic paths (`giantTour`, cluster adjacency, hotelArea) on the default matrix
- [x] 3.3 Emit legs with the mode actually used (`car` legs on car days) including explanation strings for the car heuristic
- [x] 3.4 Make rental add/edit/remove trigger a full re-solve (not incremental) from the store path
- [x] 3.5 Solver tests: distant unschedulable place becomes scheduled when a rental covers a day; non-car days solve identically to a no-rental trip; walk wins over car for short hops on car days; overrides honoured on both day types; determinism with rentals fixed

## 4. UI: booking and display

- [x] 4.1 Add rental editor in the stays panel: calendar-style range picker restricted to trip dates, existing-rental days disabled, overlap prevention with visible explanation
- [x] 4.2 Add rental coverage bar (distinct from stays styling) and out-of-range rental flag when trip dates no longer cover a rental
- [x] 4.3 Add car-day indicator on timeline day cards; ensure car legs show a car mode badge with explanation
- [x] 4.4 Wire rental edits through the trip store: availability indicators update immediately, re-solve runs, undo/redo covers rental changes

## 5. Validation

- [x] 5.1 Add a rental-covering variant of one benchmark fixture with recorded baselines (score, travel, unscheduled count)
- [x] 5.2 Run lint, typecheck, full test suite and fixture regressions; verify a trip with no rentals produces identical output to pre-change baseline

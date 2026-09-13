## Context

`Mode` already includes `"car"` in the persisted zod schema (`packages/domain/src/schema.ts:10`), but the solver only uses it via the global `TripSettings.carOnly` toggle: `heuristicEntry` (`packages/solver/src/matrix.ts:67`) switches its candidate curves wholesale — transit/rail when `carOnly` is false, car (60 km/h + 5 min parking) when true. The travel matrix stores a single `MatrixEntry {minutes, mode, source, explanation}` per pair with no notion of "which day". Solver input (`Problem`) already carries per-day structures (`dayList`, `stayGroups`, per-day bases), so a per-day boolean slot fits the established shape.

## Goals / Non-Goals

**Goals:**
- Rentals as trip data; per-day car availability derived from date ranges.
- One solve that mixes car and non-car days, with the solver free to place distant work on car days.
- Zero behaviour change for trips without rentals (byte-identical itineraries for existing fixtures).

**Non-Goals:**
- Rental suggestions, pickup/dropoff stations, one-way rentals, rental costs.
- OSRM driving-profile fetches (heuristic car curve only; API layer untouched).
- Changes to `carOnly`, region protection, or cluster-first behaviour.

## Decisions

### 1. Rentals stored as date ranges on the trip
`Trip.carRentals: CarRental[]` with `CarRental = { id, startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }`. Availability is **derived** per day (`hasCar(dayIdx)`) inside `buildProblem` — never stored on `Day`.

- *Why date ranges, not per-day flags:* matches how users actually book rentals, and the stays feature already established "user edits ranges, days derive semantics".
- *Why not store on `Day`:* stays tried both shapes historically; range data survives trip date-range edits better and avoids N booleans to keep consistent.
- *Out-of-range rentals* (trip dates shrunk later): stored as-is, availability derived only over existing trip days; the UI flags rentals extending beyond the trip for cleanup rather than silently deleting user data.

### 2. Second matrix layer instead of widening `MatrixEntry`
Build a **car variant of the entries matrix** alongside the existing one, and expose `matrix.getForDay(fromId, toId, dayIdx)` which dispatches on `hasCar[dayIdx]`. The car matrix is built **lazily — only when the trip has at least one rental** (or `carOnly`), so memory stays 1×N² for the common case.

- *Alternative considered:* `MatrixEntry.minutes: Partial<Record<Mode, number>>` — touches every consumer for no benefit and entangles modes; the dispatch approach keeps `MatrixEntry` untouched.
- Both variants share the overrides map (user overrides apply regardless of mode — they are the user's measured times) and the same resolution precedence (override > cached API > heuristic).

### 3. Car curve = the existing `carOnly` curve, extracted
Extract the car candidate (60 km/h + 5 min parking, walk still wins under `walkMaxKm`) out of `heuristicEntry`'s `carOnly` branch into a shared code path. `heuristicEntry` gains an internal "available modes" notion; the exported signature stays (`settings.carOnly` ⇒ car available on all days) so the ~30 call sites in `hotelArea.ts` and tests are untouched. On a rental car day the candidate set is `{car, walk (≤walkMaxKm)}`; on a non-car day it is today's `{walk, transit, rail}`.

- The min-of-non-decreasing-curves invariant documented in `matrix.ts` is preserved (car curve is affine and non-decreasing), so heuristic monotonicity tests keep passing.
- API resolution on a car day: cached foot-profile durations remain usable as the *walk* candidate; no driving API data exists in v1, so the car candidate is always heuristic — the leg's source badge reflects that honestly.

### 4. Threading `hasCar` through the solver
`Problem` gains `carByDay: boolean[]` (and `hasAnyCar: boolean` as a fast-path flag). Consumers that currently call `matrix.get(...)` in a per-day context (`split`, `sequence`, ALNS operators, repair pass) switch to `getForDay(..., dayIdx)`. Distance-only code paths (`giantTour`, cluster adjacency, hotelArea) are day-agnostic and stay on the default matrix.

- *Why a full re-solve on rental edit (no incremental):* car availability changes the feasible solution space globally (distant places become insertable anywhere), so the "affected days only" heuristic used for drags would produce stale assignments elsewhere. Rental edits are rare; full solve is acceptable.

### 5. Persistence: additive schema bump
`schemaVersion` 3 → 4; migration adds `carRentals: []` (zod `.default([])` makes old payloads validate unchanged). Export/import and share links carry the field for free through existing trip serialisation.

### 6. UI: rentals live next to stays
The stays panel already owns "temporal coverage of the trip" visually (coverage bar across days). The rental editor goes in the same panel: a calendar-style range picker restricted to the trip's dates, overlapping/other-rental days shown as disabled, a second coverage bar (distinct styling) for rentals, and a vehicle indicator on car day cards. Leg badges need no new mechanism — `Leg.mode` already renders; only the label/explanation for `car` is added. Rental edits write through the existing trip-update store path, which already triggers re-solve.

## Risks / Trade-offs

- [Solver assigns big detours to car days, unbalancing the plan] → Existing day-levelling ALNS operators already minimise imbalance; the car curve only changes edge weights, not the objective. Benchmark fixtures get a rental-covering variant to pin behaviour.
- [Heuristic car times unrealistic (no traffic, flat 60 km/h)] → Same trade-off already accepted for `carOnly`; explanations always name the heuristic source. OSRM driving profile is the natural v2.
- [Doubled matrix memory for rental trips] → Car matrix built only when rentals exist; N is small (≤ a few hundred), so 2×N² entries is fine.
- [Walk candidate on car days uses foot-profile API walking time, mixing sources] → Matches the existing car-vs-walk blend in `resolveApiOrHeuristic`; the badge shows the true source.
- [Stale `matrix.ts` doc comment claims `Mode` is only walk/transit] → Fixed in passing; the comment's caution is obsolete since `ModeSchema` already includes `"car"`.

## Migration Plan

Additive: new optional-with-default trip field, new solver input field defaulting to "no car anywhere". Existing trips load unchanged and solve identically (guarded by the existing Tokyo/Warsaw fixture baselines). Rollback is trivial — the field is ignored by older code paths if the release is reverted before any later migration builds on it.

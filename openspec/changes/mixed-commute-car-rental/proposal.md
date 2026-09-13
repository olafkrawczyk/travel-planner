## Why

Today the planner assumes the traveller never drives: travel times are always the cheapest of walk/transit/rail curves, and the only car support is a global `carOnly` toggle. Real trips mix modes — travellers often rent a car for a portion of the trip (e.g. a countryside leg between city stays). The solver cannot represent this, so it under-plans car days (distant places stay "unreachable") and over-penalizes them (transit curves applied to a day the user will drive).

## What Changes

- Users can book a car rental for a **date range within the trip** (matching how rentals are actually booked), via a calendar-like control in the trip input UI.
- The trip stores car rentals as first-class data (`Trip.carRentals`); each day's car availability is derived from the rental's date range (v1: the car is "with you" for the whole day — no pickup/dropoff locations or times).
- On days with a car, the solver evaluates travel using a car cost curve (the existing heuristic car curve: ~60 km/h + parking overhead, walking still wins for very short hops) instead of the walk/transit-only minimum.
- The travel matrix becomes mode-aware so car and non-car days can be evaluated in one solve; legs on car days are emitted with mode `car`.
- `TripSettings.carOnly` stays exactly as it is (whole-trip toggle); the new mechanism is additive and independent.
- Out of scope (explicitly deferred): car-rental *suggestions* from the solver, rental pickup/dropoff stations and one-way rentals, monetary cost of rentals, fetching OSRM driving-profile tables (heuristic car times only in v1).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trip-management`: new requirement for managing car rentals (book a car for a date range, edit/remove it, derive per-day availability); rentals are stored on the trip and survive re-solves and persistence.
- `itinerary-solver`: travel-time matrix and day assignment/sequencing become aware of per-day car availability — car days use the car cost curve, non-car days keep today's behaviour unchanged; emitted legs carry the actual mode used.
- `itinerary-view`: timeline leg badges reflect car legs; days covered by a rental are visually identified in the timeline (calendar-style availability indication).

## Impact

- `packages/domain` (`schema.ts`): new `CarRental` schema + `Trip.carRentals` field (additive, no migration of existing fields; schemaVersion bump per persistence rules).
- `packages/solver` (`matrix.ts`, `split.ts`, `sequence.ts`, `alns.ts`, `solve.ts`): mode-aware matrix entries; per-day car availability in `Problem`; car heuristic curve reused from the `carOnly` path.
- `packages/storage`: persistence of the new trip field (zod versioning/migration).
- `apps/web`: rental booking UI (calendar-ish date-range control), day car-availability display, leg badges/explanations for car mode, store wiring, re-solve on rental edits.
- No external service changes (OSRM car profile intentionally out of scope for v1).

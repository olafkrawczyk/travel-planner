# Proposal: fix-time-display-sample-trips

## Why

Timeline times render with float garbage ("14:10.9999999999999") because float travel minutes propagate into `formatHHMM`. Hotel start/end points are not clearly identifiable on the map and can't be toggled. And there are no rich, real-world sample trips for benchmarking/demo beyond a synthetic solver fixture.

## What Changes

- **Time formatting fix**: all displayed times are whole-minute `"HH:mm"` — round minutes at the solver output boundary (`computeTimes` arrive/depart/wait) AND make `formatHHMM` itself total (rounds any float input) so no caller can reintroduce the bug.
- **Hotel start/end markers**: base (hotel) markers are clearly identifiable on the map (distinct "H" hotel styling, name on hover) with a map-level toggle to show/hide them; hidden state returns to the current look.
- **Sample trips**: two curated real-world trips ship as importable samples — **Tokyo, 5 days, 24 places** (hotel in Shinjuku) and **Warsaw, 4 days, 22 places** (hotel in Śródmieście/Old Town) — loadable with one click from the trip list, and mirrored as solver benchmark fixtures (Warsaw joins the existing Tokyo fixture; regression assertions on score/travel/unscheduled for both).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `itinerary-solver`: timeline times SHALL be whole minutes; benchmark fixtures for Tokyo and Warsaw SHALL guard route quality.
- `itinerary-view`: displayed times SHALL always be whole-minute HH:mm; hotel start/end markers SHALL be identifiable and toggleable.
- `trip-management`: the trip list SHALL offer one-click curated sample trips (Tokyo, Warsaw).

## Impact

- `packages/domain/src/time.ts` (rounding), `packages/solver/src/sequence.ts` (round at boundary), `apps/web` (MapView hotel styling + toggle, TripList sample buttons, sample data), `packages/solver/fixtures/` (Warsaw fixture, real Tokyo data replaces/augments synthetic fixture), `packages/solver/src/tokyo.test.ts` + new `warsaw.test.ts`.
- Data files authored up-front in the change folder (`samples/tokyo.json`, `samples/warsaw.json`) — the implementer wires them in, no web research needed at implementation time.
- No schema changes.

## ADDED Requirements

### Requirement: Per-day car availability
The solver SHALL derive per-day car availability from the trip's car rentals and SHALL use it when evaluating travel on each day. On a car day, travel times SHALL be evaluated as the minimum over the modes available that day: the car cost curve (the same heuristic curve used by `carOnly` — driving speed plus a parking overhead) and walking for very short hops. On non-car days behaviour SHALL be unchanged: the existing cheapest-of walk/transit/rail curves apply. On a `carOnly` trip all days behave as car days exactly as before. Legs SHALL be emitted with the mode actually used, so a leg solved with the car curve carries mode `car`; non-car legs keep their current modes. The solver SHALL remain deterministic for a given seed and input, including the car configuration, and incremental re-solves SHALL respect the car availability of the affected days: changing a rental SHALL trigger a full re-solve (car availability can change the feasible solution space across all days).

#### Scenario: Distant place becomes schedulable on a car day
- **WHEN** a place is too far to reach within the day budget by transit but reachable by car, and the user books a rental covering that day
- **THEN** the re-solved itinerary schedules the place on a car day using car travel times, instead of reporting it unscheduled as unreachable

#### Scenario: Non-car day unchanged
- **WHEN** a trip has a rental on days 3–5
- **THEN** days 1–2 and 6–7 are solved exactly as they would be with no rentals, and their legs carry non-car modes

#### Scenario: Car day evaluates over available modes
- **WHEN** a leg on a car day connects two stops less than a very short hop apart (walking is faster than driving plus parking)
- **THEN** the leg uses walking time and carries mode `walk`, not `car`

#### Scenario: Car leg is emitted with car mode
- **WHEN** a leg on a car day is best served by the car curve
- **THEN** the leg's mode is `car` with the actual car-derived minutes and its usual source (heuristic or override)

#### Scenario: Travel override applies on car days
- **WHEN** a user travel-time override exists for a pair and both days appear in a car-day and a non-car-day context
- **THEN** the override is honoured on both day types, since it represents the user's own measured time for that pair

#### Scenario: Rental edit triggers full re-solve
- **WHEN** the user extends, shrinks, or removes a rental
- **THEN** the itinerary is re-solved with the new per-day car availability, and the same trip snapshot and seed always produce the same result

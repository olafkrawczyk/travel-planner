## MODIFIED Requirements

### Requirement: Travel-time matrix
The solver SHALL build an N×N travel-time matrix in minutes over all places and day bases, applying per-pair resolution in priority order: user override, then cached routing-API (OSRM `/table`) result, then heuristic (walk below a distance threshold, transit with overhead above it, straight-line distance scaled by a detour factor). API results SHALL be persisted in a local cache keyed by rounded coordinates and profile so reloads do not re-fetch. The matrix SHALL be cached so that moving one place only recomputes its row and column. Solving SHALL NOT block on the network: the heuristic plan is produced immediately and one re-solve follows when API data arrives; if the API is unreachable, rate-limited, or the node count exceeds the server limit, the heuristic is used instead.

#### Scenario: Heuristic leg estimation
- **WHEN** no override or API result exists for a pair 0.8 km apart (below the walk threshold)
- **THEN** the matrix entry equals walking time at the configured walk speed, and the leg source is "heuristic"

#### Scenario: Override wins over heuristic
- **WHEN** an override exists for a pair
- **THEN** the matrix uses the override value regardless of distance, and the leg source is "override"

#### Scenario: API result used when cached
- **WHEN** an OSRM table response covering the trip's nodes is in the cache
- **THEN** legs use API minutes with source "api", and no network request is made

#### Scenario: API fetch then re-solve
- **WHEN** a trip is solved without cached API data
- **THEN** the heuristic itinerary is produced first, the OSRM table is fetched once in the background, and a single re-solve applies API times with source "api"

#### Scenario: API failure falls back
- **WHEN** the OSRM request fails or the node count exceeds the table limit
- **THEN** the itinerary still solves with heuristic times, and the user is informed that estimated times are in use

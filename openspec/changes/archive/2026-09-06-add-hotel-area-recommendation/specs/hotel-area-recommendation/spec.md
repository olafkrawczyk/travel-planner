## Purpose

Tells a user who has entered places but not yet booked accommodation which area to search for a hotel in, and why — computed honestly from their place list and trip/stay structure alone, without requiring a solved itinerary or any hotel inventory data.

## ADDED Requirements

### Requirement: Recommendation computed without a solved itinerary
The system SHALL be able to compute a hotel-area recommendation from a trip's places and day/stay structure alone, without requiring the itinerary to have been solved and without depending on any solver output (day assignments, sequencing, or timing).

#### Scenario: Recommendation available before any solve
- **WHEN** a trip has places added but has never been solved
- **THEN** a hotel-area recommendation can still be computed from those places and the trip's days

#### Scenario: Recommendation ignores stale solved output
- **WHEN** a trip has a stale or absent solved itinerary
- **THEN** the recommendation is computed the same way regardless, using only places and day/stay structure

### Requirement: Recommendation weighted toward what the user cares about
The recommendation SHALL weight each place's influence on the suggested area by its priority tier (must-see influencing the result more than nice-to-have) and its dwell time, so that a cluster of must-see places pulls the recommendation toward it more strongly than a cluster of nice-to-have places of similar size.

#### Scenario: Must-see cluster dominates a nice-to-have cluster
- **WHEN** a trip has a geographically separate cluster of must-see places and a similarly-sized cluster of nice-to-have places
- **THEN** the top-ranked candidate area is the one nearer the must-see cluster

### Requirement: Base-adjacent travel is the recommendation's objective
The recommendation SHALL be based on estimated one-way travel time from a candidate area to the trip's places using the existing offline heuristic travel-time model, reflecting that a hotel's location primarily affects the start and end of each day, not the total travel within a day. The recommendation SHALL NOT require or trigger any network request.

#### Scenario: Offline and instant
- **WHEN** a hotel-area recommendation is computed
- **THEN** no network request is made and no routing-API data is required

### Requirement: Per-stay-segment recommendation for multi-hotel trips
When a trip has more than one stay segment (a hotel change mid-trip), the system SHALL compute a separate recommendation for each segment, based only on the places relevant to that segment's days, rather than a single recommendation for the whole trip.

#### Scenario: Two-city trip gets two recommendations
- **WHEN** a trip has two stay segments covering geographically distinct sets of places
- **THEN** each segment has its own recommendation reflecting only its own places

#### Scenario: Single-hotel trip is the one-segment case
- **WHEN** a trip has only one stay (or no hotel assigned yet)
- **THEN** the recommendation is computed once, over all of the trip's places, as the one-segment case of the same mechanism

### Requirement: Recommendation is an honest search area, not a hotel listing
Each recommended candidate SHALL be presented as a search area (a center location, a radius, and a plain-language label) with a rationale describing why it was chosen, and SHALL NOT name, imply, or fabricate any specific hotel, price, or availability. An optional outbound link MAY be offered to search for hotels in that area on an external map service, and SHALL be clearly indicated as leaving the app.

#### Scenario: No fabricated hotel data
- **WHEN** a recommendation is shown
- **THEN** it names no specific hotel, price, or availability, and its rationale is expressed only in terms of the user's own places and estimated travel time

#### Scenario: Outbound search link leaves the app
- **WHEN** the user follows the "search hotels in this area" link
- **THEN** an external map service opens in a new context, and the link is visibly marked as external

### Requirement: Competitive alternatives surfaced instead of one false-precise pin
When a stay segment's places support more than one reasonably competitive candidate area, the system SHALL surface up to three candidates ranked by estimated travel cost, each annotated with its estimated one-way travel time so the user can see the trade-off, rather than only the single best-scoring point. When the places do not support a meaningfully different alternative (e.g., they form one tight cluster), the system SHALL surface a single candidate rather than manufacturing artificial alternatives.

#### Scenario: Two distant clusters produce a real trade-off
- **WHEN** a stay segment's places form two geographically distant, similarly-weighted clusters
- **THEN** at least two candidate areas are shown, each with its own estimated one-way travel time, so the user can compare them

#### Scenario: One tight cluster yields a single candidate
- **WHEN** a stay segment's places are all close together
- **THEN** only one candidate area is shown

### Requirement: Degenerate inputs are handled without failure
The system SHALL handle degenerate inputs without error: a segment with no eligible places, a segment with exactly one place, places that all share the same coordinates, a place with missing or non-finite coordinates, and a trip with no days. A place with missing or non-finite coordinates SHALL be excluded from the computation rather than causing a failure.

#### Scenario: No eligible places yet
- **WHEN** a stay segment has no places with valid coordinates
- **THEN** the system reports that there are not enough places yet, rather than erroring or showing a fabricated area

#### Scenario: Single place gives a precise, low-radius candidate
- **WHEN** a stay segment has exactly one place with valid coordinates
- **THEN** the single candidate area is centered on that place with a small radius

#### Scenario: Invalid coordinates are excluded, not fatal
- **WHEN** one of a segment's places has a missing or non-finite coordinate
- **THEN** that place is excluded from the recommendation and every other eligible place is still considered

### Requirement: Accepting a recommendation creates a correctly-flagged stay
The system SHALL let the user turn an accepted candidate area directly into a hotel assigned to that stay segment, through the same mechanism already used to create a hotel from the stays UI. A hotel created this way SHALL be recorded at the recommended location and SHALL NOT be flagged as needing a location, since its location was deliberately chosen rather than defaulted.

#### Scenario: Accepting a recommendation creates a located hotel
- **WHEN** the user accepts a recommended area for a stay segment
- **THEN** a hotel place is created at that area's location and assigned to that stay, and the itinerary re-solves

#### Scenario: A recommendation-created hotel is not flagged as needing a location
- **WHEN** a hotel is created by accepting a recommendation
- **THEN** it does not show the "needs location" indicator that a placeholder-location hotel shows

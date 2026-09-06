## MODIFIED Requirements

### Requirement: Explainable legs
Every travel leg in the timeline SHALL show its duration and a source badge (heuristic / api / override), a human-readable explanation (e.g. "18 min — transit heuristic (2.9 km)" or "12 min — OSRM walking"), an inline edit control to override the time, and a "check in Google Maps" deep link.

#### Scenario: Override from the timeline
- **WHEN** the user edits a leg's minutes inline and confirms
- **THEN** a pair-level travel override is stored, the itinerary re-solves, and the leg shows the override badge

#### Scenario: Google Maps deep link
- **WHEN** the user clicks "check in Google Maps" on a leg
- **THEN** a directions URL opens with origin, destination and transit travel mode

#### Scenario: API-sourced leg badge
- **WHEN** a leg's minutes came from the routing API
- **THEN** the leg shows the "api" badge and an explanation naming the source

### Requirement: Never-blocking solve feedback
The system SHALL show the initial greedy itinerary immediately and animate in solver improvements as they arrive, without ever showing a blocking spinner for the solve itself. Fetching routing-API data SHALL never block the initial render; when API times replace heuristic times, the change SHALL be visible via source badges. If the routing API is unavailable, a non-blocking notice SHALL inform the user that estimated (heuristic) times are in use.

#### Scenario: Progressive display
- **WHEN** a solve starts
- **THEN** the first feasible itinerary renders promptly and is replaced in place as better solutions arrive

#### Scenario: Offline with grace
- **WHEN** the routing API is unreachable
- **THEN** the itinerary still renders with heuristic times and a toast explains that times are estimates

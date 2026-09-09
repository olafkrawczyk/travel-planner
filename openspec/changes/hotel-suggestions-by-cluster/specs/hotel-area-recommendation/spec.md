## ADDED Requirements

### Requirement: Geographic-cluster-based base area suggestions
The system SHALL detect geographic clusters of places independent of stay segments and day allocations. For each detected cluster that is geographically distant from the active base accommodation (e.g. >25km or substantial travel time), the system SHALL evaluate the cluster as a candidate base area.

#### Scenario: Multi-region trip detects separate base candidate
- **WHEN** a trip contains places forming a distinct geographic cluster distant from the assigned base
- **THEN** the system identifies that cluster as a candidate base area

#### Scenario: Tight single-region trip produces no external base candidates
- **WHEN** all trip places are tightly clustered near the existing base
- **THEN** no additional external base areas are suggested

### Requirement: Shadow solve validation for base recommendations
The system SHALL evaluate candidate base areas using background shadow solves in a Web Worker, simulating a trip configuration with the candidate base and comparing total transit time against the baseline solved itinerary. The system SHALL only surface a base suggestion if the shadow solve demonstrates a verified reduction in transit time.

#### Scenario: Base suggested when transit savings exceed threshold
- **WHEN** a shadow solve with a proposed base area saves meaningful transit time compared to the baseline solve
- **THEN** the candidate base is surfaced to the user displaying the verified time savings

#### Scenario: Base suppressed when no meaningful savings
- **WHEN** a shadow solve demonstrates negligible or negative transit time savings
- **THEN** the candidate base is suppressed from the UI

### Requirement: Auto-assigning days when applying a recommended base
The system SHALL support applying a recommended base area as a new stay in the trip. Applying the base SHALL automatically determine the appropriate number of nights based on the cluster's workload (dwell time and travel) and insert the stay into the trip's stay schedule.

#### Scenario: Applying recommended base creates stay and assigns nights
- **WHEN** the user applies a recommended base area
- **THEN** a new hotel place is created at the recommended location, a new stay is inserted with nights sized to the cluster's dwell time, and the itinerary re-solves

## MODIFIED Requirements

### Requirement: Accepting a recommendation creates a correctly-flagged stay
The system SHALL let the user turn an accepted candidate area directly into a hotel assigned as a new base stay, through the same mechanism already used to create a hotel from the stays UI. A hotel created this way SHALL be recorded at the recommended location and SHALL NOT be flagged as needing a location, since its location was deliberately chosen rather than defaulted.

#### Scenario: Accepting a recommendation creates a located hotel
- **WHEN** the user accepts a recommended area for a base
- **THEN** a hotel place is created at that area's location and assigned to the new stay, and the itinerary re-solves

#### Scenario: A recommendation-created hotel is not flagged as needing a location
- **WHEN** a hotel is created by accepting a recommendation
- **THEN** it does not show the "needs location" indicator that a placeholder-location hotel shows

## REMOVED Requirements

### Requirement: Recommendation computed without a solved itinerary
**Reason**: Replaced by background shadow solve verification to guarantee honest transit time savings before surfacing suggestions.
**Migration**: Recommendations run asynchronously in a Web Worker after an itinerary solve completes.

### Requirement: Per-stay-segment recommendation for multi-hotel trips
**Reason**: Recommendations are now driven by geographic clustering of places across the whole trip rather than pre-existing temporal day segments.
**Migration**: Places are clustered by geographic proximity, and new base areas are suggested per cluster.

## MODIFIED Requirements

### Requirement: Competitive alternatives surfaced instead of one false-precise pin
When a stay segment's places support more than one reasonably competitive candidate area, the system SHALL surface up to three candidates, prioritizing them so the user can see the trade-offs, rather than only a single best-scoring point. When the places do not support a meaningfully different alternative (e.g., they form one tight cluster), the system SHALL surface a single candidate rather than manufacturing artificial alternatives. Candidate bases MAY be discovered and surfaced either because they significantly reduce overall transit time for scheduled places ("Transit Saver") OR because they allow the itinerary to schedule a significant number of places that were otherwise dropped for lack of time/reachability ("Capacity Expander"). A Capacity Expander candidate SHALL NOT regress the itinerary's overall score.

#### Scenario: Two distant clusters produce a real trade-off
- **WHEN** a stay segment's places form two geographically distant, similarly-weighted clusters
- **THEN** at least two candidate areas are shown, each with its own estimated one-way travel time, so the user can compare them

#### Scenario: One tight cluster yields a single candidate
- **WHEN** a stay segment's places are all close together
- **THEN** only one candidate area is shown

#### Scenario: Capacity expander rescues unscheduled places
- **WHEN** a group of places is completely omitted from the itinerary because of time or reachability limits, and a candidate base near them would allow scheduling at least 1 additional place without worsening the trip's score
- **THEN** that base is surfaced as a recommendation highlighting the number of places it enables the user to visit

### Requirement: Recommendation computed without a solved itinerary
The system SHALL be able to compute a hotel-area recommendation (for existing stays) from a trip's places and day/stay structure alone, without requiring the itinerary to have been solved and without depending on any solver output. However, for discovering and evaluating *new* proactive base suggestions across the trip, the system MAY use the results of the baseline itinerary solve (such as the list of unscheduled places) to find candidate areas and run speculative "shadow solves" to validate their benefit before surfacing them.

#### Scenario: Recommendation available before any solve
- **WHEN** a trip has places added but has never been solved
- **THEN** a hotel-area recommendation can still be computed for its existing stay segments from those places and the trip's days

#### Scenario: Recommendation ignores stale solved output
- **WHEN** a trip has a stale or absent solved itinerary
- **THEN** the recommendation is computed the same way regardless, using only places and day/stay structure

#### Scenario: Speculative bases use shadow solves
- **WHEN** the system suggests a completely new base for a trip
- **THEN** the suggestion is validated by comparing a speculative shadow solve against the baseline itinerary's score or transit time

## ADDED Requirements

### Requirement: Candidate base regions discovered from dropped places
The system SHALL discover candidate base regions by clustering places the baseline itinerary could not schedule due to lack of time or reachability (excluding places dropped solely for opening-hours conflicts, since a new base cannot fix those). A cluster of dropped places SHALL be considered a candidate region as long as it contains at least 1 such place. Any already-scheduled place geographically near a qualifying dropped-place cluster SHALL be included in that cluster so the resulting candidate base serves both the dropped and the nearby scheduled places.

#### Scenario: Cluster of dropped places forms a candidate
- **WHEN** the baseline itinerary drops 5 geographically-clustered places for lack of time or reachability
- **THEN** those 5 places form a candidate base region

#### Scenario: A single dropped place forms a candidate
- **WHEN** the baseline itinerary drops just 1 place for lack of time or reachability
- **THEN** that place still forms a candidate base region on its own

#### Scenario: Opening-hours-only drops do not form a candidate
- **WHEN** several places near each other are unscheduled solely because of opening-hours conflicts
- **THEN** they do not form a capacity-expander candidate base region

#### Scenario: Nearby scheduled places join the candidate
- **WHEN** a qualifying cluster of dropped places has scheduled places nearby
- **THEN** those nearby scheduled places are included when locating the candidate base

### Requirement: Candidate base separation uses travel time, not straight-line distance
The system SHALL determine whether a candidate base region is meaningfully separate from a trip's existing base(s) using estimated travel time between them, not straight-line (haversine) distance, so that a region which is geographically close but slow to reach (e.g. across water or mountainous terrain) is still recognized as a distinct base opportunity.

#### Scenario: Short straight-line distance but long travel time
- **WHEN** a candidate region is within a short straight-line distance of the existing base but travel between them takes significantly longer than a typical single-leg commute
- **THEN** the candidate region is treated as a distinct base opportunity, not merged with the existing base's area

#### Scenario: Short travel time is not a distinct base
- **WHEN** a candidate region is quickly reachable from the existing base
- **THEN** it is not treated as a distinct base opportunity

### Requirement: New base stays are appended, not spliced into the timeline
When a capacity-expander (or any newly discovered) base is applied, its stay SHALL be appended after the trip's existing stays, shrinking existing stays as needed to make room, rather than being inserted at a point in the timeline chosen to match when the rescued places were originally attempted.

#### Scenario: New base stay placed at the end of the trip
- **WHEN** the user applies a suggested capacity-expander base
- **THEN** the new stay is added after the existing stays in the trip, and prior stays are shortened (never below one night) to accommodate it


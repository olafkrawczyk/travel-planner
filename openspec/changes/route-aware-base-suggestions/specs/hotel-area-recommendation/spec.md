## ADDED Requirements

### Requirement: Route-ordered stay sequencing
When a candidate base is evaluated or applied, it SHALL be inserted into the timeline in a sequence that minimizes total base-to-base travel jumps (e.g., geographic route ordering), rather than simply appending the stay to the end of the trip.

#### Scenario: Base inserted mid-trip for geographic flow
- **WHEN** a new candidate base is applied to a trip that forms a loop or geographic progression
- **THEN** the stay is inserted into the sequence at a day index that minimizes the total distance traveled between bases, avoiding ping-ponging back and forth across the region.

### Requirement: Workload-proportional night allocation
When a candidate base is evaluated or applied, the number of nights assigned to it and to other stays SHALL be sized proportionally to the travel-and-dwell workload of the places nearest to each base, relative to the whole trip's workload. Every base must retain at least one night.

#### Scenario: Dense region receives multiple nights
- **WHEN** a candidate base covers a region containing a large number of places with high dwell times and intra-cluster travel
- **THEN** it is assigned a proportional share of the trip's total nights, rather than being clamped to a single night.

### Requirement: Commute-relief based discovery
The system SHALL discover candidate base regions by identifying places whose nearest active base requires a one-way commute exceeding a travel-time threshold (e.g., >45 minutes), and clustering them.

#### Scenario: Commute relief identifies strained places
- **WHEN** a group of scheduled or unscheduled places is located significantly far in travel time from the current base
- **THEN** those places are clustered to form a candidate relief base region.

### Requirement: Permissive acceptance for multi-base discovery
A candidate base SHALL be considered valid and surfaced to the user if it either reduces the number of unscheduled places OR if it does not regress the baseline itinerary's total travel time beyond a reasonable allowance (e.g., 60 minutes).

#### Scenario: Progressive multi-base addition
- **WHEN** adding a candidate base restructures the trip geographic sequence without significantly inflating total travel time, even if it does not immediately rescue unscheduled places
- **THEN** the candidate is surfaced, enabling the user to iteratively accept bases until the entire region is comfortably covered.

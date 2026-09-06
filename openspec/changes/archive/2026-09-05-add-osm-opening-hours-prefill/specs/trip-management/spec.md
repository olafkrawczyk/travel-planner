## MODIFIED Requirements

### Requirement: Place management
The system SHALL allow adding places by geocoding search or map click, and editing each place's name, category, dwell time in minutes, priority tier (must / want / nice-to-have), optional notes, and opening-hour windows per trip date (multiple windows per day allowed). For places with an OSM id, the system SHALL offer to prefill opening windows from the OSM `opening_hours` tag: the expression is fetched (Overpass), parsed, and expanded into concrete per-date windows for the trip's date range, which the user reviews in the editor before saving. Unparseable, missing, or `24/7` tags SHALL leave the place without windows (always open) and inform the user when the tag could not be used. Geocoding searches SHALL be debounced and results cached, and the map SHALL display required OSM attribution.

#### Scenario: Add a place via search
- **WHEN** the user searches for "Senso-ji" and selects a result
- **THEN** a place is created with name, coordinates, and default dwell time and priority, editable afterwards

#### Scenario: Add a place via map click
- **WHEN** the user clicks on the map and confirms
- **THEN** a place is created at the clicked coordinates

#### Scenario: Set opening windows
- **WHEN** the user adds the window 09:00–17:00 for day 2's date on a museum
- **THEN** subsequent solves only schedule that museum inside that window on day 2

#### Scenario: Prefill from OSM
- **WHEN** the user clicks "Fetch opening hours" on a place with an OSM id whose tag is `Mo-Fr 09:00-17:00`
- **THEN** the opening-hours section shows 09:00–17:00 windows for each weekday of the trip and none for weekend days, ready to review and save

#### Scenario: OSM tag unusable
- **WHEN** the place's OSM element has no `opening_hours` tag or the expression cannot be parsed
- **THEN** the editor informs the user and leaves opening hours unset (always open)

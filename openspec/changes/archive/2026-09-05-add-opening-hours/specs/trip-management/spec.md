## MODIFIED Requirements

### Requirement: Place management
The system SHALL allow adding places by geocoding search or map click, and editing each place's name, category, dwell time in minutes, priority tier (must / want / nice-to-have), optional notes, and opening-hour windows per trip date (multiple windows per day allowed). Geocoding searches SHALL be debounced and results cached, and the map SHALL display required OSM attribution.

#### Scenario: Add a place via search
- **WHEN** the user searches for "Senso-ji" and selects a result
- **THEN** a place is created with name, coordinates, and default dwell time and priority, editable afterwards

#### Scenario: Add a place via map click
- **WHEN** the user clicks on the map and confirms
- **THEN** a place is created at the clicked coordinates

#### Scenario: Set opening windows
- **WHEN** the user adds the window 09:00–17:00 for day 2's date on a museum
- **THEN** subsequent solves only schedule that museum inside that window on day 2

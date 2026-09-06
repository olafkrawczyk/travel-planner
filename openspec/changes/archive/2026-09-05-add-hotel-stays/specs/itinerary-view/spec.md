## MODIFIED Requirements

### Requirement: Map and timeline presentation
The system SHALL display both a map and a timeline list of stops and legs, simultaneously in a split view on desktop and via tabs on mobile. The map SHALL draw each day's route as a polyline (base → ordered stops → base) in that day's colour. All displayed times SHALL be whole-minute `"HH:mm"` values. When a trip is opened, the map SHALL center on that trip's base place (hotel) rather than any hardcoded location. The timeline sidebar SHALL include a stays panel listing each stay (hotel, check-in day, nights) with a visual coverage bar across the trip's days. Hovering a timeline stop SHALL highlight its map marker and vice versa.

#### Scenario: Consistent day colouring
- **WHEN** a trip has 3 solved days
- **THEN** each day uses one distinct colour consistently across markers, route line, numbers and timeline entries

#### Scenario: Cross-highlighting
- **WHEN** the user hovers a stop in the timeline
- **THEN** the corresponding map marker is visually highlighted

#### Scenario: Route visible per day
- **WHEN** a day's itinerary has been solved
- **THEN** the map shows a polyline connecting that day's stops in order, starting and ending at the day's base, in the day's colour

#### Scenario: Clean time display
- **WHEN** times are shown in the timeline
- **THEN** they always appear as whole-minute `"HH:mm"` values with no fractional artifacts

#### Scenario: Map opens on the trip's city
- **WHEN** the user opens a trip whose base is in Warsaw
- **THEN** the map is centered on that Warsaw base, not on any hardcoded default city

#### Scenario: Stays overview
- **WHEN** a trip has two stays (3 nights + 2 nights)
- **THEN** the stays panel lists both with hotel name, check-in day and nights, and the coverage bar shows the split at the check-in day

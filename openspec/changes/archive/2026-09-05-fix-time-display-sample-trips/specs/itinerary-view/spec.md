## MODIFIED Requirements

### Requirement: Map and timeline presentation
The system SHALL display both a map and a timeline list of stops and legs, simultaneously in a split view on desktop and via tabs on mobile. The map SHALL draw each day's route as a polyline (base → ordered stops → base) in that day's colour. All displayed times SHALL be whole-minute `"HH:mm"` values. Hovering a timeline stop SHALL highlight its map marker and vice versa.

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

### Requirement: Map marker identification
Map markers SHALL show the place name on hover and SHALL be colour-coded by place category. Scheduled markers SHALL additionally carry a border in their day's colour (matching the sidebar day colour); unscheduled markers SHALL have no day-colour border (a neutral style). The home base (hotel) markers SHALL be clearly identifiable (distinct hotel styling) and SHALL be toggleable via a show/hide control on the map.

#### Scenario: Hover shows place name
- **WHEN** the user hovers a map marker
- **THEN** the place name is displayed at the marker

#### Scenario: Category colour coding
- **WHEN** places of different categories are on the map
- **THEN** markers of different categories use visually distinct colours, and day numbers remain readable on them

#### Scenario: Day border distinguishes scheduled state
- **WHEN** a place is scheduled on day 2
- **THEN** its marker shows a border in day 2's colour; when the place is unscheduled, the marker shows no day-colour border

#### Scenario: Toggle hotel markers
- **WHEN** the user toggles the hotel-markers control off
- **THEN** base/hotel markers disappear from the map (routes still terminate at the base); toggling on restores them

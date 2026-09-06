## MODIFIED Requirements

### Requirement: Map and timeline presentation
The system SHALL display both a map and a timeline list of stops and legs, simultaneously in a split view on desktop and via tabs on mobile. The map SHALL draw each day's route as a polyline (base → ordered stops → base) in that day's colour. Hovering a timeline stop SHALL highlight its map marker and vice versa.

#### Scenario: Consistent day colouring
- **WHEN** a trip has 3 solved days
- **THEN** each day uses one distinct colour consistently across markers, route line, numbers and timeline entries

#### Scenario: Cross-highlighting
- **WHEN** the user hovers a stop in the timeline
- **THEN** the corresponding map marker is visually highlighted

#### Scenario: Route visible per day
- **WHEN** a day's itinerary has been solved
- **THEN** the map shows a polyline connecting that day's stops in order, starting and ending at the day's base, in the day's colour

### Requirement: Map marker identification
Map markers SHALL show the place name on hover and SHALL be colour-coded by place category. Scheduled markers SHALL additionally carry a border in their day's colour (matching the sidebar day colour); unscheduled markers SHALL have no day-colour border (a neutral style). The home base remains visually distinct.

#### Scenario: Hover shows place name
- **WHEN** the user hovers a map marker
- **THEN** the place name is displayed at the marker

#### Scenario: Category colour coding
- **WHEN** places of different categories are on the map
- **THEN** markers of different categories use visually distinct colours, and day numbers remain readable on them

#### Scenario: Day border distinguishes scheduled state
- **WHEN** a place is scheduled on day 2
- **THEN** its marker shows a border in day 2's colour; when the place is unscheduled, the marker shows no day-colour border

### Requirement: Day visibility toggle and focus
Each day card in the timeline SHALL have an eye toggle that hides/shows that day's markers and route line on the map. Clicking a day card SHALL focus the map on that day's route (fit bounds or highlight).

#### Scenario: Hide a day's pins
- **WHEN** the user clicks the eye icon on day 2's card
- **THEN** day 2's markers and route line disappear from the map while other days stay visible, and clicking again restores them

#### Scenario: Click day card focuses route
- **WHEN** the user clicks day 1's card
- **THEN** the map highlights or fits to day 1's route

### Requirement: Right-click place creation
The map SHALL open a small context menu on right-click at the cursor position offering "Add place here"; choosing it SHALL start creating a place at exactly those coordinates. Plain left-click on the map SHALL also open the place editor at the clicked coordinates. The menu SHALL dismiss on click elsewhere or Escape.

#### Scenario: Add via context menu
- **WHEN** the user right-clicks a point on the map and chooses "Add place here"
- **THEN** the place editor opens prefilled with the coordinates under the cursor

#### Scenario: Add via left click
- **WHEN** the user left-clicks a point on the map
- **THEN** the place editor opens prefilled with the clicked coordinates

#### Scenario: Menu dismisses
- **WHEN** the context menu is open and the user clicks elsewhere or presses Escape
- **THEN** the menu closes without creating anything

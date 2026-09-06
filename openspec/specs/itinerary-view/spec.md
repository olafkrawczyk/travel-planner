# itinerary-view Specification

## Purpose

Presents the solved itinerary as an always-visible map plus timeline, explains every solver decision, and lets the user correct the plan manually with immediate re-solve.


## Requirements

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

### Requirement: Unscheduled tray
Unscheduled places SHALL be shown in a visible "couldn't fit" tray with their reason, a human-readable explanation, and their priority, never silently omitted. Each entry SHALL offer quick actions: "Force into day N" (day selector) and "Raise to must", both triggering a re-solve.

#### Scenario: Dropped place visible
- **WHEN** the solver cannot fit a place
- **THEN** the tray lists it with its reason, explanation and priority, and it remains visible until scheduled or removed

#### Scenario: Fix from the tray
- **WHEN** the user clicks "Raise to must" on an unscheduled place
- **THEN** the place's priority becomes must, the trip re-solves, and the place is scheduled if any feasible slot exists

#### Scenario: Over-budget day visible
- **WHEN** a force-insert makes a day exceed its end time
- **THEN** that day's section shows a visible over-budget indicator

### Requirement: Manual tweaks
The system SHALL allow dragging a place to another day (with a "move to day N" menu as a mobile-friendly fallback), pinning a place to a position in its day, and locking an entire day, each triggering a re-solve that respects all locks and pins.

#### Scenario: Move via menu
- **WHEN** the user chooses "move to day 3" from a stop's menu
- **THEN** the place is re-solved into day 3 exactly as if it had been dragged there

#### Scenario: Lock a day
- **WHEN** the user locks day 2 and edits a place on day 1
- **THEN** the re-solved itinerary leaves day 2 completely unchanged

### Requirement: Geocoding search behavior
Geocoding search SHALL debounce user input so that typing produces at most one trailing request per debounce window, SHALL cache results, and SHALL display a visible error state when a search request fails instead of implying no results exist.

#### Scenario: Debounced search
- **WHEN** the user types a multi-character query without pausing
- **THEN** requests are debounced and only the final query is sent after the pause

#### Scenario: Search failure visible
- **WHEN** a geocoding request fails (network or server error)
- **THEN** an error message is shown in the search UI, distinct from the "no results" state

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

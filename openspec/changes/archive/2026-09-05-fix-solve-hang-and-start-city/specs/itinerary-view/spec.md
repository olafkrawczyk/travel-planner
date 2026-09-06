## MODIFIED Requirements

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
Map markers SHALL show the place name on hover and SHALL be colour-coded by place category, while preserving per-day numbering (e.g. a category-coloured marker carrying its day-number badge); the home base remains visually distinct.

#### Scenario: Hover shows place name
- **WHEN** the user hovers a map marker
- **THEN** the place name is displayed at the marker

#### Scenario: Category colour coding
- **WHEN** places of different categories are on the map
- **THEN** markers of different categories use visually distinct colours, and day numbers remain readable on them

### Requirement: Right-click place creation
The map SHALL open a small context menu on right-click at the cursor position offering "Add place here"; choosing it SHALL start creating a place at exactly those coordinates. The menu SHALL dismiss on click elsewhere or Escape.

#### Scenario: Add via context menu
- **WHEN** the user right-clicks a point on the map and chooses "Add place here"
- **THEN** the place editor opens prefilled with the coordinates under the cursor

#### Scenario: Menu dismisses
- **WHEN** the context menu is open and the user clicks elsewhere or presses Escape
- **THEN** the menu closes without creating anything

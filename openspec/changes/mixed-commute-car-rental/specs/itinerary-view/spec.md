## ADDED Requirements

### Requirement: Car rental visibility
The timeline SHALL make car availability visible: days covered by a rental SHALL be identifiable at a glance in the timeline (e.g. a vehicle indicator on the day card and/or a rental coverage bar in the stays panel area, in the style of the existing stays coverage bar), and car legs in the timeline SHALL be recognisable as car travel via their mode badge and explanation (e.g. "car heuristic (34 km)"). Non-car legs and days SHALL remain unchanged. Editing a rental from the UI SHALL visibly re-solve, and the day indicators SHALL reflect the new availability immediately without waiting for the solve to finish.

#### Scenario: Car day is identifiable
- **WHEN** a trip has a rental covering days 3–5
- **THEN** the timeline marks days 3–5 as car days distinctly from days 1–2 and 6+, consistent with the trip's day colouring

#### Scenario: Car leg badge
- **WHEN** a solved leg on day 4 uses the car curve
- **THEN** the timeline shows that leg with a car mode badge and a human-readable explanation naming the car estimate

#### Scenario: Rental edit re-solves visibly
- **WHEN** the user moves a rental's end date one day later
- **THEN** the newly covered day is immediately marked as a car day and the itinerary re-solves with car-aware travel times

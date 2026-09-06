## MODIFIED Requirements

### Requirement: Trip creation and day settings
The system SHALL allow creating a trip with a name, a starting city, and a date range, generating one day entry per date. The starting city SHALL be geocoded and its coordinates used for the default home-base place; if geocoding fails, the system SHALL fall back to a sensible default and inform the user that they should set the base location manually. The trip list SHALL offer one-click curated sample trips (Tokyo and Warsaw) preloaded with real places, and a curated multi-hotel sample demonstrating a base change mid-trip. Each day SHALL have configurable start time, end time, a wake-up base (hotel) and a sleep base, which MAY differ on hotel-change days, plus optional fixed start/end locations. The user SHALL be able to change which place is a day's base after creation (for one day or all days), including setting different wake-up and sleep bases.

#### Scenario: Create a trip
- **WHEN** the user creates a trip named "Tokyo" with starting city "Tokyo" and date range 2026-04-01 to 2026-04-05
- **THEN** a trip exists with 5 days, each with default start/end times, and the default base place is located at the geocoded coordinates of Tokyo

#### Scenario: Hotel change mid-trip
- **WHEN** the user sets day 3's sleep base to a different place than its wake-up base
- **THEN** the day records distinct `baseStartId` and `baseEndId` and the solver treats both as route endpoints for that day

#### Scenario: Geocoding fails at creation
- **WHEN** the user creates a trip with a starting city that yields no geocoding result
- **THEN** the trip is still created, the user is told to set the base location manually, and the map is usable

#### Scenario: Load a sample trip
- **WHEN** the user clicks "Load sample: Tokyo" on the trip list
- **THEN** a trip is created with 5 days, a Shinjuku hotel base, and 20+ real Tokyo places, and the itinerary solves

#### Scenario: Load the multi-hotel sample
- **WHEN** the user loads the multi-hotel sample
- **THEN** the trip contains at least two distinct base places and at least one day whose wake-up and sleep bases differ, and the itinerary solves with days starting/ending at the correct hotels

#### Scenario: Set a place as base
- **WHEN** the user picks "Set as base for all days" on a place
- **THEN** every day's wake-up and sleep base becomes that place, the itinerary re-solves starting/ending there, and undo restores the previous bases

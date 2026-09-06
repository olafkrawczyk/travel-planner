# trip-management Specification

## Purpose

Lets a user define everything the solver needs as input: a trip with its date range, per-day settings and home bases, a pool of places with dwell/priority/appointments, and per-pair travel-time corrections.


## Requirements

### Requirement: Trip creation and day settings
The system SHALL allow creating a trip with a name, a starting city, and a date range, generating one day entry per date. The starting city SHALL be geocoded and its coordinates used for the default home-base place; if geocoding fails, the system SHALL fall back to a sensible default and inform the user that they should set the base location manually. The trip list SHALL offer one-click curated sample trips (Tokyo and Warsaw) preloaded with real places, and a curated multi-hotel sample demonstrating a base change mid-trip. Bases SHALL be managed as **stays**: a stay is a hotel plus a check-in day and a number of nights; stays cover the trip contiguously starting from day 1. The system SHALL derive each day's wake-up base and sleep base from the stays (on a check-in day the wake-up base is the previous hotel and the sleep base is the new one). Each day SHALL have configurable start time, end time, plus optional fixed start/end locations.

#### Scenario: Create a trip
- **WHEN** the user creates a trip named "Tokyo" with starting city "Tokyo" and date range 2026-04-01 to 2026-04-05
- **THEN** a trip exists with 5 days, each with default start/end times, and the default base place is located at the geocoded coordinates of Tokyo

#### Scenario: Hotel change mid-trip
- **WHEN** a stay ends and another begins on day 3 (check-in day 3)
- **THEN** day 3's wake-up base is the previous hotel and its sleep base is the new hotel, and the solver treats both as route endpoints for that day

#### Scenario: Geocoding fails at creation
- **WHEN** the user creates a trip with a starting city that yields no geocoding result
- **THEN** the trip is still created, the user is told to set the base location manually, and the map is usable

#### Scenario: Load a sample trip
- **WHEN** the user clicks "Load sample: Tokyo" on the trip list
- **THEN** a trip is created with 5 days, a Shinjuku hotel base, and 20+ real Tokyo places, and the itinerary solves

#### Scenario: Load the multi-hotel sample
- **WHEN** the user loads the multi-hotel sample
- **THEN** the stays panel shows two contiguous stays and at least one day whose wake-up and sleep bases differ, and the itinerary solves with days starting/ending at the correct hotels

#### Scenario: Add a stay
- **WHEN** the user adds a stay with hotel H checking in on day 4 for 2 nights in a 5-day trip
- **THEN** days 4–5 sleep at H, day 5 wakes at H, day 3 keeps waking at the previous hotel and now sleeps at H (travel day), and the itinerary re-solves

#### Scenario: Set a place as base
- **WHEN** the user assigns a hotel to a range of days via the stays panel (check-in day + nights)
- **THEN** those days' bases become that hotel per the stay semantics, the itinerary re-solves, and undo restores the previous bases

### Requirement: Place management
The system SHALL allow adding places by geocoding search or map click, and editing each place's name, category (including `hotel`), dwell time in minutes, priority tier (must / want / nice-to-have), optional notes, and opening-hour windows per trip date (multiple windows per day allowed). Any place SHALL be markable as a hotel via a "This is a hotel" toggle; hotel places are candidates in the stays editor. For places with an OSM id, the system SHALL offer to prefill opening windows from the OSM `opening_hours` tag, which the user reviews in the editor before saving. Geocoding searches SHALL be debounced and results cached, and the map SHALL display required OSM attribution.

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

#### Scenario: Mark a place as hotel
- **WHEN** the user toggles "This is a hotel" on a place and saves
- **THEN** the place's category is `hotel` and it becomes selectable in the stays editor

### Requirement: Fixed appointments
The system SHALL allow marking a place as a fixed appointment on a specific day with a start time, which the solver MUST treat as a hard time window.

#### Scenario: Set an appointment
- **WHEN** the user sets "Kusama Museum, day 2, 14:00, 90 min dwell"
- **THEN** the solved itinerary schedules that place on day 2 arriving no later than 14:00, or reports it as unscheduled with a conflict reason

### Requirement: Travel-time overrides
The system SHALL allow the user to override the travel time of any pair of places (with optional direction symmetry), and overrides SHALL be stored on the pair so they survive re-solves and apply wherever that pair appears.

#### Scenario: Override a leg
- **WHEN** the user sets "Hotel → Fuji = 120 min"
- **THEN** every subsequent solve uses 120 min for that pair instead of the heuristic, and the resulting leg is marked as override-sourced

### Requirement: Priority tiers
The system SHALL store priority as a 3-tier field (must / want / nice-to-have) independent of solver weight tuning.

#### Scenario: Change priority
- **WHEN** the user changes a place from "nice-to-have" to "must"
- **THEN** the stored value changes and subsequent solves weight that place accordingly, without any schema change

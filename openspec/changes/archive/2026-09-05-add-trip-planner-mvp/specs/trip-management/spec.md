# Capability: trip-management

## Purpose

Lets a user define everything the solver needs as input: a trip with its date range, per-day settings and home bases, a pool of places with dwell/priority/appointments, and per-pair travel-time corrections.

## ADDED Requirements

### Requirement: Trip creation and day settings
The system SHALL allow creating a trip with a name and date range, generating one day entry per date. Each day SHALL have configurable start time, end time, a wake-up base (hotel) and a sleep base, which MAY differ on hotel-change days, plus optional fixed start/end locations.

#### Scenario: Create a trip
- **WHEN** the user creates a trip named "Tokyo" with date range 2026-04-01 to 2026-04-05
- **THEN** a trip exists with 5 days, each with default start/end times and a settable base location

#### Scenario: Hotel change mid-trip
- **WHEN** the user sets day 3's sleep base to a different place than its wake-up base
- **THEN** the day records distinct `baseStartId` and `baseEndId` and the solver treats both as route endpoints for that day

### Requirement: Place management
The system SHALL allow adding places by geocoding search or map click, and editing each place's name, category, dwell time in minutes, priority tier (must / want / nice-to-have), and optional notes. Geocoding searches SHALL be debounced and results cached, and the map SHALL display required OSM attribution.

#### Scenario: Add a place via search
- **WHEN** the user searches for "Senso-ji" and selects a result
- **THEN** a place is created with name, coordinates, and default dwell time and priority, editable afterwards

#### Scenario: Add a place via map click
- **WHEN** the user clicks on the map and confirms
- **THEN** a place is created at the clicked coordinates

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

## Purpose

Allows scheduling and planning intercity transfer days bridging distant cities or regions, supporting explicit departure and arrival locations and manual travel time overrides.

## ADDED Requirements

### Requirement: Day departure and arrival location bounds
The user interface SHALL allow users to independently configure each day's starting location (`startLocation`) and ending location (`endLocation`), selecting either the day's base hotel or any designated place (such as an airport, train station, or landmark) within the trip.

#### Scenario: User configures custom departure station
- **WHEN** the user selects a train station as the start location for a travel day
- **THEN** the day's itinerary schedule begins from that train station instead of the base hotel

#### Scenario: User configures split-city transfer day
- **WHEN** day N has a start location in city A (or city A's base hotel) and an end location in city B (or city B's base hotel)
- **THEN** the solver schedules the day's itinerary starting from city A's location and ending at city B's location

### Requirement: Manual intercity travel overrides
The system SHALL allow users to create and edit manual travel-time overrides between pairs of places (including transit hubs, stations, airports, and hotels) with explicit duration in minutes, overriding default distance heuristics for long-haul intercity journeys.

#### Scenario: User overrides intercity leg duration
- **WHEN** the user specifies an override of 300 minutes between a Seoul hotel and a Tokyo hotel
- **THEN** the solver and itinerary timeline assign exactly 300 minutes for that travel leg regardless of geographic distance

#### Scenario: Solver respects travel override without dropping activities
- **WHEN** an intercity travel override is present for a transit leg within a day's schedule budget
- **THEN** the solver calculates day feasibility and timing using the overridden duration without mathematical failure or heuristic breakdown

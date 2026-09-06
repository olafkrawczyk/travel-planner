# Capability: itinerary-view

## Purpose

Presents the solved itinerary as an always-visible map plus timeline, explains every solver decision, and lets the user correct the plan manually with immediate re-solve.

## ADDED Requirements

### Requirement: Map and timeline presentation
The system SHALL display both a map with numbered, per-day-coloured markers and a timeline list of stops and legs, simultaneously in a split view on desktop and via tabs on mobile. Hovering a timeline stop SHALL highlight its map marker and vice versa.

#### Scenario: Consistent day colouring
- **WHEN** a trip has 3 solved days
- **THEN** each day uses one distinct colour consistently across markers, numbers and timeline entries

#### Scenario: Cross-highlighting
- **WHEN** the user hovers a stop in the timeline
- **THEN** the corresponding map marker is visually highlighted

### Requirement: Explainable legs
Every travel leg in the timeline SHALL show its duration and a source badge (heuristic / override), a human-readable explanation (e.g. "18 min — transit heuristic (2.9 km)"), an inline edit control to override the time, and a "check in Google Maps" deep link.

#### Scenario: Override from the timeline
- **WHEN** the user edits a leg's minutes inline and confirms
- **THEN** a pair-level travel override is stored, the itinerary re-solves, and the leg shows the override badge

#### Scenario: Google Maps deep link
- **WHEN** the user clicks "check in Google Maps" on a leg
- **THEN** a directions URL opens with origin, destination and transit travel mode

### Requirement: Never-blocking solve feedback
The system SHALL show the initial greedy itinerary immediately and animate in solver improvements as they arrive, without ever showing a blocking spinner for the solve itself.

#### Scenario: Progressive display
- **WHEN** a solve starts
- **THEN** the first feasible itinerary renders promptly and is replaced in place as better solutions arrive

### Requirement: Unscheduled tray
Unscheduled places SHALL be shown in a visible "couldn't fit" tray with their reasons, never silently omitted.

#### Scenario: Dropped place visible
- **WHEN** the solver cannot fit a place
- **THEN** the tray lists it with its reason, and it remains visible until scheduled or removed

### Requirement: Manual tweaks
The system SHALL allow dragging a place to another day (with a "move to day N" menu as a mobile-friendly fallback), pinning a place to a position in its day, and locking an entire day, each triggering a re-solve that respects all locks and pins.

#### Scenario: Move via menu
- **WHEN** the user chooses "move to day 3" from a stop's menu
- **THEN** the place is re-solved into day 3 exactly as if it had been dragged there

#### Scenario: Lock a day
- **WHEN** the user locks day 2 and edits a place on day 1
- **THEN** the re-solved itinerary leaves day 2 completely unchanged

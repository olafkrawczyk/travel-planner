# Capability: itinerary-solver

## Purpose

Turns a trip definition into a feasible, high-quality day-by-day itinerary — deterministic, fast enough to recalculate on every edit, and honest about what doesn't fit.

## ADDED Requirements

### Requirement: Travel-time matrix
The solver SHALL build an N×N travel-time matrix in minutes over all places and day bases, applying per-pair resolution in priority order: user override, then heuristic (walk below a distance threshold, transit with overhead above it, straight-line distance scaled by a detour factor). The matrix SHALL be cached so that moving one place only recomputes its row and column.

#### Scenario: Heuristic leg estimation
- **WHEN** no override exists for a pair 0.8 km apart (below the walk threshold)
- **THEN** the matrix entry equals walking time at the configured walk speed, and the leg source is "heuristic"

#### Scenario: Override wins over heuristic
- **WHEN** an override exists for a pair
- **THEN** the matrix uses the override value regardless of distance, and the leg source is "override"

### Requirement: Day assignment
The solver SHALL partition places across days using route-first assignment: a single tour over all places, split into consecutive day segments such that each segment fits its day's time budget including travel from and to the day's bases. Places with appointments SHALL be forced onto their appointment day.

#### Scenario: Split respects day budgets
- **WHEN** a trip has 30 places and 5 days each with a 09:00–21:00 budget
- **THEN** every assigned day fits within its budget, and days start and end at their configured bases

#### Scenario: Appointment forces day
- **WHEN** a place has an appointment on day 3
- **THEN** it is assigned to day 3 or reported unscheduled with a conflict reason — never assigned to another day

### Requirement: Within-day sequencing with time windows
The solver SHALL order each day's stops starting and ending at the day's bases, propagating arrival times as `max(previous departure + travel, window open)` and recording wait time, while respecting hard appointment windows and pinned orders.

#### Scenario: Timeline computed
- **WHEN** a day is solved
- **THEN** each stop has arrive/depart times, dwell equals the place's dwell time, waits are explicit, and legs connect consecutive stops with minutes, mode and source

#### Scenario: Pinned order respected
- **WHEN** the user pins a sub-sequence of places on a day
- **THEN** re-solves keep those places in the pinned relative order

### Requirement: Anytime improvement
The solver SHALL improve the initial solution via ruin-and-recreate within a bounded time budget, reporting the current best solution periodically so the UI can update live, and SHALL be deterministic for a given seed and input.

#### Scenario: Deterministic output
- **WHEN** the solver runs twice with the same trip snapshot and seed
- **THEN** both runs produce identical itineraries

#### Scenario: Progressive improvement
- **WHEN** the solver runs with its time budget
- **THEN** it emits an initial feasible solution promptly and at least one improved or equal final solution before the budget expires

### Requirement: Incremental re-solve
The solver SHALL support edit-driven re-solves — moving a place, changing dwell, or dragging a place to another day — that re-optimize only affected days, exclude locked days from modification, and complete in well under one second for N=50.

#### Scenario: Drag to another day
- **WHEN** the user drags a place from day 1 to day 2
- **THEN** the place is removed from day 1, inserted into day 2 at a feasible position, both days are re-optimized, and other days are unchanged

#### Scenario: Locked day untouched
- **WHEN** a day is locked and the user triggers a re-solve
- **THEN** that day's stops, order and times are unchanged in the output

### Requirement: Unscheduled reporting
The solver SHALL never silently drop places: every place that cannot be scheduled SHALL appear in an unscheduled list with a reason of `no_time`, `window_conflict`, or `unreachable`.

#### Scenario: More must-visits than time
- **WHEN** the total dwell and travel of must-visit places exceeds available day budgets
- **THEN** overflow places appear in the unscheduled list with reason `no_time`

#### Scenario: Unreachable appointment
- **WHEN** two fixed appointments cannot both be reached within their windows
- **THEN** at least one appears unscheduled with reason `window_conflict`

### Requirement: Solver runs off the UI thread
The solver SHALL execute in a Web Worker, receive a frozen trip snapshot plus settings, and return itinerary results without blocking UI interaction.

#### Scenario: UI stays responsive
- **WHEN** a solve is in progress
- **THEN** the UI remains interactive and displays intermediate best itineraries as they arrive

# itinerary-solver Specification

## Purpose

Turns a trip definition into a feasible, high-quality day-by-day itinerary — deterministic, fast enough to recalculate on every edit, and honest about what doesn't fit.

## Requirements

### Requirement: Travel-time matrix
The solver SHALL build an N×N travel-time matrix in minutes over all places and day bases, applying per-pair resolution in priority order: user override, then cached routing-API (OSRM `/table`) result, then heuristic (walk below a distance threshold, transit with overhead above it, straight-line distance scaled by a detour factor). API results SHALL be persisted in a local cache keyed by rounded coordinates and profile so reloads do not re-fetch. The matrix SHALL be cached so that moving one place only recomputes its row and column. Solving SHALL NOT block on the network: the heuristic plan is produced immediately and one re-solve follows when API data arrives; if the API is unreachable, rate-limited, or the node count exceeds the server limit, the heuristic is used instead.

#### Scenario: Heuristic leg estimation
- **WHEN** no override or API result exists for a pair 0.8 km apart (below the walk threshold)
- **THEN** the matrix entry equals walking time at the configured walk speed, and the leg source is "heuristic"

#### Scenario: Override wins over heuristic
- **WHEN** an override exists for a pair
- **THEN** the matrix uses the override value regardless of distance, and the leg source is "override"

#### Scenario: API result used when cached
- **WHEN** an OSRM table response covering the trip's nodes is in the cache
- **THEN** legs use API minutes with source "api", and no network request is made

#### Scenario: API fetch then re-solve
- **WHEN** a trip is solved without cached API data
- **THEN** the heuristic itinerary is produced first, the OSRM table is fetched once in the background, and a single re-solve applies API times with source "api"

#### Scenario: API failure falls back
- **WHEN** the OSRM request fails or the node count exceeds the table limit
- **THEN** the itinerary still solves with heuristic times, and the user is informed that estimated times are in use

### Requirement: Day assignment
The solver SHALL partition places across days using route-first assignment: a single tour over all places, split into consecutive day segments such that each segment fits its day's time budget including travel from and to the day's bases. After the split, the improvement loop SHALL level load between days: the most-loaded active day SHALL donate a place to the cheapest hard-feasible position on a meaningfully less-loaded active day — or swap a place with one on such a day — whenever doing so improves the objective, where "load" is measured as a day's committed time (travel, dwell and wait) as a fraction of its own start/end window, so days with different windows remain comparable. A day already over its soft time budget SHALL be treated as the most-loaded day regardless of any other day's load. Appointments, pinned orders, forced placements and locked days are never relocated, and locked days are never a rebalancing source or destination. Places with appointments SHALL be forced onto their appointment day.

#### Scenario: Split respects day budgets
- **WHEN** a trip has 30 places and 5 days each with a 09:00–21:00 budget
- **THEN** every assigned day fits within its budget, and days start and end at their configured bases

#### Scenario: Appointment forces day
- **WHEN** a place has an appointment on day 3
- **THEN** it is assigned to day 3 or reported unscheduled with a conflict reason — never assigned to another day

#### Scenario: Over-budget day rebalanced
- **WHEN** one day is over budget (negative slack) and another day has free time, and moving a place between them reduces total overrun more than it costs in travel
- **THEN** the final itinerary moves that work to the freer day

#### Scenario: Uneven but in-budget days rebalanced
- **WHEN** no day is over budget, but one active day's load is meaningfully higher than another's and moving a place between them improves the objective
- **THEN** the final itinerary moves that work to the less-loaded day

#### Scenario: No empty day while work could fill it
- **WHEN** a route-first split leaves one day empty (or near-empty) and another day loaded, with unscheduled or relocatable places that would fit in the empty day at reasonable travel cost
- **THEN** the final itinerary schedules at least one place on that day rather than leaving it empty

#### Scenario: Constraints survive rebalancing
- **WHEN** a day is locked, or a place is pinned, forced, or has an appointment
- **THEN** rebalancing never relocates that place or modifies the locked day

### Requirement: Within-day sequencing with time windows
The solver SHALL order each day's stops starting and ending at the day's bases, propagating arrival times as `max(previous departure + travel, window open)` and recording wait time, while respecting hard appointment windows, opening-hour windows, and pinned orders. A place with opening windows on a given day SHALL only be scheduled inside one of that day's windows: arrival may be earlier than opening (the difference is counted as wait time) but the visit SHALL NOT end after closing. A place that fits no window on any available day SHALL be reported unscheduled with reason `window_conflict`. All times in solver output (arrive, depart, wait) SHALL be whole minutes — fractional travel-time arithmetic SHALL be rounded before emission.

#### Scenario: Timeline computed
- **WHEN** a day is solved
- **THEN** each stop has arrive/depart times, dwell equals the place's dwell time, waits are explicit, and legs connect consecutive stops with minutes, mode and source

#### Scenario: Pinned order respected
- **WHEN** the user pins a sub-sequence of places on a day
- **THEN** re-solves keep those places in the pinned relative order

#### Scenario: Whole-minute output
- **WHEN** any itinerary is produced
- **THEN** every arrive/depart time is a whole-minute `"HH:mm"` value and every wait is a whole number of minutes

#### Scenario: Wait for opening
- **WHEN** the route reaches a museum at 08:40 whose window opens at 09:00
- **THEN** the stop arrives at 08:40, waits 20 minutes, and the visit starts at 09:00

#### Scenario: Closed all day
- **WHEN** a place's windows never overlap the available time on any day
- **THEN** it appears in the unscheduled list with reason `window_conflict`

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
The solver SHALL never silently drop places: every place that cannot be scheduled SHALL appear in an unscheduled list with a reason of `no_time`, `window_conflict`, or `unreachable`, plus a human-readable explanation of why it does not fit. Dropping SHALL be priority-ordered: the solver SHALL prefer dropping nice-to-have places over want, and want over must; a must-priority place SHALL only be unscheduled when no feasible insertion exists on any allowed day.

#### Scenario: More must-visits than time
- **WHEN** the total dwell and travel of must-visit places exceeds available day budgets
- **THEN** overflow places appear in the unscheduled list with reason `no_time` and an explanation quantifying the shortfall

#### Scenario: Unreachable appointment
- **WHEN** two fixed appointments cannot both be reached within their windows
- **THEN** at least one appears unscheduled with reason `window_conflict` and an explanation naming the conflict

#### Scenario: Priority-ordered dropping
- **WHEN** a trip cannot fit all places
- **THEN** nice-to-have places are dropped before want, and want before must — no must place is dropped while a lower-priority place remains scheduled on a day where the must place would fit

### Requirement: Solver runs off the UI thread
The solver SHALL execute in a Web Worker, receive a frozen trip snapshot plus settings, and return itinerary results without blocking UI interaction. Progress and completion callbacks SHALL be passed across the worker boundary using an explicit proxying mechanism so they are delivered reliably. If a solve invocation fails, the solving indicator SHALL clear and the failure SHALL be surfaced to the user rather than hanging indefinitely.

#### Scenario: UI stays responsive
- **WHEN** a solve is in progress
- **THEN** the UI remains interactive and displays intermediate best itineraries as they arrive

#### Scenario: Solve completes and clears the indicator
- **WHEN** the user triggers any solve or re-solve
- **THEN** progress and final results are delivered and the solving indicator clears when the run finishes

#### Scenario: Solve invocation fails
- **WHEN** the worker call throws or rejects before producing a result
- **THEN** the solving indicator clears and an error is surfaced to the user

### Requirement: Solver input validation and worker logging
The system SHALL validate the trip snapshot at the solver input boundary and report invalid data (e.g. null numeric fields) as an explicit error naming the offending place, instead of failing with an opaque validation error. The worker bridge SHALL emit structured, toggleable diagnostic logs covering requests sent to the worker, progress/done callbacks received, and errors, so message flow is inspectable in devtools.

#### Scenario: Invalid place reported clearly
- **WHEN** a trip containing a place with a null or non-numeric coordinate reaches the solver boundary
- **THEN** the solve fails with an error identifying the offending place, and the UI surfaces it without hanging

#### Scenario: Worker traffic logged
- **WHEN** solver logging is enabled (dev flag)
- **THEN** the console shows each solve request, each progress/done delivery, and any error crossing the worker boundary

### Requirement: Benchmark fixtures
The solver SHALL ship curated real-world fixtures (Tokyo and Warsaw, 20+ places each) with regression assertions on score, total travel, and unscheduled count, so quality regressions fail the build.

#### Scenario: Fixtures guard quality
- **WHEN** the test suite runs
- **THEN** both the Tokyo and Warsaw fixtures solve deterministically and match their recorded baselines

### Requirement: Force-insert support
The solver's incremental re-solve SHALL support a best-effort forced insertion of an unscheduled place into a chosen day, inserting at the cheapest feasible position even when the day's soft budget is exceeded (hard constraints — appointments, opening windows — still apply; if none fits, the place stays unscheduled with the explanation updated).

#### Scenario: Force into a day
- **WHEN** the user forces an unscheduled place into day 2
- **THEN** it is inserted at the cheapest hard-feasible position and the day may exceed its end time, visibly flagged as over budget

#### Scenario: Force respects hard windows
- **WHEN** the user forces a place into a day where its opening windows have already passed
- **THEN** it remains unscheduled with an updated explanation

## MODIFIED Requirements

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

## MODIFIED Requirements

### Requirement: Unscheduled tray
Unscheduled places SHALL be shown in a visible "couldn't fit" tray with their reason, a human-readable explanation, and their priority, never silently omitted. Each entry SHALL offer quick actions: "Force into day N" (day selector) and "Raise to must", both triggering a re-solve.

#### Scenario: Dropped place visible
- **WHEN** the solver cannot fit a place
- **THEN** the tray lists it with its reason, explanation and priority, and it remains visible until scheduled or removed

#### Scenario: Fix from the tray
- **WHEN** the user clicks "Raise to must" on an unscheduled place
- **THEN** the place's priority becomes must, the trip re-solves, and the place is scheduled if any feasible slot exists

#### Scenario: Over-budget day visible
- **WHEN** a force-insert makes a day exceed its end time
- **THEN** that day's section shows a visible over-budget indicator

## MODIFIED Requirements

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

### Requirement: Force-insert support
The solver's incremental re-solve SHALL support a best-effort forced insertion of an unscheduled place into a chosen day, inserting at the cheapest feasible position even when the day's soft budget is exceeded (hard constraints — appointments, opening windows — still apply; if none fits, the place stays unscheduled with the explanation updated).

#### Scenario: Force into a day
- **WHEN** the user forces an unscheduled place into day 2
- **THEN** it is inserted at the cheapest hard-feasible position and the day may exceed its end time, visibly flagged as over budget

#### Scenario: Force respects hard windows
- **WHEN** the user forces a place into a day where its opening windows have already passed
- **THEN** it remains unscheduled with an updated explanation

## MODIFIED Requirements

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

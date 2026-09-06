## MODIFIED Requirements

### Requirement: Day assignment
The solver SHALL partition places across days using route-first assignment: a single tour over all places, split into consecutive day segments such that each segment fits its day's time budget including travel from and to the day's bases. After the split, the improvement loop SHALL rebalance load between days: places on an over-budget day (negative slack) SHALL be relocated to the cheapest hard-feasible position on an under-budget day — or swapped with a place on such a day — whenever doing so improves the objective, while appointments, pinned orders, forced placements and locked days are never relocated. Places with appointments SHALL be forced onto their appointment day.

#### Scenario: Split respects day budgets
- **WHEN** a trip has 30 places and 5 days each with a 09:00–21:00 budget
- **THEN** every assigned day fits within its budget, and days start and end at their configured bases

#### Scenario: Appointment forces day
- **WHEN** a place has an appointment on day 3
- **THEN** it is assigned to day 3 or reported unscheduled with a conflict reason — never assigned to another day

#### Scenario: Over-budget day rebalanced
- **WHEN** one day is over budget (negative slack) and another day has free time, and moving a place between them reduces total overrun more than it costs in travel
- **THEN** the final itinerary moves that work to the freer day

#### Scenario: Constraints survive rebalancing
- **WHEN** a day is locked, or a place is pinned, forced, or has an appointment
- **THEN** rebalancing never relocates that place or modifies the locked day

## MODIFIED Requirements

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

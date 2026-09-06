## MODIFIED Requirements

### Requirement: Within-day sequencing with time windows
The solver SHALL order each day's stops starting and ending at the day's bases, propagating arrival times as `max(previous departure + travel, window open)` and recording wait time, while respecting hard appointment windows and pinned orders. All times in solver output (arrive, depart, wait) SHALL be whole minutes — fractional travel-time arithmetic SHALL be rounded before emission.

#### Scenario: Timeline computed
- **WHEN** a day is solved
- **THEN** each stop has arrive/depart times, dwell equals the place's dwell time, waits are explicit, and legs connect consecutive stops with minutes, mode and source

#### Scenario: Pinned order respected
- **WHEN** the user pins a sub-sequence of places on a day
- **THEN** re-solves keep those places in the pinned relative order

#### Scenario: Whole-minute output
- **WHEN** any itinerary is produced
- **THEN** every arrive/depart time is a whole-minute `"HH:mm"` value and every wait is a whole number of minutes

### Requirement: Benchmark fixtures
The solver SHALL ship curated real-world fixtures (Tokyo and Warsaw, 20+ places each) with regression assertions on score, total travel, and unscheduled count, so quality regressions fail the build.

#### Scenario: Fixtures guard quality
- **WHEN** the test suite runs
- **THEN** both the Tokyo and Warsaw fixtures solve deterministically and match their recorded baselines

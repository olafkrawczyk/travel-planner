## Why

The current engine for suggesting additional hotel bases successfully identifies when an itinerary is struggling geographically, but its method for inserting the new base breaks the resulting road trip. It always appends the new hotel at the very end of the trip (e.g., Day 12) for a single night, leaving the original base to cover Days 1-11. For a circular road trip (like Iceland's Ring Road), this forces the solver into massive daily 10-hour out-and-back commutes from the original base because the newly added base is stuck at the end of the timeline. Furthermore, the engine stops suggesting bases prematurely because its acceptance gate rejects candidates if they don't meet a strict travel-time savings threshold, even when driving times are unacceptably high.

## What Changes

- **BREAKING**: Base suggestions will no longer be appended to the end of the trip for a single night. Instead, candidate bases will be inserted into the sequence of stays in a route-ordered sequence that minimizes base-to-base travel jumps.
- **BREAKING**: Night allocation for a new base will be proportional to the cluster's workload (dwell time + intra-cluster travel) relative to the whole trip, rather than clamped to 1 night.
- **BREAKING**: The acceptance gate for a base suggestion will be relaxed. A base will be accepted if it either reduces the number of unscheduled places OR if it doesn't regress total travel time by more than a reasonable threshold (e.g., 60 minutes). The existing strict requirement for an improved objective score or massive transit savings is relaxed to allow progressive building of a multi-base road trip.
- **New Flow**: Base discovery will be triggered by "commute relief"—identifying clusters of places whose nearest active base exceeds a travel-time threshold—replacing the existing strict haversine-distance checks and the reliance on places being entirely dropped.
- **Impact on Iteration**: Because the acceptance gate is fixed, the user can sequentially accept suggestions to organically build a complete 10+ base road trip from a 1-base starting point, and the system will restructure the sequence geographically at each step.

## Capabilities

### New Capabilities

*(None)*

### Modified Capabilities

- `hotel-area-recommendation`: The mechanism for evaluating and sizing candidate bases changes. The engine must size base nights proportionally to workload, sequence bases geographically, and use a commute-relief trigger and permissive acceptance gate rather than appending 1-night stays and requiring immediate score improvements.

## Impact

- **Solver Worker** (`evaluateBaseSuggestions`, `buildSpeculativeStays`, `createSpeculativeTrip`): Needs new logic for allocating nights proportionally, sequencing bases via TSP, and evaluating candidates against the new permissive gate.
- **Stays Panel UX**: The UI is unaffected structurally, but the suggested stays it receives will cover multiple nights and may reorder existing stays geographically rather than just appending to them.

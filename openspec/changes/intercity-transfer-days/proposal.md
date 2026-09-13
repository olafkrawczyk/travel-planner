## Why

The current 80 km/h distance heuristic completely breaks down for long-haul intercity travel (e.g., crossing oceans or long train routes). When scheduling a trip day across two distant cities, the solver deems the travel mathematically impossible and drops activities, making it difficult to explicitly schedule travel days without breaking the solver.

## What Changes

- Add explicit UI and engine support for **"Intercity Transfer Days"**.
- Allow users to schedule split-city days by leaning on explicit `startLocation` and `endLocation` bounds.
- Provide a mechanism to create manual `TravelOverride` entries to shortcut the heuristic (e.g. explicitly asserting that Hotel Seoul -> Hotel Tokyo takes 300 minutes), which the ALNS solver natively respects.

## Capabilities

### New Capabilities
- `intercity-transfers`: Scheduling and planning days where travel bridges distant cities, utilizing existing solver primitives (`TravelOverride` and Day `startLocation`/`endLocation`).

### Modified Capabilities
- (None)

## Impact

- **UI Timeline:** Must surface the ability to add intercity transit explicitly and manage `startLocation`/`endLocation`.
- **Solver Engine:** Operates natively with the existing `TravelOverride` and day-bound logic, minimal changes required.

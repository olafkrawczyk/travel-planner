## Why

Currently, hotel area recommendations are generated per temporal stay segment (a chunk of days) and rely on a cheap heuristic. This obscures geographic reality: if a user creates a 5-day trip for Tokyo and Hakone, they won't see a Hakone recommendation unless they manually split the days first. By shifting to geographic-first clustering and backing recommendations with a background "shadow solve", we can proactively suggest new base areas (with honest, validated transit savings) and let the user auto-assign nights to them with one click.

## What Changes

- **BREAKING**: Hotel recommendations will no longer be bound to pre-existing stay segments (days). They will be computed by geographically clustering all unassigned places (e.g., separating Tokyo places from Hakone places).
- **BREAKING**: The time-savings rationale will no longer rely solely on a cheap heuristic. It will be backed by a full "shadow solve" of the itinerary in a background web worker.
- **New Flow**: When the itinerary regenerates, the system will cluster places, generate speculative `Stay[]` configurations, and evaluate them in the background. If a candidate significantly reduces transit time compared to the baseline solve, it is surfaced to the user.
- **UI Update**: Hotel area recommendations move from the individual stay-row level to a top-level "Suggested Bases" section in the Stays panel.

## Capabilities

### New Capabilities

*(None)*

### Modified Capabilities

- `hotel-area-recommendation`: The recommendation mechanism must change to cluster places geographically (ignoring temporal stay boundaries) and validate travel-time savings using a background shadow solve. The requirement that recommendations are computed "without requiring a solved itinerary" is replaced by a background shadow solve pipeline.

## Impact

- **Solver Worker**: Will need to handle speculative "shadow" problem variants alongside the main solve, returning transit time diffs.
- **Stays Panel UX**: Structural changes to surface recommendations independently of day rows.
- **Recommendation Logic**: `recommendHotelAreas` and `assignPlacesToSegments` will be replaced or fundamentally changed to cluster places globally, rather than mapping them to existing days.
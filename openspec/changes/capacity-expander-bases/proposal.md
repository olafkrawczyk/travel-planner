## Why

The shadow-solve base-suggestion engine (`evaluateBaseSuggestions`) only surfaces a candidate base when it reduces total transit time by at least 45 minutes. This misses a common and important case: a trip with one hotel and a distant region (e.g. another island) whose places never get scheduled at all because they're unreachable within any day's budget. Adding a second base there naturally *increases* transit time (more places are now being visited), so the existing transit-savings check always rejects it — even though the base would let the user see 10+ places that were silently dropped. The clustering that finds candidate regions also uses straight-line (haversine) distance, which fails on islands and mountainous terrain where a geometrically close region is an hour or more away by road.

## What Changes

- **New discovery path ("Anchor & Pull")**: In addition to the existing transit-saver discovery, find candidate base regions by clustering the places the baseline solve *dropped* (`unscheduled` reasons `no_time` or `unreachable`; `window_conflict` is excluded since a second base can't fix opening hours). Even a single dropped place qualifies. Scheduled places geographically near a dropped cluster are pulled into it so the candidate hotel serves both.
- **Travel-time-based separation, not haversine**: Replace the coarse-clustering distance check against existing hotels with a check against the travel-time matrix, so a candidate is only rejected as "too close" when it's genuinely a short drive from an existing base, not merely close on a map (fixes the island/mountain-road case).
- **New evaluation criterion for capacity-expander candidates**: A candidate discovered via Anchor & Pull is surfaced when the shadow solve schedules at least 1 more place than the baseline AND the shadow solve's objective score is not worse than the baseline's. This runs alongside (not instead of) the existing transit-savings check used for geography-only candidates.
- **Suggestion surfaces its rationale**: A suggestion produced via this path states how many additional places it would let the user visit, distinct from the existing "saves N minutes transit" rationale.
- Night placement keeps the existing simple behavior: the candidate stay is appended at the end of the trip and existing stays are shrunk to make room (no smart insertion near where the dropped places "wanted" to be visited).

## Capabilities

### New Capabilities

*(None)*

### Modified Capabilities

- `hotel-area-recommendation`: Candidate base discovery and surfacing criteria are extended to also find and validate bases that rescue places the baseline solve couldn't schedule at all, not only bases that reduce transit time for already-scheduled places. The existing region-separation check moves from straight-line distance to travel time.

## Impact

- **Solver package** (`packages/solver/src/hotelArea.ts`): `findExternalClusters` needs access to the baseline itinerary's `unscheduled` list to build anchor clusters, and a travel-time based separation check. `evaluateBaseSuggestions` needs a second surfacing condition (rescued-place count + non-regressing score) alongside the existing `minSavingsMin` check.
- **Suggested base data shape** (`SuggestedBase`): needs a field distinguishing "transit saver" from "capacity expander" suggestions (or a rescued-place count) so the UI can render the right rationale.
- **Stays Panel UI** (`apps/web/src/components/StaysPanel.tsx`): "Suggested Bases" card needs to render the rescued-places rationale for capacity-expander suggestions.

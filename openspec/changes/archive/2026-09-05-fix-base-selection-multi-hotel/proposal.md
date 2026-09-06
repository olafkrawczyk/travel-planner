# Proposal: fix-base-selection-multi-hotel

## Why

The map always opens centered on Tokyo regardless of the trip's actual base city (hardcoded initial center + recenter guard that never fires for sample trips). There is no way to change which place is a day's base (hotel) after creation — even though the domain model and solver already support per-day bases and hotel changes mid-trip. And no sample exercises the multi-hotel path.

## What Changes

- **Map centering fix**: the map centers on the current trip's base place (hotel) when a trip opens, not on a hardcoded Tokyo coordinate; opening any trip shows the right city.
- **Base editing UI**: the place editor gains a "Set as base" action (for a chosen day range: this day / all days), so any place can become the wake-up/sleep base — enabling hotel changes mid-trip through the UI.
- **Multi-hotel sample**: a curated sample trip with a hotel change mid-trip (e.g. Tokyo 3 nights → Hakone/Kyoto 2 nights) demonstrating `baseStartId` ≠ `baseEndId` days.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trip-management`: the user SHALL be able to change a day's base (hotel) after creation, including mid-trip hotel changes; sample trips SHALL include a multi-hotel example.
- `itinerary-view`: the map SHALL center on the trip's base city when a trip is opened.

## Impact

- `apps/web/src/components/MapView.tsx` (initial center from trip base; recenter on trip open), `apps/web/src/store.ts` (set-base mutation), `apps/web/src/components/PlaceEditor.tsx` (set-as-base action), `apps/web/src/samples/` (new multi-hotel sample), `apps/web/src/tripFactory.ts` (multi-hotel sample support: per-day hotel ids), `apps/web/src/components/TripList.tsx` (sample button).
- No schema changes — bases already exist per day.

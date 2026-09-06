# Proposal: add-day-route-map-ux

## Why

The map currently shows only numbered markers — users can't see the actual route shape of a day, can't tell scheduled vs unscheduled places at a glance, day identity is invisible on the map, the right-click "Add place here" action is broken (menu appears but nothing is created), and there's no feedback that edits are being saved.

## What Changes

- **Fix add-place**: clicking "Add place here" (context menu) or the map itself opens the place editor at those coordinates (currently `openPlaceEditor(null, coords)` sets `editingPlaceId: null`, which the editor treats as "closed" — must set it to `"new"`).
- **Route polylines**: each day's route (base → stops → base) is drawn on the map in that day's colour; clicking a day card focuses/highlights its route.
- **Day identity on markers**: each scheduled marker carries a day-coloured border (matching the sidebar day colour); unscheduled places have no day border (a neutral dashed/grey style).
- **Autosave indicator**: the header shows save status ("Saving…" / "Saved HH:MM") after any user or worker action persists the trip.
- **Hide a day's pins**: an eye toggle on each day card hides that day's markers and route line on the map.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `itinerary-view`: map shows per-day route polylines and day-coloured marker borders, distinguishes unscheduled markers, supports hiding a day's pins, focuses a day's route when its card is clicked, and shows a save-status indicator; map place creation opens the editor reliably.
- `trip-persistence`: the UI SHALL surface save status after each persisted change.

## Impact

- `apps/web/src/store.ts` (openPlaceEditor "new" fix, hidden-day state, save-status state), `apps/web/src/components/MapView.tsx` (polyline layers, marker borders, hidden-day filtering), `apps/web/src/components/Timeline.tsx` (eye toggle, day click-to-focus), `apps/web/src/components/TripScreen.tsx` (save indicator), CSS.
- No schema changes; hidden-days is UI-only state (not persisted).

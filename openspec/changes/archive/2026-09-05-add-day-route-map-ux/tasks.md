# Tasks: add-day-route-map-ux

## 1. Fix add-place (broken)

- [x] 1.1 In `store.openPlaceEditor`, map a null placeId WITH coords to `editingPlaceId: "new"` (null placeId without coords = close); verify map left-click and context-menu "Add place here" both open the editor at the coordinates

## 2. Route polylines

- [x] 2.1 Draw each solved day's route as a polyline (base → ordered stops → base) in the day's colour, updating with the itinerary; markers stay above lines

## 3. Day-coloured marker borders + unscheduled style

- [x] 3.1 Scheduled markers get a border in their day's colour; unscheduled markers get a neutral dashed/grey border; base marker stays distinct

## 4. Day visibility toggle + focus

- [x] 4.1 Store: `hiddenDays` (Set of dayIds) + `toggleDayHidden`; `focusDayId` + `focusDay` (UI-only)
- [x] 4.2 Timeline day cards: eye toggle hides/shows that day's markers + route on the map; clicking the day card focuses/fits the map to that day's route

## 5. Autosave indicator

- [x] 5.1 Store: `saveState`/`savedAt` set inside `persist()` (saving → saved), covering both user edits and worker-triggered persistence
- [x] 5.2 TripScreen header shows "Saving…" / "Saved HH:MM"

## 6. Verify

- [x] 6.1 `pnpm build` passes and `pnpm test` is green; add cheap unit coverage for the openPlaceEditor "new" mapping if practical

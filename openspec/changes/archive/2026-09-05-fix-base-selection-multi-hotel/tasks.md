# Tasks: fix-base-selection-multi-hotel

## 1. Map centering fix

- [x] 1.1 MapView: initial center and trip-open recenter use the current trip's base place coords (`trip.days[0].baseStartId` → place; fallback: first place, then Tokyo); remove the `recenterKey <= 2` guard; recenter when `trip.id` changes

## 2. Set-as-base UI

- [x] 2.1 Store: `setBase(placeId, scope)` via mutateTrip (full re-solve); supports "all days" and "from day N onward"
- [x] 2.2 PlaceEditor: "Set as base for all days" button + "Set as base from day N onward" (day select); works for any place; undo restores previous bases

## 3. Multi-hotel sample

- [x] 3.1 `tripFactory`: multi-hotel sample builder — hotel semantics per design (travel day: baseStart=old hotel, baseEnd=new hotel); wire `samples/tokyo-hakone.json` (move into `apps/web/src/samples/`)
- [x] 3.2 TripList: "Load sample: Tokyo → Hakone" button; trip solves with day 3 ending at the Hakone hotel

## 4. Verify

- [x] 4.1 `pnpm build` passes and `pnpm test` is green; cheap unit test for factory multi-hotel mapping if practical

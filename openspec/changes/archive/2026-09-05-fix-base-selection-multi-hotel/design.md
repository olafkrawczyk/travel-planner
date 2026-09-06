# Design: fix-base-selection-multi-hotel

## 1. Map centering (root cause)

`MapView.tsx` hardcodes `center: [139.7671, 35.6812]` and the recenter effect guards on `recenterKey <= 2` (place count), so any trip loaded with >2 places never recenters. Fix:
- Compute the initial center from the current trip's first base place (`trip.days[0].baseStartId` → place coords), falling back to the first place, then to Tokyo only as a last resort.
- Recenter (`jumpTo`) whenever `trip.id` changes (trip opened), using the base coords. Drop the `recenterKey <= 2` guard.

## 2. Set-as-base UI

- Store: `setBase(placeId, scope: { mode: "all" } | { mode: "day"; dayId: string })` — a `mutateTrip` wrapper that sets `baseStartId`/`baseEndId` for the targeted days, then re-solves (full edit). Undo/redo works via existing snapshots.
- `PlaceEditor`: for any place, show a "Base" section with two buttons: "Set as base for all days" and "Set as base for this trip from day N" (simplest: "all days" + a day select). Keep it minimal: two controls — "Set as base for all days" and "Set as base from this day onward (day select)".
- A place used as a base keeps `dwellMin: 0` convention optional; do NOT force dwell to 0 for user-chosen bases — but for correctness the solver treats base ids as route endpoints already.

## 3. Multi-hotel sample

Data authored at `openspec/changes/fix-base-selection-multi-hotel/samples/tokyo-hakone.json`: Tokyo (Shinjuku hotel, days 1–3) → Hakone ryokan (nights 4–5). Note the base semantics: day d's `baseStartId` = hotel you wake in; `baseEndId` = hotel you sleep in. For a hotel change on day 4 (travel day): day 3 sleeps at Hakone hotel (baseEnd = hakone), so day 4 wakes in Hakone. Mapping for a 5-day trip, hotels [tokyo(3 nights), hakone(2 nights)]:
- days 1–2: baseStart=baseEnd=tokyo
- day 3: baseStart=tokyo, baseEnd=hakone (travel day — check-out, day trip luggage note, arrive Hakone)
- days 4–5: baseStart=baseEnd=hakone

`tripFactory` gains `multiHotelSampleTrip(data, startDate?)` supporting `meta.hotels[]` with `daysFromStart`/`nights`; `TripList` gets "Load sample: Tokyo → Hakone". Keep `sampleTrip` for single-hotel samples (shared internals fine).

## Constraints

- No schema changes.
- Solver already handles per-day distinct bases — only UI/factory work.
- `pnpm build` + `pnpm test` green; cheap unit test for the base-center computation or factory mapping if practical.

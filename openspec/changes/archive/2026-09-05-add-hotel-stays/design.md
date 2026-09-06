# Design: add-hotel-stays

## Model

Keep `Day.baseStartId`/`baseEndId` as the stored source of truth (solver unchanged). Stays are a **derived view** + write-back:

```ts
interface Stay { hotelId: Id; checkInDayIdx: number; nights: number } // UI-only
```

- `staysFor(trip): Stay[]` — derive from days: group consecutive days by `baseEndId` (sleep hotel); each group's first day is the check-in day, length is nights. (baseStart of day d = baseEnd of day d−1 is an invariant stays maintain; on derive, tolerate inconsistencies by grouping on baseEnd only.)
- `setStays(store, stays: Stay[])` — validate: sorted by checkInDayIdx, first starts at 0, contiguous coverage of all days, total nights == trip length. Write back per day d: `baseEndId = stay covering d`; `baseStartId = baseEndId of day d−1` (day 0: its own stay's hotel). Then `mutateTrip` full re-solve. Undo/redo comes free.

## UI

**StaysPanel** (top of the timeline pane, collapsible):
- Rows: hotel name (select from hotel-categorized places), "check in: Day N (date)", "nights: N" — nights auto-computed as (next stay's check-in − this check-in) except the last stay which is editable.
- Coverage bar: horizontal segments per stay across trip days with hotel colour/label; check-in days visually marked.
- "Add stay" → splits at a chosen day (default: midpoint); "Remove" → previous stay absorbs the nights.
- Editing writes via `setStays`.

**PlaceEditor**: replace "Set as base…" buttons with a "This is a hotel" toggle (sets category hotel; dwell untouched — base role comes from stays). Note text: "Hotels can be assigned in the Stays panel."

**Category**: add `"hotel"` to `CategorySchema`; category palette gets a colour; base markers keep their distinct look (now also category=hotel for new hotels).

## Migration / compat

- Additive category — old trips load fine (their base places are category "other"; user can mark them as hotels).
- `sampleTrip`/`multiHotelSampleTrip` set hotel category going forward; samples' base places get category hotel.
- Delete-hotel edge: if a stay's hotel place is deleted, `staysFor` falls back to the first remaining hotel place; existing delete guard already refuses deleting base-referenced places.

## Tests

- store/domain: staysFor derive (single hotel, Tokyo→Hakone two-stay mapping incl. check-in day baseStart=old/baseEnd=new), setStays write-back mapping + validation errors.
- Keep all existing tests green (fixture baselines unchanged).

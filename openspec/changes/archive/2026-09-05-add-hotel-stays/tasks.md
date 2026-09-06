# Tasks: add-hotel-stays

## 1. Domain

- [x] 1.1 Add `"hotel"` to the category union (additive, no migration); category colour for hotel; hotel sample bases get category hotel

## 2. Stays model (store)

- [x] 2.1 `staysFor(trip)` derivation (group consecutive days by sleep base; check-in day semantics) + `setStays(stays)` write-back with contiguous-coverage validation, writing baseStartId/baseEndId per day and re-solving; unit tests incl. Tokyo→Hakone mapping (day 3: wake Tokyo, sleep Hakone)

## 3. UI

- [x] 3.1 StaysPanel in the timeline sidebar: stay rows (hotel select from hotel-category places, check-in day, nights), coverage bar, add/remove stay; edits go through setStays (undoable)
- [x] 3.2 PlaceEditor: "This is a hotel" toggle (sets category hotel); REMOVE the old "Set as base…" buttons (replaced by stays)
- [x] 3.3 Hotel markers keep distinct styling with hotel category colour

## 4. Verify

- [x] 4.1 `pnpm build` passes; `pnpm test` green (fixtures unchanged); sample trips (incl. Tokyo→Hakone) derive correct stays

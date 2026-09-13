## 1. Safety & Place Deletion

- [x] 1.1 In `PlaceEditor.tsx`, extend place deletion to reset `day.startLocation` and `day.endLocation` to `"base"` if they reference the deleted place.
- [x] 1.2 Add unit test in `PlaceEditor.test.ts` verifying that deleting a place resets any day's `startLocation`/`endLocation` referencing it to `"base"`.

## 2. Day Start and End Location Controls

- [x] 2.1 In `Timeline.tsx` (`DaySettings`), add "Starts from" and "Ends at" place selectors allowing selection between "Base" (`"base"`) and any place in `trip.places`.
- [x] 2.2 In `Timeline.tsx`, ensure that changing `startLocation` or `endLocation` mutates the day via `mutateTrip`.
- [x] 2.3 Add unit/integration tests verifying start/end location changes persist in trip state and mutate appropriately.

## 3. Manual Travel Override Affordance

- [x] 3.1 Extract an `upsertTravelOverride` helper to avoid duplication between `handleOverride` and the new override UI, ensuring symmetric deduplication.
- [x] 3.2 In `Timeline.tsx` (`DaySettings` or Travel Overrides section), add a form to add a manual travel override between any pair of places with custom duration (in minutes) and optional symmetric flag.
- [x] 3.3 Add unit/integration tests for adding and deduplicating travel overrides via the helper and UI.

## 4. Verification

- [x] 4.1 Run typecheck and existing test suite to ensure all tests pass and no regressions occur.

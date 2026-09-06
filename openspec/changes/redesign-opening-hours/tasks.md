## 1. Domain schema

- [x] 1.1 Add `WeekdaySchema`, `DayPatternSchema` (`{kind:"closed"}` | `{kind:"open", windows: TimeWindow[] (min 1)}`), `WeeklyPatternSchema` (full `mon..sun` object) to `packages/domain/src/schema.ts`
- [x] 1.2 Add `Place.openingHoursWeekly?`, `Place.openingHoursClosedDates?: string[]`, `Place.openingHoursAlwaysOpen?: boolean` (reuse existing `OPENING_HOURS_MAX_*` bounds where applicable); keep `Place.openingHours` field's type exactly as `Record<string, TimeWindow[]>` (unchanged) so `packages/solver/src/matrix.ts`'s `reasonFor` keeps compiling and behaving identically
- [x] 1.3 Bump `schemaVersion` 2→3; add migration entry `3: (t) => t` (documented no-op — new fields are additive) to `migrations`
- [x] 1.4 Rewrite `windowsForDate(place, date)` to resolve precedence `openingHoursClosedDates` > `openingHours[date]` > `openingHoursWeekly[weekdayOf(date)]` > `undefined`, returning the `CLOSED_ALL_DAY` sentinel (`[{start:"23:59", end:"00:00"}]`, documented in place) for any closed outcome; add a `weekdayOf(date): Weekday` helper
- [x] 1.5 Add an `openingHoursState(place): "unknown" | "always_open" | "has_hours"` helper for the UI's three-state badge (derived from which of the new fields/legacy map are set — no new persisted field needed for this)
- [x] 1.6 Domain tests: weekly-pattern expansion per weekday, closed-vs-unknown (including that `CLOSED_ALL_DAY` is infeasible via `feasibleVisit` for `dwellMin` 0 and >0, at various day-start times), per-date override beats weekly pattern, `openingHoursClosedDates` beats weekly pattern, migration v2→v3 (old per-date-only data parses and produces identical `windowsForDate` results), `openingHoursState` for all three states plus the legacy-data case

## 2. Geo package (OSM proposal helpers)

- [x] 2.1 Add `deriveWeeklyProposal(expansion: OpeningHoursExpansion, dates: string[]): { weekly: WeeklyPattern; exceptions: Record<string, "closed" | TimeWindow[]> } | null` to `packages/geo/src/openingHours.ts` as a new export — groups per-date windows by weekday, picks each weekday's majority pattern, flags dates that diverge as exceptions; treats a requested date absent from `expansion` as closed for that date (per `expandOpeningHours`'s existing contract). Leave `expandOpeningHours` itself untouched (signature and behavior), since `apps/web/src/store.ts`'s auto-prefill depends on it as-is
- [x] 2.2 Tests for `deriveWeeklyProposal`: consistent weekday pattern across all matching dates, a single-date holiday exception, an all-closed weekday, a `null`/24-7 input

## 3. PlaceEditor UI

- [x] 3.1 New component file(s) under `apps/web/src/components/` (e.g. `OpeningHoursEditor.tsx`) implementing: the three-state badge, the weekly grid (7 rows, each with a closed/open toggle and add/remove window controls), the exceptions section (add/remove a date override — closed or specific windows — from the trip's dates), and the "always open" confirmation control. Exported as a component consumed by `PlaceEditor.tsx`
- [x] 3.2 New OSM-review component/panel: shows the diff between the current weekly pattern/exceptions and the fetched proposal (via `deriveWeeklyProposal`), with explicit Apply/Discard actions; nothing is written to the editor's state until Apply
- [x] 3.3 Rewrite `PlaceEditor.tsx`'s opening-hours block to use the new components instead of the per-trip-date row list; wire local state for `openingHoursWeekly`, `openingHoursClosedDates`, `openingHoursAlwaysOpen`, and the existing `openingHours` (now exceptions-only) into `save()`
- [x] 3.4 Fix failure copy: replace "left as always open" messaging with "hours are unknown" wording for the no-tag / unparseable / no-open-hours-on-trip-dates cases
- [x] 3.5 Add the timezone-assumption note (referencing `trip.timezone`) next to the weekly editor and the OSM fetch control
- [x] 3.6 Full keyboard operability and labelling for the weekly grid and exceptions list (unique `aria-label`s per input, logical tab order, no keyboard traps), consistent with the app's existing accessibility pass
- [x] 3.7 New stylesheet under `apps/web/src/styles/` for the weekly grid / badge / diff panel, using tokens from `apps/web/src/styles/tokens.css` only (no hardcoded colors/spacing); imported the same way sibling stylesheets are imported
- [x] 3.8 Pure-helper tests in `apps/web/src/components/PlaceEditor.test.ts` (and/or a co-located test file for the new component(s)) covering any newly-exported pure functions (e.g. state-derivation or diff-computation helpers), consistent with this repo having no component-render harness

## 4. Verify

- [x] 4.1 `npx tsc -b --force` reports 0 errors
- [x] 4.2 `pnpm test` passes (295 pre-existing + all new tests), including Tokyo/Warsaw solver fixtures unaffected
- [x] 4.3 Manually trace the "add a day to the trip" scenario against the new model (a place with `openingHoursWeekly` set, one more date added to `days`) and confirm `windowsForDate` covers the new date without further action; record the result in the final report

## 5. Follow-ups (explicitly out of scope for this change)

- [x] 5.1 Record as a follow-up (do not implement): `packages/solver/src/matrix.ts`'s `reasonFor` (~line 427) should classify `window_conflict` vs `no_time` by an actual feasibility probe instead of the place's static shape, and should also consider `openingHoursWeekly`/`openingHoursClosedDates`, not just the legacy `openingHours` map — requires an edit inside `packages/solver`, which this change does not own

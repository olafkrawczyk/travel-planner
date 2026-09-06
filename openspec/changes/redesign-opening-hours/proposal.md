## Why

The opening-hours editor exposes the raw persisted shape (`Record<date, TimeWindow[]>`) directly: one row per trip date, so a 14-day trip means up to 14 redundant rows per place for hours that are actually weekly-recurring. Worse, "closed" and "no restriction" are indistinguishable — deleting the last window for a date silently means "always open," even though that is the opposite of what a user closing a place usually intends — and the OSM fetch button overwrites whatever was hand-entered with no preview or undo. This is the single biggest usability defect in the app's data entry and it produces itineraries that can schedule a visit when a place is actually shut.

## What Changes

- **Weekly-pattern editor as primary input**: a per-weekday grid (Mon–Sun, each "open" with one or more windows, or "closed") replaces per-date rows as the main way to enter hours; it is expanded onto the trip's dates automatically, including any date added later.
- **Per-date exceptions as a secondary affordance**: a specific date can still override the weekly pattern (holiday closure, one-off late opening) — the existing per-date `openingHours` map keeps this role, now reached through a smaller "exceptions" section instead of being the only editor.
- **Three legible states**: every place's hours now render as one of "unknown" (no data), "always open" (user-confirmed, no restriction), or "has hours" (weekly pattern and/or exceptions set) — previously "unknown" and "always open" were the same undefined value with no way to tell them apart.
- **OSM fetch becomes a reviewable proposal**: fetching from OSM shows the derived weekly pattern and any exceptions as a diff against the current state before anything is written; the user applies or discards it instead of it silently replacing hand-entered rows.
- **Failure copy fixed**: "No opening hours on OSM" / "unusable" / "no open hours on the trip dates" no longer say the place is "left as always open" (a false claim that lets the solver schedule it at any hour) — they say the hours are unknown.
- **Timezone assumption surfaced**: the existing local-to-POI-treated-as-local-to-trip assumption is now shown as a note in the editor at the point the user is entering or reviewing hours, not only in a source comment.
- **Domain model** (additive, no breaking change): `Place` gains `openingHoursWeekly` (the weekly pattern), `openingHoursClosedDates` (explicit per-date closures, so "closed" is a first-class value rather than an absent/empty array), and `openingHoursAlwaysOpen` (the confirmed-always-open flag). The legacy `openingHours` per-date map is unchanged in type and keeps its current per-date-override meaning and priority. `schemaVersion` bumps 2→3 with a migration; all existing stored trips keep loading and keep solving identically (old data has none of the three new fields, so `windowsForDate` falls through to exactly its old per-date-only logic).
- **Fixes a real latent bug**: because the old model only stored concrete per-date windows, a trip whose date range grows (a day added) would give the new date no opening-hours coverage at all — the weekly pattern is derived from the day of week, so it automatically covers any date, present or future.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trip-management`: opening-hours editing changes from a per-date-row editor to a weekly-pattern-first editor with per-date exceptions, three-state legibility, a reviewable (non-destructive) OSM prefill, corrected failure copy, and a visible timezone-assumption note.

## Impact

- `packages/domain/src/schema.ts`: additive `Place` fields (`openingHoursWeekly`, `openingHoursClosedDates`, `openingHoursAlwaysOpen`); `schemaVersion` 2→3 with migration; `windowsForDate` extended to resolve the new fields with a documented precedence (closed-dates > per-date override > weekly pattern > unset), while still returning exactly the same `TimeWindow[] | undefined` shape `packages/solver` already consumes, so `packages/solver/**` needs zero edits.
- `packages/geo/src/openingHours.ts`: new pure helper(s) that turn an OSM-derived per-date expansion into a weekly-pattern-plus-exceptions proposal for the editor to preview; existing `expandOpeningHours` signature and behavior are unchanged (it is still called as-is by `apps/web/src/store.ts`'s untouched auto-prefill path).
- `apps/web/src/components/PlaceEditor.tsx` (+ new component files it imports, + a new stylesheet under `apps/web/src/styles/`): weekly-grid editor, exceptions section, three-state badge, OSM review/diff panel, corrected copy, timezone note. Fully keyboard-operable and labelled per the app's existing accessibility bar.
- Out of scope, noted as a follow-up: `packages/solver/src/matrix.ts`'s `reasonFor` (~line 427) classifies any place with a non-empty legacy `openingHours` map as `window_conflict` regardless of actual cause, and does not look at the new fields at all — a place dropped purely for lack of time, or one constrained only by the new weekly pattern, can still be misclassified. Fixing this requires editing `packages/solver`, which this change does not own.

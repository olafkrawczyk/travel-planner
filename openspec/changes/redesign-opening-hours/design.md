## Context

`Place.openingHours: Record<"YYYY-MM-DD", TimeWindow[]>` (`packages/domain/src/schema.ts`) is read by `windowsForDate(place, date)`, which `packages/solver/src/sequence.ts`'s `feasibleVisit` calls directly, and by `packages/solver/src/matrix.ts`'s `reasonFor` (~line 427), which reads the raw field instead of going through `windowsForDate`:

```ts
if (p.openingHours && Object.values(p.openingHours).some((ws) => ws.length > 0)) {
  return "window_conflict";
}
```

This repo's ownership split puts `packages/solver/**` off limits for this change — any fix there is a follow-up. That constrains the whole design: **`Place.openingHours`'s field type cannot change**, because `reasonFor` accesses it with the old `Record<string, TimeWindow[]>` assumption and would either fail to typecheck or silently misbehave if that type changed. Likewise `sequence.ts`'s `feasibleVisit` only treats a *non-empty* `windowsForDate(...)` result as constraining — an empty array is indistinguishable there from "no windows at all" — so "closed" can never be expressed as `[]`; it has to arrive as a windows array that actively can't be satisfied, or not be represented via that channel at all.

Two other existing, unowned call sites matter:
- `apps/web/src/store.ts`'s `addPlace` auto-prefill calls `expandOpeningHours(expr, dates)` (from `packages/geo`, which this change owns) and assigns its return value straight onto `p.openingHours`. Its signature/semantics (`Record<string, TimeWindow[]> | null`) must not change, or that untouched call site breaks.
- `parseTrip` runs on every storage read; `schemaVersion`/`migrations` in `packages/domain/src/schema.ts` are how old data stays loadable.

## Goals / Non-Goals

**Goals:**
- Let a user express hours as a weekly-recurring pattern, with per-date exceptions, and see three distinct states (unknown / always-open / has-hours) for every place.
- Fix the real gap where a per-date-only store cannot represent recurrence, so a trip whose dates change loses coverage silently.
- Make OSM fetch a reviewable, non-destructive proposal.
- Zero edits to `packages/solver/**` or `apps/web/src/store.ts`; zero behavior change for existing stored trips.

**Non-Goals:**
- Fixing `matrix.ts`'s `reasonFor` to classify by actual feasibility rather than static shape (documented follow-up; needs a `packages/solver` edit).
- Multi-timezone-per-place support — the trip-local-timezone assumption stays, just made visible in the UI.
- A component-render test harness for `apps/web` (none exists today; out of scope to invent per the task brief — noted, not built).

## Decisions

### Storage: additive new fields, legacy `openingHours` untouched in type and meaning

`Place` gains three new optional fields:
- `openingHoursWeekly?: WeeklyPattern` — a full 7-key object (`mon`..`sun`), each a `{kind:"closed"}` or `{kind:"open", windows: TimeWindow[]}` (min 1 window). Full (not partial) so a weekly pattern is never ambiguous about an unset day.
- `openingHoursClosedDates?: string[]` — dates explicitly closed, overriding the weekly pattern. A plain list, not a magic value inside `openingHours`, so "closed" never has to masquerade as a window.
- `openingHoursAlwaysOpen?: boolean` — set when the user explicitly confirms "no restriction," distinct from simply never having touched the hours for this place.

`Place.openingHours?: Record<string, TimeWindow[]>` **keeps its exact current type**. It becomes the "different/extra windows on this date" override channel — the UI reaches it through an "exceptions" section, and precedence is: `openingHoursClosedDates` > `openingHours[date]` > `openingHoursWeekly[weekdayOf(date)]` > unset. `windowsForDate` (in `packages/domain`, owned by this change) is the single place this precedence is implemented; its signature (`(place, date) => TimeWindow[] | undefined`) is unchanged, so `sequence.ts` needs no edit.

**Alternative considered**: replace `openingHours` with a single structured object (`{status, weekly, overrides}`) and drop the bare per-date map. Rejected — `matrix.ts`'s `reasonFor` reads `p.openingHours` directly with the old shape; changing the field's type breaks that unowned call site (likely a `tsc` error, at best a silent misclassification of every place). The additive shape keeps every existing call site — owned or not — compiling and behaving identically, which is the deciding factor given the "preserve existing stored data and solver behaviour when a decision is close" instruction.

**Alternative considered**: keep the weekly pattern purely as a UI-level projection, never persisted, and write it out as concrete per-date entries into the existing `openingHours` map at save time. Rejected — this is exactly the bug being fixed. A per-date-only store can only cover the dates known at save time; a trip whose date range later grows (or an exported/re-imported trip solved against a different date window) would have no windows for the new dates, silently reverting to "no restriction" for a place the user explicitly gave hours to. Persisting the pattern itself is what makes it recur.

### Representing "closed" to the solver without touching the solver

`sequence.ts`'s `feasibleVisit` only applies a constraint when `windowsForDate(...)` returns a non-empty array, then checks whether any window in it fits. To make "closed" a real hard constraint through that existing, unmodified gate, `windowsForDate` returns a single-element sentinel window when the resolved state is closed:

```ts
const CLOSED_ALL_DAY: TimeWindow[] = [{ start: "23:59", end: "00:00" }];
```

`open` (23:59 = 1439) is after `close` (00:00 = 0), so `start + dwell <= close` (`1439 + dwell <= 0`) can never hold for any non-negative `dwellMin`, including 0 — unconditionally infeasible, with no dependency on the day's start time or the place's dwell. This value is synthesized only inside `windowsForDate`'s implementation; it is never persisted (the stored fields are `"closed"`-as-a-list-membership or a `{kind:"closed"}` variant, both self-describing) and never rendered — the UI works off the structured fields, not off `windowsForDate`'s output.

**Alternative considered**: encode "closed" as an empty `TimeWindow[]` at the storage layer. Rejected — this is the ambiguity the whole change exists to remove (`sequence.ts` treats empty and absent identically), and it would have reproduced the current bug one layer higher.

### Migration

`schemaVersion` 2 → 3. The three new fields are optional and additive; no stored data needs transformation — old trips have none of them, and `windowsForDate` falls through to exactly its current per-date-only behavior when they're absent, so pre-existing trips solve identically. The migration function is recorded (not a no-op silently skipped) so the version bump and its justification are traceable, and a test asserts a v2 fixture still parses under v3 and produces the same `windowsForDate` results for its existing dates.

### OSM fetch as a reviewable proposal

`expandOpeningHours` (existing, unowned-caller-facing signature) stays exactly as is — `apps/web/src/store.ts`'s silent auto-prefill-on-add keeps using it unchanged. A new pure helper in `packages/geo/src/openingHours.ts` (e.g. `deriveWeeklyProposal(expansion, dates)`) turns that same per-date expansion into `{ weekly: WeeklyPattern, exceptions: string[] /* dates that don't match their weekday's majority pattern */ }` for the editor's manual "Fetch from OSM" button. The editor renders this as a diff against the place's current weekly pattern/exceptions and only writes it to component state (not to the trip) when the user clicks Apply; Cancel/dismiss discards it with no mutation. This is a UI-state-only feature — no store/domain persistence changes beyond the fields above.

### Timezone note

A short, static note ("Hours are treated as local to the trip — `<trip.timezone>`. Location-based hours like sunrise/sunset aren't supported.") renders next to the weekly-pattern editor and next to the OSM fetch control, i.e. at the two points a user is actually looking at hours, rather than only in `openingHours.ts`'s doc comment.

## Risks / Trade-offs

- **[Risk]** Places whose only constraint comes from `openingHoursWeekly`/`openingHoursClosedDates` (no legacy `openingHours` entries) are still misclassified as `no_time` by `matrix.ts`'s shape-based `reasonFor` when dropped, compounding its existing bug rather than fixing it. → **Mitigation**: documented as an explicit follow-up task requiring a `packages/solver` edit (out of this change's ownership); not silently left unmentioned.
- **[Risk]** The `CLOSED_ALL_DAY` sentinel is a deliberate exploit of `feasibleVisit`'s exact current implementation; if that implementation ever changes (e.g. the `windows.length > 0` gate is refactored), the sentinel could stop working. → **Mitigation**: heavily commented at the definition site and covered by a solver-facing behavioral test (via `feasibleVisit`, which this package can call as a test dependency without editing it) so a future change to `sequence.ts` that breaks the assumption fails a domain-side test, not silently.
- **[Risk]** A full 7-key `WeeklyPattern` means every place with a weekly pattern must have an opinion for all 7 days. → **Mitigation**: this is intentional (see Decisions) — it removes "day not mentioned" as a fourth, ambiguous state; the editor defaults new weekdays to "closed" when the pattern is first created and lets the user flip each to open.

## Migration Plan

Additive schema change behind a version bump; no user-facing migration step. Deploying only requires the new `packages/domain` code to ship together with the new `PlaceEditor`; a page load against already-stored v2 (or earlier) trip data upgrades in place via `parseTrip` the next time it's read, same as the v1→v2 migration did.

## Context

The solver already models everything `intercity-transfers` needs: `Day.startLocation`/`Day.endLocation` (`"base"` or an explicit place id, `packages/domain/src/schema.ts`) and `TravelOverride` (fromId/toId/minutes/symmetric, resolved with highest priority in `matrix.ts`'s per-pair resolution order — see `itinerary-solver` spec's "Travel-time matrix" requirement). `sequence.ts` already resolves a day's start/end node through `startLocation`/`endLocation` (lines 128-129) and `matrix.ts:dayNodeIds` already includes those nodes when building the trip's node set. `TravelOverride` is already fully wired end-to-end in the solver and persisted on `Trip.travelOverrides`.

The only missing piece is **UI surface**: `Day.startLocation`/`endLocation` are never edited by the user (`DaySettings` in `Timeline.tsx` only exposes start/end *time*, sourced from bases which are managed in `StaysPanel`), and `TravelOverride` can only be created implicitly via inline leg editing in `LegRow`/`handleOverride` (a user can only override a leg that the solver already drew on the timeline — there is no way to declare a Day 1 → Day 5 override between two hotels the solver has never connected).

## Goals / Non-Goals

**Goals:**
- Let a user pick an explicit start/end place for a day (distinct from that day's base) directly in the Timeline UI.
- Let a user create a `TravelOverride` between any two places in the trip (not just ones the solver has already drawn a leg between), so long-haul city-to-city jumps can be asserted without the solver first attempting (and failing) to route them heuristically.

**Non-Goals:**
- No change to solver algorithms, the travel-time matrix resolution order, or `TravelOverride`/`Day` schemas — all primitives already exist and are respected end-to-end.
- No automatic detection or suggestion of "this looks like an intercity day" — purely user-driven, explicit configuration.
- No new transportation modes (flight, ferry) — an override's `mode` field already accepts any of the existing `ModeSchema` values or is left unset.

## Decisions

**Decision 1: Add start/end location pickers to `DaySettings`.**
Extend the existing `DaySettings` panel (`Timeline.tsx:591`) with two `<select>` controls — "Starts from" and "Ends at" — defaulting to "Base" (mapping to `"base"`) with every trip place listed as an alternative. Chosen because `DaySettings` is already the per-day settings disclosure the user opens via the gear icon; adding fields there keeps day-level config in one place rather than introducing a new panel.
- Alternative considered: put these controls in `StaysPanel` next to base editing. Rejected — bases are stay-level (shared across a stay's days), while `startLocation`/`endLocation` are per-day overrides of that base; mixing them in the stay-centric panel would blur that distinction the schema already encodes.

**Decision 2: Add a manual "Add travel override" affordance for arbitrary place pairs.**
Add a small form (from-place selector, to-place selector, minutes, symmetric checkbox) that calls the same `mutateTrip` pattern as `handleOverride` in `Timeline.tsx:574`, writing directly to `draft.travelOverrides`. Placed in `DaySettings` (or a new small "Transfers" sub-section within the Timeline sidebar) since that is where the user is already thinking about this day's intercity jump. Reuses the existing filter-then-push logic from `handleOverride` (dedupe by fromId/toId, respecting `symmetric`) rather than duplicating it — factor it into a shared helper.
- Alternative considered: only allow overrides via the inline `LegRow` editor once the solver draws *some* leg between the two places. Rejected — this is precisely the case the proposal calls out as broken: for very distant pairs the heuristic can make the day infeasible before a leg is ever drawn, so the user has no leg row to click.

**Decision 3: No new component file.**
Both additions are small, colocated UI within `Timeline.tsx` (following its existing local component pattern: `DaySettings`, `LegRow`, `PinToggle` are all defined in that file). Introducing a new file for ~2 small forms would fragment a single day's settings across files for no benefit.

## Risks / Trade-offs

- **[Risk]** A user sets `startLocation`/`endLocation` to a place, then deletes that place, leaving a dangling id. → **Mitigation**: `PlaceEditor.tsx`'s existing delete handler already cleans `pinnedOrder` and `travelOverrides` referencing a deleted place (lines 116-129); extend it to also clear any day's `startLocation`/`endLocation` that references the deleted place (reset to `"base"`).
- **[Risk]** Overriding two hotels' pair without `symmetric` leaves the reverse direction unresolved (falls back to heuristic), silently producing a lopsided day (e.g. a fast asserted outbound leg but a heuristic-broken return leg on a later day). → **Mitigation**: default the new override form's "symmetric" checkbox to checked (matching `handleOverride`'s existing default of `symmetric: true`), and note in the UI that unchecking only affects the one direction.
- **[Trade-off]** Exposing start/end location as raw place selects (not filtered to "far away" places) means the control is available even when unnecessary (same-city days) — accepted since filtering by geography adds complexity with no behavior benefit; the field simply defaults to "Base" for the common case.

## Migration Plan

No data migration needed — `Day.startLocation`/`endLocation` and `travelOverrides` already exist on the persisted schema and default correctly for all existing trips (`"base"` and `[]` respectively). This is a pure UI-additive change; existing trips render unaffected until a user opts in.

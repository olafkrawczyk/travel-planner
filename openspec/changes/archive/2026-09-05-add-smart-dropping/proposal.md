# Proposal: add-smart-dropping

## Why

When not everything fits, the solver already drops places into the unscheduled tray — but the drop choice is an emergent side effect of insertion order, and the tray only shows terse reason codes. v1 requires deliberate handling: the solver should drop the lowest-priority places FIRST (the objective weights exist but the search isn't guided by them), and the UI should explain each drop in plain language with a path to fix it.

## What Changes

- **Priority-aware dropping**: when time is short, ruin/insertion explicitly prefers dropping `nice-to-have` over `want` over `must`; a must-visit is dropped only when truly infeasible (verified: no feasible insertion exists on any allowed day).
- **Human-readable drop explanations**: each unscheduled place gets a computed explanation (e.g. "Not enough time on any day — 340 min needed, 210 min free"; "Windows on all days are before your earliest arrival"; "Appointment at 14:00 conflicts with X") alongside the reason code.
- **Tray UX**: each unscheduled entry shows the explanation, its priority, and quick actions — "Force into day N" (best-effort insert, relaxing soft constraints) and "Raise priority to must" + re-solve.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `itinerary-solver`: dropping SHALL be priority-ordered and deliberate; each unscheduled place SHALL carry a human-readable explanation.
- `itinerary-view`: the unscheduled tray SHALL show explanations and offer fix actions (force-insert, raise priority).

## Impact

- `packages/solver/src/solve.ts` / `alns.ts`: guided dropping — after the budget, for each pool place try a feasibility-verified insertion across allowed days in priority order before declaring it dropped; explanation computation in `finalize` (needs remaining-slack info per day).
- `packages/domain`: `Itinerary.unscheduled[]` gains optional `explanation: string` (additive, schema v2 stays — optional field, no migration needed).
- `apps/web/src/components/Timeline.tsx` tray: explanation text, priority badge, action buttons; store actions `forceInsert(placeId, dayId)`, `raisePriority(placeId)`.
- Tests: must-beats-nice dropping order; explanation strings for each reason; force-insert smoke test.

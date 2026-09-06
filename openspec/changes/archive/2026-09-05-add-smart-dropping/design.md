# Design: add-smart-dropping

## 1. Priority-ordered dropping (packages/solver)

Current behaviour: insertion failures land in the pool in construction order. Add a **final repair pass** in `solve()` (and `resolve()`) after ALNS:

```
for place in pool sorted by (priority asc, dwellMin desc):
    for each allowed day (appointment day if set, else unlocked days):
        try cheapest hard-feasible insertion (existing insertion routine, strict)
        if success: insert, remove from pool, break
```

This guarantees "no must is dropped while a lower-priority place sits on a day where the must would fit" at the strict-feasibility level — the objective weights then guide ALNS beyond that. Keep the pass cheap: pool is small; insertion is O(n²) per day.

## 2. Explanations

`finalize()` computes per-unscheduled-place explanations using data already available:
- `no_time`: quantify — "needs ~X min (dwell + avg travel), best day has Y min free slack" (use per-day slackMin from computed plans).
- `window_conflict`: name the constraint — "windows 09:00–12:00 on day 2 but earliest feasible arrival is 12:40" (from a probe insertion), fallback "no opening window fits any day".
- `unreachable`: "no route — check coordinates or add a travel override".

Implementation: a `explainUnscheduled(problem, state, placeId, reason)` helper running one probe insertion per allowed day (cheap at this scale). Domain: `UnscheduledEntry` gains optional `explanation: string` (additive; schema v2 unchanged).

## 3. Force-insert

New `Edit` variant: `{ type: "forceInsert"; placeId: string; dayId: string }`. In `resolve()`: insert at cheapest HARD-feasible position (appointments/windows still enforced), allowing `depart > day.end` (soft budget). `computeTimes`/`finalize` must not treat over-budget as infeasible for force-inserted days; instead the DayPlan gets negative/zero `slackMin` and the UI flags it. Persist the intent: the place stays scheduled on re-solves because… simplest correct approach: force-insert marks the day `pinnedOrder` to include the place? No — too invasive. Instead: add `Place.forceDayId?: Id` (additive optional field, no migration) that the repair pass honours like a soft appointment-day (allowed-day filter + relaxes day budget for it). This survives re-solves naturally and appears in exports.

## 4. Tray UX (Timeline.tsx)

Each unscheduled row: name, priority badge, reason badge, explanation text, and actions: day-select + "Force" button, "Raise to must" button. Store actions: `forceInsert(placeId, dayId)` (sets forceDayId + resolve with forceInsert edit), `raisePriority(placeId)` (mutateTrip priority=1, full re-solve). Over-budget day header shows "⚠ over by N min".

## Tests

- solve: must never dropped while nice scheduled on a feasible day (constructed scenario).
- explain: one explanation per reason (deterministic strings asserted loosely — non-empty, contains key number).
- resolve: forceInsert schedules over budget (slackMin ≤ 0); hard window still blocks.
- Fixtures unchanged (nothing gets force/pool changes in samples) — verify green.

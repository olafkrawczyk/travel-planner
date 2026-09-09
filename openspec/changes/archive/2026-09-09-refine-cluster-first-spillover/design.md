## Context

See `proposal.md` for the motivation regarding the diagnostic bug and the opportunity for controlled region spillover. The existing `classifyUnscheduled` function runs probes (`fitsIgnoringWindow`) on all allowed days for unscheduled places. However, it tests time constraints exclusively and completely ignores `clusterFirst` region boundaries (`regionCompatible` in `alns.ts`). Because of this, it mistakenly concludes that if a place fits physically into an empty day (which was intentionally left empty to preserve region coherence), the reason it wasn't scheduled *must* be an opening hours conflict. Additionally, ALNS region protection currently blocks all lower-priority places from mixing, which is sound but leaves under-booked days completely wasted when lower-priority places could have been successfully packed into them.

## Goals / Non-Goals

**Goals:**
- Fix `classifyUnscheduled` to recognize when a place is blocked by `clusterFirst` region boundaries, resulting in a correct `no_time` (or region mismatch) diagnostic.
- Introduce a mechanism in ALNS insertion operators to conditionally relax `regionCompatible` for low-priority places on under-utilized days.

**Non-Goals:**
- Exposing the under-utilized threshold in the UI (it will remain a solver setting or internal constant).
- Altering the behavior of `routeFirst` strategy.
- Introducing a completely new `region_conflict` reason code for the frontend to render unless absolutely necessary (falling back to `no_time` is acceptable since the day effectively has "no compatible time" for this region).

## Decisions

1. **How to fix the unscheduled diagnostic**
   **Decision**: Update `fitsIgnoringWindow` (or `classifyUnscheduled`) to call `regionCompatible` when checking if a place could fit on a day, just as it checks time constraints.
   **Rationale**: `classifyUnscheduled` relies on answering the question: "if we ignore opening hours/appointments, would it fit?" If region constraints block it, it *still* wouldn't fit, so we shouldn't blame the time window.
   **Alternatives considered**: Introducing a new `UnscheduledReason` like `region_conflict`. Decided against because it would require frontend changes in `UnscheduledTray.tsx` just to say "Doesn't fit in this day's region", which is practically equivalent to `no_time` ("Not enough time in a compatible region"). We'll use `no_time` for simplicity.

2. **How to allow spillover to under-utilized days**
   **Decision**: Modify `insertPlace` or `regionCompatible` in `alns.ts` to accept a candidate if the day's total scheduled time is below a certain threshold (e.g., 65% of its window) and the candidate is a non-priority-1 place.
   **Rationale**: This permits ALNS operators (`recreate`, `relocateDay`, `swapDays`) to place nice/want places on a nearly empty day.
   **Alternatives considered**: Creating a separate "spillover" pass at the end of solving. Decided against because the ALNS loop naturally evaluates the objective cost (travel time) and will insert the place at the most optimal sequence, avoiding naive dumping.

3. **Under-load threshold computation**
   **Decision**: Add a check in `regionCompatible` (or passing the day's current utilization directly) that calculates the ratio of `usedMinutes / (day.end - day.start)`. If it is less than `0.65`, region constraints are bypassed.
   **Rationale**: We already have `computeTimes` running in `alns` which provides `travelMin` + `waitMin` + dwell, but we can approximate utilization just by adding up `dwellMin` plus estimated travel. Better yet, we can check the day's `slackMin` if it's available, but since `regionCompatible` is a quick check, calculating the sum of dwells on the day divided by the day's duration is a fast proxy for utilization.

## Risks / Trade-offs

- [Risk] Spilled-over places might cause massive travel-time penalties on the under-utilized day.
  - Mitigation: The ALNS objective function heavily penalizes travel time. An insertion will only be accepted if the penalty of leaving the place unscheduled (`niceDropped` weight) outweighs the travel time increase.
- [Risk] Approximating utilization just by `dwellMin` might allow spillover even when a day has massive travel times (e.g., a 2-hour drive between 2 places).
  - Mitigation: The ALNS objective evaluation will reject the move if it pushes the day over the budget, so the approximation only acts as a gate to *try* the move, not a guarantee it will be accepted.
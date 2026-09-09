import { formatHHMM, parseHHMM, windowsForDate, type Day, type Place, type UnscheduledReason } from "@app/domain";
import { entryNode, exitNode, regionCompatible, type State } from "./alns";
import type { Problem } from "./matrix";
import { computeTimes } from "./sequence";

/**
 * Day indexes a pool place may be inserted into: the appointment day when one
 * is set, otherwise the forced day, otherwise every unlocked day. Locked days
 * are never touched by insertion, so they are not explainer targets either.
 */
function allowedDays(problem: Problem, place: Place): number[] {
  const forcedId = place.appointment?.dayId ?? place.forceDayId;
  if (forcedId) {
    const d = problem.dayList.findIndex((day) => day.id === forcedId);
    return d >= 0 && !problem.dayList[d]!.locked ? [d] : [];
  }
  const days: number[] = [];
  problem.dayList.forEach((day, d) => {
    if (!day.locked) days.push(d);
  });
  return days;
}

/**
 * Capacity probe for `classifyUnscheduled`: could `place` have been
 * inserted somewhere in `day`'s current order if its opening-hours /
 * appointment-time constraint were set aside? Tries every insertion
 * position, mirroring `insertPlace`/`sequenceDay`'s own insertion loop, so a
 * place that would only fit at the very end of the day isn't missed. The
 * place's own id is stripped from `order` first — defensive against the
 * (rare) case where `order` is the very infeasible order this place already
 * sits in, which would otherwise double it up in the trial.
 *
 * `respectRegions` (clusterFirst only, want/nice priority only — see
 * `classifyUnscheduled`'s call site) additionally requires `place` to pass
 * `regionCompatible` against `dayIdx`'s current occupants before any time
 * probe runs: a day the ALNS operators would never have placed this region
 * onto in the first place was never a real time-fit candidate, so it must
 * not report `window_conflict` just because it happened to have physical
 * room. See design.md Decision 1 in the refine-cluster-first-spillover
 * change.
 *
 * Bounded by `order.length + 1` `computeTimes` calls; only ever invoked per
 * allowed day for one pooled place at a time (see `classifyUnscheduled`),
 * never inside the ALNS hot loop.
 */
function fitsIgnoringWindow(
  problem: Problem,
  state: State,
  dayIdx: number,
  day: Day,
  order: string[],
  place: Place,
  respectRegions: boolean,
): boolean {
  if (respectRegions && !regionCompatible(problem, state, dayIdx, place.id)) return false;
  const base = order.filter((id) => id !== place.id);
  for (let pos = 0; pos <= base.length; pos++) {
    const trial = [...base.slice(0, pos), place.id, ...base.slice(pos)];
    if (computeTimes(problem, day, trial, false, true).feasible) return true;
  }
  return false;
}

/**
 * Real feasibility-based classification of why a pooled place is
 * unscheduled — this is the actual determination, not a guess from the
 * place's static shape. The previous approach (report `window_conflict` for
 * any place with a non-empty opening-hours entry, `no_time` otherwise) was
 * wrong whenever a place had hours *and* was dropped purely because no day
 * had room: it named the wrong cause 100% of the time in that case.
 *
 * Only ever called for the small set of places left in the pool once
 * solving is done (see `finalize` in solve.ts) — never inside the ALNS hot
 * loop or any per-candidate insertion path — so the cost here (bounded by
 * `fitsIgnoringWindow`'s cost per allowed day) is a non-issue: comparable to
 * this one place's share of the repair pass that already ran before this is
 * ever called.
 *
 * For each allowed day, probes whether the place would have fit somewhere
 * in that day's *current* order once its opening-hours/appointment-time
 * constraint is set aside. If some allowed day had the room, hours (or the
 * appointment's fixed time) are the actual blocker: `window_conflict`. If no
 * allowed day had room even with hours ignored, hours were never the issue —
 * there simply was no time anywhere: `no_time`.
 */
export function classifyUnscheduled(problem: Problem, state: State, placeId: string): UnscheduledReason {
  const p = problem.placesById.get(placeId);
  if (!p) return "no_time";
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return "unreachable";
  const clusterFirst = problem.settings?.solverStrategy === "clusterFirst";
  const respectRegions = clusterFirst && p.priority !== 1;
  for (const d of allowedDays(problem, p)) {
    const day = problem.dayList[d]!;
    if (fitsIgnoringWindow(problem, state, d, day, state.days[d] ?? [], p, respectRegions)) return "window_conflict";
  }
  return "no_time";
}

/**
 * Human-readable, quantified explanation of why `placeId` is unscheduled.
 * Uses cheap probes only (per-day time propagation + one matrix lookup per
 * allowed day); deterministic so progress itineraries stay stable.
 */
export function explainUnscheduled(
  problem: Problem,
  state: State,
  placeId: string,
  reason: UnscheduledReason,
): string {
  const p = problem.placesById.get(placeId);
  if (!p) return "This place is no longer part of the trip.";
  if (reason === "unreachable") {
    return "No route — check the place's coordinates or add a travel override.";
  }
  if (reason === "window_conflict") return explainWindowConflict(problem, p);
  return explainNoTime(problem, state, p);
}

/** no_time: quantify the shortfall — needed minutes vs the best day's free slack. */
function explainNoTime(problem: Problem, state: State, p: Place): string {
  let bestFree = Number.NEGATIVE_INFINITY;
  let bestTravel = 0;
  for (const d of allowedDays(problem, p)) {
    const day = problem.dayList[d]!;
    const times = computeTimes(problem, day, state.days[d] ?? []);
    const endMin = times.feasible ? times.endMin : parseHHMM(day.start);
    const free = parseHHMM(day.end) - endMin;
    if (free > bestFree) {
      bestFree = free;
      bestTravel =
        (problem.matrix.minutes(entryNode(problem, d), p.id) +
          problem.matrix.minutes(p.id, exitNode(problem, d))) /
        2;
    }
  }
  if (!Number.isFinite(bestFree)) {
    return `Not enough time on any day — needs ~${p.dwellMin} min plus travel.`;
  }
  const needed = Math.round(p.dwellMin + bestTravel);
  const free = Math.max(0, Math.round(bestFree));
  return `Not enough time on any day — needs ~${needed} min (dwell ${p.dwellMin} + travel), best day has ${free} min free.`;
}

/** window_conflict: name the constraint that blocks the visit. */
function explainWindowConflict(problem: Problem, p: Place): string {
  for (const d of allowedDays(problem, p)) {
    const day = problem.dayList[d]!;
    const arrive = parseHHMM(day.start) + problem.matrix.minutes(entryNode(problem, d), p.id);
    const arriveStr = formatHHMM(Math.round(arrive));
    if (p.appointment) {
      const appt = parseHHMM(p.appointment.start);
      if (arrive > appt) {
        return `Appointment at ${p.appointment.start} on day ${d + 1} cannot be reached — earliest feasible arrival is ${arriveStr}.`;
      }
      return `Appointment at ${p.appointment.start} on day ${d + 1} conflicts with the rest of that day's schedule.`;
    }
    const windows = day.date ? windowsForDate(p, day.date) : undefined;
    if (!windows || windows.length === 0) continue;
    const fits = windows.some((w) => {
      const start = Math.max(arrive, parseHHMM(w.start));
      return start + p.dwellMin <= parseHHMM(w.end);
    });
    if (!fits) {
      const w = windows[0]!;
      return `Opening window ${w.start}–${w.end} on day ${d + 1} but earliest feasible arrival is ${arriveStr}.`;
    }
  }
  return "No opening window fits any day.";
}

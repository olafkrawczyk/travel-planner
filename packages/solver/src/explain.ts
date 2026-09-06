import { formatHHMM, parseHHMM, windowsForDate, type Place, type UnscheduledReason } from "@app/domain";
import { entryNode, exitNode, type State } from "./alns";
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

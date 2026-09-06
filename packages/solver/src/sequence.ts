import type { Leg, Place, Stop, UnscheduledReason } from "@app/domain";
import { formatHHMM, parseHHMM, windowsForDate } from "@app/domain";
import { type Problem, reasonFor } from "./matrix";

export interface SequenceResult {
  /** Feasible, time-ordered place ids that fit in the day. */
  order: string[];
  dropped: { placeId: string; reason: UnscheduledReason }[];
  stops: Stop[];
  legs: Leg[];
  travelMin: number;
  waitMin: number;
  /**
   * Minutes of headroom before the day's soft end (`day.end - endMin`).
   * Signed: negative means the day runs past its soft end (a force-relaxed
   * day, or an infeasible order past a hard constraint) — never clamped to 0.
   * Matches `DayPlan.slackMin` (see `@app/domain` schema.ts) so the two
   * "slack" fields carry one meaning across the solver.
   */
  slackMin: number;
}

export interface DayWindow {
  id: string;
  /** Concrete date (YYYY-MM-DD) — used to look up opening-hour windows. */
  date?: string;
  start: string;
  end: string;
  startLocation: string | "base";
  endLocation: string | "base";
  baseStartId: string;
  baseEndId: string;
  pinnedOrder?: string[];
}

/**
 * Shared hard-constraint check for a single visit — the single source of truth
 * used by `computeTimes`, which every construction and improvement (insertion,
 * Or-opt, 2-opt, ALNS) path routes through. Appointments are the hardest
 * constraint (zero slack); opening-hour windows apply on the appointment's and
 * every other day. When both exist, the appointment start must fall inside a
 * window that also fits the dwell time.
 *
 * Returns the raw arrival time (physical arrival, pushed to the appointment
 * start where the wait is zero-slack), the effective visit start (raw arrival
 * plus any window wait) and the accumulated wait, or null when the visit
 * cannot fit.
 */
export function feasibleVisit(
  place: Place,
  day: { id: string; date?: string },
  earliestArrive: number,
): { rawArrive: number; arrive: number; wait: number } | null {
  let rawArrive = earliestArrive;
  let wait = 0;
  let visitStart = earliestArrive;
  if (place.appointment && place.appointment.dayId !== day.id) return null;
  if (place.appointment) {
    const appt = parseHHMM(place.appointment.start);
    if (earliestArrive > appt) return null;
    rawArrive = appt;
    visitStart = appt;
    wait = appt - earliestArrive;
  }
  const windows = day.date ? windowsForDate(place, day.date) : undefined;
  if (windows && windows.length > 0) {
    if (place.appointment) {
      // Appointment start must fall inside a window that fits the dwell.
      const appt = parseHHMM(place.appointment.start);
      const fits = windows.some((w) => {
        const open = parseHHMM(w.start);
        const close = parseHHMM(w.end);
        return appt >= open && appt + place.dwellMin <= close;
      });
      if (!fits) return null;
    } else {
      // First window the visit (dwell included) still fits inside.
      let matched: { arrive: number; wait: number } | null = null;
      for (const w of windows) {
        const open = parseHHMM(w.start);
        const close = parseHHMM(w.end);
        const start = Math.max(rawArrive, open);
        if (start + place.dwellMin <= close) {
          matched = { arrive: start, wait: start - rawArrive };
          break;
        }
      }
      if (!matched) return null;
      visitStart = matched.arrive;
      wait += matched.wait;
    }
  }
  return { rawArrive, arrive: visitStart, wait };
}

/**
 * Forward time propagation over an order. Appointment windows are hard and
 * only apply on the appointment's own day; an appointment place appearing on
 * any other day makes the order infeasible. Opening-hour windows (per date)
 * are equally hard: early arrivals wait for opening, visits ending after
 * closing make the order infeasible.
 */
export function computeTimes(
  problem: Problem,
  day: DayWindow,
  order: string[],
  relaxBudget = false,
): { feasible: boolean; stops: Stop[]; legs: Leg[]; travelMin: number; waitMin: number; endMin: number } {
  // A day holding a place with `forceDayId === day.id` has its soft time
  // budget relaxed (hard constraints — appointments, opening windows — still
  // apply per visit below); the day may then end after `day.end`.
  const budgetRelaxed =
    relaxBudget || order.some((id) => problem.placesById.get(id)?.forceDayId === day.id);
  const dayStart = parseHHMM(day.start);
  const dayEnd = parseHHMM(day.end);
  const startNode = day.startLocation === "base" ? day.baseStartId : day.startLocation;
  const endNode = day.endLocation === "base" ? day.baseEndId : day.endLocation;

  const stops: Stop[] = [];
  const legs: Leg[] = [];
  let travelMin = 0;
  let waitMin = 0;
  let t = dayStart;
  let prevNode = startNode;

  for (const placeId of order) {
    const place = problem.placesById.get(placeId)!;
    const m = problem.matrix.get(prevNode, placeId);
    const arriveAbs = t + m.minutes;
    travelMin += m.minutes;
    const fit = feasibleVisit(place, day, arriveAbs);
    if (!fit) {
      return { feasible: false, stops: [], legs: [], travelMin, waitMin, endMin: Number.POSITIVE_INFINITY };
    }
    const wait = fit.wait;
    waitMin += wait;
    const depart = fit.arrive + place.dwellMin;
    // Emitted times are rounded to whole minutes (fractional heuristic travel
    // minutes must not leak into the timeline); the internal propagation `t`
    // stays unrounded so feasibility and optimisation are unaffected.
    // `arrive` is the physical arrival (before any window wait) so waits are
    // explicit; the visit itself starts at arrive + wait and ends at depart.
    const arriveRounded = Math.round(fit.rawArrive);
    stops.push({
      placeId,
      arrive: formatHHMM(arriveRounded),
      depart: formatHHMM(Math.round(depart)),
      waitMin: Math.round(wait),
    });
    legs.push({ fromId: prevNode, toId: placeId, minutes: m.minutes, mode: m.mode, source: m.source, explanation: m.explanation });
    t = depart;
    prevNode = placeId;
  }

  if (order.length > 0) {
    const m = problem.matrix.get(prevNode, endNode);
    travelMin += m.minutes;
    legs.push({ fromId: prevNode, toId: endNode, minutes: m.minutes, mode: m.mode, source: m.source, explanation: m.explanation });
    t += m.minutes;
  }

  return {
    feasible: budgetRelaxed || t <= dayEnd,
    stops,
    legs,
    travelMin,
    waitMin,
    endMin: t,
  };
}

/** Cheapest feasible insertion cost of `placeId` at `pos`; null if infeasible. */
function insertionDelta(
  problem: Problem,
  day: DayWindow,
  order: string[],
  placeId: string,
  pos: number,
): number | null {
  const trial = [...order.slice(0, pos), placeId, ...order.slice(pos)];
  const times = computeTimes(problem, day, trial);
  if (!times.feasible) return null;
  return problem.weights.travel * times.travelMin + problem.weights.wait * times.waitMin;
}

/** Relative order of pinned ids inside `order` (for pin-preservation checks). */
function pinnedSignature(order: string[], pinnedSet: Set<string>): string[] {
  return order.filter((id) => pinnedSet.has(id));
}

/**
 * Within-day sequencing: cheapest-feasible insertion with forward time
 * propagation. Insertion order: pinned places (in pinned order, so the pinned
 * relative order is established up front), then appointment places (hardest
 * time windows), then the rest by priority and dwell. Followed by 2-opt /
 * Or-opt improvement that preserves pinned relative order and feasibility.
 */
export function sequenceDay(
  problem: Problem,
  day: DayWindow,
  candidates: string[],
): SequenceResult {
  const pinned = day.pinnedOrder ?? [];
  const pinnedSet = new Set(pinned);
  const candidateSet = new Set(candidates);

  const dropped: { placeId: string; reason: UnscheduledReason }[] = [];

  const pinnedInDay = pinned.filter((id) => candidateSet.has(id));
  const appointmentPlaces = candidates
    .filter((id) => !pinnedSet.has(id) && problem.placesById.get(id)?.appointment)
    .sort((a, b) =>
      parseHHMM(problem.placesById.get(a)!.appointment!.start) -
      parseHHMM(problem.placesById.get(b)!.appointment!.start),
    );
  const rest = candidates
    .filter((id) => !pinnedSet.has(id) && !problem.placesById.get(id)?.appointment)
    .sort((a, b) => {
      const pa = problem.placesById.get(a)!;
      const pb = problem.placesById.get(b)!;
      if (pa.priority !== pb.priority) return pa.priority - pb.priority;
      return pb.dwellMin - pa.dwellMin;
    });

  let order: string[] = [];
  let lastPinnedIdx = -1;

  const tryInsert = (placeId: string, minPosInclusive: number): boolean => {
    const place = problem.placesById.get(placeId);
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
      dropped.push({ placeId, reason: "unreachable" });
      return false;
    }
    let bestPos = -1;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let pos = Math.max(0, minPosInclusive); pos <= order.length; pos++) {
      const cost = insertionDelta(problem, day, order, placeId, pos);
      // On ties prefer the later position (stable append semantics).
      if (cost !== null && cost <= bestCost) {
        bestCost = cost;
        bestPos = pos;
      }
    }
    if (bestPos < 0) {
      dropped.push({ placeId, reason: reasonFor(place) });
      return false;
    }
    order = [...order.slice(0, bestPos), placeId, ...order.slice(bestPos)];
    return true;
  };

  // 1. Pinned places in their pinned order (each after the previous pinned one).
  for (const id of pinnedInDay) {
    tryInsert(id, lastPinnedIdx + 1);
    const idx = order.indexOf(id);
    if (idx >= 0) lastPinnedIdx = idx;
  }
  // 2. Non-pinned appointment places (hard windows) — may slot between pins;
  //    that does not change the pinned relative order.
  for (const id of appointmentPlaces) {
    tryInsert(id, 0);
  }
  // 3. Everything else, most constrained first.
  for (const id of rest) {
    tryInsert(id, 0);
  }

  // Improvement: Or-opt (relocate 1-3 place segments) + 2-opt (reverse),
  // accepted only when feasible, pin-preserving and cheaper.
  const baseTimes = computeTimes(problem, day, order);
  let bestCost = problem.weights.travel * baseTimes.travelMin + problem.weights.wait * baseTimes.waitMin;

  let improved = true;
  let guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    for (let i = 0; i < order.length; i++) {
      for (let len = 1; len <= 3 && i + len <= order.length; len++) {
        const seg = order.slice(i, i + len);
        const without = [...order.slice(0, i), ...order.slice(i + len)];
        for (let pos = 0; pos <= without.length; pos++) {
          if (pos === i || pos === i + len) continue; // identical reinsertion position
          const trial = [...without.slice(0, pos), ...seg, ...without.slice(pos)];
          if (pinnedSignature(trial, pinnedSet).join("|") !== pinnedSignature(order, pinnedSet).join("|")) continue;
          const times = computeTimes(problem, day, trial);
          if (!times.feasible) continue;
          const cost = problem.weights.travel * times.travelMin + problem.weights.wait * times.waitMin;
          if (cost < bestCost - 1e-9) {
            bestCost = cost;
            order = trial;
            improved = true;
          }
        }
      }
    }
    // 2-opt: reverse a segment.
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const trial = [
          ...order.slice(0, i),
          ...order.slice(i, j + 1).reverse(),
          ...order.slice(j + 1),
        ];
        if (pinnedSignature(trial, pinnedSet).join("|") !== pinnedSignature(order, pinnedSet).join("|")) continue;
        const times = computeTimes(problem, day, trial);
        if (!times.feasible) continue;
        const cost = problem.weights.travel * times.travelMin + problem.weights.wait * times.waitMin;
        if (cost < bestCost - 1e-9) {
          bestCost = cost;
          order = trial;
          improved = true;
        }
      }
    }
  }

  const times = computeTimes(problem, day, order);
  const dayEnd = parseHHMM(day.end);
  return {
    order,
    dropped,
    stops: times.stops,
    legs: times.legs,
    travelMin: times.travelMin,
    waitMin: times.waitMin,
    // Signed — see the field doc above. Not clamped to 0: a negative value
    // means the day (e.g. force-relaxed) runs past its soft end.
    slackMin: Number.isFinite(times.endMin) ? Math.round(dayEnd - times.endMin) : 0,
  };
}

/** Places actually used in a day plan (ordered). */
export function orderOf(stops: Stop[]): string[] {
  return stops.map((s) => s.placeId);
}

export type { Place };

import {
  type DayPlan,
  type Itinerary,
  type Leg,
  type Stop,
  type Trip,
  type UnscheduledReason,
  parseHHMM,
} from "@app/domain";
import { alns, evaluate, insertPlace, type State } from "./alns";
import { classifyUnscheduled, explainUnscheduled } from "./explain";
import { clusterFirstSequence } from "./cluster";
import { giantTour } from "./giantTour";
import { buildProblem, type Problem } from "./matrix";
import { split } from "./split";
import { computeTimes, sequenceDay, type DayWindow } from "./sequence";
import { validateTripInput } from "./validate";

export interface SolveOptions {
  trip: Trip;
  /** Seed for the deterministic RNG. */
  seed?: number;
  /** ALNS wall-clock budget in ms (upper bound). */
  budgetMs?: number;
  /** ALNS iteration cap (determinism bound). Default 1000. */
  maxIterations?: number;
  /**
   * Optional prefetched routing-API (OSRM) duration matrix in MINUTES, indexed
   * in `buildProblem`'s node order (places first, then non-place base ids).
   * Pure data — fetched on the main thread; the solver never touches the
   * network. Precedence: override > api > heuristic (api entries are also
   * guarded for plausibility — see `resolveApiOrHeuristic` in matrix.ts).
   */
  apiDurations?: number[][];
  /**
   * The OSRM routing profile that actually produced `apiDurations` (e.g.
   * "foot"). Defaults to `DEFAULT_OSRM_PROFILE` ("foot") — the only profile
   * this app currently requests — and is used to honestly derive each api
   * entry's `mode`/explanation rather than asserting "walk" unconditionally.
   */
  apiProfile?: string;
  onProgress?: (itinerary: Itinerary) => void;
}

/**
 * Number of candidate seam edges tried when opening `giantTour`'s closed
 * cycle into the linear order `split` cuts into day segments — see
 * `bestRotationSplit`'s doc for why a small constant beats the O(N)
 * exhaustive rotation search this replaced.
 */
const ROTATION_CANDIDATES = 8;

/**
 * Pick the best way to linearize `tour` (a closed-cycle giant tour over
 * schedulable places only, no bases) for `split`'s day-segment DP, without
 * the O(N) exhaustive rotation search this replaces (that search, combined
 * with `split`'s own O(D·N²) DP, cost O(D·N³) — the dominant cost of a full
 * solve; see the perf-defect writeup this fixes).
 *
 * Why rotation matters at all: `split` treats its input as a plain linear
 * array and can only cut between two elements that are *consecutive in that
 * array* — it never considers the wraparound pair (tour[N-1], tour[0]) as a
 * candidate boundary, because after linearizing they are the two ends of the
 * array, not neighbours. So whichever cyclic edge of the tour happens to sit
 * at the rotation's seam is the ONE edge from the closed tour that is never
 * paid for and never replaced by a base detour — every other edge is either
 * kept (paid at its real travel cost) or cut (replaced by two base-return
 * legs) by the DP. Removing the tour's most expensive edge for free is
 * therefore the single best lever rotation gives the DP, which is exactly
 * what the old exhaustive search was (expensively) discovering by trial:
 * for N rotations it re-ran the full O(D·N²) DP just to find that the best
 * rotation is overwhelmingly the one that opens the cycle at its longest
 * edge (or very near it — ties and near-ties are common enough that a
 * single candidate risks picking a worse one by a hair).
 *
 * So instead of every rotation, this tries only the `ROTATION_CANDIDATES`
 * rotations that open the cycle at its longest edges (O(N log N) to rank all
 * N edges), each in both directions (`split` is not order-symmetric because
 * of appointments/opening windows) — a constant number of O(D·N²) DP calls,
 * making the whole selection O(N log N + D·N²) instead of O(D·N³). Verified
 * against the Tokyo/Warsaw fixtures to match or beat the old exhaustive
 * search's chosen split cost (see tokyo.test.ts/warsaw.test.ts).
 */
function bestRotationSplit(problem: Problem, tour: string[]): string[][] {
  const n = tour.length;
  if (n <= 1) return [tour];

  const edgeCost = (i: number): number => problem.matrix.minutes(tour[i]!, tour[(i + 1) % n]!);
  const byEdgeCostDesc = Array.from({ length: n }, (_, i) => i).sort((a, b) => edgeCost(b) - edgeCost(a));
  const cutStarts: number[] = [];
  for (const i of byEdgeCostDesc) {
    if (cutStarts.length >= Math.min(ROTATION_CANDIDATES, n)) break;
    cutStarts.push((i + 1) % n);
  }

  let bestSplitCost = Number.POSITIVE_INFINITY;
  let bestSegments: string[][] = [];
  for (const i of cutStarts) {
    const rotated = i === 0 ? tour : [...tour.slice(i), ...tour.slice(0, i)];
    const fwd = split(problem, rotated);
    if (fwd.cost < bestSplitCost) {
      bestSplitCost = fwd.cost;
      bestSegments = fwd.segments;
    }
    const rev = split(problem, [...rotated].reverse());
    if (rev.cost < bestSplitCost) {
      bestSplitCost = rev.cost;
      bestSegments = rev.segments;
    }
  }
  return bestSegments;
}

/**
 * Full solve: heuristic matrix → giant tour → Prins split → per-day
 * sequencing → ALNS improvement. Emits the initial feasible itinerary via
 * onProgress before improving it (anytime behaviour).
 */
export function solve(opts: SolveOptions): Itinerary {
  validateTripInput(opts.trip);
  const problem = buildProblem(opts.trip, opts.apiDurations, opts.apiProfile);
  let segments: string[][] = [];
  if (problem.settings.solverStrategy === "clusterFirst") {
    segments = clusterFirstSequence(problem);
  } else {
    const tour = giantTour(problem);
    segments = bestRotationSplit(problem, tour);
  }

  const state: State = { days: [], pool: [] };
  for (let d = 0; d < problem.dayList.length; d++) {
    const day = problem.dayList[d]!;
    // A place forced onto another day (Place.forceDayId) must not be
    // constructed here — it belongs to the pool until the repair pass
    // inserts it on its forced day.
    const segment: string[] = [];
    for (const id of segments[d] ?? []) {
      const p = problem.placesById.get(id);
      if (p?.forceDayId && p.forceDayId !== day.id) state.pool.push(id);
      else segment.push(id);
    }
    const res = sequenceDay(problem, day, segment);
    state.days.push(res.order);
    for (const drop of res.dropped) state.pool.push(drop.placeId);
  }
  // Anything not scheduled in `state` goes to the pool.
  const scheduled = new Set(state.days.flat());
  for (const p of problem.places) {
    if (!scheduled.has(p.id) && !state.pool.includes(p.id)) state.pool.push(p.id);
  }

  if (opts.onProgress) opts.onProgress(finalize(problem, state, undefined));

  const { best } = alns(problem, state, {
    seed: opts.seed ?? 42,
    budgetMs: opts.budgetMs,
    maxIterations: opts.maxIterations,
    onProgress: opts.onProgress ? (s) => opts.onProgress!(finalize(problem, s, undefined)) : undefined,
  });
  repairPass(problem, best);
  return finalize(problem, best, undefined);
}

/**
 * Final priority-ordered repair pass (runs after ALNS in `solve` and
 * `resolve`): try a strict-feasible insertion for every pooled place, most
 * important first (must before want before nice, larger dwell first). This
 * guarantees no must-visit stays dropped while it would fit, strictly
 * feasible, on an allowed day that also holds lower-priority places.
 *
 * Places with `Place.forceDayId` are treated like a soft appointment: only
 * their forced day is tried, and that day's time budget is relaxed (hard
 * constraints still apply).
 *
 * When `dayIdxs` is given (incremental resolve), only those days are tried —
 * untouched days stay verbatim.
 *
 * clusterFirst region protection (see `alns.ts`'s `regionCompatible`) is
 * bypassed here ONLY for must-priority places: the itinerary-solver spec
 * guarantees a must-priority place is unscheduled only when no feasible slot
 * exists anywhere, and region coherence is a quality preference that must
 * yield to that correctness guarantee. A want/nice-priority place has no
 * such guarantee — for those, this pass still respects region compatibility,
 * so a leftover low-priority place from one district is not dumped onto an
 * unrelated day's district just because it happens to fit in time; it stays
 * pooled (reported unscheduled) instead, same as it would if no day had
 * physical room for it.
 */
export function repairPass(problem: Problem, state: State, dayIdxs?: Set<number>): void {
  const clusterFirst = problem.settings?.solverStrategy === "clusterFirst";
  const sorted = state.pool
    .filter((id) => problem.placesById.has(id))
    .sort((a, b) => {
      const pa = problem.placesById.get(a)!;
      const pb = problem.placesById.get(b)!;
      if (pa.priority !== pb.priority) return pa.priority - pb.priority;
      return pb.dwellMin - pa.dwellMin;
    });
  const remaining: string[] = [];
  for (const id of sorted) {
    const p = problem.placesById.get(id)!;
    const respectRegions = clusterFirst && p.priority !== 1;
    let inserted = false;
    for (let d = 0; d < problem.dayList.length; d++) {
      const day = problem.dayList[d]!;
      if (day.locked) continue;
      if (dayIdxs && !dayIdxs.has(d)) continue;
      if (p.appointment && p.appointment.dayId !== day.id) continue;
      if (p.forceDayId && p.forceDayId !== day.id) continue;
      if (insertPlace(problem, state, d, id, false, respectRegions)) {
        inserted = true;
        break;
      }
    }
    if (!inserted) remaining.push(id);
  }
  state.pool = remaining;
}

export type Edit =
  | { type: "movePlace"; placeId: string }
  | { type: "dwellChange"; placeId: string }
  | { type: "dragToDay"; placeId: string; dayId: string }
  | { type: "forceInsert"; placeId: string; dayId: string }
  | { type: "full" };

export interface ResolveOptions extends Omit<SolveOptions, "trip"> {
  trip: Trip;
  /** The itinerary before the edit (used as the starting state). */
  previous: Itinerary;
  edit: Edit;
}

/**
 * Incremental re-solve: only affected (non-locked) days are re-optimized;
 * locked days keep their previous stops, order and times verbatim.
 * Drags involving locked days are no-ops.
 */
export function resolve(opts: ResolveOptions): Itinerary {
  const { trip, previous, edit } = opts;
  validateTripInput(trip);
  const problem = buildProblem(trip, opts.apiDurations, opts.apiProfile);

  // Reconstruct state from the previous itinerary.
  const prevByDay = new Map(previous.days.map((d) => [d.dayId, d]));
  const state: State = { days: [], pool: [] };
  const dayIdxOfPlace = new Map<string, number>();
  trip.days.forEach((day, i) => {
    const plan = prevByDay.get(day.id);
    const order = (plan?.stops ?? [])
      .map((s) => s.placeId)
      .filter((id) => {
        const p = problem.placesById.get(id);
        if (!p || problem.baseIdSet.has(id)) return false;
        // A place with an appointment or a force-day for another day cannot
        // stay on this day.
        return !(
          (p.appointment && p.appointment.dayId !== day.id) ||
          (p.forceDayId && p.forceDayId !== day.id)
        );
      });
    state.days.push(order);
    for (const id of order) dayIdxOfPlace.set(id, i);
  });
  const scheduledSet = new Set(dayIdxOfPlace.keys());
  for (const u of previous.unscheduled) {
    if (problem.placesById.has(u.placeId) && !scheduledSet.has(u.placeId) && !state.pool.includes(u.placeId)) {
      state.pool.push(u.placeId);
    }
  }
  for (const p of problem.places) {
    if (!scheduledSet.has(p.id) && !state.pool.includes(p.id)) state.pool.push(p.id);
  }

  // Matrix row/column refresh for the touched place (incremental update path).
  if (edit.type === "movePlace" || edit.type === "dwellChange") {
    problem.matrix.updateNode(edit.placeId);
  }

  // Determine affected days per edit type.
  const activeDays = new Set<number>();
  const unlocked = (i: number) => !trip.days[i]!.locked;

  if (edit.type === "full") {
    trip.days.forEach((_, i) => {
      if (unlocked(i)) activeDays.add(i);
    });
  } else if (edit.type === "dragToDay") {
    const targetIdx = trip.days.findIndex((d) => d.id === edit.dayId);
    const sourceIdx = dayIdxOfPlace.get(edit.placeId);
    const inPool = sourceIdx === undefined && state.pool.includes(edit.placeId);
    const sourceOk = sourceIdx === undefined ? inPool : unlocked(sourceIdx);
    if (targetIdx >= 0 && unlocked(targetIdx) && sourceOk) {
      if (sourceIdx !== undefined) {
        state.days[sourceIdx] = state.days[sourceIdx]!.filter((id) => id !== edit.placeId);
        activeDays.add(sourceIdx);
      } else {
        state.pool = state.pool.filter((id) => id !== edit.placeId);
      }
      state.days[targetIdx] = [...(state.days[targetIdx] ?? []), edit.placeId];
      activeDays.add(targetIdx);
    }
    // Locked day involved (or unknown day): no-op — locked days stay untouched.
  } else if (edit.type === "forceInsert") {
    // Best-effort forced insertion: cheapest HARD-feasible position on the
    // target day, relaxing that day's soft time budget (appointments and
    // opening windows still block). If nothing hard-feasible exists, the
    // place stays unscheduled.
    const targetIdx = trip.days.findIndex((d) => d.id === edit.dayId);
    const p = problem.placesById.get(edit.placeId);
    if (targetIdx >= 0 && p && unlocked(targetIdx) && !(p.appointment && p.appointment.dayId !== edit.dayId)) {
      state.days[targetIdx] = (state.days[targetIdx] ?? []).filter((id) => id !== edit.placeId);
      state.pool = state.pool.filter((id) => id !== edit.placeId);
      if (!insertPlace(problem, state, targetIdx, edit.placeId, true)) {
        state.pool.push(edit.placeId);
      }
      activeDays.add(targetIdx);
    }
    // Unknown day or locked target: no-op.
  } else {
    // movePlace / dwellChange: only the day currently holding the place.
    const sourceIdx = dayIdxOfPlace.get(edit.placeId);
    if (sourceIdx !== undefined && unlocked(sourceIdx)) activeDays.add(sourceIdx);
  }

  // Re-sequence affected days (starting from their current order).
  for (const d of activeDays) {
    const res = sequenceDay(problem, problem.dayList[d]!, state.days[d] ?? []);
    state.days[d] = res.order;
    for (const drop of res.dropped) {
      if (!state.pool.includes(drop.placeId)) state.pool.push(drop.placeId);
    }
  }
  // Remove now-scheduled places from the pool.
  const sched2 = new Set(state.days.flat());
  state.pool = state.pool.filter((id) => !sched2.has(id));

  const { best } = alns(problem, state, {
    seed: opts.seed ?? 42,
    budgetMs: opts.budgetMs ?? 100,
    maxIterations: opts.maxIterations ?? 300,
    activeDays,
    // A drag is an explicit user placement: the dragged place must stay on the
    // target day through ruin/recreate.
    pinnedToDay: edit.type === "dragToDay" ? new Map([[edit.placeId, trip.days.findIndex((d) => d.id === edit.dayId)]]) : undefined,
    onProgress: opts.onProgress
      ? (s) => opts.onProgress!(finalize(problem, s, previous))
      : undefined,
  });
  repairPass(problem, best, activeDays);
  return finalize(problem, best, previous);
}

/**
 * Build the final Itinerary from a State. Locked days are copied verbatim
 * from `previous` (when available); every other day's stops/legs are computed
 * by forward time propagation over its order — no re-optimization here, so
 * progress callbacks stay cheap.
 */
export function finalize(problem: Problem, state: State, previous: Itinerary | undefined): Itinerary {
  const prevByDay = new Map<string, DayPlan>(previous?.days.map((d) => [d.dayId, d]) ?? []);
  const unscheduled: { placeId: string; reason: UnscheduledReason; explanation: string }[] = [];
  let totalTravel = 0;
  let totalWait = 0;

  const days: DayPlan[] = problem.dayList.map((day, d) => {
    if (day.locked && prevByDay.has(day.id)) {
      const prev = prevByDay.get(day.id)!;
      totalTravel += prev.legs.reduce((acc, l) => acc + l.minutes, 0);
      totalWait += prev.stops.reduce((acc, s) => acc + s.waitMin, 0);
      return prev;
    }
    const order = state.days[d] ?? [];
    const times = computeTimes(problem, day as DayWindow, order);
    totalTravel += times.travelMin;
    totalWait += times.waitMin;
    if (order.length > 0 && times.stops.length === 0) {
      // Infeasible order (e.g. stale wrong-day appointment): report as unscheduled.
      for (const id of order) {
        const reason = classifyUnscheduled(problem, state, id);
        unscheduled.push({ placeId: id, reason, explanation: explainUnscheduled(problem, state, id, reason) });
      }
    }
    return {
      dayId: day.id,
      stops: times.stops,
      legs: times.legs,
      // Negative slack marks a day forced past its soft end time (the UI
      // flags it); feasible days always have slack ≥ 0.
      slackMin: Number.isFinite(times.endMin) ? Math.round(parseHHMM(day.end) - times.endMin) : 0,
    };
  });

  for (const id of state.pool) {
    if (!problem.placesById.has(id)) continue;
    const reason = classifyUnscheduled(problem, state, id);
    unscheduled.push({ placeId: id, reason, explanation: explainUnscheduled(problem, state, id, reason) });
  }

  const evalResult = evaluate(problem, state);
  return {
    days,
    unscheduled,
    stats: {
      totalTravelMin: round(totalTravel),
      totalWaitMin: round(totalWait),
      score: round(evalResult.objective),
    },
  };
}

function round(x: number): number {
  return Math.round(x * 10) / 10;
}

export type { Stop, Leg };

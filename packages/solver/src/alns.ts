import type { UnscheduledReason } from "@app/domain";
import { parseHHMM } from "@app/domain";
import { mulberry32, pick, randInt, shuffle, type Rng } from "./rng";
import { type Problem, reasonFor } from "./matrix";
import { computeTimes, sequenceDay } from "./sequence";

/** Solver state: ordered place ids per day index, plus the unscheduled pool. */
export interface State {
  days: string[][];
  pool: string[];
}

export interface Evaluation {
  objective: number;
  travelMin: number;
  waitMin: number;
  mustDropped: number;
  niceDropped: number;
  /**
   * Total absolute deviation of per-day utilisation from the trip's mean
   * utilisation, scaled to minutes by the mean day-window length — see
   * `dayUtilisation` below. This is the term `w.dayImbalance` weights in the
   * objective.
   */
  imbalance: number;
  /**
   * Diagnostic only (not weighted into the objective): the raw max-min
   * spread of per-day utilisation, 0..1+. Useful for reporting "how uneven is
   * this trip" without the smoothing `imbalance` applies.
   */
  utilisationSpread: number;
  /** Total minutes days run past their soft end (force-relaxed days excluded). */
  overBudgetMin: number;
}

const BIG_PENALTY = 1e9;

/**
 * A day's committed-time utilisation: the fraction of its start-to-end
 * window actually consumed by travel + dwell + wait (`endMin - dayStart`
 * over `dayEnd - dayStart`). Working in utilisation rather than raw minutes
 * makes days with different `start`/`end` windows comparable — a day with a
 * short window that is completely full is exactly as "loaded" as a long
 * window that is completely full, whereas a raw-minutes comparison would
 * call the long day emptier. Force-relaxed / over-budget days can push this
 * above 1; that is intentional (see `mostLoadedDay`). Returns `null` for a
 * hard-infeasible order (`endMin` is `+Infinity`) so callers can exclude it
 * instead of propagating `Infinity`/`NaN` into the objective — infeasible
 * days are already charged `BIG_PENALTY` in `evaluate`.
 */
function utilisationOf(dayStart: number, dayEnd: number, endMin: number): number {
  const windowMin = Math.max(1, dayEnd - dayStart);
  return (endMin - dayStart) / windowMin;
}

function dayUtilisation(problem: Problem, dayIdx: number, order: string[]): number | null {
  const day = problem.dayList[dayIdx]!;
  const times = computeTimes(problem, day, order);
  if (!Number.isFinite(times.endMin)) return null;
  return utilisationOf(parseHHMM(day.start), parseHHMM(day.end), times.endMin);
}

export function evaluate(problem: Problem, state: State): Evaluation {
  let travelMin = 0;
  let waitMin = 0;
  let infeasibleDays = 0;
  let overBudgetMin = 0;
  // Locked days are included here (they are part of the trip the user sees)
  // even though the balance *operators* below (`mostLoadedDay`,
  // `candidateRecipient`) skip them entirely — see those functions' docs.
  const dayStats: { util: number; window: number }[] = new Array(problem.dayList.length);
  for (let d = 0; d < problem.dayList.length; d++) {
    const day = problem.dayList[d]!;
    const order = state.days[d] ?? [];
    const times = computeTimes(problem, day, order);
    travelMin += times.travelMin;
    waitMin += times.waitMin;
    if (!times.feasible) infeasibleDays++;
    // Force-relaxed days opted into ending past `day.end` — exempt from the
    // over-budget penalty (same detection as `computeTimes`).
    const forceRelaxed = order.some((id) => problem.placesById.get(id)?.forceDayId === day.id);
    if (!forceRelaxed && Number.isFinite(times.endMin)) {
      overBudgetMin += Math.max(0, times.endMin - parseHHMM(day.end));
    }
    // An infeasible day's endMin is +Infinity (sequence.ts); excluding it here
    // keeps the imbalance term finite so BIG_PENALTY alone (below) grades
    // infeasibility — one infinite endMin must not make every infeasible
    // state compare equal, nor poison the objective into Infinity/NaN (which
    // would silently disable simulated annealing in `alns` below).
    if (Number.isFinite(times.endMin)) {
      const dayStart = parseHHMM(day.start);
      const dayEnd = parseHHMM(day.end);
      dayStats[d] = {
        util: utilisationOf(dayStart, dayEnd, times.endMin),
        window: Math.max(1, dayEnd - dayStart),
      };
    }
  }
  let mustDropped = 0;
  let niceDropped = 0;
  for (const id of state.pool) {
    const p = problem.placesById.get(id);
    if (!p) continue;
    if (p.priority === 1) mustDropped++;
    else niceDropped++;
  }
  let imbalance = 0;
  let utilisationSpread = 0;
  for (const group of problem.stayGroups) {
    const groupStats = group.map((d) => dayStats[d]).filter((s) => s !== undefined) as { util: number; window: number }[];
    if (groupStats.length > 1) {
      const mean = groupStats.reduce((a, s) => a + s.util, 0) / groupStats.length;
      // Total (not mean) absolute deviation, scaled to minutes by the mean
      // window length.
      const totalAbsDev = groupStats.reduce((a, s) => a + Math.abs(s.util - mean), 0);
      const meanWindow = groupStats.reduce((a, s) => a + s.window, 0) / groupStats.length;
      imbalance += totalAbsDev * meanWindow;
      const groupSpread = Math.max(...groupStats.map((s) => s.util)) - Math.min(...groupStats.map((s) => s.util));
      utilisationSpread = Math.max(utilisationSpread, groupSpread);
    }
  }
  
  let regionMixing = 0;
  for (let d = 0; d < problem.dayList.length; d++) {
    const stops = state.days[d]!;
    if (stops.length === 0) continue;
    
    const regionCounts = new Map<string, number>();
    let placesWithRegion = 0;
    
    for (const id of stops) {
      const p = problem.placesById.get(id);
      if (p && p.region) {
        regionCounts.set(p.region, (regionCounts.get(p.region) ?? 0) + 1);
        placesWithRegion++;
      }
    }
    
    if (regionCounts.size > 1) {
      let maxCount = 0;
      for (const count of regionCounts.values()) {
        if (count > maxCount) maxCount = count;
      }
      regionMixing += (placesWithRegion - maxCount);
    }
  }

  const w = problem.settings?.solverStrategy === "clusterFirst" 
    ? { ...problem.weights, dayImbalance: 0 } // In clusterFirst, regions naturally dictate imbalance
    : problem.weights;

  const objective =
    w.travel * travelMin +
    w.wait * waitMin +
    w.mustDropped * mustDropped +
    w.niceDropped * niceDropped +
    w.dayImbalance * imbalance +
    w.overBudget * overBudgetMin +
    infeasibleDays * BIG_PENALTY +
    regionMixing * BIG_PENALTY;
  
  return {
    objective,
    travelMin,
    waitMin,
    mustDropped,
    niceDropped,
    imbalance,
    utilisationSpread,
    overBudgetMin,
  };
}

export function cloneState(s: State): State {
  return { days: s.days.map((d) => [...d]), pool: [...s.pool] };
}

/**
 * Remove `q` places from active, unlocked days using the chosen strategy.
 * Places in `pinnedToDay` are never removed. Returns the removed place ids
 * (day lists modified in place).
 */
function ruin(
  problem: Problem,
  state: State,
  rng: Rng,
  activeDays: number[],
  pinnedToDay?: Map<string, number>,
): string[] {
  const scheduled: { dayIdx: number; pos: number; id: string }[] = [];
  for (const d of activeDays) {
    const list = state.days[d] ?? [];
    for (let pos = 0; pos < list.length; pos++) {
      scheduled.push({ dayIdx: d, pos, id: list[pos]! });
    }
  }
  if (scheduled.length === 0) return [];

  const q = Math.max(1, Math.round(scheduled.length * (0.1 + rng() * 0.1)));
  const removed: string[] = [];

  const keepPinned = (victims: Set<string>): void => {
    if (pinnedToDay) for (const id of pinnedToDay.keys()) victims.delete(id);
  };

  const strategy = randInt(rng, 3);
  if (strategy === 0) {
    // Random ruin
    const shuffled = shuffle(rng, scheduled.map((s) => s.id));
    const victims = new Set(shuffled.slice(0, q));
    keepPinned(victims);
    for (const d of activeDays) {
      const before = state.days[d] ?? [];
      const kept = before.filter((id) => !victims.has(id));
      removed.push(...(before.filter((id) => victims.has(id))));
      state.days[d] = kept;
    }
  } else if (strategy === 1) {
    // Geographic ruin: a random place plus its nearest neighbours.
    const seedEntry = pick(rng, scheduled);
    const distances = scheduled
      .map((s) => ({
        ...s,
        dist: problem.matrix.minutes(seedEntry.id, s.id),
      }))
      .sort((a, b) => a.dist - b.dist);
    const victims = new Set(distances.slice(0, q).map((s) => s.id));
    keepPinned(victims);
    for (const d of activeDays) {
      const before = state.days[d] ?? [];
      removed.push(...(before.filter((id) => victims.has(id))));
      state.days[d] = before.filter((id) => !victims.has(id));
    }
  } else {
    // Worst-detour ruin: places whose removal saves the most travel.
    const scored = scheduled
      .map((s) => {
        const list = state.days[s.dayIdx]!;
        const prev = s.pos > 0 ? list[s.pos - 1]! : entryNode(problem, s.dayIdx);
        const next = s.pos < list.length - 1 ? list[s.pos + 1]! : exitNode(problem, s.dayIdx);
        const withIt =
          problem.matrix.minutes(prev, s.id) + problem.matrix.minutes(s.id, next);
        const withoutIt = problem.matrix.minutes(prev, next);
        return { ...s, saving: withIt - withoutIt };
      })
      .sort((a, b) => b.saving - a.saving);
    const victims = new Set(scored.slice(0, q).map((s) => s.id));
    keepPinned(victims);
    for (const d of activeDays) {
      const before = state.days[d] ?? [];
      removed.push(...(before.filter((id) => victims.has(id))));
      state.days[d] = before.filter((id) => !victims.has(id));
    }
  }
  return removed;
}

export function entryNode(problem: Problem, dayIdx: number): string {
  const day = problem.dayList[dayIdx]!;
  return day.startLocation === "base" ? day.baseStartId : day.startLocation;
}

export function exitNode(problem: Problem, dayIdx: number): string {
  const day = problem.dayList[dayIdx]!;
  return day.endLocation === "base" ? day.baseEndId : day.endLocation;
}

/** Cheapest-feasible insertion of `placeId` across the given days; mutates state. */
export function insertPlace(
  problem: Problem,
  state: State,
  dayIdx: number,
  placeId: string,
  relaxBudget = false,
): boolean {
  const list = state.days[dayIdx] ?? [];
  const day = problem.dayList[dayIdx]!;
  let bestPos = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let pos = 0; pos <= list.length; pos++) {
    const trial = [...list.slice(0, pos), placeId, ...list.slice(pos)];
    const times = computeTimes(problem, day, trial, relaxBudget);
    if (!times.feasible) continue;
    const cost = times.travelMin + problem.weights.wait * times.waitMin;
    if (cost < bestCost) {
      bestCost = cost;
      bestPos = pos;
    }
  }
  if (bestPos < 0) return false;
  state.days[dayIdx] = [...list.slice(0, bestPos), placeId, ...list.slice(bestPos)];
  return true;
}

/**
 * Overrun minutes past the day's soft end for the given order — 0 for
 * force-relaxed days (they opted in) and for hard-infeasible orders (already
 * charged `BIG_PENALTY`).
 */
export function overMinutes(problem: Problem, dayIdx: number, order: string[]): number {
  const day = problem.dayList[dayIdx]!;
  if (order.some((id) => problem.placesById.get(id)?.forceDayId === day.id)) return 0;
  const times = computeTimes(problem, day, order);
  if (!Number.isFinite(times.endMin)) return 0;
  return Math.max(0, times.endMin - parseHHMM(day.end));
}

/**
 * A place that must never be relocated by the balance operators: pinned
 * (day.pinnedOrder), appointment-bound, force-inserted, or explicitly pinned
 * to its day through a drag (`pinnedToDay`).
 */
function isProtected(
  problem: Problem,
  dayIdx: number,
  id: string,
  pinnedToDay?: Map<string, number>,
): boolean {
  const day = problem.dayList[dayIdx]!;
  const p = problem.placesById.get(id);
  return (
    (day.pinnedOrder?.includes(id) ?? false) ||
    !!p?.appointment ||
    !!p?.forceDayId ||
    (pinnedToDay?.has(id) ?? false)
  );
}

/** The active day with the largest overrun, or -1 when none is over budget. */
function worstOverBudgetDay(problem: Problem, state: State, activeDays: number[]): number {
  let worst = -1;
  let worstOver = 0;
  for (const d of activeDays) {
    if (problem.dayList[d]!.locked) continue;
    const over = overMinutes(problem, d, state.days[d] ?? []);
    if (over > worstOver) {
      worstOver = over;
      worst = d;
    }
  }
  return worst;
}

/**
 * Utilisation-fraction gap a recipient day must trail the donor by before the
 * balance operators consider it a target for *ordinary* load imbalance (no
 * day over budget) — the "meaningfully less loaded" bar from the design doc.
 * Without this gate, ordinary balancing would happily shuffle two
 * near-identical days back and forth for a sliver of objective improvement,
 * competing with ruin-and-recreate for iterations to no real benefit. An
 * over-budget donor bypasses the gate entirely (see `candidateRecipient`):
 * getting a genuine overrun back under budget outranks how evenly the rest
 * of the trip compares.
 */
const MIN_LOAD_GAP = 0.15;

/**
 * The active, unlocked day to draw work from: the worst over-budget day when
 * one exists (top priority — a real overrun always outranks ordinary
 * unevenness), otherwise the most-loaded (highest utilisation) active day.
 * Locked days never donate. Returns null when there is nothing measurable to
 * balance.
 */
function mostLoadedDay(
  problem: Problem,
  state: State,
  activeDays: number[],
): { dayIdx: number; overBudget: boolean; utilisation: number } | null {
  const worst = worstOverBudgetDay(problem, state, activeDays);
  if (worst >= 0) {
    const util = dayUtilisation(problem, worst, state.days[worst] ?? []) ?? Number.POSITIVE_INFINITY;
    return { dayIdx: worst, overBudget: true, utilisation: util };
  }
  let best = -1;
  let bestUtil = Number.NEGATIVE_INFINITY;
  for (const d of activeDays) {
    if (problem.dayList[d]!.locked) continue;
    const util = dayUtilisation(problem, d, state.days[d] ?? []);
    if (util === null) continue;
    if (util > bestUtil) {
      bestUtil = util;
      best = d;
    }
  }
  return best >= 0 ? { dayIdx: best, overBudget: false, utilisation: bestUtil } : null;
}

/**
 * Whether `target` is a legitimate balance-operator recipient for `donor`.
 * A day already over budget, the donor day itself, and locked days never
 * qualify. Beyond that: an over-budget donor may unload onto ANY
 * under-budget day (legacy behaviour, unchanged); an ordinary-imbalance
 * donor may only unload onto a day trailing it by at least `MIN_LOAD_GAP` —
 * see that constant's doc for why.
 */
function candidateRecipient(
  problem: Problem,
  state: State,
  target: number,
  donor: { dayIdx: number; overBudget: boolean; utilisation: number },
): boolean {
  if (target === donor.dayIdx) return false;
  if (problem.dayList[target]!.locked) return false;
  if (overMinutes(problem, target, state.days[target] ?? []) > 0) return false;
  if (donor.overBudget) return true;
  const targetUtil = dayUtilisation(problem, target, state.days[target] ?? []);
  if (targetUtil === null) return false;
  return donor.utilisation - targetUtil >= MIN_LOAD_GAP;
}

/**
 * relocate-day balance operator: move a non-pinned/non-forced/non-appointment
 * place from the most-loaded day (over-budget days take priority; otherwise
 * the highest-utilisation active day) to the cheapest hard-feasible position
 * on a meaningfully-less-loaded, unlocked, under-budget day. Applied only
 * when the objective strictly improves; selection is deterministic via the
 * seeded RNG. Mutates `state`.
 */
export function relocateDay(
  problem: Problem,
  state: State,
  rng: Rng,
  activeDays: number[],
  pinnedToDay?: Map<string, number>,
): boolean {
  const donor = mostLoadedDay(problem, state, activeDays);
  if (!donor) return false;
  const worst = donor.dayIdx;
  const candidates = (state.days[worst] ?? []).filter(
    (id) => !isProtected(problem, worst, id, pinnedToDay),
  );
  if (candidates.length === 0) return false;
  shuffle(rng, candidates);
  let bestObj = evaluate(problem, state).objective;
  let best: { id: string; target: number } | null = null;
  for (const id of candidates) {
    const base = cloneState(state);
    base.days[worst] = (base.days[worst] ?? []).filter((x) => x !== id);
    for (const target of activeDays) {
      if (!candidateRecipient(problem, state, target, donor)) continue;
      const trial = cloneState(base);
      if (!insertPlace(problem, trial, target, id)) continue;
      const obj = evaluate(problem, trial).objective;
      if (obj < bestObj - 1e-9) {
        bestObj = obj;
        best = { id, target };
      }
    }
  }
  if (!best) return false;
  state.days[worst] = (state.days[worst] ?? []).filter((x) => x !== best.id);
  return insertPlace(problem, state, best.target, best.id);
}

/**
 * swap-days balance operator for the relocation-alone-insufficient case:
 * exchange a place from the most-loaded day (see `relocateDay`'s doc) with a
 * place on a meaningfully-less-loaded, unlocked, under-budget day (same
 * protection rules), re-sequencing both days via the insertion helper.
 * Applied only when the objective strictly improves; deterministic via the
 * seeded RNG. Mutates `state`.
 */
export function swapDays(
  problem: Problem,
  state: State,
  rng: Rng,
  activeDays: number[],
  pinnedToDay?: Map<string, number>,
): boolean {
  const donor = mostLoadedDay(problem, state, activeDays);
  if (!donor) return false;
  const worst = donor.dayIdx;
  const aCandidates = (state.days[worst] ?? []).filter(
    (id) => !isProtected(problem, worst, id, pinnedToDay),
  );
  if (aCandidates.length === 0) return false;
  const bCandidates: { id: string; day: number }[] = [];
  for (const d of activeDays) {
    if (!candidateRecipient(problem, state, d, donor)) continue;
    for (const id of state.days[d] ?? []) {
      if (!isProtected(problem, d, id, pinnedToDay)) bCandidates.push({ id, day: d });
    }
  }
  if (bCandidates.length === 0) return false;
  shuffle(rng, aCandidates);
  shuffle(rng, bCandidates);
  const baseObj = evaluate(problem, state).objective;
  let best: { a: string; b: string; bDay: number; obj: number } | null = null;
  for (const a of aCandidates) {
    for (const { id: b, day: bDay } of bCandidates) {
      const trial = cloneState(state);
      trial.days[worst] = (trial.days[worst] ?? []).filter((x) => x !== a);
      trial.days[bDay] = (trial.days[bDay] ?? []).filter((x) => x !== b);
      if (!insertPlace(problem, trial, bDay, a)) continue;
      if (!insertPlace(problem, trial, worst, b)) continue;
      const obj = evaluate(problem, trial).objective;
      if (obj < baseObj - 1e-9 && (best === null || obj < best.obj)) {
        best = { a, b, bDay, obj };
      }
    }
  }
  if (!best) return false;
  state.days[worst] = (state.days[worst] ?? []).filter((x) => x !== best.a);
  state.days[best.bDay] = (state.days[best.bDay] ?? []).filter((x) => x !== best.b);
  return insertPlace(problem, state, best.bDay, best.a) && insertPlace(problem, state, worst, best.b);
}

/** Re-insert removed places (priority/appointment first) across active days. */
function recreate(
  problem: Problem,
  state: State,
  toInsert: string[],
  activeDays: number[],
  pinnedToDay?: Map<string, number>,
): void {
  const sorted = [...toInsert].sort((a, b) => {
    const pa = problem.placesById.get(a);
    const pb = problem.placesById.get(b);
    const aa = pa?.appointment ? 0 : 1;
    const ab = pb?.appointment ? 0 : 1;
    if (aa !== ab) return aa - ab;
    if ((pa?.priority ?? 3) !== (pb?.priority ?? 3)) {
      return (pa?.priority ?? 3) - (pb?.priority ?? 3);
    }
    return (pb?.dwellMin ?? 0) - (pa?.dwellMin ?? 0);
  });
  for (const id of sorted) {
    const p = problem.placesById.get(id);
    const forcedDay = pinnedToDay?.get(id);
    let inserted = false;
    for (const d of activeDays) {
      const day = problem.dayList[d]!;
      if (forcedDay !== undefined && d !== forcedDay) continue;
      if (p?.appointment && p.appointment.dayId !== day.id) continue;
      // A force-inserted place stays on its forced day through ruin/recreate.
      if (p?.forceDayId && p.forceDayId !== day.id) continue;
      if (insertPlace(problem, state, d, id)) {
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      state.pool.push(id);
    }
  }
}

/**
 * Max-min utilisation gap among unlocked active days (locked/infeasible days
 * excluded) — a cheap proxy for "is there daylight between the busiest and
 * quietest day worth interrupting ruin-and-recreate for" (see
 * `IMBALANCE_GATE_THRESHOLD`).
 */
function loadSpread(problem: Problem, state: State, activeDays: number[]): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const d of activeDays) {
    if (problem.dayList[d]!.locked) continue;
    const util = dayUtilisation(problem, d, state.days[d] ?? []);
    if (util === null) continue;
    if (util < min) min = util;
    if (util > max) max = util;
  }
  return Number.isFinite(min) && Number.isFinite(max) ? max - min : 0;
}

/**
 * Ordinary (non-over-budget) load imbalance wins a seeded coin flip before an
 * iteration spends itself on the balance operators instead of
 * ruin-and-recreate — but the odds are a *continuous* function of
 * `loadSpread`, not a step function. Once relocateDay/swapDays fire on
 * ordinary imbalance (not just genuine overruns), they find *some* improving
 * move almost every iteration for as long as any two active days differ at
 * all — unthrottled, `balanced || ruin/recreate` would pick the balance
 * operators nearly every time and starve the generic search that does the
 * rest of the quality work (an earlier, ungated version of this measurably
 * worsened the Tokyo/Warsaw fixture scores). Throttling is still required;
 * a *hard* spread threshold is not, and was actively harmful: gating on the
 * very quantity being optimised makes the threshold a resting point — below
 * it the operators never fire at all, so the search has no way to improve
 * balance past the cutoff, and the cutoff becomes the best balance it will
 * ever bother to reach (measured: the Warsaw fixture's spread settled to
 * exactly the old 0.2 threshold after a travel-cost model change nudged it
 * there, see warsaw.test.ts's header comment). `balanceAttemptProbability`
 * ramps linearly from 0 at spread 0 to `BALANCE_ATTEMPT_PROBABILITY` at
 * spread `IMBALANCE_RAMP_SPAN` (and saturates beyond it): pressure to
 * rebalance fades smoothly as the trip gets more even instead of switching
 * off at a cliff, so there is no spread value where the gate itself creates
 * an attractor — wherever the search settles is a genuine local optimum of
 * the objective, not an artifact of this gate. `IMBALANCE_RAMP_SPAN` keeps
 * the same value the old hard threshold used (0.2) — that number was already
 * validated as "the spread at which the fixtures want balancing at full
 * strength"; only its role changed, from a cutoff to the top of a ramp. A
 * genuine over-budget day always attempts balancing regardless of either
 * knob (see `mostLoadedDay`/`candidateRecipient`) — that case is rare enough,
 * and important enough, not to throttle.
 *
 * Note `MIN_LOAD_GAP` (above) is a second, independent floor: even at
 * probability 1, `relocateDay`/`swapDays` can only move work onto a day
 * trailing the donor by >= 0.15 utilisation, so spread cannot be driven
 * below ~0.15 by these operators no matter how this probability is shaped.
 * That floor was left alone here — lowering it was tried directly (0.15 ->
 * 0.08) and measured against both fixtures: Warsaw's spread improved further
 * but Tokyo's got *worse* (0.008 -> 0.041), because a looser recipient gate
 * changes which candidate moves are available mid-search and so which local
 * optimum the run settles into overall — not a strict win, so the value was
 * left at 0.15. In practice both fixtures land under 0.15 anyway (0.107 and
 * 0.008) because an over-budget donor bypasses this gate entirely during the
 * search even though the final state is under budget everywhere, so
 * "meaningfully below 0.2" is not the ceiling it looks like on paper.
 */
const IMBALANCE_RAMP_SPAN = 0.2;
const BALANCE_ATTEMPT_PROBABILITY = 0.3;

/**
 * Probability of attempting the balance operators this iteration, for a
 * given (non-over-budget) `loadSpread`. Linear ramp from 0 up to
 * `BALANCE_ATTEMPT_PROBABILITY` at `IMBALANCE_RAMP_SPAN`, clamped beyond it —
 * see `IMBALANCE_RAMP_SPAN`'s doc for why this replaced a hard threshold.
 */
function balanceAttemptProbability(spread: number): number {
  if (spread <= 0) return 0;
  return BALANCE_ATTEMPT_PROBABILITY * Math.min(1, spread / IMBALANCE_RAMP_SPAN);
}

export interface AlnsOptions {
  seed: number;
  /** Wall-clock budget in ms; combined with maxIterations (whichever binds). */
  budgetMs?: number;
  /** Iteration cap (determinism bound). Default 1000. */
  maxIterations?: number;
  activeDays?: Set<number>;
  /** Places that must stay on the given day index (e.g. after a drag). */
  pinnedToDay?: Map<string, number>;
  onProgress?: (state: State, iteration: number) => void;
}

export interface AlnsResult {
  best: State;
  iterations: number;
}

/**
 * Adaptive large neighbourhood search (ruin & recreate) with simulated
 * annealing acceptance. Deterministic for a given seed + input when the
 * iteration cap binds; the wall-clock budget is an upper bound.
 */
export function alns(problem: Problem, initial: State, opts: AlnsOptions): AlnsResult {
  const rng = mulberry32(opts.seed);
  const maxIterations = opts.maxIterations ?? 1000;
  const deadline = opts.budgetMs !== undefined ? Date.now() + opts.budgetMs : Number.POSITIVE_INFINITY;
  const allDays = problem.dayList.map((_, i) => i);
  const activeDays = (opts.activeDays ?? null)
    ? allDays.filter((d) => opts.activeDays!.has(d) && !problem.dayList[d]!.locked)
    : allDays.filter((d) => !problem.dayList[d]!.locked);

  let current = initial;
  let best = cloneState(initial);
  let bestObj = evaluate(problem, best).objective;
  let curObj = bestObj;

  // bestObj is finite in practice now that `evaluate` keeps the imbalance term
  // finite, but this guard stays regardless: a non-finite bestObj would make
  // T0 non-finite, and T0 * Math.pow(TEnd / T0, iter / maxIterations) then
  // evaluates to NaN, so every acceptance test `rng() < Math.exp(-delta / T)`
  // silently becomes `false` forever — annealing degrades to hill-climbing
  // with no error anywhere. Falling back to a fixed, finite scale keeps the
  // schedule well-defined even if a future objective term goes infinite.
  const T0 = Number.isFinite(bestObj) ? Math.max(1e-3, Math.abs(bestObj) * 0.02) : BIG_PENALTY * 0.02;
  const TEnd = 1e-3;

  let lastProgress = Date.now();
  let iter = 0;
  for (; iter < maxIterations; iter++) {
    if (Date.now() >= deadline) break;
    const candidate = cloneState(current);
    // Day-rebalancing runs when there's something worth rebalancing: always
    // for a genuine over-budget day (top priority), and for ordinary load
    // imbalance with odds that scale continuously with how uneven the trip
    // currently is, so it doesn't starve ruin-and-recreate (see
    // `balanceAttemptProbability`'s doc). relocate-day tries first, then
    // swap-days when relocation alone finds no improving move. Both are
    // strict-improvement local search over the split, so an applied move
    // replaces ruin/recreate for this iteration.
    const donor = mostLoadedDay(problem, candidate, activeDays);
    const attemptBalance =
      donor !== null &&
      (donor.overBudget ||
        rng() < balanceAttemptProbability(loadSpread(problem, candidate, activeDays)));
    const balanced =
      attemptBalance &&
      (relocateDay(problem, candidate, rng, activeDays, opts.pinnedToDay) ||
        swapDays(problem, candidate, rng, activeDays, opts.pinnedToDay));
    if (!balanced) {
      const removed = ruin(problem, candidate, rng, activeDays, opts.pinnedToDay);
      // The unscheduled pool participates in recreate.
      const poolAttempt = candidate.pool.splice(0);
      recreate(problem, candidate, [...removed, ...poolAttempt], activeDays, opts.pinnedToDay);
    }

    const candObj = evaluate(problem, candidate).objective;
    if (candObj < curObj) {
      current = candidate;
      curObj = candObj;
    } else {
      const T = Math.max(TEnd, T0 * Math.pow(TEnd / T0, iter / maxIterations));
      const delta = candObj - curObj;
      if (delta > 0 && rng() < Math.exp(-delta / T)) {
        current = candidate;
        curObj = candObj;
      }
    }
    if (curObj < bestObj) {
      best = cloneState(current);
      bestObj = curObj;
    }
    if (opts.onProgress && Date.now() - lastProgress >= 100) {
      lastProgress = Date.now();
      opts.onProgress(cloneState(best), iter);
    }
  }
  if (opts.onProgress) opts.onProgress(cloneState(best), iter);
  return { best, iterations: iter };
}

/** Convenience: reason to attach to a pooled place. */
export function poolReason(problem: Problem, placeId: string): UnscheduledReason {
  const p = problem.placesById.get(placeId);
  return p ? reasonFor(p) : "no_time";
}

export { sequenceDay };

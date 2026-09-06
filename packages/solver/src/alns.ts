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

/**
 * Per-day contribution to `evaluate`'s objective, cheap to cache: everything
 * `evaluate` needs from one day's `computeTimes` call. See `EvalCache` for
 * why this is split out — a day whose order is untouched for the lifetime of
 * an `alns` run never needs this recomputed.
 */
interface DayStat {
  travelMin: number;
  waitMin: number;
  overBudgetMin: number;
  infeasible: boolean;
  /** null when the day is hard-infeasible (endMin is +Infinity) — see `evaluate`'s matching comment. */
  util: number | null;
  window: number;
}

function computeDayStat(problem: Problem, dayIdx: number, order: string[]): DayStat {
  const day = problem.dayList[dayIdx]!;
  const times = computeTimes(problem, day, order);
  // Force-relaxed days opted into ending past `day.end` — exempt from the
  // over-budget penalty (same detection as `computeTimes`).
  const forceRelaxed = order.some((id) => problem.placesById.get(id)?.forceDayId === day.id);
  const dayStart = parseHHMM(day.start);
  const dayEnd = parseHHMM(day.end);
  const overBudgetMin =
    !forceRelaxed && Number.isFinite(times.endMin) ? Math.max(0, times.endMin - dayEnd) : 0;
  // An infeasible day's endMin is +Infinity (sequence.ts); excluding it here
  // keeps the imbalance term finite so BIG_PENALTY alone (below) grades
  // infeasibility — one infinite endMin must not make every infeasible
  // state compare equal, nor poison the objective into Infinity/NaN (which
  // would silently disable simulated annealing in `alns` below).
  const util = Number.isFinite(times.endMin) ? utilisationOf(dayStart, dayEnd, times.endMin) : null;
  return {
    travelMin: times.travelMin,
    waitMin: times.waitMin,
    overBudgetMin,
    infeasible: !times.feasible,
    util,
    window: Math.max(1, dayEnd - dayStart),
  };
}

/**
 * Cache of `DayStat`s for days that are guaranteed not to change for the
 * lifetime of one `alns` run: everything outside that run's `activeDays`.
 * `ruin`/`recreate`/`relocateDay`/`swapDays` only ever mutate `state.days[d]`
 * for `d` in `activeDays` (locked days and days excluded from an incremental
 * resolve's blast radius are never touched) — so those days' `computeTimes`
 * result is invariant across every iteration of the run, and recomputing it
 * on every `evaluate` call (this cache's whole reason to exist) was pure
 * waste: an `evaluate` call inside `relocateDay`/`swapDays`'s nested
 * candidate loops recomputed EVERY day, including untouched ones, so one
 * balance-operator attempt cost O(n²·D) full-objective evaluations — see the
 * perf-defect writeup this fixes. `evaluate`'s own default behaviour
 * (`cache` omitted) is unchanged: a fresh `DayStat` for every day, so every
 * existing caller that evaluates a one-off state (tests, `finalize`) is
 * unaffected.
 */
export interface EvalCache {
  readonly staticStats: ReadonlyMap<number, DayStat>;
}

/** Build an `EvalCache` for an `alns` run over `activeDays` — see `EvalCache`'s doc. */
export function buildEvalCache(problem: Problem, state: State, activeDays: readonly number[]): EvalCache {
  const activeSet = new Set(activeDays);
  const staticStats = new Map<number, DayStat>();
  for (let d = 0; d < problem.dayList.length; d++) {
    if (!activeSet.has(d)) staticStats.set(d, computeDayStat(problem, d, state.days[d] ?? []));
  }
  return { staticStats };
}

export function evaluate(problem: Problem, state: State, cache?: EvalCache): Evaluation {
  let travelMin = 0;
  let waitMin = 0;
  let infeasibleDays = 0;
  let overBudgetMin = 0;
  // Locked days are included here (they are part of the trip the user sees)
  // even though the balance *operators* below (`mostLoadedDay`,
  // `candidateRecipient`) skip them entirely — see those functions' docs.
  const dayStats: (DayStat | undefined)[] = new Array(problem.dayList.length);
  for (let d = 0; d < problem.dayList.length; d++) {
    const stat = cache?.staticStats.get(d) ?? computeDayStat(problem, d, state.days[d] ?? []);
    dayStats[d] = stat.util !== null ? stat : undefined;
    travelMin += stat.travelMin;
    waitMin += stat.waitMin;
    if (stat.infeasible) infeasibleDays++;
    overBudgetMin += stat.overBudgetMin;
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
  
  // Region coherence under clusterFirst is enforced at the OPERATOR level
  // (see `regionCompatible`, used by `insertPlace` and threaded through
  // `recreate`/`relocateDay`/`swapDays`), not as an objective term. An
  // earlier version of this function added an unconditional `regionMixing`
  // term here weighted at `BIG_PENALTY` (1e9/mismatched place) — six orders
  // of magnitude above `mustDropped` (1000/place) — which fired on every
  // solve regardless of strategy and made ALNS prefer dropping hundreds of
  // must-see places over accepting one region-mixed day. Blocking
  // incompatible moves at the source costs nothing to apply consistently and
  // needs no weight tuned against the rest of the objective, so the term was
  // removed rather than reweighted — see design.md Decision 2.5 in the
  // cluster-first-strategy change for the full rationale.
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
    infeasibleDays * BIG_PENALTY;

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

/**
 * Clone `s`. With `activeDays` given, only those days' arrays are copied —
 * every other day is shared by reference with the source state. That is
 * only safe because a day outside `activeDays` is, by construction, never
 * mutated for the lifetime of one `alns` run (see `EvalCache`'s doc for the
 * same invariant on the evaluation side) — every mutator here (`ruin`,
 * `recreate`, `relocateDay`, `swapDays`) restricts itself to `activeDays`.
 * Without `activeDays` (the default — every existing caller outside the
 * `alns` hot loop), behaviour is unchanged: a full deep copy.
 */
export function cloneState(s: State, activeDays?: readonly number[]): State {
  if (!activeDays) {
    return { days: s.days.map((d) => [...d]), pool: [...s.pool] };
  }
  const activeSet = new Set(activeDays);
  return {
    days: s.days.map((d, i) => (activeSet.has(i) ? [...d] : d)),
    pool: [...s.pool],
  };
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
/**
 * Whether `placeId` may join day `dayIdx` without introducing NEW
 * cross-region mixing (clusterFirst region protection — see design.md
 * Decision 2.5 in the cluster-first-strategy change). A place with no
 * `region` is a free agent: it never blocks, and is never blocked. A day
 * with no established region yet (empty, or every current occupant is
 * unregioned) accepts anything. Otherwise the day already has one or more
 * established regions (construction can tie-assign more than one cluster to
 * a day, so "already mixed" is possible) and `placeId` may only join if its
 * region is among them — this stops the operators from making mixing worse,
 * but does not require them to *fix* mixing construction already produced.
 */
function regionCompatible(problem: Problem, state: State, dayIdx: number, placeId: string): boolean {
  const region = problem.placesById.get(placeId)?.region;
  if (!region) return true;
  for (const id of state.days[dayIdx] ?? []) {
    const r = problem.placesById.get(id)?.region;
    if (r && r !== region) return false;
  }
  return true;
}

/**
 * Cheapest-feasible insertion of `placeId` across the given day; mutates
 * state. `respectRegions` (clusterFirst only — see `regionCompatible`)
 * refuses the day outright when the place's region would newly mix with an
 * already-established, different region there; callers that must never be
 * blocked by region coherence (the final repair pass, explicit force-insert)
 * leave it at the default `false`.
 */
export function insertPlace(
  problem: Problem,
  state: State,
  dayIdx: number,
  placeId: string,
  relaxBudget = false,
  respectRegions = false,
): boolean {
  if (respectRegions && !regionCompatible(problem, state, dayIdx, placeId)) return false;
  const list = state.days[dayIdx] ?? [];
  const day = problem.dayList[dayIdx]!;
  let bestPos = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let pos = 0; pos <= list.length; pos++) {
    const trial = [...list.slice(0, pos), placeId, ...list.slice(pos)];
    const times = computeTimes(problem, day, trial, relaxBudget);
    if (!times.feasible) continue;
    const cost = problem.weights.travel * times.travelMin + problem.weights.wait * times.waitMin;
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
  cache?: EvalCache,
): boolean {
  const donor = mostLoadedDay(problem, state, activeDays);
  if (!donor) return false;
  const worst = donor.dayIdx;
  // clusterFirst-only: never relocate a place onto a day that would newly
  // mix it with a different, already-established region there (see
  // `regionCompatible`). routeFirst is unaffected (region stays inert).
  const respectRegions = problem.settings?.solverStrategy === "clusterFirst";
  const candidates = (state.days[worst] ?? []).filter(
    (id) => !isProtected(problem, worst, id, pinnedToDay),
  );
  if (candidates.length === 0) return false;
  shuffle(rng, candidates);
  let bestObj = evaluate(problem, state, cache).objective;
  let best: { id: string; target: number } | null = null;
  for (const id of candidates) {
    const base = cloneState(state, activeDays);
    base.days[worst] = (base.days[worst] ?? []).filter((x) => x !== id);
    for (const target of activeDays) {
      if (!candidateRecipient(problem, state, target, donor)) continue;
      const trial = cloneState(base, activeDays);
      if (!insertPlace(problem, trial, target, id, false, respectRegions)) continue;
      const obj = evaluate(problem, trial, cache).objective;
      if (obj < bestObj - 1e-9) {
        bestObj = obj;
        best = { id, target };
      }
    }
  }
  if (!best) return false;
  state.days[worst] = (state.days[worst] ?? []).filter((x) => x !== best.id);
  return insertPlace(problem, state, best.target, best.id, false, respectRegions);
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
  cache?: EvalCache,
): boolean {
  const donor = mostLoadedDay(problem, state, activeDays);
  if (!donor) return false;
  const worst = donor.dayIdx;
  // clusterFirst-only: see `relocateDay`'s matching comment.
  const respectRegions = problem.settings?.solverStrategy === "clusterFirst";
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
  const baseObj = evaluate(problem, state, cache).objective;
  let best: { a: string; b: string; bDay: number; obj: number } | null = null;
  for (const a of aCandidates) {
    for (const { id: b, day: bDay } of bCandidates) {
      const trial = cloneState(state, activeDays);
      trial.days[worst] = (trial.days[worst] ?? []).filter((x) => x !== a);
      trial.days[bDay] = (trial.days[bDay] ?? []).filter((x) => x !== b);
      if (!insertPlace(problem, trial, bDay, a, false, respectRegions)) continue;
      if (!insertPlace(problem, trial, worst, b, false, respectRegions)) continue;
      const obj = evaluate(problem, trial, cache).objective;
      if (obj < baseObj - 1e-9 && (best === null || obj < best.obj)) {
        best = { a, b, bDay, obj };
      }
    }
  }
  if (!best) return false;
  state.days[worst] = (state.days[worst] ?? []).filter((x) => x !== best.a);
  state.days[best.bDay] = (state.days[best.bDay] ?? []).filter((x) => x !== best.b);
  return (
    insertPlace(problem, state, best.bDay, best.a, false, respectRegions) &&
    insertPlace(problem, state, worst, best.b, false, respectRegions)
  );
}

/** Re-insert removed places (priority/appointment first) across active days. */
function recreate(
  problem: Problem,
  state: State,
  toInsert: string[],
  activeDays: number[],
  pinnedToDay?: Map<string, number>,
): void {
  // clusterFirst-only: see `relocateDay`'s matching comment. A place pinned
  // to a specific day (an explicit drag) always bypasses the check for that
  // day, same as `forceInsert` and `repairPass` — an explicit user placement
  // outranks region coherence.
  const clusterFirst = problem.settings?.solverStrategy === "clusterFirst";
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
    const respectRegions = clusterFirst && forcedDay === undefined;
    let inserted = false;
    for (const d of activeDays) {
      const day = problem.dayList[d]!;
      if (forcedDay !== undefined && d !== forcedDay) continue;
      if (p?.appointment && p.appointment.dayId !== day.id) continue;
      // A force-inserted place stays on its forced day through ruin/recreate.
      if (p?.forceDayId && p.forceDayId !== day.id) continue;
      if (insertPlace(problem, state, d, id, false, respectRegions)) {
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
  /**
   * Wall-clock budget in ms. Deterministically converted to an iteration
   * cap up front (see `calibratedIterationCap`) — NOT a live `Date.now()`
   * check inside the search loop, which is what made "deterministic seeded
   * runs" false at the budgets this app actually ships (see the
   * determinism-defect writeup this fixes). Combined with `maxIterations`
   * (whichever is smaller binds).
   */
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
 * Places across `activeDays` plus the unscheduled pool — the working set
 * `ruin`/`recreate`/`evaluate` actually touch each iteration. Used only to
 * size `calibratedIterationCap`'s conservative per-iteration cost estimate.
 */
function activeWorkSize(state: State, activeDays: readonly number[]): number {
  let n = state.pool.length;
  for (const d of activeDays) n += (state.days[d] ?? []).length;
  return n;
}

/**
 * Conservative (deliberately generous) estimate of one `alns` iteration's
 * cost, in ms, on ordinary hardware — benchmarked against `perf.test.ts`
 * post the `EvalCache`/scoped-`cloneState` fix above (the cost this formula
 * models is exactly what that fix reduced: `activeN` for
 * ruin/recreate/evaluate, times `activeDays.length` for the balance
 * operators' nested day loop — see `relocateDay`/`swapDays`). Deliberately
 * on the pessimistic side: `calibratedIterationCap`'s whole job is picking
 * an iteration count that comfortably fits inside a wall-clock budget
 * WITHOUT ever consulting the wall clock while doing so, so overestimating
 * cost (running fewer iterations than the machine could truly do) is the
 * safe direction — underestimating would let the wall-clock safety valve in
 * `alns` actually engage, which is the non-determinism this is meant to
 * prevent.
 */
const MS_PER_UNIT = 0.01;

/**
 * Deterministic conversion from a wall-clock budget to an iteration cap —
 * see `AlnsOptions.budgetMs`'s doc and `MS_PER_UNIT`'s doc for why this
 * replaces a live timing check. A pure function of problem size and
 * `budgetMs`: the same seed + input + budget always yields the same cap,
 * on any machine, at any time — that determinism is the entire point.
 */
function calibratedIterationCap(activeN: number, activeDayCount: number, budgetMs: number): number {
  const unitsPerIteration = Math.max(1, activeN * Math.max(1, activeDayCount));
  return Math.max(1, Math.floor(budgetMs / (unitsPerIteration * MS_PER_UNIT)));
}

/**
 * Wall-clock safety valve for `alns`'s search loop: NOT part of the
 * deterministic trajectory (see `AlnsOptions.budgetMs`'s doc) — a last
 * resort in case `calibratedIterationCap` badly under-costs an iteration on
 * some pathological input or machine. `SAFETY_MARGIN` makes it deliberately
 * unlikely to ever engage in practice (that's the point: a safety cap that
 * is never reached needs no determinism story of its own — see the
 * determinism-defect writeup's preferred fix). Checked only every
 * `SAFETY_CHECK_INTERVAL` iterations (not every one) so it costs nothing
 * once calibration is doing its job; when it does engage, the loop always
 * breaks at an iteration BOUNDARY (never mid-iteration — `current`/`best`
 * are only ever updated after a full ruin+recreate/balance+evaluate cycle
 * completes), so the returned state is always the last fully-completed
 * iteration's best-so-far: feasible, never a partially-applied operator.
 */
const SAFETY_MARGIN = 20;
const SAFETY_CHECK_INTERVAL = 32;

/**
 * Improvement-stall early exit: `alns` stops once `best` has gone this many
 * consecutive iterations without improving, instead of always spending every
 * iteration `maxIterations`/`budgetMs` would otherwise allow — the loop
 * previously had no way to notice it had converged and would keep spinning
 * (re-evaluating ruin/recreate/balance candidates that never beat `best`)
 * for the rest of its budget even after the search had genuinely settled
 * (see the perf-defect writeup this fixes; measured on the Tokyo/Warsaw
 * fixtures and the N=100 synthetic case in perf.test.ts — both settle within
 * a small fraction of their 1000-iteration cap).
 *
 * `stallPatience` is a fraction of THIS run's own iteration cap
 * (`STALL_PATIENCE_FRACTION`), floored at `STALL_PATIENCE_FLOOR`: scaling
 * with the cap matters because simulated annealing's whole mechanism is to
 * wander through non-improving states for a while (especially early, while
 * `T` is still high) before re-improving on `best` — a fixed small patience
 * would cut that off prematurely on a long run. The floor exists so a short
 * run (an incremental resolve's few hundred iterations) isn't tripped by a
 * handful of unlucky non-improving iterations right at the start; in
 * practice `resolve()`'s default 300-iteration cap rarely reaches
 * `STALL_PATIENCE_FLOOR` iterations without at least one improvement, so
 * this exit mostly changes behaviour on the LONGER runs (an initial full
 * `solve()`) where converging early actually saves meaningful wall time.
 *
 * This does not change WHICH state a run converges to relative to a version
 * without the exit — the loop only ever breaks immediately after checking
 * whether `best` improved this iteration, so what is returned is always
 * `best` as of the last iteration that improved it (or the initial state, if
 * none did) plus `stallPatience` iterations of confirmation that nothing
 * better turned up — never a mid-improvement or partially-applied state.
 * That is an empirical bet, not a proof (a later iteration could in
 * principle still find something after a long enough stall), so
 * `STALL_PATIENCE_FRACTION`/`STALL_PATIENCE_FLOOR` are deliberately generous
 * and were checked against the Tokyo/Warsaw fixture baselines
 * (tokyo.test.ts/warsaw.test.ts), which are bit-for-bit unchanged by this —
 * i.e. on those two representative trips, nothing was ever found in the tail
 * this exit skips.
 */
const STALL_PATIENCE_FRACTION = 0.5;
const STALL_PATIENCE_FLOOR = 200;

/**
 * Adaptive large neighbourhood search (ruin & recreate) with simulated
 * annealing acceptance. Deterministic for a given seed + input: `budgetMs`
 * is converted up front into an iteration cap (see `calibratedIterationCap`)
 * that is itself a pure function of problem size and the budget, never of
 * wall-clock timing — so the same seed + input + options always run the
 * same number of iterations, drawing the same RNG sequence, and therefore
 * produce the same result, regardless of machine speed or GC pauses. A
 * wall-clock deadline still exists as a safety valve (see its doc above)
 * but is sized to never engage in practice; if it ever does, that run's
 * result is best-effort/anytime rather than covered by the guarantee above,
 * but is always feasible (see the safety-valve doc for why).
 */
export function alns(problem: Problem, initial: State, opts: AlnsOptions): AlnsResult {
  const rng = mulberry32(opts.seed);
  const allDays = problem.dayList.map((_, i) => i);
  const activeDays = (opts.activeDays ?? null)
    ? allDays.filter((d) => opts.activeDays!.has(d) && !problem.dayList[d]!.locked)
    : allDays.filter((d) => !problem.dayList[d]!.locked);

  const explicitCap = opts.maxIterations ?? 1000;
  const budgetCap =
    opts.budgetMs !== undefined
      ? calibratedIterationCap(activeWorkSize(initial, activeDays), activeDays.length, opts.budgetMs)
      : Number.POSITIVE_INFINITY;
  const maxIterations = Math.min(explicitCap, budgetCap);
  const deadline =
    opts.budgetMs !== undefined ? Date.now() + opts.budgetMs * SAFETY_MARGIN : Number.POSITIVE_INFINITY;
  const stallPatience = Math.max(STALL_PATIENCE_FLOOR, Math.floor(maxIterations * STALL_PATIENCE_FRACTION));

  // Days outside `activeDays` never change for the life of this run (every
  // mutator below restricts itself to `activeDays`) — cache their stats once
  // instead of recomputing them on every `evaluate` call, and share their
  // array references instead of deep-copying them on every `cloneState`
  // call. See `EvalCache`/`cloneState`'s docs — this is what makes an
  // incremental `resolve()` (a handful of `activeDays`) actually scale down
  // with the edit's blast radius instead of paying full-trip cost per
  // iteration regardless.
  const cache = buildEvalCache(problem, initial, activeDays);

  let current = initial;
  let best = cloneState(initial, activeDays);
  let bestObj = evaluate(problem, best, cache).objective;
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
  let stallCount = 0;
  let iter = 0;
  for (; iter < maxIterations; iter++) {
    if (iter % SAFETY_CHECK_INTERVAL === 0 && Date.now() >= deadline) break;
    const candidate = cloneState(current, activeDays);
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
      (relocateDay(problem, candidate, rng, activeDays, opts.pinnedToDay, cache) ||
        swapDays(problem, candidate, rng, activeDays, opts.pinnedToDay, cache));
    if (!balanced) {
      const removed = ruin(problem, candidate, rng, activeDays, opts.pinnedToDay);
      // The unscheduled pool participates in recreate.
      const poolAttempt = candidate.pool.splice(0);
      recreate(problem, candidate, [...removed, ...poolAttempt], activeDays, opts.pinnedToDay);
    }

    const candObj = evaluate(problem, candidate, cache).objective;
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
      best = cloneState(current, activeDays);
      bestObj = curObj;
      stallCount = 0;
    } else {
      stallCount++;
    }
    if (opts.onProgress && Date.now() - lastProgress >= 100) {
      lastProgress = Date.now();
      opts.onProgress(cloneState(best), iter);
    }
    if (stallCount >= stallPatience) {
      // See `STALL_PATIENCE_FRACTION`'s doc: nothing has beaten `best` for a
      // full patience window, so the rest of the budget is spent the same
      // way this tail was — return the same `best` a full-length run would,
      // just without paying for the remainder of the confirmed-flat tail.
      iter++;
      break;
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

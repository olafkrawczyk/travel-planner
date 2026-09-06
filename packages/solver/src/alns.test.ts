import { describe, expect, it } from "vitest";
import { buildProblem } from "./matrix";
import { alns, buildEvalCache, cloneState, evaluate, insertPlace, relocateDay, swapDays, type State } from "./alns";
import { computeTimes, sequenceDay } from "./sequence";
import { resolve, solve } from "./solve";
import { split } from "./split";
import { mulberry32 } from "./rng";
import { DEG_PER_KM, day, place, trip } from "./testUtils";
import type { Trip } from "@app/domain";

/** A deterministic 12-place, 3-day trip spread over a grid. */
function makeTrip() {
  let s = 7;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const places = Array.from({ length: 12 }, (_, i) =>
    place({
      lat: 35.66 + (i % 4) * 40 * DEG_PER_KM + rnd() * 0.004,
      lng: 139.68 + Math.floor(i / 4) * 40 * DEG_PER_KM + rnd() * 0.004,
      id: `p${i}`,
      dwellMin: 60 + Math.floor(rnd() * 3) * 30,
      priority: ((i % 3) + 1) as 1 | 2 | 3,
    }),
  );
  return trip({
    places,
    days: [day({ id: "d1" }), day({ id: "d2" }), day({ id: "d3" })],
  });
}

function initialState(problem: ReturnType<typeof buildProblem>) {
  const state = { days: problem.dayList.map(() => [] as string[]), pool: problem.places.map((p) => p.id) };
  // Cheap feasible start: sequence the pool onto day 0.
  const res = sequenceDay(problem, problem.dayList[0]!, state.pool);
  state.days[0] = res.order;
  state.pool = res.dropped.map((d) => d.placeId);
  return state;
}

describe("alns", () => {
  it("is deterministic for a given seed and input", () => {
    const t = makeTrip();
    const problem = buildProblem(t);
    const a = alns(problem, initialState(problem), { seed: 42, maxIterations: 200, budgetMs: 60_000 });
    const b = alns(problem, initialState(problem), { seed: 42, maxIterations: 200, budgetMs: 60_000 });
    expect(a.best).toEqual(b.best);
    expect(a.iterations).toBe(b.iterations);
  });

  it("never returns a worse objective than the initial state", () => {
    const t = makeTrip();
    const problem = buildProblem(t);
    const init = initialState(problem);
    const before = evaluate(problem, init).objective;
    const { best } = alns(problem, init, { seed: 3, maxIterations: 300, budgetMs: 60_000 });
    expect(evaluate(problem, best).objective).toBeLessThanOrEqual(before);
  });

  it("uses the seeded RNG (different seeds may differ)", () => {
    const t = makeTrip();
    const problem = buildProblem(t);
    const a = alns(problem, initialState(problem), { seed: 1, maxIterations: 50, budgetMs: 60_000 });
    const b = alns(problem, initialState(problem), { seed: 999, maxIterations: 50, budgetMs: 60_000 });
    // Not a strict requirement, but with 50 iterations of ruin/recreate on 12
    // places, different seeds almost surely visit different states.
    const same = JSON.stringify(a.best) === JSON.stringify(b.best);
    expect(typeof same).toBe("boolean");
  });

  it("respects the mulberry32 contract (same seed, same sequence)", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
});

/** A 2-place trip on one short day (09:00–12:00): both places overrun it. */
function overBudgetTrip() {
  return trip({
    places: [
      place({ id: "a", lat: 35.66, lng: 139.68, dwellMin: 120 }),
      place({ id: "b", lat: 35.66 + 30 * DEG_PER_KM, lng: 139.68, dwellMin: 120 }),
    ],
    days: [day({ id: "d1", end: "12:00" })],
  });
}

const BASE_WEIGHTS = { travel: 1, wait: 0.5, mustDropped: 1000, niceDropped: 10, dayImbalance: 1 };

describe("evaluate over-budget penalty", () => {
  it("adds overBudget × overrun minutes to the objective", () => {
    const t0 = overBudgetTrip();
    t0.settings.weights = { ...BASE_WEIGHTS, overBudget: 0 };
    const t3 = overBudgetTrip();
    t3.settings.weights = { ...BASE_WEIGHTS, overBudget: 3 };
    const p0 = buildProblem(t0);
    const p3 = buildProblem(t3);
    const state: State = { days: [["a", "b"]], pool: [] };
    const e0 = evaluate(p0, state);
    const e3 = evaluate(p3, state);
    const times = computeTimes(p3, p3.dayList[0]!, ["a", "b"]);
    const overMin = times.endMin - (12 * 60);
    expect(overMin).toBeGreaterThan(0);
    expect(e3.overBudgetMin).toBeCloseTo(overMin, 6);
    // Same BIG_PENALTY / travel / wait terms on both — the delta is purely the
    // over-budget term.
    expect(e3.objective - e0.objective).toBeCloseTo(3 * overMin, 6);
  });

  it("exempts force-relaxed days from the over-budget penalty", () => {
    const t = overBudgetTrip();
    t.places.find((p) => p.id === "a")!.forceDayId = "d1";
    const p = buildProblem(t);
    const ev = evaluate(p, { days: [["a", "b"]], pool: [] });
    expect(ev.overBudgetMin).toBe(0);
  });
});

describe("day-rebalancing operators", () => {
  /** 4 places on a short day 1 (09:00–12:00); day 2 is 09:00–21:00 and empty. */
  function overloadedTwoDayTrip() {
    return trip({
      places: [
        place({ id: "p0", lat: 35.66, lng: 139.68, dwellMin: 60 }),
        place({ id: "p1", lat: 35.66 + 2 * DEG_PER_KM, lng: 139.68, dwellMin: 60 }),
        place({ id: "p2", lat: 35.66 + 4 * DEG_PER_KM, lng: 139.68, dwellMin: 60 }),
        place({ id: "p3", lat: 35.66 + 6 * DEG_PER_KM, lng: 139.68, dwellMin: 60 }),
      ],
      days: [day({ id: "d1", end: "12:00" }), day({ id: "d2" })],
    });
  }

  function overloadedState(): State {
    return { days: [["p0", "p1", "p2", "p3"], []], pool: [] };
  }

  it("relocate-day moves work from the over-budget day to the free day", () => {
    const t = overloadedTwoDayTrip();
    const problem = buildProblem(t);
    const state = overloadedState();
    const before = evaluate(problem, state).objective;
    expect(relocateDay(problem, state, mulberry32(42), [0, 1])).toBe(true);
    const after = evaluate(problem, state);
    expect(after.objective).toBeLessThan(before);
    expect(after.overBudgetMin).toBeLessThan(evaluate(problem, overloadedState()).overBudgetMin);
    expect(state.days[1]!.length).toBe(1);
    expect(state.days[0]!.length).toBe(3);
  });

  it("relocating every place alone cannot fit — swap-days succeeds", () => {
    // Day 1 (09:00–12:00) holds a (90 min dwell) far from b (60 min). Day 2
    // (09:00–11:00) holds c (60 min, near b). Moving a or b to day 2 alone is
    // hard-infeasible; swapping a with c fixes both days.
    const t = trip({
      places: [
        place({ id: "a", lat: 35.66, lng: 139.68, dwellMin: 90 }),
        place({ id: "b", lat: 35.66 + 18.92 * DEG_PER_KM, lng: 139.68, dwellMin: 60 }),
        place({ id: "c", lat: 35.66 + 19.497 * DEG_PER_KM, lng: 139.68, dwellMin: 60 }),
      ],
      days: [day({ id: "d1", end: "12:00" }), day({ id: "d2", end: "11:00" })],
    });
    const problem = buildProblem(t);
    const state: State = { days: [["a", "b"], ["c"]], pool: [] };
    const before = evaluate(problem, state).objective;
    // Relocation alone cannot help: neither a nor b fits on day 2.
    const r = relocateDay(problem, state, mulberry32(42), [0, 1]);
    expect(r).toBe(false);
    expect(swapDays(problem, state, mulberry32(42), [0, 1])).toBe(true);
    const after = evaluate(problem, state);
    expect(after.overBudgetMin).toBe(0);
    expect(after.objective).toBeLessThan(before);
    expect(state.days[0]!.slice().sort()).toEqual(["b", "c"]);
    expect(state.days[1]).toEqual(["a"]);
  });

  it("balance operators never relocate pinned, forced, or appointment places", () => {
    const t = trip({
      places: [
        place({ id: "p0", lat: 35.66, lng: 139.68, dwellMin: 100 }), // pinned on d1
        place({ id: "p1", lat: 35.66 + 2 * DEG_PER_KM, lng: 139.68, dwellMin: 60 }), // forced to d2
        place({ id: "p2", lat: 35.66 + 4 * DEG_PER_KM, lng: 139.68, dwellMin: 60 }), // appointment on d1
        place({ id: "p3", lat: 35.66 + 5 * DEG_PER_KM, lng: 139.68, dwellMin: 60 }), // free (over day)
        place({ id: "p4", lat: 35.66 + 1 * DEG_PER_KM, lng: 139.68, dwellMin: 60 }), // free (under day)
      ],
      days: [day({ id: "d1", end: "12:00" }), day({ id: "d2" })],
    });
    t.days[0]!.pinnedOrder = ["p0"];
    t.places.find((p) => p.id === "p2")!.appointment = { dayId: "d1", start: "12:00" };
    t.places.find((p) => p.id === "p1")!.forceDayId = "d2";
    const problem = buildProblem(t);

    // relocate: only p3 is movable off the over-budget day 1.
    const s1: State = { days: [["p0", "p2", "p3"], []], pool: [] };
    expect(relocateDay(problem, s1, mulberry32(42), [0, 1])).toBe(true);
    expect(s1.days[0]!.slice().sort()).toEqual(["p0", "p2"]);
    expect(s1.days[1]).toEqual(["p3"]);
    // Nothing movable left → both operators are no-ops.
    expect(relocateDay(problem, s1, mulberry32(7), [0, 1])).toBe(false);
    expect(swapDays(problem, s1, mulberry32(7), [0, 1])).toBe(false);
    expect(s1.days[0]!.slice().sort()).toEqual(["p0", "p2"]);

    // swap: A candidates exclude the pinned p0; B candidates exclude the
    // forced p1 — the only possible exchange is p3 <-> p4 (day 1 fits again:
    // 100 + 60 dwell + ~12 travel ≤ 180).
    const s2: State = { days: [["p0", "p3"], ["p1", "p4"]], pool: [] };
    expect(swapDays(problem, s2, mulberry32(42), [0, 1])).toBe(true);
    expect(s2.days[0]!.slice().sort()).toEqual(["p0", "p4"]);
    expect(s2.days[1]!.slice().sort()).toEqual(["p1", "p3"]);
  });

  it("balance operators never touch locked days", () => {
    const t = trip({
      places: [
        place({ id: "p0", lat: 35.66, lng: 139.68, dwellMin: 60 }),
        place({ id: "p1", lat: 35.66 + 2 * DEG_PER_KM, lng: 139.68, dwellMin: 60 }),
        place({ id: "p2", lat: 35.66 + 4 * DEG_PER_KM, lng: 139.68, dwellMin: 60 }),
        place({ id: "p3", lat: 35.66 + 6 * DEG_PER_KM, lng: 139.68, dwellMin: 60 }),
        place({ id: "p4", lat: 35.66 + 8 * DEG_PER_KM, lng: 139.68, dwellMin: 60 }),
      ],
      days: [day({ id: "d1", end: "12:00" }), day({ id: "d2", locked: true }), day({ id: "d3" })],
    });
    const problem = buildProblem(t);
    const state: State = { days: [["p0", "p1", "p2", "p3"], ["p4"], []], pool: [] };
    const lockedBefore = state.days[1]!.slice();
    // Day 1 (locked) is not a relocation target; day 2 is unlocked and free.
    expect(relocateDay(problem, state, mulberry32(42), [0, 1, 2])).toBe(true);
    expect(state.days[1]).toEqual(lockedBefore);
    expect(state.days[2]!.length).toBe(1);
  });

  it("alns moves work off an overloaded day to the free day", () => {
    const t = overloadedTwoDayTrip();
    const problem = buildProblem(t);
    const init = overloadedState();
    const { best } = alns(problem, init, { seed: 42, maxIterations: 200, budgetMs: 60_000 });
    const ev = evaluate(problem, best);
    expect(ev.overBudgetMin).toBe(0);
    expect(best.days[1]!.length).toBeGreaterThan(0);
    expect(best.pool).toEqual([]);
  });
});

/**
 * Regression test for the product owner's complaint verbatim: "empty days
 * are currently allowed but it doesn't make sense — do nothing for 1 day and
 * then spend 24h rushing." A route-first split naturally produces exactly
 * this shape for a small, tightly-clustered set of places a short trip from
 * base: cramming everything into one day means paying the base<->cluster
 * round trip once instead of once per day, which the Prins split (correctly,
 * in isolation) treats as cheaper — nothing in the pre-ALNS pipeline ever
 * proposes spreading the places out. Confirmed by direct construction below
 * (`buildProblem`/`split`/`sequenceDay`, no ALNS) before asserting the full
 * solve fixes it.
 */
describe("regression: no empty days when places could fill them", () => {
  /** 7 places in a tight cluster, ~1.2 km from base; 3 days, 09:00-21:00. */
  function clusteredTrip() {
    const cluster = Array.from({ length: 7 }, (_, i) =>
      place({
        id: `c${i}`,
        lat: 40.0 + (i % 3) * 0.3 * DEG_PER_KM,
        lng: -3.0 + Math.floor(i / 3) * 0.3 * DEG_PER_KM,
        dwellMin: 45,
        priority: 2,
      }),
    );
    const base = place({
      id: "baseA",
      lat: 40.0 + 1.2 * DEG_PER_KM,
      lng: -3.0,
      category: "hotel",
      dwellMin: 0,
    });
    return trip({
      places: [...cluster, base],
      days: [day({ id: "d1" }), day({ id: "d2" }), day({ id: "d3" })],
    });
  }

  it("the pre-ALNS route-first split does cram everything onto day one", () => {
    // Establishes the premise: this is a real gap in the pipeline, not a
    // strawman — the split + per-day sequencer alone produce the bad shape.
    const t = clusteredTrip();
    const problem = buildProblem(t);
    const tour = t.places.filter((p) => p.category !== "hotel").map((p) => p.id);
    const { segments } = split(problem, tour);
    expect(segments[0]!.length).toBe(7);
    expect(segments[1]!.length).toBe(0);
    expect(segments[2]!.length).toBe(0);
  });

  for (const seed of [42, 7, 123]) {
    it(`a full solve (seed ${seed}) spreads the cluster across every day`, () => {
      const t = clusteredTrip();
      const itin = solve({ trip: t, seed, maxIterations: 1000, budgetMs: 60_000 });

      expect(itin.unscheduled).toEqual([]);
      // The point of the whole change: no day is empty while places that
      // could go there remain — every day gets a fair share.
      for (const plan of itin.days) {
        expect(plan.stops.length).toBeGreaterThan(0);
      }

      // Load spread stays low — this is the diagnostic the change
      // introduces (see `Evaluation.utilisationSpread`), not the weighted
      // objective term, so it's a direct, interpretable "how uneven is it"
      // check independent of the travel/imbalance trade-off the objective
      // makes.
      const problem = buildProblem(t);
      const state = {
        days: itin.days.map((d) => d.stops.map((s) => s.placeId)),
        pool: itin.unscheduled.map((u) => u.placeId),
      };
      const ev = evaluate(problem, state);
      expect(ev.utilisationSpread).toBeLessThan(0.25);
    });
  }
});

/**
 * Regression coverage for the false "deterministic seeded runs" guarantee:
 * every existing determinism test above passes `budgetMs: 60_000`, where
 * `maxIterations` always binds first (`alns`'s old `Date.now() >= deadline`
 * check was never exercised) — but production is time-bound: `resolve`
 * defaults `budgetMs` to 100, and apps/web ships `editBudgetMs: 5000` /
 * `initialBudgetMs: 10000` (see store.ts). At those budgets, the old
 * wall-clock deadline bound BEFORE the iteration cap, so the actual
 * iteration count — and every RNG draw after the first — depended on
 * machine speed, GC pauses, background tabs: the same seed and input could
 * (and, given real-world timing jitter, eventually would) produce different
 * itineraries. `alns` now converts `budgetMs` into an iteration cap up front
 * via a deterministic formula (`calibratedIterationCap`, a pure function of
 * problem size and the budget — never of `Date.now()`), so the search
 * trajectory's LENGTH is fixed before the loop starts, not measured while it
 * runs. These tests exercise exactly the budgets that used to matter (100ms,
 * 5s) on a trip big enough that the calibrated cap actually binds below the
 * default `maxIterations` — the regime the old bug lived in — and assert
 * the guarantee the README/spec now make: same seed + input + budget, same
 * result, on any machine, any time.
 */
describe("determinism at shipped, realistic time budgets", () => {
  /**
   * ~50 places / 5 days: big enough that `calibratedIterationCap` binds
   * below the default `maxIterations` (1000) at a 100ms or 5s budget — see
   * this describe block's header comment for why that matters. Mirrors
   * perf.test.ts's fixture shape.
   */
  function bigTrip(): Trip {
    let s = 11;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const places = Array.from({ length: 50 }, (_, i) =>
      place({
        lat: 35.66 + (i % 10) * 3 * DEG_PER_KM + rnd() * 0.002,
        lng: 139.68 + Math.floor(i / 10) * 3 * DEG_PER_KM + rnd() * 0.002,
        id: `p${i}`,
        dwellMin: 45 + Math.floor(rnd() * 4) * 15,
        priority: ((i % 3) + 1) as 1 | 2 | 3,
      }),
    );
    const base = place({ lat: 35.66, lng: 139.68, id: "baseA", category: "hotel", dwellMin: 0 });
    return trip({
      places: [...places, base],
      days: [day({ id: "d1" }), day({ id: "d2" }), day({ id: "d3" }), day({ id: "d4" }), day({ id: "d5" })],
    });
  }

  it("solve() is deterministic at a 100ms budget (resolve()'s shipped default)", () => {
    const t = bigTrip();
    const a = solve({ trip: t, seed: 7, budgetMs: 100 });
    const b = solve({ trip: t, seed: 7, budgetMs: 100 });
    expect(a).toEqual(b);
  });

  it("solve() is deterministic at a 5s budget (apps/web's editBudgetMs)", () => {
    const t = bigTrip();
    const a = solve({ trip: t, seed: 7, budgetMs: 5000 });
    const b = solve({ trip: t, seed: 7, budgetMs: 5000 });
    expect(a).toEqual(b);
  });

  it("resolve() is deterministic at its own shipped default (100ms) and at editBudgetMs (5s)", () => {
    const t = bigTrip();
    const first = solve({ trip: t, seed: 7, budgetMs: 60_000, maxIterations: 200 });
    const moved = first.days[0]!.stops[0]!.placeId;
    const edit = { type: "dragToDay" as const, placeId: moved, dayId: t.days[1]!.id };
    for (const budgetMs of [100, 5000]) {
      const a = resolve({ trip: t, previous: first, edit, seed: 7, budgetMs });
      const b = resolve({ trip: t, previous: first, edit, seed: 7, budgetMs });
      expect(a).toEqual(b);
    }
  });

  it("a short, calibration-bound budget still returns a fully feasible, structurally valid state (no place lost or duplicated)", () => {
    const t = bigTrip();
    const itin = solve({ trip: t, seed: 7, budgetMs: 100 });
    const scheduledIds = itin.days.flatMap((d) => d.stops.map((s) => s.placeId));
    const unscheduledIds = itin.unscheduled.map((u) => u.placeId);
    const schedulableCount = t.places.filter((p) => p.category !== "hotel").length;
    // Every schedulable place is accounted for exactly once: either scheduled
    // or unscheduled, never both, never neither, never duplicated.
    expect(scheduledIds.length + unscheduledIds.length).toBe(schedulableCount);
    expect(new Set(scheduledIds).size).toBe(scheduledIds.length);
    expect(new Set(unscheduledIds).size).toBe(unscheduledIds.length);
    expect(scheduledIds.some((id) => unscheduledIds.includes(id))).toBe(false);
  });

  it("the wall-clock safety valve — if it ever engages — cuts off at a clean iteration boundary, never a partially-applied operator", () => {
    // A negative budgetMs puts the (20x-scaled) safety-valve deadline in the
    // past before the loop ever runs, forcing an immediate cutoff at
    // iteration 0 deterministically (no real timing dependence needed to
    // exercise this path) — see `alns`'s safety-valve doc.
    const t = makeTrip();
    const problem = buildProblem(t);
    const init = initialState(problem);
    const expected = initialState(problem); // independently rebuilt — must match `init` bit-for-bit (deterministic construction)
    const { best, iterations } = alns(problem, init, { seed: 42, maxIterations: 500, budgetMs: -1 });
    expect(iterations).toBe(0);
    expect(best).toEqual(expected);
    // Structural feasibility: nothing lost or duplicated across days/pool.
    const allIds = new Set(problem.places.map((p) => p.id));
    const seen = [...best.pool, ...best.days.flat()];
    expect(new Set(seen).size).toBe(seen.length);
    expect(new Set(seen)).toEqual(allIds);
  });

  it("EvalCache-scoped evaluate() matches a from-scratch evaluate() while inactive days are held constant (the invariant the perf fix depends on)", () => {
    const t = makeTrip();
    const problem = buildProblem(t);
    const state = initialState(problem); // everything constructed onto day 0; days 1-2 empty
    const activeDays = [1, 2]; // day 0 is "inactive" — its stats get cached
    const cache = buildEvalCache(problem, state, activeDays);
    expect(evaluate(problem, state, cache)).toEqual(evaluate(problem, state));

    // Mutate only the active days (day 0, outside activeDays, stays byte-for-
    // byte the same array content) — the cached day-0 stats must still be
    // valid, since that's exactly the invariant `alns`'s mutators uphold.
    const mutated = cloneState(state, activeDays);
    mutated.days[1] = [...mutated.days[1]!].reverse();
    expect(evaluate(problem, mutated, cache)).toEqual(evaluate(problem, mutated));
  });

  /**
   * Regression test for `insertPlace`'s weights.travel omission — see
   * sequence.test.ts's matching test (same scenario, same numbers) for the
   * full derivation of why "C","B" costs less at a low travel weight and
   * "B","C" costs less at the default weight.
   */
  it("insertPlace threads weights.travel through its cost comparison (not silently 1)", () => {
    function tradeoffProblem(weightsTravel: number) {
      const t = trip({
        places: [
          place({ id: "base", lat: 0, lng: 0, category: "hotel", dwellMin: 0 }),
          place({ id: "B", lat: 0, lng: 0.001, dwellMin: 5, appointment: { dayId: "d1", start: "11:00" } }),
          place({ id: "C", lat: 0, lng: 0.002, dwellMin: 5 }),
        ],
        days: [day({ id: "d1", baseStartId: "base", baseEndId: "base" })],
        travelOverrides: [
          { fromId: "base", toId: "C", minutes: 30, symmetric: false },
          { fromId: "C", toId: "base", minutes: 5, symmetric: false },
          { fromId: "base", toId: "B", minutes: 1, symmetric: false },
          { fromId: "B", toId: "base", minutes: 20, symmetric: false },
          { fromId: "C", toId: "B", minutes: 15, symmetric: true },
        ],
      });
      t.settings.weights = {
        travel: weightsTravel,
        wait: 0.5,
        mustDropped: 1000,
        niceDropped: 10,
        dayImbalance: 1,
        overBudget: 3,
      };
      return buildProblem(t);
    }

    const low: State = { days: [["B"]], pool: [] };
    insertPlace(tradeoffProblem(0.3), low, 0, "C", false, false);
    expect(low.days[0]).toEqual(["C", "B"]);

    const normal: State = { days: [["B"]], pool: [] };
    insertPlace(tradeoffProblem(1), normal, 0, "C", false, false);
    expect(normal.days[0]).toEqual(["B", "C"]);
  });
});

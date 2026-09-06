import { describe, expect, it } from "vitest";
import { solve } from "./solve";
import { evaluate } from "./alns";
import { buildProblem } from "./matrix";
import { WARSAW_PLACE_COUNT, warsawTrip } from "./fixtures/warsaw";

/**
 * Regression guard on the Warsaw fixture (22 curated places + Hotel Bristol
 * base, 4 days). The solver is deterministic, so these recorded baselines must
 * hold exactly; a change that alters them is a solver behaviour change and the
 * baselines should be consciously re-recorded.
 * Re-checked for add-day-rebalancing (overBudget objective term + day
 * rebalancing operators): solutions are unchanged, so the baselines stand.
 *
 * Re-recorded for level-day-load (see openspec/changes/archive/
 * 2026-09-06-level-day-load): the schedule itself is UNCHANGED — travel
 * (328.8) and unscheduled count (0) are identical, and re-scoring the exact
 * same days/stops under the new objective reproduces 446.3 exactly. The
 * score moved purely because the imbalance term's formula changed (a
 * per-day utilisation measure, total absolute deviation scaled to minutes,
 * in place of the old end-time-range) — this fixture was already
 * well-balanced (utilisation spread 0.117, unchanged) so the new operators
 * had nothing to fix and left it alone.
 *
 * Re-recorded for the mode-curve travel-time rework (`heuristicEntry` in
 * matrix.ts: minimum of walk/urban-transit/regional-rail cost curves in
 * place of a single distance threshold + flat transit speed). Travel rose
 * 328.8 -> 345.9 (+5%) — this fixture is all central-Warsaw sightseeing, so
 * every non-walking leg now pays the higher urban-transit overhead (8 -> 12
 * min); no leg here is long enough for the new regional-rail curve to ever
 * win. Unscheduled count is unchanged at 0 and every day is still within
 * budget (0 over-budget minutes — see the "within the day budget" test
 * below). Score rose further than travel alone would predict, 446.3 ->
 * 566.8, because the reshaped cost landscape moved the ALNS search's local
 * optimum to a somewhat less evenly-loaded arrangement (utilisation spread
 * ~0.12 -> ~0.20 across the 4 days) — a legitimate re-optimisation under the
 * new costs within the fixed iteration/time budget, not a regression: no
 * place is dropped and no day is overbooked.
 *
 * Re-recorded for the balance-gate-cliff fix (`IMBALANCE_GATE_THRESHOLD` in
 * alns.ts replaced by `balanceAttemptProbability`, a continuous ramp). The
 * hard 0.2 threshold above had become a resting point, not a coincidence:
 * below it the balance operators never fired at all, so once the travel-cost
 * rework above pushed this fixture's spread up to exactly 0.2, nothing could
 * push it back down. With attempt odds now scaling continuously with spread
 * instead of switching off at that cliff, this fixture's spread comes down
 * to ~0.107 (checked explicitly, not just eyeballed - see "keeps day-load
 * spread meaningfully below the old hard gate" below) at the cost of a small
 * travel increase, 345.9 -> 349.1 (+0.9%) - a legitimate balance/travel
 * trade-off, not balance overwhelming travel. Score moved 566.8 -> 452.8,
 * entirely from the smaller imbalance term (better-balanced days deviate
 * less from the mean); unscheduled count is unchanged at 0 and no day is
 * overbooked.
 *
 * Re-recorded for the rotation-search perf fix (see tokyo.test.ts's matching
 * note for the full mechanism: `solve.ts`'s O(N)-rotation `split()` search
 * replaced by a constant `ROTATION_CANDIDATES` (8) longest-edge cut
 * selection). Here the DP cost of the chosen split (2015) is IDENTICAL to
 * the old exhaustive search's best — but it's a tie: the old search settled
 * it at rotation index 4, the new candidate-subset search at a different,
 * equally-optimal rotation index 21 (both forward, neither reversed), so the
 * actual day segments handed to ALNS differ even though their DP cost does
 * not. That different (but equally good, by the DP's own metric) starting
 * point sends ALNS's fixed 1000-iteration seeded random walk down a
 * different path, landing in a better final local optimum for this seed:
 * score 531.7 -> 477.2, travel 408 -> 405.4 (both improved). Unscheduled
 * count is unchanged at 0 and no day is overbooked.
 */
const BASELINES = {
  score: 477.2,
  totalTravelMin: 405.4,
  unscheduledCount: 0,
};

describe("warsaw fixture regression", () => {
  const trip = warsawTrip();

  it("fixture has 22 places and 4 days", () => {
    expect(WARSAW_PLACE_COUNT).toBe(23); // 22 places + Hotel Bristol
    expect(trip.days).toHaveLength(4);
    expect(trip.places.filter((p) => p.dwellMin > 0)).toHaveLength(22);
    // Every day wakes up and sleeps at Hotel Bristol.
    for (const day of trip.days) {
      expect(day.baseStartId).toBe("plc_hotel_bristol");
      expect(day.baseEndId).toBe("plc_hotel_bristol");
    }
  });

  it("matches recorded score / travel / unscheduled baselines", () => {
    const itin = solve({ trip, seed: 42, maxIterations: 1000, budgetMs: 60_000 });
    expect(itin.stats.score).toBe(BASELINES.score);
    expect(itin.stats.totalTravelMin).toBe(BASELINES.totalTravelMin);
    expect(itin.unscheduled).toHaveLength(BASELINES.unscheduledCount);
  });

  it("is deterministic for the same seed and input", () => {
    const a = solve({ trip: warsawTrip(), seed: 42, maxIterations: 1000, budgetMs: 60_000 });
    const b = solve({ trip: warsawTrip(), seed: 42, maxIterations: 1000, budgetMs: 60_000 });
    expect(a).toEqual(b);
  });

  it("emits only whole-minute times (no float artifacts)", () => {
    const itin = solve({ trip, seed: 42, maxIterations: 1000, budgetMs: 60_000 });
    for (const plan of itin.days) {
      for (const stop of plan.stops) {
        expect(stop.arrive).toMatch(/^\d{2}:\d{2}$/);
        expect(stop.depart).toMatch(/^\d{2}:\d{2}$/);
        expect(Number.isInteger(stop.waitMin)).toBe(true);
      }
    }
  });

  it("schedules places on every day within the day budget", () => {
    const itin = solve({ trip, seed: 42, maxIterations: 1000, budgetMs: 60_000 });
    for (const plan of itin.days) {
      expect(plan.stops.length).toBeGreaterThan(0);
      expect(plan.slackMin).toBeGreaterThanOrEqual(0);
      // Routes start and end at the hotel base.
      expect(plan.legs[0]!.fromId).toBe("plc_hotel_bristol");
      expect(plan.legs[plan.legs.length - 1]!.toId).toBe("plc_hotel_bristol");
    }
    // No avoidable overbooking: total over-budget minutes across all days is 0.
    const totalOverrun = itin.days.reduce((acc, d) => acc + Math.max(0, -d.slackMin), 0);
    expect(totalOverrun).toBe(0);
  });

  it("keeps day-load spread meaningfully below the old hard gate, not parked on it", () => {
    // Regression guard for the balance-gate-cliff bug: a HARD spread
    // threshold gating the balance operators (IMBALANCE_GATE_THRESHOLD, now
    // replaced by a continuous ramp in balanceAttemptProbability) made that
    // threshold a resting point — below it the operators never fired, so the
    // search had no way to improve balance past the cutoff. This fixture's
    // spread settled at exactly the old 0.2 threshold after an unrelated
    // travel-cost change (see the header comment above). The bar here is
    // deliberately not "< 0.2" — a threshold-parked value would pass that
    // trivially. 0.15 is comfortably below the old gate (0.2) and below
    // MIN_LOAD_GAP (0.15 in alns.ts, the recipient-selection floor) too, so
    // clearing it demonstrates the search can improve balance past *both*
    // knobs, not just the one this change touched.
    const itin = solve({ trip, seed: 42, maxIterations: 1000, budgetMs: 60_000 });
    const problem = buildProblem(trip);
    const state = {
      days: itin.days.map((d) => d.stops.map((s) => s.placeId)),
      pool: itin.unscheduled.map((u) => u.placeId),
    };
    const ev = evaluate(problem, state);
    expect(ev.utilisationSpread).toBeLessThan(0.15);
  });
});

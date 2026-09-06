import { describe, expect, it } from "vitest";
import { resolve, solve } from "./solve";
import { day, place, trip } from "./testUtils";
import type { Trip } from "@app/domain";

/**
 * A synthetic N-place trip laid out on a city-like grid (N=50 target).
 *
 * Perf-investigation notes (see the writeup this file's assertions are
 * calibrated against): profiling `resolve()` end to end at this trip size
 * found `buildProblem` + `sequenceDay` + `validateTripInput` overhead is a
 * few milliseconds total — not the "roughly a second outside the ALNS loop"
 * an earlier read of this test's numbers assumed. That earlier read
 * conflated this test's OWN setup step (`first = solve(...)`, a full solve
 * with its own ALNS budget) with the `elapsed` this test actually measures
 * (only the `resolve()` call) — the two are different operations with
 * different costs, and only `elapsed` corresponds to what a user's edit
 * actually pays. The real, now-fixed dominant cost outside the ALNS loop was
 * `giantTour`'s Or-opt step recomputing the whole tour's cost (an O(n) walk)
 * for every candidate relocation instead of an O(1) edge delta — see
 * `giantTour.ts`'s Or-opt comment — which inflated exactly this file's setup
 * step (a full `solve()`, which runs `giantTour`) but never touched
 * `resolve()` (which does not call `giantTour` at all: an incremental
 * resolve reuses the previous itinerary's day orders as its starting point).
 * `resolve()` itself was already fast; it just shared this file with a setup
 * step that was not.
 */
function makeTrip(n: number): Trip {
  let s = 99;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const places = Array.from({ length: n }, (_, i) =>
    place({
      lat: 35.66 + (i % 10) * 3 * (1 / 111.195) + rnd() * 0.002,
      lng: 139.68 + Math.floor(i / 10) * 3 * (1 / 111.195) + rnd() * 0.002,
      id: `p${i}`,
      dwellMin: 45 + Math.floor(rnd() * 4) * 15,
      priority: ((i % 3) + 1) as 1 | 2 | 3,
    }),
  );
  // `day()` defaults every day's base to "baseA" — it must resolve to a real
  // place (validateTripInput now rejects a dangling base reference).
  const base = place({ lat: 35.66, lng: 139.68, id: "baseA", category: "hotel", dwellMin: 0 });
  return trip({
    places: [...places, base],
    days: [day({ id: "d1" }), day({ id: "d2" }), day({ id: "d3" }), day({ id: "d4" }), day({ id: "d5" })],
  });
}

describe("performance (N=50, generous CI margins)", () => {
  it("full solve completes within the time budget", () => {
    const t = makeTrip(50);
    const t0 = performance.now();
    const itin = solve({ trip: t, seed: 7, budgetMs: 1000, maxIterations: 2000 });
    const elapsed = performance.now() - t0;
    expect(itin.days).toHaveLength(5);
    // Budget + generous CI margin for slow runners.
    expect(elapsed).toBeLessThan(3000);
  });

  /**
   * Measures ONLY the `resolve()` call (the setup `first = solve(...)` above
   * it is a separate, unmeasured operation — see this file's header
   * comment). Typical local measurement is ~85-150ms at this trip size and
   * budget; 800ms leaves comfortable headroom for a slow CI runner while
   * still failing loudly if `resolve()` regresses back toward
   * multi-hundred-millisecond territory. This is resolve()'s own
   * `budgetMs: 100` (its shipped default when apps/web doesn't override it),
   * not apps/web's `editBudgetMs: 5000` — see
   * "edit re-solve at the shipped editBudgetMs stays fast" below for that
   * configuration.
   */
  it("edit re-solve at a 100ms ALNS budget completes in well under a second", () => {
    const t = makeTrip(50);
    const first = solve({ trip: t, seed: 7, budgetMs: 1000, maxIterations: 2000 });
    const moved = first.days[0]!.stops[0]!.placeId;
    const targetId = t.days[1]!.id;

    const t0 = performance.now();
    const second = resolve({
      trip: t,
      previous: first,
      edit: { type: "dragToDay", placeId: moved, dayId: targetId },
      seed: 7,
      budgetMs: 100,
      maxIterations: 300,
    });
    const elapsed = performance.now() - t0;

    expect(second.days).toHaveLength(5);
    expect(elapsed).toBeLessThan(800);
  });

  /**
   * Same edit, but at apps/web's actual shipped `editBudgetMs` (5000) with no
   * `maxIterations` override — i.e. exactly what `store.ts`'s `requestSolve`
   * passes `resolve()` for a live drag. `resolve()`'s own default
   * `maxIterations` (300) binds well before a 5s budget's calibrated
   * iteration cap would (see `calibratedIterationCap` in alns.ts), so this
   * runs the same ~300 iterations as the 100ms-budget case above and finishes
   * in comparable time — the generous 5s budget is headroom for large/complex
   * edits, not something an ordinary edit spends. This test exists so a
   * future change to either default has to fail a test here before it can
   * silently turn "well under a second" into a real 5-second edit stall.
   */
  it("edit re-solve at the shipped editBudgetMs (5000) stays fast", () => {
    const t = makeTrip(50);
    const first = solve({ trip: t, seed: 7, budgetMs: 1000, maxIterations: 2000 });
    const moved = first.days[0]!.stops[0]!.placeId;
    const targetId = t.days[1]!.id;

    const t0 = performance.now();
    const second = resolve({
      trip: t,
      previous: first,
      edit: { type: "dragToDay", placeId: moved, dayId: targetId },
      seed: 7,
      budgetMs: 5000, // apps/web's flags.editBudgetMs — no maxIterations override.
    });
    const elapsed = performance.now() - t0;

    expect(second.days).toHaveLength(5);
    expect(elapsed).toBeLessThan(800);
  });
});

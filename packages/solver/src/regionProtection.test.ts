import { describe, expect, it } from "vitest";
import { insertPlace, regionCompatible, type State } from "./alns";
import { buildProblem } from "./matrix";
import { solve } from "./solve";
import { DEG_PER_KM, day, place, trip } from "./testUtils";

/**
 * A two-district trip: an over-loaded cluster of "A" places near day 1's
 * base, and a light cluster of "B" places near day 2's base — far enough
 * apart (50km) that a route-first tour would have to cross the gap, and
 * close enough within each cluster that any reasonable clustering keeps
 * them together. Day 1's "A" places (3 must-see that comfortably fit, plus
 * 3 nice-to-have that together overflow the day) are deliberately more than
 * its window can hold, so — absent region protection — the ALNS/repair
 * operators would want to relocate the nice-to-have overflow onto day 2's
 * spare capacity rather than drop it; that's exactly the move the
 * clusterFirst region-protection constraint (`alns.ts`'s
 * `regionCompatible`) must refuse. (The overflow is deliberately
 * nice-priority, not must — a must-priority place is *supposed* to bypass
 * region protection in the final repair pass per Decision 2.5, so testing
 * with must-priority overflow would exercise that intentional override
 * instead of the ordinary operator constraint this test targets.)
 */
function makeTwoDistrictTrip(solverStrategy: "routeFirst" | "clusterFirst") {
  const baseA = place({ id: "baseA", lat: 0, lng: 0, category: "hotel", dwellMin: 0 });
  const baseB = place({ id: "baseB", lat: 50 * DEG_PER_KM, lng: 0, category: "hotel", dwellMin: 0 });

  // 3 must-see places near base A (300min dwell — fits the 720min window
  // easily on its own) plus 3 nice-to-have places (150min each — 450min)
  // that push the day over budget once all six are considered together.
  const districtAMust = Array.from({ length: 3 }, (_, i) =>
    place({ id: `am${i}`, lat: i * 0.02 * DEG_PER_KM, lng: 0, dwellMin: 100, priority: 1, region: "A" }),
  );
  const districtANice = Array.from({ length: 3 }, (_, i) =>
    place({ id: `an${i}`, lat: 0, lng: i * 0.02 * DEG_PER_KM, dwellMin: 150, priority: 3, region: "A" }),
  );
  // 4 places near base B (480min dwell — 66.7% of the 720min window,
  // sitting above the 65% under-load spillover threshold so region
  // protection holds during search, while still leaving 240min of spare
  // capacity that an overflowing "A" place (150min) would easily fit into
  // absent region protection).
  const districtB = [
    place({ id: "b0", lat: 50 * DEG_PER_KM, lng: 0.05 * DEG_PER_KM, dwellMin: 120, priority: 2, region: "B" }),
    place({ id: "b1", lat: 50.05 * DEG_PER_KM, lng: 0, dwellMin: 120, priority: 2, region: "B" }),
    place({ id: "b2", lat: 50.02 * DEG_PER_KM, lng: 0.02 * DEG_PER_KM, dwellMin: 120, priority: 2, region: "B" }),
    place({ id: "b3", lat: 50.04 * DEG_PER_KM, lng: 0.04 * DEG_PER_KM, dwellMin: 120, priority: 2, region: "B" }),
  ];

  const t = trip({
    places: [baseA, baseB, ...districtAMust, ...districtANice, ...districtB],
    days: [
      day({ id: "d1", baseStartId: "baseA", baseEndId: "baseA" }),
      day({ id: "d2", baseStartId: "baseB", baseEndId: "baseB" }),
    ],
  });
  t.settings.solverStrategy = solverStrategy;
  return t;
}

describe("region protection through the real solve() path", () => {
  it("clusterFirst: never mixes a region into a day already dedicated to a different one, even under load pressure", () => {
    const t = makeTwoDistrictTrip("clusterFirst");
    const itinerary = solve({ trip: t, seed: 42, maxIterations: 300, budgetMs: 2000 });

    const regionOf = new Map<string, string>([
      ...Array.from({ length: 3 }, (_, i) => [`am${i}`, "A"] as const),
      ...Array.from({ length: 3 }, (_, i) => [`an${i}`, "A"] as const),
      ["b0", "B"],
      ["b1", "B"],
      ["b2", "B"],
      ["b3", "B"],
    ]);

    for (const dayPlan of itinerary.days) {
      const regionsOnDay = new Set(
        dayPlan.stops.map((s) => regionOf.get(s.placeId)).filter((r): r is string => r !== undefined),
      );
      // A day may legitimately hold zero or one region's worth of
      // region-tagged places, but never two different regions.
      expect(regionsOnDay.size).toBeLessThanOrEqual(1);
    }

    // Day 1's overload must be resolved by dropping the nice-to-have
    // overflow (or squeezing it into day 1) — never by spilling an "A"
    // place onto day 2, which is exclusively "B".
    const day2 = itinerary.days.find((d) => d.dayId === "d2")!;
    for (const stop of day2.stops) {
      expect(regionOf.get(stop.placeId)).not.toBe("A");
    }
    // All 3 must-see "A" places are always scheduled somewhere.
    for (let i = 0; i < 3; i++) {
      expect(itinerary.unscheduled.some((u) => u.placeId === `am${i}`)).toBe(false);
    }
  });

  it("routeFirst: Place.region has no effect on the resulting itinerary", () => {
    const withRegions = makeTwoDistrictTrip("routeFirst");
    const withoutRegions = makeTwoDistrictTrip("routeFirst");
    for (const p of withoutRegions.places) delete p.region;

    const a = solve({ trip: withRegions, seed: 42, maxIterations: 300, budgetMs: 2000 });
    const b = solve({ trip: withoutRegions, seed: 42, maxIterations: 300, budgetMs: 2000 });

    // Same stop assignment per day and the same score — region is inert.
    expect(a.days.map((d) => d.stops.map((s) => s.placeId))).toEqual(
      b.days.map((d) => d.stops.map((s) => s.placeId)),
    );
    expect(a.stats.score).toBe(b.stats.score);
  });
});

describe("regionCompatible: set-based mixing and centroid adjacency", () => {
  /**
   * Three regions: "A" and "B" are tight clusters ~1km apart (within
   * `DEFAULT_ADJACENCY_THRESHOLD_KM`, so adjacent); "C" is ~50km away from
   * both (far outside the threshold, so non-adjacent to either).
   */
  // "a0" is dwelled long enough (500 of the day's 720-min window, ~69%) to
  // sit above the default 65% under-load spillover threshold on its own —
  // these tests target the base set/adjacency rules, not the spillover
  // bypass (see the "under-utilized day spillover" describe block below for
  // that), so the day must read as adequately loaded for a rejection to mean
  // what it says.
  function makeThreeRegionProblem() {
    const a0 = place({ id: "a0", region: "A", lat: 0, lng: 0, dwellMin: 500 });
    const b0 = place({ id: "b0", region: "B", lat: 1 * DEG_PER_KM, lng: 0 });
    const c0 = place({ id: "c0", region: "C", lat: 50 * DEG_PER_KM, lng: 0 });

    const t = trip({
      places: [a0, b0, c0],
      days: [day({ id: "d1" })],
    });
    t.settings.solverStrategy = "clusterFirst";
    return buildProblem(t);
  }

  it("a day mixed with 'A' and 'B' accepts a new place from 'A' (mixed-day lockout fix)", () => {
    const problem = makeThreeRegionProblem();
    const state: State = { days: [["a0", "b0"]], pool: [] };
    const newA = place({ id: "a1", region: "A", lat: 0.01 * DEG_PER_KM, lng: 0 });
    problem.placesById.set("a1", newA);
    expect(regionCompatible(problem, state, 0, "a1")).toBe(true);
  });

  it("a day mixed with 'A' and 'B' rejects a place from 'C' (far, non-adjacent)", () => {
    const problem = makeThreeRegionProblem();
    const state: State = { days: [["a0", "b0"]], pool: [] };
    expect(regionCompatible(problem, state, 0, "c0")).toBe(false);
  });

  it("a day with only 'A' accepts a place from adjacent 'B'", () => {
    const problem = makeThreeRegionProblem();
    const state: State = { days: [["a0"]], pool: [] };
    expect(regionCompatible(problem, state, 0, "b0")).toBe(true);
  });

  it("a day with only 'A' rejects a place from non-adjacent 'C'", () => {
    const problem = makeThreeRegionProblem();
    const state: State = { days: [["a0"]], pool: [] };
    expect(regionCompatible(problem, state, 0, "c0")).toBe(false);
  });

  it("an empty day accepts any region", () => {
    const problem = makeThreeRegionProblem();
    const state: State = { days: [[]], pool: [] };
    expect(regionCompatible(problem, state, 0, "c0")).toBe(true);
  });

  it("insertPlace with respectRegions=true honours the same rules", () => {
    const problem = makeThreeRegionProblem();
    const state: State = { days: [["a0", "b0"]], pool: [] };
    // "c0" (non-adjacent to A or B) must be refused.
    expect(insertPlace(problem, state, 0, "c0", false, true)).toBe(false);
    expect(state.days[0]).not.toContain("c0");
  });
});

describe("regionCompatible: under-utilized day spillover (task 2.3)", () => {
  /** A single "A"-region day, with a configurable occupant dwell and a 600-min window. */
  function makeUnderLoadProblem(occupantDwellMin: number) {
    const a0 = place({ id: "a0", region: "A", lat: 0, lng: 0, dwellMin: occupantDwellMin });
    const c0 = place({ id: "c0", region: "C", lat: 50 * DEG_PER_KM, lng: 0, priority: 2 });

    const t = trip({
      places: [a0, c0],
      days: [day({ id: "d1", start: "09:00", end: "19:00" })], // 600-min window
    });
    t.settings.solverStrategy = "clusterFirst";
    const problem = buildProblem(t);
    return problem;
  }

  it("allows a low-priority, mismatched-region place onto a day loaded below 65%", () => {
    // 300 / 600 = 50% utilization — below the default 0.65 threshold.
    const problem = makeUnderLoadProblem(300);
    const state: State = { days: [["a0"]], pool: [] };
    expect(regionCompatible(problem, state, 0, "c0")).toBe(true);
  });

  it("still rejects the same place once the day is loaded at/above 65%", () => {
    // 400 / 600 ≈ 66.7% utilization — above the default 0.65 threshold.
    const problem = makeUnderLoadProblem(400);
    const state: State = { days: [["a0"]], pool: [] };
    expect(regionCompatible(problem, state, 0, "c0")).toBe(false);
  });

  it("does not bypass region protection for a must-priority (priority 1) place, even on an under-loaded day", () => {
    const problem = makeUnderLoadProblem(300);
    const mustC = place({ id: "c_must", region: "C", lat: 50 * DEG_PER_KM, lng: 0, priority: 1 });
    problem.placesById.set("c_must", mustC);
    const state: State = { days: [["a0"]], pool: [] };
    expect(regionCompatible(problem, state, 0, "c_must")).toBe(false);
  });

  it("honours a custom utilizationThreshold argument", () => {
    // 300 / 600 = 50% — below a raised 0.9 threshold, so the bypass applies.
    const problem = makeUnderLoadProblem(300);
    const state: State = { days: [["a0"]], pool: [] };
    expect(regionCompatible(problem, state, 0, "c0", 0.9)).toBe(true);
    // Disabling the bypass entirely (threshold 0) must fall back to the base rules.
    expect(regionCompatible(problem, state, 0, "c0", 0)).toBe(false);
  });
});

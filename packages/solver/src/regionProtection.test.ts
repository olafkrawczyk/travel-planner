import { describe, expect, it } from "vitest";
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
  // 2 light places near base B — day 2 has plenty of spare capacity.
  const districtB = [
    place({ id: "b0", lat: 50 * DEG_PER_KM, lng: 0.05 * DEG_PER_KM, dwellMin: 60, priority: 2, region: "B" }),
    place({ id: "b1", lat: 50.05 * DEG_PER_KM, lng: 0, dwellMin: 60, priority: 2, region: "B" }),
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

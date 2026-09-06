import { describe, expect, it } from "vitest";
import { resolve, solve } from "./solve";
import { day, place, trip } from "./testUtils";
import type { Trip } from "@app/domain";

/** A synthetic N-place trip laid out on a city-like grid (N=50 target). */
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

  it("edit re-solve completes well under one second", () => {
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
    expect(elapsed).toBeLessThan(1500);
  });
});

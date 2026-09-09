import { describe, expect, it } from "vitest";
import { clusterPlaces, clusterFirstSequence } from "./cluster";
import { buildProblem } from "./matrix";
import { day, place, trip, DEG_PER_KM } from "./testUtils";

describe("clusterFirst strategy", () => {
  it("groups places by their region", () => {
    // Two tight clusters separated by ~50km
    const p1 = place({ id: "p1", region: "A", lat: 35.66, lng: 139.68 });
    const p2 = place({ id: "p2", region: "A", lat: 35.66 + 0.5 * DEG_PER_KM, lng: 139.68 });

    const p3 = place({ id: "p3", region: "B", lat: 35.66 + 50 * DEG_PER_KM, lng: 139.68 });
    const p4 = place({ id: "p4", region: "B", lat: 35.66 + 50.5 * DEG_PER_KM, lng: 139.68 });

    const clusters = clusterPlaces([p1, p2, p3, p4]);
    expect(clusters).toHaveLength(2);
    
    // Sort so we can deterministically check sizes
    clusters.sort((a, b) => a.places.length - b.places.length);
    expect(clusters[0]!.places).toHaveLength(2);
    expect(clusters[1]!.places).toHaveLength(2);
  });

  it("assigns clusters to the nearest base day", () => {
    // Hakone (approx lat 35.2, lng 139.0)
    const hakonePlace = place({ id: "hakone_1", lat: 35.2, lng: 139.0 });
    // Tokyo (approx lat 35.6, lng 139.7)
    const tokyoPlace = place({ id: "tokyo_1", lat: 35.6, lng: 139.7 });
    
    // Base in Tokyo
    const tokyoBase = place({ id: "tokyo_base", lat: 35.6, lng: 139.7, category: "hotel" });
    // Base in Hakone
    const hakoneBase = place({ id: "hakone_base", lat: 35.2, lng: 139.0, category: "hotel" });

    const t = trip({
      places: [hakonePlace, tokyoPlace, tokyoBase, hakoneBase],
      days: [
        day({ id: "d1", baseStartId: "tokyo_base", baseEndId: "tokyo_base" }),
        day({ id: "d2", baseStartId: "hakone_base", baseEndId: "hakone_base" }),
      ],
    });

    const problem = buildProblem(t);
    const segments = clusterFirstSequence(problem);
    
    expect(segments).toHaveLength(2);
    // Day 1 (Tokyo base) should get Tokyo place
    expect(segments[0]).toEqual(["tokyo_1"]);
    // Day 2 (Hakone base) should get Hakone place
    expect(segments[1]).toEqual(["hakone_1"]);
  });

  it("splits a large cluster across a 3-day base camp based on time budgets, instead of dumping it onto day 1", () => {
    const base = place({ id: "base", lat: 35.66, lng: 139.68, category: "hotel", dwellMin: 0 });

    // 9 tightly-clustered "A" places (all within ~0.5km of each other and the
    // base) whose combined dwell time (1800min) comfortably fits a 3-day base
    // camp's window (3 * 720min = 2160min) but overflows a single day's
    // 720min window several times over — so a correct localized DP split
    // must spread them across all 3 days, not dump them all onto day 1.
    const places = Array.from({ length: 9 }, (_, i) =>
      place({
        id: `p${i}`,
        region: "A",
        lat: 35.66 + (i * 0.02) * DEG_PER_KM,
        lng: 139.68,
        dwellMin: 200,
      }),
    );

    const t = trip({
      places: [base, ...places],
      days: [
        day({ id: "d1", baseStartId: "base", baseEndId: "base" }),
        day({ id: "d2", baseStartId: "base", baseEndId: "base" }),
        day({ id: "d3", baseStartId: "base", baseEndId: "base" }),
      ],
    });
    t.settings.solverStrategy = "clusterFirst";

    const problem = buildProblem(t);
    const segments = clusterFirstSequence(problem);

    expect(segments).toHaveLength(3);

    // All 9 places are scheduled somewhere across the 3-day base camp.
    const allScheduled = segments.flat();
    expect(allScheduled).toHaveLength(9);
    expect(new Set(allScheduled)).toEqual(new Set(places.map((p) => p.id)));

    // The cluster must not be dumped entirely onto day 1 — at least one
    // other day in the base camp must also receive some of the cluster.
    expect(segments[0]!.length).toBeLessThan(9);
    expect(segments[1]!.length + segments[2]!.length).toBeGreaterThan(0);

    // Every day in the base camp actually participates in the split.
    expect(segments[0]!.length).toBeGreaterThan(0);
    expect(segments[1]!.length).toBeGreaterThan(0);
    expect(segments[2]!.length).toBeGreaterThan(0);
  });
});

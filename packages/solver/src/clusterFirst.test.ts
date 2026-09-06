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
});

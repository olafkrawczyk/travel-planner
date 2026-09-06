import { describe, expect, it } from "vitest";
import { haversineKm } from "@app/geo";
import { recommendHotelAreas, weightForPlace, weightedGeometricMedian } from "./hotelArea";
import { DEG_PER_KM, day, place, trip } from "./testUtils";

describe("weightForPlace", () => {
  it("maps priority to a 3:2:1 multiplier (1 = must)", () => {
    const dwell = 60;
    expect(weightForPlace(place({ lat: 0, lng: 0, priority: 1, dwellMin: dwell }))).toBe(3 * dwell);
    expect(weightForPlace(place({ lat: 0, lng: 0, priority: 2, dwellMin: dwell }))).toBe(2 * dwell);
    expect(weightForPlace(place({ lat: 0, lng: 0, priority: 3, dwellMin: dwell }))).toBe(1 * dwell);
  });

  it("floors dwellMin at 15 minutes so no place is ever zero-weight", () => {
    expect(weightForPlace(place({ lat: 0, lng: 0, priority: 3, dwellMin: 0 }))).toBe(1 * 15);
    expect(weightForPlace(place({ lat: 0, lng: 0, priority: 3, dwellMin: 5 }))).toBe(1 * 15);
    expect(weightForPlace(place({ lat: 0, lng: 0, priority: 1, dwellMin: 10 }))).toBe(3 * 15);
  });

  it("uses the real dwell once it exceeds the floor", () => {
    expect(weightForPlace(place({ lat: 0, lng: 0, priority: 2, dwellMin: 100 }))).toBe(2 * 100);
  });
});

describe("weightedGeometricMedian", () => {
  it("returns {lat:0, lng:0} for zero points (degenerate, callers must guard)", () => {
    expect(weightedGeometricMedian([])).toEqual({ lat: 0, lng: 0 });
  });

  it("returns the single point exactly for one point", () => {
    const result = weightedGeometricMedian([{ lat: 12.3, lng: 45.6, weight: 7 }]);
    expect(result).toEqual({ lat: 12.3, lng: 45.6 });
  });

  it("converges to the exact point for identical inputs", () => {
    const pts = [
      { lat: 10, lng: 20, weight: 1 },
      { lat: 10, lng: 20, weight: 5 },
      { lat: 10, lng: 20, weight: 2 },
    ];
    const result = weightedGeometricMedian(pts);
    expect(result.lat).toBeCloseTo(10, 6);
    expect(result.lng).toBeCloseTo(20, 6);
  });

  it("converges near the centroid for near-identical inputs", () => {
    const pts = [
      { lat: 10.0001, lng: 20.0001, weight: 1 },
      { lat: 9.9999, lng: 19.9999, weight: 1 },
      { lat: 10.0, lng: 20.0, weight: 1 },
    ];
    const result = weightedGeometricMedian(pts);
    expect(result.lat).toBeCloseTo(10, 3);
    expect(result.lng).toBeCloseTo(20, 3);
  });

  it("does not throw and stays finite for exactly-coincident points (division-by-zero guard)", () => {
    const pts = [
      { lat: 5, lng: 5, weight: 1 },
      { lat: 5, lng: 5, weight: 1 },
    ];
    const result = weightedGeometricMedian(pts);
    expect(Number.isFinite(result.lat)).toBe(true);
    expect(Number.isFinite(result.lng)).toBe(true);
  });

  it("pulls toward the heavier-weighted cluster for two clusters of unequal weight", () => {
    // Cluster A (heavy) near (0,0); cluster B (light) ~50km away.
    const clusterA = [
      { lat: 0, lng: 0, weight: 1000 },
      { lat: 0.01 * DEG_PER_KM, lng: 0, weight: 1000 },
      { lat: 0, lng: 0.01 * DEG_PER_KM, weight: 1000 },
    ];
    const clusterB = [
      { lat: 50 * DEG_PER_KM, lng: 0, weight: 1 },
      { lat: 50.01 * DEG_PER_KM, lng: 0, weight: 1 },
      { lat: 50 * DEG_PER_KM, lng: 0.01 * DEG_PER_KM, weight: 1 },
    ];
    const result = weightedGeometricMedian([...clusterA, ...clusterB]);
    const distToA = haversineKm(result.lat, result.lng, 0, 0);
    const distToB = haversineKm(result.lat, result.lng, 50 * DEG_PER_KM, 0);
    expect(distToA).toBeLessThan(distToB);
    // Heavily dominated by A's weight (1000x), so the result should land
    // very close to A, not merely "somewhat closer".
    expect(distToA).toBeLessThan(1);
  });
});

describe("recommendHotelAreas: degenerate inputs", () => {
  it("returns [] for a trip with zero days, without throwing", () => {
    const t = trip({ places: [], days: [] });
    expect(() => recommendHotelAreas(t)).not.toThrow();
    expect(recommendHotelAreas(t)).toEqual([]);
  });

  it("reports 'not enough places' for a segment with zero eligible places", () => {
    // Only a hotel place (excluded) — no schedulable place with a location.
    const base = place({ id: "baseA", lat: 0, lng: 0, category: "hotel", dwellMin: 0 });
    const t = trip({ places: [base], days: [day({ id: "d1" })] });
    const result = recommendHotelAreas(t);
    expect(result).toHaveLength(1);
    expect(result[0]!.candidates).toEqual([]);
    expect(result[0]!.note).toBeTruthy();
  });

  it("gives a single, precise, low-radius candidate for exactly one eligible place", () => {
    const base = place({ id: "baseA", lat: 0, lng: 0, category: "hotel", dwellMin: 0 });
    const p = place({ id: "p1", lat: 1 * DEG_PER_KM, lng: 0, priority: 2, dwellMin: 60 });
    const t = trip({ places: [base, p], days: [day({ id: "d1" })] });
    const result = recommendHotelAreas(t);
    expect(result).toHaveLength(1);
    expect(result[0]!.candidates).toHaveLength(1);
    const c = result[0]!.candidates[0]!;
    expect(c.lat).toBeCloseTo(p.lat, 6);
    expect(c.lng).toBeCloseTo(p.lng, 6);
    expect(c.radiusKm).toBeCloseTo(0.3, 5); // floored
    expect(c.label).toBe(`Near ${p.name}`);
  });

  it("floors the radius at 0.3km and yields a single candidate when all places share the same coordinates", () => {
    const pts = Array.from({ length: 4 }, (_, i) =>
      place({ id: `p${i}`, lat: 10, lng: 20, priority: 2, dwellMin: 60 }),
    );
    const t = trip({ places: pts, days: [day({ id: "d1" })] });
    const result = recommendHotelAreas(t);
    expect(result[0]!.candidates).toHaveLength(1);
    const c = result[0]!.candidates[0]!;
    expect(c.lat).toBeCloseTo(10, 6);
    expect(c.lng).toBeCloseTo(20, 6);
    expect(c.radiusKm).toBeCloseTo(0.3, 5);
  });

  it("excludes a place with missing/non-finite coordinates rather than failing", () => {
    const good1 = place({ id: "g1", lat: 0, lng: 0, priority: 2, dwellMin: 60 });
    const good2 = place({ id: "g2", lat: 0.05 * DEG_PER_KM, lng: 0, priority: 2, dwellMin: 60 });
    const bad = place({ id: "bad", lat: NaN, lng: Infinity, priority: 1, dwellMin: 60 });
    const t = trip(
      { places: [good1, good2, bad], days: [day({ id: "d1" })] },
      { validate: false },
    );
    expect(() => recommendHotelAreas(t)).not.toThrow();
    const result = recommendHotelAreas(t);
    expect(result[0]!.candidates.length).toBeGreaterThan(0);
    for (const c of result[0]!.candidates) {
      expect(Number.isFinite(c.lat)).toBe(true);
      expect(Number.isFinite(c.lng)).toBe(true);
      expect(Number.isFinite(c.avgOneWayMin)).toBe(true);
    }
    // The candidate must reflect only the two good, nearby places — nowhere
    // near a NaN/Infinity-derived location.
    expect(result[0]!.candidates[0]!.lat).toBeCloseTo(0, 3);
  });
});

describe("recommendHotelAreas: competitive alternatives", () => {
  it("surfaces >=2 candidates with comparable costs for two distant, similarly-weighted clusters", () => {
    const clusterA = Array.from({ length: 3 }, (_, i) =>
      place({ id: `a${i}`, lat: i * 0.02 * DEG_PER_KM, lng: 0, priority: 2, dwellMin: 60 }),
    );
    const clusterB = Array.from({ length: 3 }, (_, i) =>
      place({ id: `b${i}`, lat: 60 * DEG_PER_KM + i * 0.02 * DEG_PER_KM, lng: 0, priority: 2, dwellMin: 60 }),
    );
    const t = trip({ places: [...clusterA, ...clusterB], days: [day({ id: "d1" })] });
    const result = recommendHotelAreas(t);
    const candidates = result[0]!.candidates;
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    // Sorted ascending by cost, and every kept alternative must be within
    // the competitive margin used by the implementation.
    const best = candidates[0]!.avgOneWayMin;
    for (const c of candidates) {
      expect(c.avgOneWayMin).toBeGreaterThanOrEqual(best);
      expect(c.avgOneWayMin - best).toBeLessThanOrEqual(Math.max(10, best * 0.35) + 1e-6);
    }
  });

  it("yields exactly one candidate (no manufactured alternatives) when all places form one tight cluster", () => {
    const tight = Array.from({ length: 5 }, (_, i) =>
      place({ id: `t${i}`, lat: i * 0.001 * DEG_PER_KM, lng: 0, priority: 2, dwellMin: 60 }),
    );
    const t = trip({ places: tight, days: [day({ id: "d1" })] });
    const result = recommendHotelAreas(t);
    expect(result[0]!.candidates).toHaveLength(1);
  });
});

describe("recommendHotelAreas: multi-segment isolation", () => {
  function makeTwoSegmentTrip(includeApptPlace: boolean) {
    // Explicit `name`s throughout: the shared `place()` test helper derives
    // a default name from a module-global counter, which would otherwise
    // drift between this function's two invocations below (one includes an
    // extra `place()` call for `apptPlace`) and make unrelated places compare
    // unequal by name alone.
    const baseTokyo = place({ id: "baseTokyo", name: "Base Tokyo", lat: 0, lng: 0, category: "hotel", dwellMin: 0 });
    const baseHakone = place({
      id: "baseHakone",
      name: "Base Hakone",
      lat: 80 * DEG_PER_KM,
      lng: 0,
      category: "hotel",
      dwellMin: 0,
    });

    const tokyoPlaces = Array.from({ length: 3 }, (_, i) =>
      place({ id: `t${i}`, name: `Tokyo ${i}`, lat: i * 0.02 * DEG_PER_KM, lng: 0, priority: 2, dwellMin: 60 }),
    );
    const hakonePlaces = Array.from({ length: 3 }, (_, i) =>
      place({
        id: `h${i}`,
        name: `Hakone ${i}`,
        lat: 80 * DEG_PER_KM + i * 0.02 * DEG_PER_KM,
        lng: 0,
        priority: 2,
        dwellMin: 60,
      }),
    );

    // Geographically sits right next to the Tokyo cluster, but is pinned by
    // appointment.dayId to "d2" — the Hakone segment's day. Assignment must
    // follow the explicit hint, not geography.
    const apptPlace = place({
      id: "apptPlace",
      name: "Appt Place",
      lat: 0.01 * DEG_PER_KM,
      lng: 0,
      priority: 1,
      dwellMin: 90,
      appointment: { dayId: "d2", start: "10:00" },
    });

    const places = [
      baseTokyo,
      baseHakone,
      ...tokyoPlaces,
      ...hakonePlaces,
      ...(includeApptPlace ? [apptPlace] : []),
    ];

    return trip({
      places,
      days: [
        day({ id: "d1", baseStartId: "baseTokyo", baseEndId: "baseTokyo" }),
        day({ id: "d2", baseStartId: "baseHakone", baseEndId: "baseHakone", stayStart: true }),
      ],
    });
  }

  it("computes each segment's recommendation from only that segment's own places", () => {
    const withAppt = recommendHotelAreas(makeTwoSegmentTrip(true));
    const withoutAppt = recommendHotelAreas(makeTwoSegmentTrip(false));

    expect(withAppt).toHaveLength(2);
    expect(withoutAppt).toHaveLength(2);

    // Segment 0 (Tokyo, day d1) must be byte-for-byte unaffected by the
    // appointment-pinned place, even though it sits geographically right
    // next to Tokyo's own cluster — it belongs to segment 1 by explicit hint.
    expect(withAppt[0]!.candidates).toEqual(withoutAppt[0]!.candidates);

    // Segment 1 (Hakone, day d2) DID receive the place (per its
    // appointment.dayId) and its recommendation reflects that.
    expect(withAppt[1]!.candidates).not.toEqual(withoutAppt[1]!.candidates);
  });
});

describe("recommendHotelAreas: priority-weighted ranking", () => {
  it("ranks the candidate nearer a must-see cluster above a same-size nice-to-have cluster", () => {
    const mustCluster = Array.from({ length: 3 }, (_, i) =>
      place({ id: `m${i}`, lat: i * 0.02 * DEG_PER_KM, lng: 0, priority: 1, dwellMin: 60 }),
    );
    const niceCluster = Array.from({ length: 3 }, (_, i) =>
      place({ id: `n${i}`, lat: 50 * DEG_PER_KM + i * 0.02 * DEG_PER_KM, lng: 0, priority: 3, dwellMin: 60 }),
    );
    const t = trip({ places: [...mustCluster, ...niceCluster], days: [day({ id: "d1" })] });
    const result = recommendHotelAreas(t);
    const top = result[0]!.candidates[0]!;

    const distToMust = haversineKm(top.lat, top.lng, 0.02 * DEG_PER_KM, 0);
    const distToNice = haversineKm(top.lat, top.lng, 50 * DEG_PER_KM + 0.02 * DEG_PER_KM, 0);
    expect(distToMust).toBeLessThan(distToNice);
  });
});

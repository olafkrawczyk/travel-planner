import { describe, expect, it } from "vitest";
import { haversineKm } from "@app/geo";
import { type Itinerary, type Place } from "@app/domain";
import { heuristicEntry } from "./matrix";
import {
  buildSpeculativeStays,
  calculateWorkloadNights,
  coarseClusterPlaces,
  DEFAULT_COARSE_THRESHOLD_KM,
  DEFAULT_COMMUTE_STRAIN_MIN,
  discoverAnchorClusters,
  discoverReliefClusters,
  estimateClusterWorkloadMin,
  extractAnchorPlaces,
  findStrainedPlaces,
  orderBasesByRoute,
  recommendHotelAreas,
  weightForPlace,
  weightedGeometricMedian,
} from "./hotelArea";
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

describe("coarseClusterPlaces (Scale B)", () => {
  it("returns [] for empty places or places with only hotels", () => {
    expect(coarseClusterPlaces([])).toEqual([]);
    const hotel = place({ lat: 35.6, lng: 139.7, category: "hotel" });
    expect(coarseClusterPlaces([hotel])).toEqual([]);
  });

  it("collapses all places within 25km into a single city cluster", () => {
    // Tokyo-style cluster: places spread across ~15km
    const tokyoPlaces = [
      place({ id: "p1", name: "Shinjuku", lat: 35.69, lng: 139.7 }),
      place({ id: "p2", name: "Shibuya", lat: 35.658, lng: 139.701 }),
      place({ id: "p3", name: "Asakusa", lat: 35.714, lng: 139.796 }),
      place({ id: "p4", name: "Ginza", lat: 35.671, lng: 139.765 }),
    ];
    const clusters = coarseClusterPlaces(tokyoPlaces, DEFAULT_COARSE_THRESHOLD_KM);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.places).toHaveLength(4);
    expect(clusters[0]!.center.lat).toBeCloseTo(35.68, 1);
    expect(clusters[0]!.center.lng).toBeCloseTo(139.74, 1);
    expect(clusters[0]!.radiusKm).toBeGreaterThan(0.3);
  });

  it("separates multi-city places into distinct clusters (Tokyo vs Hakone ~80km)", () => {
    const tokyoPlaces = [
      place({ id: "t1", name: "Tokyo 1", lat: 35.69, lng: 139.7 }),
      place({ id: "t2", name: "Tokyo 2", lat: 35.66, lng: 139.7 }),
    ];
    // Hakone is ~80km away
    const hakonePlaces = [
      place({ id: "h1", name: "Hakone Shrine", lat: 35.2, lng: 139.02 }),
      place({ id: "h2", name: "Owakudani", lat: 35.24, lng: 139.01 }),
    ];
    const clusters = coarseClusterPlaces([...tokyoPlaces, ...hakonePlaces], DEFAULT_COARSE_THRESHOLD_KM);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.places).toHaveLength(2);
    expect(clusters[1]!.places).toHaveLength(2);

    const distBetweenCenters = haversineKm(
      clusters[0]!.center.lat,
      clusters[0]!.center.lng,
      clusters[1]!.center.lat,
      clusters[1]!.center.lng,
    );
    expect(distBetweenCenters).toBeGreaterThan(60);
  });

  it("excludes places with invalid/non-finite coordinates", () => {
    const valid = place({ id: "v1", lat: 35.0, lng: 139.0 });
    const invalid = place({ id: "inv", lat: NaN, lng: 139.0 });
    const clusters = coarseClusterPlaces([valid, invalid]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.places).toHaveLength(1);
    expect(clusters[0]!.places[0]!.id).toBe("v1");
  });
});

describe("estimateClusterWorkloadMin", () => {
  const dummySettings = trip({ places: [], days: [] }).settings;

  it("returns dwell time for a single-place cluster", () => {
    const p = place({ lat: 35.0, lng: 139.0, dwellMin: 90 });
    const cluster = coarseClusterPlaces([p])[0]!;
    expect(estimateClusterWorkloadMin(cluster, dummySettings)).toBe(90);
  });

  it("adds internal travel estimate for multi-place cluster", () => {
    const p1 = place({ id: "p1", lat: 0, lng: 0, dwellMin: 60 });
    const p2 = place({ id: "p2", lat: 10 * DEG_PER_KM, lng: 0, dwellMin: 60 }); // ~10km away
    const cluster = coarseClusterPlaces([p1, p2])[0]!;
    const workload = estimateClusterWorkloadMin(cluster, dummySettings);
    // Dwell is 120, plus travel for 10km transit
    expect(workload).toBeGreaterThan(120);
  });
});

describe("buildSpeculativeStays", () => {
  const dummySettings = trip({ places: [], days: [] }).settings;

  it("returns null for a 1-day trip (cannot host multiple bases)", () => {
    const p = place({ lat: 35.0, lng: 139.0, dwellMin: 120 });
    const cluster = coarseClusterPlaces([p])[0]!;
    const stays = buildSpeculativeStays(cluster, "hotel-hakone", 1, [{ hotelId: "hotel-base", checkInDayIdx: 0, nights: 1 }], dummySettings);
    expect(stays).toBeNull();
  });

  it("generates valid contiguous speculative Stay[] covering all trip days", () => {
    const places = [
      place({ id: "p1", lat: 35.0, lng: 139.0, dwellMin: 180 }),
      place({ id: "p2", lat: 35.02, lng: 139.01, dwellMin: 180 }),
    ];
    const cluster = coarseClusterPlaces(places)[0]!;
    // 5-day trip, 1 existing stay covering all 5 days
    const existing = [{ hotelId: "hotel-base", checkInDayIdx: 0, nights: 5 }];
    const speculative = buildSpeculativeStays(cluster, "hotel-hakone", 5, existing, dummySettings);
    expect(speculative).not.toBeNull();
    expect(speculative).toHaveLength(2);

    // Sum of nights must equal 5
    const totalNights = speculative!.reduce((sum, s) => sum + s.nights, 0);
    expect(totalNights).toBe(5);

    // Check-in indices must be contiguous
    expect(speculative![0]!.checkInDayIdx).toBe(0);
    expect(speculative![1]!.checkInDayIdx).toBe(speculative![0]!.nights);
    expect(speculative![1]!.hotelId).toBe("hotel-hakone");
    expect(speculative![0]!.nights).toBeGreaterThanOrEqual(1);
    expect(speculative![1]!.nights).toBeGreaterThanOrEqual(1);
  });

  it("clamps nights so that existing stay retains at least 1 night even with huge workload", () => {
    // Workload of 3000 minutes (~50 hours) on a 3-day trip
    const hugePlaces = Array.from({ length: 5 }, (_, i) => place({ id: `p${i}`, lat: 35.0 + i * 0.01, lng: 139.0, dwellMin: 600 }));
    const cluster = coarseClusterPlaces(hugePlaces)[0]!;
    const existing = [{ hotelId: "hotel-base", checkInDayIdx: 0, nights: 3 }];
    const speculative = buildSpeculativeStays(cluster, "hotel-huge", 3, existing, dummySettings);
    expect(speculative).not.toBeNull();
    expect(speculative).toHaveLength(2);
    // On a 3-day trip, max shareable for candidate is 2 nights (existing keeps 1)
    expect(speculative![0]!.nights).toBe(1);
    expect(speculative![1]!.nights).toBe(2);
    expect(speculative![0]!.nights + speculative![1]!.nights).toBe(3);
  });

  it("re-allocates a multi-stay configuration with proportional nights and >=1 night per stay", () => {
    const places = [place({ lat: 35.0, lng: 139.0, dwellMin: 450 })]; // ~1 night workload
    const cluster = coarseClusterPlaces(places)[0]!;
    // 6-day trip with 2 stays: Stay A (3 nights), Stay B (3 nights)
    const existing = [
      { hotelId: "hotel-A", checkInDayIdx: 0, nights: 3 },
      { hotelId: "hotel-B", checkInDayIdx: 3, nights: 3 },
    ];
    const speculative = buildSpeculativeStays(cluster, "hotel-C", 6, existing, dummySettings);
    expect(speculative).not.toBeNull();
    expect(speculative).toHaveLength(3);

    // Nights sum to the trip length; every stay keeps at least one night.
    expect(speculative!.reduce((sum, s) => sum + s.nights, 0)).toBe(6);
    for (const s of speculative!) {
      expect(s.nights).toBeGreaterThanOrEqual(1);
    }
    // Check-in days are contiguous from day 0.
    let cursor = 0;
    for (const s of speculative!) {
      expect(s.checkInDayIdx).toBe(cursor);
      cursor += s.nights;
    }
    // The candidate is no longer forced to the end: route order decides, but
    // the first stay must still start at the trip's initial base.
    expect(speculative![0]!.checkInDayIdx).toBe(0);
  });
});

describe("extractAnchorPlaces (Anchor & Pull)", () => {
  function itineraryWith(
    unscheduled: { placeId: string; reason: "no_time" | "window_conflict" | "unreachable" }[],
  ): Itinerary {
    return {
      days: [],
      unscheduled,
      stats: { totalTravelMin: 0, totalWaitMin: 0, score: 0 },
    };
  }

  it("keeps places dropped for no_time or unreachable", () => {
    const t = trip({
      places: [
        place({ id: "nt1", lat: 35.0, lng: 139.0 }),
        place({ id: "ur1", lat: 35.1, lng: 139.0 }),
      ],
      days: [day({ id: "d1" })],
    });
    const anchors = extractAnchorPlaces(
      t,
      itineraryWith([
        { placeId: "nt1", reason: "no_time" },
        { placeId: "ur1", reason: "unreachable" },
      ]),
    );
    expect(anchors.map((p) => p.id)).toEqual(["nt1", "ur1"]);
  });

  it("excludes window_conflict drops", () => {
    const t = trip({
      places: [place({ id: "wc1", lat: 35.0, lng: 139.0 })],
      days: [day({ id: "d1" })],
    });
    const anchors = extractAnchorPlaces(
      t,
      itineraryWith([{ placeId: "wc1", reason: "window_conflict" }]),
    );
    expect(anchors).toEqual([]);
  });
});

describe("discoverAnchorClusters (Anchor & Pull)", () => {
  function itineraryWith(
    unscheduled: { placeId: string; reason: "no_time" | "window_conflict" | "unreachable" }[],
  ): Itinerary {
    return {
      days: [],
      unscheduled,
      stats: { totalTravelMin: 0, totalWaitMin: 0, score: 0 },
    };
  }

  it("a cluster of 5 dropped places forms a candidate", () => {
    const dropped = [
      place({ id: "d1", lat: 35.2, lng: 139.02, priority: 2, dwellMin: 60 }),
      place({ id: "d2", lat: 35.21, lng: 139.02, priority: 2, dwellMin: 60 }),
      place({ id: "d3", lat: 35.22, lng: 139.02, priority: 2, dwellMin: 60 }),
      place({ id: "d4", lat: 35.2, lng: 139.03, priority: 2, dwellMin: 60 }),
      place({ id: "d5", lat: 35.21, lng: 139.03, priority: 2, dwellMin: 60 }),
    ];
    const t = trip({ places: dropped, days: [day({ id: "day1" }), day({ id: "day2" })] });
    const clusters = discoverAnchorClusters(
      t,
      itineraryWith(dropped.map((p) => ({ placeId: p.id, reason: "no_time" as const }))),
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.places).toHaveLength(5);
  });

  it("even a single dropped place forms a candidate", () => {
    const dropped = [place({ id: "d1", lat: 35.2, lng: 139.02 })];
    const t = trip({ places: dropped, days: [day({ id: "day1" }), day({ id: "day2" })] });
    const clusters = discoverAnchorClusters(
      t,
      itineraryWith(dropped.map((p) => ({ placeId: p.id, reason: "no_time" as const }))),
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.places).toHaveLength(1);
  });

  it("returns [] when there are no qualifying dropped places", () => {
    const t = trip({ places: [], days: [day({ id: "day1" })] });
    const clusters = discoverAnchorClusters(t, itineraryWith([]));
    expect(clusters).toEqual([]);
  });

  it("a window_conflict-only cluster does not form a candidate", () => {
    const dropped = [
      place({ id: "d1", lat: 35.2, lng: 139.02 }),
      place({ id: "d2", lat: 35.21, lng: 139.02 }),
      place({ id: "d3", lat: 35.22, lng: 139.02 }),
    ];
    const t = trip({ places: dropped, days: [day({ id: "day1" }), day({ id: "day2" })] });
    const clusters = discoverAnchorClusters(
      t,
      itineraryWith(dropped.map((p) => ({ placeId: p.id, reason: "window_conflict" as const }))),
    );
    expect(clusters).toEqual([]);
  });

  it("a nearby scheduled place is pulled into a qualifying cluster's centroid calculation", () => {
    // 3 dropped places tightly clustered
    const dropped = [
      place({ id: "d1", lat: 35.2, lng: 139.02, priority: 3, dwellMin: 15 }),
      place({ id: "d2", lat: 35.201, lng: 139.02, priority: 3, dwellMin: 15 }),
      place({ id: "d3", lat: 35.202, lng: 139.02, priority: 3, dwellMin: 15 }),
    ];
    // A scheduled (must-see, heavy-dwell) place 10km away — within the 25km pull radius.
    const scheduled = place({
      id: "s1",
      lat: 35.2 + 10 * DEG_PER_KM,
      lng: 139.02,
      priority: 1,
      dwellMin: 480,
    });
    const t = trip({
      places: [...dropped, scheduled],
      days: [day({ id: "day1" }), day({ id: "day2" })],
    });
    const withoutPull = weightedGeometricMedian(
      dropped.map((p) => ({ lat: p.lat, lng: p.lng, weight: weightForPlace(p) })),
    );
    const clusters = discoverAnchorClusters(
      t,
      itineraryWith(dropped.map((p) => ({ placeId: p.id, reason: "no_time" as const }))),
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.places.map((p) => p.id)).toContain("s1");
    // The heavy scheduled place pulls the center away from the dropped-only centroid.
    const distMoved = haversineKm(withoutPull.lat, withoutPull.lng, clusters[0]!.center.lat, clusters[0]!.center.lng);
    expect(distMoved).toBeGreaterThan(1);
  });
});

describe("findStrainedPlaces (commute-relief trigger)", () => {
  it("flags places whose nearest active base commute exceeds the threshold, scheduled or not", () => {
    const hotel = place({ id: "hotelMain", lat: 0, lng: 0, category: "hotel" });
    // ~60km north: one-way regional heuristic commute well over 45 min.
    const far = place({ id: "far1", lat: 60 * DEG_PER_KM, lng: 0, dwellMin: 60 });
    const near = place({ id: "near1", lat: 0.01 * DEG_PER_KM, lng: 0, dwellMin: 60 });
    const t = trip({
      places: [hotel, far, near],
      days: [day({ id: "d1", baseStartId: "hotelMain", baseEndId: "hotelMain" })],
    });

    const strained = findStrainedPlaces(t);
    expect(strained.map((p) => p.id)).toEqual(["far1"]);
    // The strained place is a *scheduled* place (it appears in trip.places and
    // is not dropped — there is no itinerary involved at all).
  });

  it("returns [] when every place is within the commute threshold of the base", () => {
    const hotel = place({ id: "hotelMain", lat: 0, lng: 0, category: "hotel" });
    const near1 = place({ id: "n1", lat: 0.01 * DEG_PER_KM, lng: 0 });
    const near2 = place({ id: "n2", lat: 0.02 * DEG_PER_KM, lng: 0 });
    const t = trip({
      places: [hotel, near1, near2],
      days: [day({ id: "d1", baseStartId: "hotelMain", baseEndId: "hotelMain" })],
    });
    expect(findStrainedPlaces(t)).toEqual([]);
  });

  it("returns [] when the trip has no active base", () => {
    const p = place({ id: "p1", lat: 0, lng: 0 });
    const t = trip({ places: [p], days: [] });
    expect(findStrainedPlaces(t)).toEqual([]);
  });

  it("honours a custom threshold", () => {
    const hotel = place({ id: "hotelMain", lat: 0, lng: 0, category: "hotel" });
    // ~15km: ~24-33 min one-way — strained only under a very low threshold.
    const mid = place({ id: "m1", lat: 15 * DEG_PER_KM, lng: 0 });
    const t = trip({
      places: [hotel, mid],
      days: [day({ id: "d1", baseStartId: "hotelMain", baseEndId: "hotelMain" })],
    });
    expect(findStrainedPlaces(t, 20)).toHaveLength(1);
    expect(findStrainedPlaces(t, 60)).toHaveLength(0);
  });
});

describe("discoverReliefClusters (commute-relief discovery)", () => {
  it("detects a strained area even when all places are scheduled (no drops involved)", () => {
    // A single base + scheduled places 60km away — the baseline has nothing
    // dropped, yet the commute is unacceptable, so relief discovery must
    // still find the candidate region (the old anchor path could not).
    const hotel = place({ id: "hotelMain", lat: 0, lng: 0, category: "hotel" });
    const scheduledFar = [
      place({ id: "f1", name: "Far 1", lat: 60 * DEG_PER_KM, lng: 0, dwellMin: 60, priority: 1 }),
      place({ id: "f2", name: "Far 2", lat: 60.05 * DEG_PER_KM, lng: 0, dwellMin: 60, priority: 1 }),
    ];
    const t = trip({
      places: [hotel, ...scheduledFar],
      days: [
        day({ id: "d1", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
        day({ id: "d2", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
      ],
    });

    const clusters = discoverReliefClusters(t);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.places.map((p) => p.id).sort()).toEqual(["f1", "f2"]);
  });

  it("returns [] when no place is strained", () => {
    const hotel = place({ id: "hotelMain", lat: 0, lng: 0, category: "hotel" });
    const near = place({ id: "n1", lat: 0.01 * DEG_PER_KM, lng: 0 });
    const t = trip({
      places: [hotel, near],
      days: [day({ id: "d1", baseStartId: "hotelMain", baseEndId: "hotelMain" })],
    });
    expect(discoverReliefClusters(t)).toEqual([]);
  });

  it("pulls in nearby places the candidate base would serve better than their existing base", () => {
    const hotel = place({ id: "hotelMain", lat: 0, lng: 0, category: "hotel" });
    // Strained places 60km away.
    const strained = [
      place({ id: "f1", lat: 60 * DEG_PER_KM, lng: 0, dwellMin: 60 }),
      place({ id: "f2", lat: 60.02 * DEG_PER_KM, lng: 0, dwellMin: 60 }),
    ];
    // A place ~63km from the existing base (just past the strain threshold)
    // sitting right next to the strained cluster — the candidate base serves
    // it better, so it is pulled into the cluster.
    const pullable = place({ id: "pull1", lat: 63 * DEG_PER_KM, lng: 0, dwellMin: 60 });
    const t = trip({
      places: [hotel, ...strained, pullable],
      days: [day({ id: "d1", baseStartId: "hotelMain", baseEndId: "hotelMain" })],
    });

    const clusters = discoverReliefClusters(t);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.places.map((p) => p.id)).toContain("pull1");
  });

  it("does not pull places that are already better served by an existing base", () => {
    const hotel = place({ id: "hotelMain", lat: 0, lng: 0, category: "hotel" });
    const strained = [
      place({ id: "f1", lat: 60 * DEG_PER_KM, lng: 0, dwellMin: 60 }),
      place({ id: "f2", lat: 60.02 * DEG_PER_KM, lng: 0, dwellMin: 60 }),
    ];
    // A second base right next to `local1`; the place is 1km from that base
    // and far from the strained cluster — even though it sits within 25km of
    // nothing strained, ensure pull logic never drags well-served places in.
    const secondBase = place({ id: "hotelEast", lat: 30 * DEG_PER_KM, lng: 0.5 * DEG_PER_KM, category: "hotel" });
    const local1 = place({ id: "local1", lat: 30.01 * DEG_PER_KM, lng: 0.5 * DEG_PER_KM, dwellMin: 60 });
    const t = trip({
      places: [hotel, ...strained, secondBase, local1],
      days: [
        day({ id: "d1", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
        day({ id: "d2", baseStartId: "hotelEast", baseEndId: "hotelEast" }),
      ],
    });

    const clusters = discoverReliefClusters(t);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.places.map((p) => p.id)).not.toContain("local1");
  });

  it("ranks the most severe region first (workload x excess commute)", () => {
    const hotel = place({ id: "hotelMain", lat: 0, lng: 0, category: "hotel" });
    // Mild strain: ~50km, two light places.
    const mild = [
      place({ id: "m1", lat: 50 * DEG_PER_KM, lng: 0, dwellMin: 15 }),
      place({ id: "m2", lat: 50.02 * DEG_PER_KM, lng: 0, dwellMin: 15 }),
    ];
    // Severe strain: ~150km, heavy dwell places.
    const severe = [
      place({ id: "s1", lat: 150 * DEG_PER_KM, lng: 0, dwellMin: 240, priority: 1 }),
      place({ id: "s2", lat: 150.05 * DEG_PER_KM, lng: 0, dwellMin: 240, priority: 1 }),
    ];
    const t = trip({
      places: [hotel, ...mild, ...severe],
      days: [day({ id: "d1", baseStartId: "hotelMain", baseEndId: "hotelMain" })],
    });

    const clusters = discoverReliefClusters(t);
    expect(clusters.length).toBeGreaterThanOrEqual(2);
    expect(clusters[0]!.places.map((p) => p.id).sort()).toEqual(["s1", "s2"]);
  });

  it("uses the 45-minute default commute threshold exported as DEFAULT_COMMUTE_STRAIN_MIN", () => {
    expect(DEFAULT_COMMUTE_STRAIN_MIN).toBe(45);
  });
});

describe("calculateWorkloadNights (proportional allocation)", () => {
  const settings = trip({ places: [], days: [] }).settings;

  function baseAt(id: string, km: number): Place {
    return place({ id, name: id, lat: km * DEG_PER_KM, lng: 0, category: "hotel", dwellMin: 0 });
  }

  it("assigns more nights to the heavier base and sums exactly to totalNights", () => {
    const baseA = baseAt("baseA", 0);
    const baseB = baseAt("baseB", 100);
    const placesNearA = Array.from({ length: 2 }, (_, i) =>
      place({ id: `a${i}`, lat: i * DEG_PER_KM, lng: 0, dwellMin: 60 }),
    );
    const placesNearB = Array.from({ length: 10 }, (_, i) =>
      place({ id: `b${i}`, lat: (100 + i) * DEG_PER_KM, lng: 0, dwellMin: 60 }),
    );

    const nights = calculateWorkloadNights([baseA, baseB], [...placesNearA, ...placesNearB], 6, settings);
    expect(nights.get("baseA")).toBeGreaterThanOrEqual(1);
    expect(nights.get("baseB")).toBeGreaterThan(nights.get("baseA")!);
    expect((nights.get("baseA") ?? 0) + (nights.get("baseB") ?? 0)).toBe(6);
  });

  it("gives every base at least one night even when its workload is zero", () => {
    const baseA = baseAt("baseA", 0);
    const baseB = baseAt("baseB", 100);
    const placesNearB = Array.from({ length: 6 }, (_, i) =>
      place({ id: `b${i}`, lat: (100 + i) * DEG_PER_KM, lng: 0, dwellMin: 60 }),
    );
    const nights = calculateWorkloadNights([baseA, baseB], placesNearB, 5, settings);
    expect(nights.get("baseA")).toBeGreaterThanOrEqual(1);
    expect(nights.get("baseB")).toBeGreaterThanOrEqual(1);
    expect((nights.get("baseA") ?? 0) + (nights.get("baseB") ?? 0)).toBe(5);
  });

  it("uses largest-remainder rounding so nights sum exactly to totalNights", () => {
    const bases = [baseAt("baseA", 0), baseAt("baseB", 60), baseAt("baseC", 120)];
    const places = [
      place({ id: "a1", lat: 0, lng: 0, dwellMin: 100 }),
      place({ id: "b1", lat: 60 * DEG_PER_KM, lng: 0, dwellMin: 100 }),
      place({ id: "c1", lat: 120 * DEG_PER_KM, lng: 0, dwellMin: 100 }),
    ];
    for (const total of [4, 5, 7, 10]) {
      const nights = calculateWorkloadNights(bases, places, total, settings);
      const sum = [...nights.values()].reduce((s, n) => s + n, 0);
      expect(sum).toBe(total);
      for (const n of nights.values()) expect(n).toBeGreaterThanOrEqual(1);
    }
  });

  it("distributes evenly when no places are assignable (zero total workload)", () => {
    const bases = [baseAt("baseA", 0), baseAt("baseB", 50)];
    const nights = calculateWorkloadNights(bases, [], 5, settings);
    expect(nights.get("baseA")).toBe(3);
    expect(nights.get("baseB")).toBe(2);
  });
});

describe("orderBasesByRoute (TSP route ordering)", () => {
  const settings = trip({ places: [], days: [] }).settings;

  function baseAt(id: string, latKm: number, lngKm: number): Place {
    return place({
      id,
      name: id,
      lat: latKm * DEG_PER_KM,
      lng: lngKm * DEG_PER_KM,
      category: "hotel",
      dwellMin: 0,
    });
  }

  const pathCost = (order: Place[]): number => {
    let cost = 0;
    for (let i = 0; i < order.length - 1; i++) {
      cost += heuristicEntry(order[i]!, order[i + 1]!, settings).minutes;
    }
    return cost;
  };

  function bruteForceBest(start: Place, rest: Place[]): number {
    let best = Number.POSITIVE_INFINITY;
    const perms = (arr: Place[], prefix: Place[]): void => {
      if (arr.length === 0) {
        best = Math.min(best, pathCost([...prefix, ...arr]));
        return;
      }
      for (let i = 0; i < arr.length; i++) {
        perms([...arr.slice(0, i), ...arr.slice(i + 1)], [...prefix, arr[i]!]);
      }
    };
    perms(rest, [start]);
    return best;
  }

  it("pins the trip's initial base first regardless of input order", () => {
    const a = baseAt("A", 0, 0);
    const b = baseAt("B", 30, 0);
    const c = baseAt("C", 60, 0);
    const ordered = orderBasesByRoute([c, b, a], "A", settings);
    expect(ordered[0]!.id).toBe("A");
    expect(ordered).toHaveLength(3);
    expect(new Set(ordered.map((p) => p.id))).toEqual(new Set(["A", "B", "C"]));
  });

  it("orders a linear chain geographically instead of ping-ponging", () => {
    const a = baseAt("A", 0, 0);
    const b = baseAt("B", 30, 0);
    const c = baseAt("C", 60, 0);
    const d = baseAt("D", 90, 0);
    const ordered = orderBasesByRoute([d, b, a, c], "A", settings);
    expect(ordered.map((p) => p.id)).toEqual(["A", "B", "C", "D"]);
  });

  it("matches the brute-force optimal open path for a 5-base configuration", () => {
    const a = baseAt("A", 0, 0);
    const b = baseAt("B", 8, 2);
    const c = baseAt("C", 15, 7);
    const d = baseAt("D", 6, 12);
    const e = baseAt("E", 18, 0);
    const ordered = orderBasesByRoute([a, b, c, d, e], "A", settings);
    expect(ordered[0]!.id).toBe("A");
    expect(pathCost(ordered)).toBeCloseTo(bruteForceBest(a, [b, c, d, e]), 6);
  });

  it("returns the input unchanged for fewer than two bases", () => {
    const a = baseAt("A", 0, 0);
    expect(orderBasesByRoute([], "A", settings)).toEqual([]);
    expect(orderBasesByRoute([a], "A", settings)).toEqual([a]);
  });
});

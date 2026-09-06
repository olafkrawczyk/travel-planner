import { describe, expect, it } from "vitest";
import { haversineKm } from "@app/geo";
import { TripSettingsSchema, parseTrip, type Trip } from "@app/domain";
import { apiMatrixCoords, buildProblem, heuristicEntry } from "./matrix";
import { BASE_A, DEG_PER_KM, day, place, trip } from "./testUtils";

describe("TravelMatrix", () => {
  it("uses walking time below the walk threshold (detour-scaled)", () => {
    // ~0.8 km apart along the equator.
    const a = place({ lat: 0, lng: 0, id: "a" });
    const b = place({ lat: 0, lng: 0.8 * DEG_PER_KM, id: "b" });
    const t = trip({ places: [a, b], days: [day({ id: "d1" })] });
    const problem = buildProblem(t);
    const entry = problem.matrix.get("a", "b");
    expect(entry.source).toBe("heuristic");
    expect(entry.mode).toBe("walk");
    const km = 0.8 * 1.3; // detour factor
    expect(entry.minutes).toBeCloseTo((km / 4.5) * 60, 1);
    expect(entry.explanation).toContain("walk heuristic");
  });

  it("uses urban transit (overhead + flat speed) above the walk threshold but below the regional crossover", () => {
    const a = place({ lat: 0, lng: 0, id: "a" });
    const b = place({ lat: 0, lng: 3 * DEG_PER_KM, id: "b" }); // 3 km raw -> well under the ~5.4 km urban/regional crossover
    const t = trip({ places: [a, b], days: [day({ id: "d1" })] });
    const problem = buildProblem(t);
    const entry = problem.matrix.get("a", "b");
    expect(entry.mode).toBe("transit");
    expect(entry.explanation).toContain("urban transit heuristic");
    const km = 3 * 1.3;
    expect(entry.minutes).toBeCloseTo((12 + (km / 18) * 60) * 1.15, 1);
  });

  it("uses regional rail (higher overhead, higher speed) once it undercuts urban transit", () => {
    const a = place({ lat: 0, lng: 0, id: "a" });
    const b = place({ lat: 0, lng: 40 * DEG_PER_KM, id: "b" }); // 40 km raw -> well past the ~5.4 km crossover
    const t = trip({ places: [a, b], days: [day({ id: "d1" })] });
    const problem = buildProblem(t);
    const entry = problem.matrix.get("a", "b");
    // Mode stays "transit" (the schema-level Mode union has no separate
    // "rail" value), but the explanation names the curve that actually won.
    expect(entry.mode).toBe("transit");
    expect(entry.explanation).toContain("regional rail heuristic");
    const km = 40 * 1.3;
    const urban = (12 + (km / 18) * 60) * 1.15;
    const regional = (30 + (km / 80) * 60) * 1.15;
    expect(regional).toBeLessThan(urban); // sanity: regional really is cheaper here
    expect(entry.minutes).toBeCloseTo(regional, 1);
  });

  it("prefers a user override over the heuristic, honouring symmetry", () => {
    const a = place({ lat: 0, lng: 0, id: "a" });
    const b = place({ lat: 0, lng: 0.01, id: "b" });
    const t = trip({
      places: [a, b],
      days: [day({ id: "d1" })],
      travelOverrides: [{ fromId: "a", toId: "b", minutes: 120, symmetric: true }],
    });
    const problem = buildProblem(t);
    expect(problem.matrix.get("a", "b")).toMatchObject({ minutes: 120, source: "override" });
    expect(problem.matrix.get("b", "a")).toMatchObject({ minutes: 120, source: "override" });
  });

  it("supports asymmetric overrides", () => {
    const a = place({ lat: 0, lng: 0, id: "a" });
    const b = place({ lat: 0, lng: 0.01, id: "b" });
    const t = trip({
      places: [a, b],
      days: [day({ id: "d1" })],
      travelOverrides: [{ fromId: "a", toId: "b", minutes: 120, symmetric: false }],
    });
    const problem = buildProblem(t);
    expect(problem.matrix.minutes("a", "b")).toBe(120);
    expect(problem.matrix.minutes("b", "a")).not.toBe(120);
  });

  it("uses api durations with source 'api' and an OSRM explanation when provided", () => {
    const a = place({ lat: 0, lng: 0, id: "a" });
    const b = place({ lat: 0, lng: 0.8 * DEG_PER_KM, id: "b" });
    const t = trip({ places: [a, b], days: [day({ id: "d1" })] });
    // Node order = places first: [a, b]. 7.3 minutes for a→b, asymmetric.
    const problem = buildProblem(t, [
      [0, 7.3],
      [12.4, 0],
    ]);
    expect(problem.matrix.get("a", "b")).toMatchObject({ minutes: 7.3, source: "api", mode: "walk" });
    expect(problem.matrix.get("a", "b")!.explanation).toContain("OSRM walking");
    expect(problem.matrix.get("b", "a")).toMatchObject({ minutes: 12.4, source: "api" });
  });

  it("prefers an override over api durations, and api over the heuristic", () => {
    const a = place({ lat: 0, lng: 0, id: "a" });
    const b = place({ lat: 0, lng: 0.8 * DEG_PER_KM, id: "b" });
    const t = trip({
      places: [a, b],
      days: [day({ id: "d1" })],
      travelOverrides: [{ fromId: "a", toId: "b", minutes: 99, symmetric: false }],
    });
    const problem = buildProblem(t, [
      [0, 7.3],
      [12.4, 0],
    ]);
    // override > api
    expect(problem.matrix.get("a", "b")).toMatchObject({ minutes: 99, source: "override" });
    // api > heuristic
    expect(problem.matrix.get("b", "a")).toMatchObject({ minutes: 12.4, source: "api" });
  });

  it("falls back to the heuristic for non-finite api entries", () => {
    const a = place({ lat: 0, lng: 0, id: "a" });
    const b = place({ lat: 0, lng: 0.8 * DEG_PER_KM, id: "b" });
    const t = trip({ places: [a, b], days: [day({ id: "d1" })] });
    const problem = buildProblem(t, [
      [0, Number.NaN],
      [Number.NaN, 0],
    ]);
    expect(problem.matrix.get("a", "b").source).toBe("heuristic");
  });

  describe("API plausibility guard (regression: Hakone Open-Air Museum -> Tokyo Tower)", () => {
    // Real coordinates from the user report: Hakone Open-Air Museum
    // (35.2444, 139.0513) -> Tokyo Tower (35.6586, 139.7454). Straight-line
    // distance is ~78 km; the public OSRM demo server reported 5470.3 s for
    // EVERY profile (foot/driving/walking alike, since it only actually
    // hosts the car profile and ignores the profile segment of the URL),
    // i.e. 91.2 walking-labelled minutes for a leg that takes ~21 hours on
    // foot — an implied speed of roughly 51 km/h, a car speed, not a walking
    // one.
    const hakone = place({ lat: 35.2444, lng: 139.0513, id: "hakone" });
    const tokyoTower = place({ lat: 35.6586, lng: 139.7454, id: "tokyoTower" });
    const API_MINUTES = 91.2; // 5470.3 s rounded to 1 decimal, as OsrmClient would report it
    const km = haversineKm(hakone.lat, hakone.lng, tokyoTower.lat, tokyoTower.lng);

    it("has the ~78 km straight-line distance and ~51 km/h implied speed the report described", () => {
      expect(km).toBeCloseTo(77.9, 0);
      const impliedKmh = km / (API_MINUTES / 60);
      expect(impliedKmh).toBeGreaterThan(45);
      expect(impliedKmh).toBeLessThan(55);
    });

    it("rejects the api duration as an impossible walking speed and falls back to the heuristic, saying so in the explanation", () => {
      const t = trip({ places: [hakone, tokyoTower], days: [day({ id: "d1" })] });
      // Node order = places first: [hakone, tokyoTower].
      const problem = buildProblem(t, [
        [0, API_MINUTES],
        [API_MINUTES, 0],
      ]);
      const entry = problem.matrix.get("hakone", "tokyoTower");
      // Rejected -> heuristic, not the (wrong) 91.2 min api value.
      expect(entry.source).toBe("heuristic");
      expect(entry.minutes).not.toBe(API_MINUTES);
      // 78 km is well above the default walkMaxKm, so the heuristic mode is transit.
      expect(entry.mode).toBe("transit");
      // The rejection must be visible, not a silent swap.
      expect(entry.explanation).toContain("API rejected");
      expect(entry.explanation).toContain("too fast for walk");
    });

    it("does NOT reject the same duration when it is honestly labelled as a driving profile (plausible for a car)", () => {
      const t = trip({ places: [hakone, tokyoTower], days: [day({ id: "d1" })] });
      const problem = buildProblem(
        t,
        [
          [0, API_MINUTES],
          [API_MINUTES, 0],
        ],
        "driving",
      );
      const entry = problem.matrix.get("hakone", "tokyoTower");
      // ~51 km/h is unremarkable for driving, so a truthfully-labelled
      // driving profile is accepted rather than rejected.
      // (Plus the 5 minute parking overhead added to all car legs)
      expect(entry.source).toBe("api");
      expect(entry.minutes).toBe(API_MINUTES + 5);
    });
  });

  describe("API entry mode/explanation follow the requested profile (not a hard-coded 'walk')", () => {
    it("labels a 'foot' profile (the app default) as walk with an OSRM-walking explanation", () => {
      const a = place({ lat: 0, lng: 0, id: "a" });
      const b = place({ lat: 0, lng: 0.01, id: "b" });
      const problem = buildProblem(trip({ places: [a, b], days: [day({ id: "d1" })] }), [[0, 10], [10, 0]], "foot");
      const entry = problem.matrix.get("a", "b");
      expect(entry.source).toBe("api");
      expect(entry.mode).toBe("walk");
      expect(entry.explanation).toContain("OSRM walking");
    });

    it("labels a non-walking profile (e.g. a self-hosted 'driving' profile) as car (or transit), and names the real profile", () => {
      const a = place({ lat: 0, lng: 0, id: "a" });
      const b = place({ lat: 0, lng: 0.1, id: "b" });
      const problem = buildProblem(trip({ places: [a, b], days: [day({ id: "d1" })] }), [[0, 30], [30, 0]], "driving");
      const entry = problem.matrix.get("a", "b");
      expect(entry.source).toBe("api");
      expect(entry.mode).toBe("car");
      expect(entry.mode).not.toBe("walk");
      expect(entry.explanation).toContain("OSRM driving");
    });
  });

  it("apiMatrixCoords matches buildProblem node order and detects unusable nodes", () => {
    const a = place({ lat: 35.68, lng: 139.69, id: "a" });
    const t = trip({ places: [a], days: [day({ id: "d1", baseStartId: BASE_A })] });
    // BASE_A is a place in testUtils? It is not in trip.places → unknown base.
    expect(apiMatrixCoords(t)).toBeNull();

    const t2 = trip({
      places: [a, place({ lat: 35.71, lng: 139.79, id: BASE_A })],
      days: [day({ id: "d1", baseStartId: BASE_A })],
    });
    expect(apiMatrixCoords(t2)).toEqual([
      { id: "a", lat: 35.68, lng: 139.69 },
      { id: BASE_A, lat: 35.71, lng: 139.79 },
    ]);
  });

  it("updateNode recomputes only the moved place's row and column", () => {
    const a = place({ lat: 0, lng: 0, id: "a" });
    const b = place({ lat: 0, lng: 5 * DEG_PER_KM, id: "b" });
    const c = place({ lat: 0, lng: 10 * DEG_PER_KM, id: "c" });
    const t = trip({ places: [a, b, c], days: [day({ id: "d1" })] });
    const problem = buildProblem(t);
    const beforeBC = problem.matrix.minutes("b", "c");

    // Move `a` next to `c`.
    t.places[0]!.lat = 0;
    t.places[0]!.lng = 9.5 * DEG_PER_KM;
    problem.matrix.updateNode("a");

    const afterAC = problem.matrix.minutes("a", "c");
    expect(afterAC).toBeLessThan(problem.matrix.minutes("a", "b")); // now closer to c
    expect(afterAC).toBeCloseTo(problem.matrix.minutes("c", "a"), 6);
    expect(problem.matrix.minutes("b", "c")).toBe(beforeBC); // untouched pair
  });

  it("exposes day base nodes so days can route from/to their hotels", () => {
    const a = place({ lat: 35.68, lng: 139.69, id: "a" });
    const t = trip({ places: [a], days: [day({ id: "d1", baseStartId: BASE_A })] });
    const problem = buildProblem(t);
    // Base A is a node in the matrix even though it is not a schedulable place.
    expect(problem.matrix.nodes).toContain(BASE_A);
    expect(problem.places.map((p) => p.id)).toEqual(["a"]);
  });

  it("excludes hotel-category places from schedulable stops even when not referenced by any day", () => {
    const a = place({ lat: 35.68, lng: 139.69, id: "a" });
    const hotel = place({ lat: 35.69, lng: 139.7, id: "hotel_unused", category: "hotel" });
    const t = trip({ places: [a, hotel], days: [day({ id: "d1", baseStartId: BASE_A, baseEndId: BASE_A })] });
    const problem = buildProblem(t);
    // The hotel is still a routable node (has travel-time entries)...
    expect(problem.matrix.nodes).toContain("hotel_unused");
    // ...but must never be scheduled as a visitable stop, referenced or not.
    expect(problem.places.map((p) => p.id)).not.toContain("hotel_unused");
    expect(problem.places.map((p) => p.id)).toContain("a");
  });
});

describe("heuristic travel-time model: calibration against real pairs", () => {
  // Real coordinates from apps/web/src/samples/tokyo-hakone.ts (the sample
  // trip that motivated this rework — see matrix.ts's heuristicEntry doc).
  const hakoneOpenAirMuseum = place({ lat: 35.2444, lng: 139.0513, id: "hakone-museum" });
  const tokyoTower = place({ lat: 35.6586, lng: 139.7454, id: "tokyo-tower" });
  const sensoji = place({ lat: 35.7148, lng: 139.7967, id: "sensoji" });
  const skytree = place({ lat: 35.7101, lng: 139.8107, id: "skytree" });
  const shibuyaCrossing = place({ lat: 35.6595, lng: 139.7005, id: "shibuya-crossing" });
  const ichiranShibuya = place({ lat: 35.6611, lng: 139.7006, id: "ichiran-shibuya" });
  const settings = TripSettingsSchema.parse({});

  it("Hakone Open-Air Museum -> Tokyo Tower (~78 km great-circle): a rail-range leg, not a ~350 min transit-priced one", () => {
    const km = haversineKm(hakoneOpenAirMuseum.lat, hakoneOpenAirMuseum.lng, tokyoTower.lat, tokyoTower.lng);
    expect(km).toBeCloseTo(77.9, 0);
    const entry = heuristicEntry(hakoneOpenAirMuseum, tokyoTower, settings);
    expect(entry.mode).toBe("transit");
    expect(entry.explanation).toContain("regional rail heuristic");
    // A limited express + local access is realistically ~85-95 min; assert a
    // documenting range rather than the exact constant-dependent value.
    expect(entry.minutes).toBeGreaterThan(90);
    expect(entry.minutes).toBeLessThan(130);
  });

  it("Sensō-ji -> Tokyo Skytree (~1.4 km): a short intra-city hop, priced as urban transit", () => {
    const km = haversineKm(sensoji.lat, sensoji.lng, skytree.lat, skytree.lng);
    expect(km).toBeCloseTo(1.4, 1);
    const entry = heuristicEntry(sensoji, skytree, settings);
    expect(entry.mode).toBe("transit");
    expect(entry.explanation).toContain("urban transit heuristic");
    expect(entry.minutes).toBeGreaterThan(10);
    expect(entry.minutes).toBeLessThan(35);
  });

  it("Shibuya Crossing -> Ichiran Ramen Shibuya (~0.2 km): a walk-range pair", () => {
    const km = haversineKm(shibuyaCrossing.lat, shibuyaCrossing.lng, ichiranShibuya.lat, ichiranShibuya.lng);
    expect(km).toBeLessThan(0.5);
    const entry = heuristicEntry(shibuyaCrossing, ichiranShibuya, settings);
    expect(entry.mode).toBe("walk");
    expect(entry.explanation).toContain("walk heuristic");
    expect(entry.minutes).toBeLessThan(10);
  });
});

describe("heuristic travel-time model is monotonic non-decreasing in distance", () => {
  it("never prices a farther pair cheaper than a nearer one, sweeping across every mode crossover", () => {
    const settings = TripSettingsSchema.parse({});
    const a = place({ lat: 0, lng: 0, id: "a" });
    let prevMinutes = -Infinity;
    let prevRawKm = 0;
    // Dense sampling through 0-20 km covers the walk/urban and (with default
    // constants) urban/regional crossovers; coarser sampling continues out to
    // 300 km (well past any real single-leg distance in the app).
    const rawKms: number[] = [];
    for (let d = 0; d <= 20; d += 0.01) rawKms.push(d);
    for (let d = 20.5; d <= 300; d += 0.5) rawKms.push(d);

    for (const rawKm of rawKms) {
      const b = place({ lat: 0, lng: rawKm * DEG_PER_KM, id: "b" });
      const entry = heuristicEntry(a, b, settings);
      expect(entry.minutes).toBeGreaterThanOrEqual(prevMinutes - 1e-9);
      prevMinutes = entry.minutes;
      prevRawKm = rawKm;
    }
    expect(prevRawKm).toBe(300); // sanity: the sweep actually ran to the end
  });
});

describe("a trip persisted before the regional-rail settings existed still parses and solves", () => {
  it("parses old settings (missing regionalSpeedKmh/regionalOverheadMin, still carrying the removed lunchWindow) with new defaults filled in", () => {
    const raw = {
      id: "trip_old",
      schemaVersion: 2,
      name: "Old export",
      timezone: "Asia/Tokyo",
      days: [
        {
          id: "d1",
          date: "2026-04-01",
          start: "09:00",
          end: "21:00",
          startLocation: "base",
          endLocation: "base",
          baseStartId: "baseA",
          baseEndId: "baseA",
        },
      ],
      places: [
        { id: "baseA", name: "Base", lat: 35.6, lng: 139.7, category: "hotel", dwellMin: 0, priority: 3 },
        { id: "p1", name: "Place 1", lat: 35.61, lng: 139.71, category: "museum", dwellMin: 60, priority: 2 },
      ],
      travelOverrides: [],
      // Old shape: no regionalSpeedKmh/regionalOverheadMin, and the phantom
      // lunchWindow field a previous export still carries.
      settings: {
        walkSpeedKmh: 4.5,
        walkMaxKm: 1.5,
        transitSpeedKmh: 18,
        transitOverheadMin: 8,
        detourFactor: 1.3,
        lunchWindow: { start: "12:00", end: "13:00" },
      },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };

    const parsed = parseTrip(raw) as Trip;
    // Unknown key silently stripped by the plain z.object — no crash, no leftover field.
    expect(parsed.settings).not.toHaveProperty("lunchWindow");
    // New fields default in rather than being required on old data.
    expect(parsed.settings.regionalSpeedKmh).toBe(80);
    expect(parsed.settings.regionalOverheadMin).toBe(30);
    // Explicitly-set old fields are preserved, not clobbered by the new defaults.
    expect(parsed.settings.transitOverheadMin).toBe(8);

    const problem = buildProblem(parsed);
    expect(problem.matrix.get("baseA", "p1").minutes).toBeGreaterThan(0);
  });
});

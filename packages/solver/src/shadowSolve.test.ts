import { describe, expect, it } from "vitest";
import { solve } from "./solve";
import {
  coarseClusterPlaces,
  evaluateBaseSuggestions,
  findExternalClusters,
  MIN_RESCUED_PLACES,
  MIN_TRANSIT_SAVINGS_MIN,
} from "./hotelArea";
import { DEG_PER_KM, day, place, trip } from "./testUtils";

describe("findExternalClusters", () => {
  it("returns empty when all places cluster near the active base (single-city)", () => {
    const hotelTokyo = place({ id: "hotelTokyo", name: "Tokyo Hotel", lat: 35.68, lng: 139.76, category: "hotel" });
    const tokyoPlaces = [
      place({ id: "t1", name: "Tokyo Place 1", lat: 35.69, lng: 139.75 }),
      place({ id: "t2", name: "Tokyo Place 2", lat: 35.67, lng: 139.77 }),
    ];
    const t = trip({
      places: [hotelTokyo, ...tokyoPlaces],
      days: [day({ id: "d1", baseStartId: "hotelTokyo", baseEndId: "hotelTokyo" })],
    });

    const external = findExternalClusters(t);
    expect(external).toHaveLength(0);
  });

  it("identifies distinct distant cluster as external base candidate", () => {
    const hotelTokyo = place({ id: "hotelTokyo", name: "Tokyo Hotel", lat: 35.68, lng: 139.76, category: "hotel" });
    const tokyoPlaces = [
      place({ id: "t1", name: "Tokyo Place 1", lat: 35.69, lng: 139.75 }),
      place({ id: "t2", name: "Tokyo Place 2", lat: 35.67, lng: 139.77 }),
    ];
    // Hakone ~80km away
    const hakonePlaces = [
      place({ id: "h1", name: "Hakone Shrine", lat: 35.2, lng: 139.02 }),
      place({ id: "h2", name: "Owakudani", lat: 35.24, lng: 139.01 }),
    ];
    const t = trip({
      places: [hotelTokyo, ...tokyoPlaces, ...hakonePlaces],
      days: [
        day({ id: "d1", baseStartId: "hotelTokyo", baseEndId: "hotelTokyo" }),
        day({ id: "d2", baseStartId: "hotelTokyo", baseEndId: "hotelTokyo" }),
      ],
    });

    const external = findExternalClusters(t);
    expect(external).toHaveLength(1);
    expect(external[0]!.places).toHaveLength(2);
    expect(external[0]!.places.map((p) => p.id)).toEqual(["h1", "h2"]);
  });

  it("treats places close in km (<25km) but >45 min apart by heuristic as distinct bases", () => {
    const baseHotel = place({ id: "hotelBase", lat: 0, lng: 0, category: "hotel" });
    // 15 km away: haversine < 25 km, but travel time is ~51 min (>45 min)
    const places15km = [
      place({ id: "p1", lat: 15 * DEG_PER_KM, lng: 0 }),
      place({ id: "p2", lat: 15.01 * DEG_PER_KM, lng: 0 }),
    ];
    const t = trip({
      places: [baseHotel, ...places15km],
      days: [day({ id: "d1", baseStartId: "hotelBase", baseEndId: "hotelBase" })],
    });

    const external = findExternalClusters(t);
    expect(external).toHaveLength(1);
    expect(external[0]!.places.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("does not treat places close in both km and travel time (<45 min) as distinct bases", () => {
    const baseHotel = place({ id: "hotelBase", lat: 0, lng: 0, category: "hotel" });
    // 2 km away: haversine is 2 km (< 25 km), travel time is ~24 min (< 45 min)
    const places2km = [
      place({ id: "p1", lat: 2 * DEG_PER_KM, lng: 0 }),
      place({ id: "p2", lat: 2.01 * DEG_PER_KM, lng: 0 }),
    ];
    const t = trip({
      places: [baseHotel, ...places2km],
      days: [day({ id: "d1", baseStartId: "hotelBase", baseEndId: "hotelBase" })],
    });

    const external = findExternalClusters(t);
    expect(external).toHaveLength(0);
  });
});

describe("evaluateBaseSuggestions (shadow solves)", () => {
  it("surfaces a suggested base when shadow solve saves meaningful transit time", () => {
    const hotelTokyo = place({ id: "hotelTokyo", name: "Tokyo Hotel", lat: 0, lng: 0, category: "hotel" });
    const tokyoPlaces = [
      place({ id: "t1", name: "Tokyo 1", lat: 0.02 * DEG_PER_KM, lng: 0, dwellMin: 60, priority: 1 }),
      place({ id: "t2", name: "Tokyo 2", lat: 0.04 * DEG_PER_KM, lng: 0, dwellMin: 60, priority: 1 }),
    ];
    // Distant places 100km away
    const distantPlaces = [
      place({ id: "d1", name: "Distant 1", lat: 100 * DEG_PER_KM, lng: 0, dwellMin: 120, priority: 1 }),
      place({ id: "d2", name: "Distant 2", lat: 101 * DEG_PER_KM, lng: 0, dwellMin: 120, priority: 1 }),
    ];

    const t = trip({
      places: [hotelTokyo, ...tokyoPlaces, ...distantPlaces],
      days: [
        day({ id: "d1", baseStartId: "hotelTokyo", baseEndId: "hotelTokyo" }),
        day({ id: "d2", baseStartId: "hotelTokyo", baseEndId: "hotelTokyo" }),
      ],
    });

    // Run baseline solve
    const baseline = solve({ trip: t, seed: 42, budgetMs: 50 });

    // Run shadow solve evaluation
    const suggestions = evaluateBaseSuggestions(t, baseline, { seed: 42, budgetMs: 50 });

    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    const top = suggestions[0]!;
    expect(top.savingsMin).toBeGreaterThanOrEqual(MIN_TRANSIT_SAVINGS_MIN);
    expect(top.candidateHotel.notes).toBe("Located from a hotel-area recommendation.");
    expect(top.suggestedStays.length).toBe(2);
    expect(top.suggestedNights).toBeGreaterThanOrEqual(1);
    expect(top.rationale).toContain("transit");
  });

  it("suppresses candidate base when savings do not meet threshold", () => {
    const hotelTokyo = place({ id: "hotelTokyo", name: "Tokyo Hotel", lat: 0, lng: 0, category: "hotel" });
    const tokyoPlaces = [
      place({ id: "t1", name: "Tokyo 1", lat: 0.02 * DEG_PER_KM, lng: 0, dwellMin: 60 }),
    ];
    const distantPlaces = [
      place({ id: "d1", name: "Distant 1", lat: 60 * DEG_PER_KM, lng: 0, dwellMin: 60 }),
    ];
    const t = trip({
      places: [hotelTokyo, ...tokyoPlaces, ...distantPlaces],
      days: [
        day({ id: "d1", baseStartId: "hotelTokyo", baseEndId: "hotelTokyo" }),
        day({ id: "d2", baseStartId: "hotelTokyo", baseEndId: "hotelTokyo" }),
      ],
    });

    const baseline = solve({ trip: t, seed: 42, budgetMs: 50 });

    // Demand an impossible 10,000 minutes savings threshold
    const suggestions = evaluateBaseSuggestions(t, baseline, { seed: 42, budgetMs: 50, minSavingsMin: 10000 });
    expect(suggestions).toHaveLength(0);
  });

  it("aborts shadow solve evaluation when cancellation signal is triggered", () => {
    const hotelTokyo = place({ id: "hotelTokyo", name: "Tokyo Hotel", lat: 0, lng: 0, category: "hotel" });
    const distantPlaces = [
      place({ id: "d1", name: "Distant 1", lat: 100 * DEG_PER_KM, lng: 0, dwellMin: 120 }),
    ];
    const t = trip({
      places: [hotelTokyo, ...distantPlaces],
      days: [
        day({ id: "d1", baseStartId: "hotelTokyo", baseEndId: "hotelTokyo" }),
        day({ id: "d2", baseStartId: "hotelTokyo", baseEndId: "hotelTokyo" }),
      ],
    });

    const baseline = solve({ trip: t, seed: 42, budgetMs: 50 });
    const suggestions = evaluateBaseSuggestions(t, baseline, {
      seed: 42,
      budgetMs: 50,
      signal: { aborted: true },
    });
    expect(suggestions).toEqual([]);
  });

  it("detects Tokyo base recommendation when trip places are in Tokyo and hotel is in Yokohama", () => {
    // Hotel in Yokohama
    const hotelYokohama = place({
      id: "hotelYokohama",
      name: "Yokohama Hotel",
      lat: 35.4658,
      lng: 139.6227,
      category: "hotel",
    });

    // 10 Tokyo places
    const tokyoPlaces = [
      place({ id: "t1", name: "Senso-ji", lat: 35.7148, lng: 139.7967, dwellMin: 90, priority: 1 }),
      place({ id: "t2", name: "Tokyo Skytree", lat: 35.7101, lng: 139.8107, dwellMin: 90, priority: 1 }),
      place({ id: "t3", name: "Tokyo National Museum", lat: 35.7188, lng: 139.7766, dwellMin: 120, priority: 1 }),
      place({ id: "t4", name: "Akihabara", lat: 35.7022, lng: 139.7745, dwellMin: 60, priority: 1 }),
      place({ id: "t5", name: "Tokyo Station", lat: 35.6812, lng: 139.7671, dwellMin: 60, priority: 1 }),
      place({ id: "t6", name: "Imperial Palace", lat: 35.6852, lng: 139.7528, dwellMin: 60, priority: 1 }),
      place({ id: "t7", name: "Shinjuku Gyoen", lat: 35.6852, lng: 139.7101, dwellMin: 90, priority: 1 }),
      place({ id: "t8", name: "Meiji Shrine", lat: 35.6764, lng: 139.6993, dwellMin: 90, priority: 1 }),
      place({ id: "t9", name: "Shibuya Crossing", lat: 35.6595, lng: 139.7004, dwellMin: 60, priority: 1 }),
      place({ id: "t10", name: "Roppongi Hills", lat: 35.6605, lng: 139.7292, dwellMin: 90, priority: 1 }),
    ];

    const t = trip({
      places: [hotelYokohama, ...tokyoPlaces],
      days: [
        day({ id: "d1", baseStartId: "hotelYokohama", baseEndId: "hotelYokohama" }),
        day({ id: "d2", baseStartId: "hotelYokohama", baseEndId: "hotelYokohama" }),
        day({ id: "d3", baseStartId: "hotelYokohama", baseEndId: "hotelYokohama" }),
      ],
    });

    const external = findExternalClusters(t);
    expect(external.length).toBeGreaterThanOrEqual(1);
    expect(external[0]!.label).toBe("Near Imperial Palace");

    const baseline = solve({ trip: t, seed: 42, budgetMs: 50 });
    const suggestions = evaluateBaseSuggestions(t, baseline, { seed: 42, budgetMs: 50 });
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions[0]!.savingsMin).toBeGreaterThanOrEqual(MIN_TRANSIT_SAVINGS_MIN);
  });

  it("checks coarse clustering on tokyoGrandPlaces", () => {
    // 10 Tokyo places representing West (Shinjuku) and East (Asakusa)
    const westPlaces = [
      place({ id: "w1", lat: 35.69, lng: 139.70 }),
      place({ id: "w2", lat: 35.66, lng: 139.70 }),
    ];
    const eastPlaces = [
      place({ id: "e1", lat: 35.71, lng: 139.80 }),
      place({ id: "e2", lat: 35.72, lng: 139.77 }),
    ];
    const clusters25 = coarseClusterPlaces([...westPlaces, ...eastPlaces], 25);
    expect(clusters25).toHaveLength(1);
  });

  it("regression: speculative candidate hotel co-located with existing base yields comparable score", () => {
    const hotelMain = place({ id: "hotelMain", name: "Main Hotel", lat: 35.68, lng: 139.76, category: "hotel" });
    const places = [
      place({ id: "p1", name: "Place 1", lat: 35.681, lng: 139.761, dwellMin: 60, priority: 1 }),
      place({ id: "p2", name: "Place 2", lat: 35.682, lng: 139.762, dwellMin: 60, priority: 1 }),
      place({ id: "p3", name: "Place 3", lat: 35.683, lng: 139.763, dwellMin: 60, priority: 2 }),
      place({ id: "p4", name: "Place 4", lat: 35.684, lng: 139.764, dwellMin: 60, priority: 2 }),
    ];
    const t = trip({
      places: [hotelMain, ...places],
      days: [
        day({ id: "d1", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
        day({ id: "d2", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
      ],
    });

    const baseline = solve({ trip: t, seed: 42, budgetMs: 50 });

    // Co-located candidate hotel, kept as a single stay across both days (same
    // stay-group shape as baseline) so the only difference between the two
    // problems is the extra, non-scheduled hotel node — isolating exactly the
    // comparability assumption design.md Decision 3 depends on, without also
    // perturbing the day-imbalance term via a stay split.
    const candidateHotel = place({
      id: "hotelCoLocated",
      name: "Co-located Hotel",
      lat: 35.68,
      lng: 139.76,
      category: "hotel",
      dwellMin: 0,
      priority: 3,
    });
    const specTrip = trip({
      places: [hotelMain, candidateHotel, ...places],
      days: [
        day({ id: "d1", baseStartId: "hotelCoLocated", baseEndId: "hotelCoLocated" }),
        day({ id: "d2", baseStartId: "hotelCoLocated", baseEndId: "hotelCoLocated" }),
      ],
    });
    const specSolve = solve({ trip: specTrip, seed: 42, budgetMs: 50 });

    // Scores must be identical or within a tiny tolerance (< 0.1)
    expect(Math.abs(specSolve.stats.score - baseline.stats.score)).toBeLessThan(0.1);
  });

  it("island fixture: surfaces capacity-expander recommendation for dropped places within haversine radius but far by road", () => {
    // Hotel at (0, 0)
    const hotel = place({ id: "hotelMain", name: "Main Base", lat: 0, lng: 0, category: "hotel" });
    // 2 places near the hotel
    const localPlaces = [
      place({ id: "l1", name: "Local 1", lat: 0.01 * DEG_PER_KM, lng: 0, dwellMin: 60, priority: 2 }),
      place({ id: "l2", name: "Local 2", lat: 0.02 * DEG_PER_KM, lng: 0, dwellMin: 60, priority: 2 }),
    ];
    // 22 island places: 20 km away (< 25 km haversine, so the old
    // straight-line separation check would never see them), ~55 min one-way
    // commute — enough that the baseline drops a third of them for no_time.
    // A base on the island rescues >= 3 of them.
    const islandPlaces = Array.from({ length: 22 }, (_, i) =>
      place({
        id: `isl_${i}`,
        name: `Island Place ${i}`,
        lat: (20 + (i % 5) * 0.01) * DEG_PER_KM,
        lng: Math.floor(i / 5) * 0.01 * DEG_PER_KM,
        dwellMin: 45,
        priority: 2,
      }),
    );

    // 3-day trip: 9:00 - 15:00 (360 min/day)
    const t = trip({
      places: [hotel, ...localPlaces, ...islandPlaces],
      days: [
        day({ id: "d1", start: "09:00", end: "15:00", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
        day({ id: "d2", start: "09:00", end: "15:00", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
        day({ id: "d3", start: "09:00", end: "15:00", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
      ],
    });

    const baseline = solve({ trip: t, seed: 42, budgetMs: 50 });
    // Baseline solve drops several island places due to time/transit constraints
    expect(baseline.unscheduled.length).toBeGreaterThanOrEqual(3);

    const suggestions = evaluateBaseSuggestions(t, baseline, { seed: 42, budgetMs: 50 });
    expect(suggestions.length).toBeGreaterThanOrEqual(1);

    const expander = suggestions.find((s) => s.kind === "capacity-expander");
    expect(expander).toBeDefined();
    expect(expander!.rescuedCount).toBeGreaterThanOrEqual(MIN_RESCUED_PLACES);
    expect(expander!.rationale).toMatch(/Lets you fit \d+ more places? and eases ~\d+ min one-way commutes\./);
  });

  it("surfaces capacity-expander when even a single dropped place is rescued", () => {
    const hotel = place({ id: "hotelMain", name: "Main Base", lat: 0, lng: 0, category: "hotel" });
    const localPlace = place({ id: "loc1", lat: 0.01 * DEG_PER_KM, lng: 0, dwellMin: 120, priority: 1 });
    // 1 distant place: 60 km away (~102 min one-way commute by the heuristic
    // model, ~204 min round trip). Dwell 45 min.
    const distantPlace = place({
      id: "distant1",
      name: "Distant Place",
      lat: 60 * DEG_PER_KM,
      lng: 0,
      dwellMin: 45,
      priority: 1,
    });

    // 2-day trip: each day is 9:00-12:00 (180 min). Sleeping at the existing
    // base, visiting `distant1` costs a round trip (~204 min) + dwell (45
    // min) = ~249 min, which does not fit either day -> baseline drops it.
    // Sleeping at a candidate base near it instead costs only the one-way
    // commute (~102 min) + dwell (45 min) = ~147 min, which fits -> the
    // capacity-expander path rescues exactly this one place.
    const t = trip({
      places: [hotel, localPlace, distantPlace],
      days: [
        day({ id: "d1", start: "09:00", end: "12:00", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
        day({ id: "d2", start: "09:00", end: "12:00", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
      ],
    });

    const baseline = solve({ trip: t, seed: 42, budgetMs: 50 });
    expect(baseline.unscheduled.map((u) => u.placeId)).toContain("distant1");

    const suggestions = evaluateBaseSuggestions(t, baseline, { seed: 42, budgetMs: 50 });
    const expander = suggestions.find((s) => s.kind === "capacity-expander");
    expect(expander).toBeDefined();
    expect(expander!.rescuedCount).toBe(1);
    expect(expander!.rationale).toContain("Lets you fit 1 more place");
    expect(expander!.rationale).toContain("commute");
  });

  it("assigns kind transit-saver and rescuedCount to every suggestion", () => {
    const hotelYokohama = place({
      id: "hotelYokohama",
      name: "Yokohama Hotel",
      lat: 35.4658,
      lng: 139.6227,
      category: "hotel",
    });
    const tokyoPlaces = [
      place({ id: "t1", name: "Senso-ji", lat: 35.7148, lng: 139.7967, dwellMin: 90, priority: 1 }),
      place({ id: "t2", name: "Tokyo Skytree", lat: 35.7101, lng: 139.8107, dwellMin: 90, priority: 1 }),
      place({ id: "t3", name: "Tokyo National Museum", lat: 35.7188, lng: 139.7766, dwellMin: 120, priority: 1 }),
      place({ id: "t4", name: "Akihabara", lat: 35.7022, lng: 139.7745, dwellMin: 60, priority: 1 }),
    ];
    const t = trip({
      places: [hotelYokohama, ...tokyoPlaces],
      days: [
        day({ id: "d1", baseStartId: "hotelYokohama", baseEndId: "hotelYokohama" }),
        day({ id: "d2", baseStartId: "hotelYokohama", baseEndId: "hotelYokohama" }),
        day({ id: "d3", baseStartId: "hotelYokohama", baseEndId: "hotelYokohama" }),
      ],
    });

    const baseline = solve({ trip: t, seed: 42, budgetMs: 50 });
    const suggestions = evaluateBaseSuggestions(t, baseline, { seed: 42, budgetMs: 50 });
    expect(suggestions.length).toBeGreaterThanOrEqual(1);

    for (const s of suggestions) {
      expect(["transit-saver", "capacity-expander"]).toContain(s.kind);
      expect(typeof s.rescuedCount).toBe("number");
      expect(s.rescuedCount).toBeGreaterThanOrEqual(0);
    }
    // This fixture is a transit-saver scenario (all places schedulable, no drops)
    expect(suggestions[0]!.kind).toBe("transit-saver");
    expect(suggestions[0]!.savingsMin).toBeGreaterThanOrEqual(MIN_TRANSIT_SAVINGS_MIN);
    expect(suggestions[0]!.rationale).toContain("transit");
  });

  it("sorts capacity-expander suggestions before transit-saver suggestions", () => {
    // Two independent distant clusters. Cluster A rescues dropped places
    // (capacity-expander); cluster B saves transit time (transit-saver).
    const hotel = place({ id: "hotelMain", name: "Main Base", lat: 0, lng: 0, category: "hotel" });
    const islandPlaces = Array.from({ length: 22 }, (_, i) =>
      place({
        id: `isl_${i}`,
        name: `Island Place ${i}`,
        lat: (20 + (i % 5) * 0.01) * DEG_PER_KM,
        lng: Math.floor(i / 5) * 0.01 * DEG_PER_KM,
        dwellMin: 45,
        priority: 2,
      }),
    );
    // A second, farther cluster of 2 places (transit-saver shape)
    const distantPlaces = [
      place({ id: "far1", name: "Far 1", lat: 80 * DEG_PER_KM, lng: 0, dwellMin: 120, priority: 1 }),
      place({ id: "far2", name: "Far 2", lat: 81 * DEG_PER_KM, lng: 0, dwellMin: 120, priority: 1 }),
    ];
    const t = trip({
      places: [hotel, ...islandPlaces, ...distantPlaces],
      days: [
        day({ id: "d1", start: "09:00", end: "15:00", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
        day({ id: "d2", start: "09:00", end: "15:00", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
        day({ id: "d3", start: "09:00", end: "15:00", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
      ],
    });

    const baseline = solve({ trip: t, seed: 42, budgetMs: 50 });
    const suggestions = evaluateBaseSuggestions(t, baseline, { seed: 42, budgetMs: 50 });

    const kinds = suggestions.map((s) => s.kind);
    const firstExpander = kinds.indexOf("capacity-expander");
    const firstSaver = kinds.indexOf("transit-saver");
    // If both kinds are present, every capacity-expander must come first
    if (firstExpander >= 0 && firstSaver >= 0) {
      expect(firstExpander).toBeLessThan(firstSaver);
    }
  });

  it("assigns unique suggestion ids even when the anchor and geography discovery paths each restart cluster numbering from 0", () => {
    // Regression for the `sug_cluster-0` React-key collision:
    // `coarseClusterPlaces` numbers clusters per-call, so two distinct
    // regions discovered via different paths (anchor vs geography) could
    // both land on `cluster-0` and produce duplicate `SuggestedBase.id`s.
    // Two symmetric regions, each with one place the baseline drops, force
    // two separate candidate clusters into a single evaluation.
    const hotel = place({ id: "hotelMain", name: "Main Base", lat: 0, lng: 0, category: "hotel" });
    const northPlaces = Array.from({ length: 8 }, (_, i) =>
      place({
        id: `north_${i}`,
        name: `North Place ${i}`,
        lat: 25 * DEG_PER_KM + i * 0.01 * DEG_PER_KM,
        lng: 0,
        dwellMin: 60,
        priority: 2,
      }),
    );
    const southPlaces = Array.from({ length: 8 }, (_, i) =>
      place({
        id: `south_${i}`,
        name: `South Place ${i}`,
        lat: -25 * DEG_PER_KM - i * 0.01 * DEG_PER_KM,
        lng: 0,
        dwellMin: 60,
        priority: 2,
      }),
    );

    // 4-day trip: 9:00 - 15:00 (360 min/day)
    const t = trip({
      places: [hotel, ...northPlaces, ...southPlaces],
      days: [
        day({ id: "d1", start: "09:00", end: "15:00", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
        day({ id: "d2", start: "09:00", end: "15:00", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
        day({ id: "d3", start: "09:00", end: "15:00", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
        day({ id: "d4", start: "09:00", end: "15:00", baseStartId: "hotelMain", baseEndId: "hotelMain" }),
      ],
    });

    const baseline = solve({ trip: t, seed: 42, budgetMs: 50 });
    const suggestions = evaluateBaseSuggestions(t, baseline, { seed: 42, budgetMs: 50 });

    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    const ids = suggestions.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

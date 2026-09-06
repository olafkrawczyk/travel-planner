import { describe, expect, it } from "vitest";
import { PlaceSchema, type Place, type Trip } from "@app/domain";
import { baseUsage, normalizePlace } from "./places";

function place(id: string, overrides: Partial<Place> = {}): Place {
  return { id, name: id, lat: 0, lng: 0, category: "hotel", dwellMin: 0, priority: 3, ...overrides };
}

/** A minimal valid trip with `days` days, all based at `hotelIds[0]`
 *  (mirrors stays.test.ts's fixture — only `places`/`days` matter here). */
function makeTrip(days: number, hotelIds: string[]): Trip {
  return {
    id: "t1",
    schemaVersion: 2,
    name: "Test trip",
    timezone: "UTC",
    days: Array.from({ length: days }, (_, i) => ({
      id: `d${i}`,
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      start: "09:00",
      end: "21:00",
      startLocation: "base" as const,
      endLocation: "base" as const,
      baseStartId: hotelIds[0]!,
      baseEndId: hotelIds[0]!,
    })),
    places: hotelIds.map((id) => place(id)),
    travelOverrides: [],
    settings: {
      carOnly: false,
      solverStrategy: "clusterFirst",
      walkSpeedKmh: 4.5,
      walkMaxKm: 1.5,
      transitSpeedKmh: 18,
      transitOverheadMin: 12,
      regionalSpeedKmh: 80,
      regionalOverheadMin: 30,
      detourFactor: 1.3,
      weights: { travel: 1, wait: 0.5, mustDropped: 1000, niceDropped: 10, dayImbalance: 1, overBudget: 3 },
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("baseUsage", () => {
  it("finds a hotel used as baseStartId", () => {
    const trip = makeTrip(3, ["hotel-a"]);
    trip.days[1]!.baseStartId = "hotel-b"; // day 1 wakes at a different (unlisted) hotel
    expect(baseUsage(trip, "hotel-b")).toEqual({ dayIndex: 1, dayId: "d1" });
  });

  it("finds a hotel used as baseEndId", () => {
    const trip = makeTrip(3, ["hotel-a"]);
    trip.days[2]!.baseEndId = "hotel-c";
    expect(baseUsage(trip, "hotel-c")).toEqual({ dayIndex: 2, dayId: "d2" });
  });

  it("finds a place used as a non-'base' startLocation", () => {
    const trip = makeTrip(2, ["hotel-a"]);
    trip.days[0]!.startLocation = "station-1";
    expect(baseUsage(trip, "station-1")).toEqual({ dayIndex: 0, dayId: "d0" });
  });

  it("finds a place used as a non-'base' endLocation", () => {
    const trip = makeTrip(2, ["hotel-a"]);
    trip.days[1]!.endLocation = "station-2";
    expect(baseUsage(trip, "station-2")).toEqual({ dayIndex: 1, dayId: "d1" });
  });

  it("returns null for an ordinary place not referenced by any day", () => {
    const trip = makeTrip(3, ["hotel-a"]);
    trip.places.push(place("museum-1", { category: "museum" }));
    expect(baseUsage(trip, "museum-1")).toBeNull();
  });
});

describe("normalizePlace", () => {
  const hotel: Place = {
    id: "h1",
    name: "Grand Hotel",
    lat: 1,
    lng: 2,
    category: "hotel",
    dwellMin: 90,
    priority: 1,
    appointment: { dayId: "d0", start: "14:00" },
    openingHours: { "2026-01-01": [{ start: "09:00", end: "17:00" }] },
    forceDayId: "d0",
    notes: "kept",
  };

  it("zeroes dwell, pins priority, and strips appointment/openingHours/forceDayId for a hotel", () => {
    const result = normalizePlace(hotel);
    expect(result.dwellMin).toBe(0);
    expect(result.priority).toBe(3);
    expect(result.appointment).toBeUndefined();
    expect(result.openingHours).toBeUndefined();
    expect(result.forceDayId).toBeUndefined();
    // unrelated fields survive untouched
    expect(result.notes).toBe("kept");
    expect(result.name).toBe("Grand Hotel");
  });

  it("leaves a non-hotel untouched (same reference)", () => {
    const museum: Place = {
      id: "m1",
      name: "Museum",
      lat: 0,
      lng: 0,
      category: "museum",
      dwellMin: 90,
      priority: 1,
      appointment: { dayId: "d0", start: "14:00" },
      openingHours: { "2026-01-01": [{ start: "09:00", end: "17:00" }] },
      forceDayId: "d0",
    };
    expect(normalizePlace(museum)).toBe(museum);
  });

  it("is idempotent", () => {
    const once = normalizePlace(hotel);
    const twice = normalizePlace(once);
    expect(twice).toEqual(once);
    // already-normalized input is returned as the same object
    expect(normalizePlace(once)).toBe(once);
  });

  it("normalized output still parses against PlaceSchema", () => {
    const result = normalizePlace(hotel);
    expect(() => PlaceSchema.parse(result)).not.toThrow();
  });
});

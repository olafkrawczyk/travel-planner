import { describe, expect, it } from "vitest";
import {
  dateRange,
  emptyTrip,
  MAX_TRIP_DAYS,
  multiHotelSampleTrip,
  sampleTrip,
  validateTripLength,
} from "./tripFactory";
import { tokyoHakoneSample } from "./samples/tokyo-hakone";
import { tokyoGrandPlaces, tokyoGrandSample } from "./samples/tokyo-grand";
import { CategorySchema, parseTrip, TripSchema } from "@app/domain";
import { staysFor } from "./stays";

describe("dateRange", () => {
  it("generates one date per day inclusive", () => {
    expect(dateRange("2026-04-01", "2026-04-05")).toEqual([
      "2026-04-01",
      "2026-04-02",
      "2026-04-03",
      "2026-04-04",
      "2026-04-05",
    ]);
  });

  it("returns empty for inverted or invalid ranges", () => {
    expect(dateRange("2026-04-05", "2026-04-01")).toEqual([]);
    expect(dateRange("nope", "2026-04-01")).toEqual([]);
  });

  it("does not cap a range longer than MAX_TRIP_DAYS — the cap is enforced at the creation boundary, not here", () => {
    const dates = dateRange("2026-01-01", "2030-01-01"); // ~4 years
    expect(dates.length).toBeGreaterThan(MAX_TRIP_DAYS);
  });
});

describe("validateTripLength", () => {
  it("allows a range at or under MAX_TRIP_DAYS", () => {
    expect(validateTripLength(dateRange("2026-04-01", "2026-04-05"))).toBeNull();
    const exactlyMax = Array.from({ length: MAX_TRIP_DAYS }, (_, i) => `day-${i}`);
    expect(validateTripLength(exactlyMax)).toBeNull();
  });

  it("refuses a range longer than MAX_TRIP_DAYS, naming both the cap and the requested length", () => {
    const tooLong = Array.from({ length: MAX_TRIP_DAYS + 1 }, (_, i) => `day-${i}`);
    const error = validateTripLength(tooLong);
    expect(error).toBeTruthy();
    expect(error).toContain(String(MAX_TRIP_DAYS));
    expect(error).toContain(String(MAX_TRIP_DAYS + 1));
  });
});

describe("emptyTrip", () => {
  it("creates a schema-valid trip with one day per date and a default base", () => {
    const dates = dateRange("2026-04-01", "2026-04-03");
    const trip = emptyTrip("Test", dates);
    expect(trip.days).toHaveLength(3);
    expect(trip.places).toHaveLength(1);
    const hotel = trip.places[0]!;
    for (const day of trip.days) {
      expect(day.baseStartId).toBe(hotel.id);
      expect(day.baseEndId).toBe(hotel.id);
    }
    expect(() => TripSchema.parse(trip)).not.toThrow();
  });

  it("seeds the base from the given starting-city coordinates", () => {
    const trip = emptyTrip("Test", ["2026-04-01"], { lat: 48.8566, lng: 2.3522 });
    expect(trip.places[0]!.lat).toBe(48.8566);
    expect(trip.places[0]!.lng).toBe(2.3522);
    expect(() => TripSchema.parse(trip)).not.toThrow();
  });

  it("falls back to the previous default base without coordinates", () => {
    const trip = emptyTrip("Test", ["2026-04-01"]);
    expect(trip.places[0]!.lat).toBe(35.6812);
    expect(trip.places[0]!.lng).toBe(139.7671);
  });
});

describe("multiHotelSampleTrip", () => {
  it("maps the Tokyo → Hakone sample: day 3 wakes in Tokyo, sleeps in Hakone", () => {
    const trip = multiHotelSampleTrip(tokyoHakoneSample, "2026-04-01");
    expect(trip.days).toHaveLength(5);
    // Hotels are the dwellMin-0 places; first hotel (daysFromStart 0) is Shinjuku.
    const hotels = trip.places.filter((p) => p.dwellMin === 0);
    expect(hotels).toHaveLength(2);
    expect(hotels[0]!.name).toBe("Hotel Gracery Shinjuku");
    expect(hotels[1]!.name).toBe("Hakone Yuryo Ryokan");
    const [tokyo, hakone] = hotels as [typeof hotels[0], typeof hotels[0]];
    const bases = trip.days.map((d) => [d.baseStartId, d.baseEndId]);
    expect(bases).toEqual([
      [tokyo!.id, tokyo!.id], // day 1
      [tokyo!.id, tokyo!.id], // day 2
      [tokyo!.id, hakone!.id], // day 3 — travel day: old hotel → new hotel
      [hakone!.id, hakone!.id], // day 4
      [hakone!.id, hakone!.id], // day 5
    ]);
    expect(() => TripSchema.parse(trip)).not.toThrow();
  });

  it("keeps a single hotel uniform across all days", () => {
    const trip = multiHotelSampleTrip(
      {
        name: "One hotel",
        city: "X",
        days: 3,
        hotels: [{ name: "H", lat: 0, lng: 0, daysFromStart: 0, nights: 3 }],
        places: [],
      },
      "2026-04-01",
    );
    const hotel = trip.places.find((p) => p.dwellMin === 0)!;
    for (const day of trip.days) {
      expect(day.baseStartId).toBe(hotel.id);
      expect(day.baseEndId).toBe(hotel.id);
    }
  });
});

describe("sampleTrip", () => {
  it("still builds single-hotel samples with one base place", () => {
    const trip = sampleTrip({
      name: "S",
      city: "X",
      days: 2,
      hotel: { name: "H", lat: 1, lng: 2 },
      places: [],
    });
    expect(trip.places.filter((p) => p.dwellMin === 0)).toHaveLength(1);
    expect(() => TripSchema.parse(trip)).not.toThrow();
  });
});

describe("tokyoGrandSample", () => {
  it("has exactly 100 places — the headline guarantee of this sample", () => {
    expect(tokyoGrandPlaces.length).toBe(100);
  });

  it("has unique names and unique lat/lng pairs", () => {
    const names = tokyoGrandPlaces.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    const coords = tokyoGrandPlaces.map((p) => `${p.lat},${p.lng}`);
    expect(new Set(coords).size).toBe(coords.length);
  });

  it("keeps every place inside the Tokyo bounding box", () => {
    for (const p of tokyoGrandPlaces) {
      expect(p.lat).toBeGreaterThanOrEqual(35.5);
      expect(p.lat).toBeLessThanOrEqual(35.9);
      expect(p.lng).toBeGreaterThanOrEqual(139.4);
      expect(p.lng).toBeLessThanOrEqual(140.0);
    }
  });

  it("uses valid, non-hotel categories, priorities, and dwell times", () => {
    for (const p of tokyoGrandPlaces) {
      expect(() => CategorySchema.parse(p.category)).not.toThrow();
      expect(p.category).not.toBe("hotel");
      expect([1, 2, 3]).toContain(p.priority);
      expect(Number.isInteger(p.dwellMin)).toBe(true);
      expect(p.dwellMin).toBeGreaterThan(0);
      expect(p.dwellMin).toBeLessThanOrEqual(1440);
    }
  });

  it("builds a schema-valid 12-day, 102-place trip", () => {
    const trip = multiHotelSampleTrip(tokyoGrandSample, "2026-04-01");
    expect(trip.days).toHaveLength(12);
    expect(trip.places).toHaveLength(102);
    expect(() => parseTrip(trip)).not.toThrow();
    expect(() => TripSchema.parse(trip)).not.toThrow();
  });

  it("derives two 6-night stays, the second checking in on day index 6", () => {
    const trip = multiHotelSampleTrip(tokyoGrandSample, "2026-04-01");
    const stays = staysFor(trip);
    expect(stays).toHaveLength(2);
    expect(stays[0]).toMatchObject({ checkInDayIdx: 0, nights: 6 });
    expect(stays[1]).toMatchObject({ checkInDayIdx: 6, nights: 6 });
  });
});

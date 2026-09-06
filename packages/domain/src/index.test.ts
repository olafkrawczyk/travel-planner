import { describe, expect, it } from "vitest";
import {
  DayPlanSchema,
  ItinerarySchema,
  LegSchema,
  StopSchema,
  newDayId,
  newPlaceId,
  newTripId,
  parseTrip,
  schemaVersion,
  windowsForDate,
  TripSchema,
} from "./index";
import type { Place } from "./index";
import { formatHHMM, parseHHMM } from "./time";

const dayId = newDayId();

export const sampleTrip = {
  id: newTripId(),
  schemaVersion,
  name: "Tokyo",
  timezone: "Asia/Tokyo",
  days: [
    {
      id: dayId,
      date: "2026-04-01",
      start: "09:00",
      end: "21:00",
      startLocation: "base",
      endLocation: "base",
      baseStartId: "hotel_1",
      baseEndId: "hotel_1",
    },
  ],
  places: [
    {
      id: newPlaceId(),
      name: "Senso-ji",
      lat: 35.7148,
      lng: 139.7967,
      category: "temple",
      dwellMin: 60,
      priority: 1,
    },
  ],
  travelOverrides: [
    { fromId: "hotel_1", toId: "plc_x", minutes: 120, mode: "transit", symmetric: false },
  ],
  settings: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("trip schema", () => {
  it("parses a valid trip and fills defaults", () => {
    const trip = TripSchema.parse(sampleTrip);
    expect(trip.settings.walkSpeedKmh).toBe(4.5);
    expect(trip.settings.detourFactor).toBe(1.3);
    expect(trip.days[0]!.id).toBe(dayId);
  });

  it("round-trips through JSON.parse(JSON.stringify())", () => {
    const trip = TripSchema.parse(sampleTrip);
    const back = TripSchema.parse(JSON.parse(JSON.stringify(trip)));
    expect(back).toEqual(trip);
  });

  it("rejects malformed times", () => {
    const bad = { ...sampleTrip, days: [{ ...sampleTrip.days[0], start: "9am" }] };
    expect(() => TripSchema.parse(bad)).toThrow();
  });

  it("rejects invalid priority", () => {
    const bad = { ...sampleTrip, places: [{ ...sampleTrip.places[0], priority: 4 }] };
    expect(() => TripSchema.parse(bad)).toThrow();
  });

  it("parseTrip migrates missing schemaVersion (legacy 0)", () => {
    const legacy = JSON.parse(JSON.stringify(sampleTrip));
    delete legacy.schemaVersion;
    const trip = parseTrip(legacy);
    expect(trip.schemaVersion).toBe(schemaVersion);
  });

  it("parseTrip migrates v1 → v2: drops legacy timeWindows and bumps version", () => {
    const v1 = JSON.parse(JSON.stringify(sampleTrip));
    v1.schemaVersion = 1;
    v1.places[0].timeWindows = [{ start: "09:00", end: "17:00" }];
    const trip = parseTrip(v1);
    expect(trip.schemaVersion).toBe(schemaVersion);
    expect(trip.places[0]).not.toHaveProperty("timeWindows");
  });

  it("parses v2 openingHours as a per-date window map", () => {
    const v2 = JSON.parse(JSON.stringify(sampleTrip));
    v2.places[0].openingHours = { "2026-04-01": [{ start: "09:00", end: "17:00" }] };
    const trip = TripSchema.parse(v2);
    expect(windowsForDate(trip.places[0]!, "2026-04-01")).toEqual([{ start: "09:00", end: "17:00" }]);
  });

  it("preserves stayStart through parseTrip round-tripping", () => {
    const withStayStart = JSON.parse(JSON.stringify(sampleTrip));
    withStayStart.days[0].stayStart = true;
    const trip = parseTrip(withStayStart);
    expect(trip.days[0]!.stayStart).toBe(true);
    const back = parseTrip(JSON.parse(JSON.stringify(trip)));
    expect(back.days[0]!.stayStart).toBe(true);
  });

  it("windowsForDate returns undefined when absent or on other dates", () => {
    const place: Place = {
      id: "plc_x",
      name: "Museum",
      lat: 0,
      lng: 0,
      category: "museum",
      dwellMin: 60,
      priority: 2,
      openingHours: { "2026-04-01": [{ start: "09:00", end: "17:00" }] },
    };
    expect(windowsForDate(place, "2026-04-01")).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(windowsForDate(place, "2026-04-02")).toBeUndefined();
    const bare: Place = { ...place };
    delete bare.openingHours;
    expect(windowsForDate(bare, "2026-04-01")).toBeUndefined();
  });

  it("itinerary schema round-trips", () => {
    const itin = ItinerarySchema.parse({
      days: [
        {
          dayId,
          stops: [{ placeId: "plc_1", arrive: "09:30", depart: "10:30", waitMin: 5 }],
          legs: [{ fromId: "hotel_1", toId: "plc_1", minutes: 18, mode: "transit", source: "heuristic" }],
          slackMin: 120,
        },
      ],
      unscheduled: [],
      stats: { totalTravelMin: 18, totalWaitMin: 5, score: 23 },
    });
    expect(DayPlanSchema.parse(itin.days[0]).slackMin).toBe(120);
    expect(StopSchema.parse(itin.days[0]!.stops[0]).waitMin).toBe(5);
    expect(LegSchema.parse(itin.days[0]!.legs[0]).source).toBe("heuristic");
  });
});

describe("time helpers", () => {
  it("converts HH:mm to minutes and back", () => {
    expect(parseHHMM("09:30")).toBe(570);
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("23:59")).toBe(1439);
    expect(formatHHMM(570)).toBe("09:30");
    expect(formatHHMM(1439)).toBe("23:59");
  });

  it("rounds float input to the nearest whole minute", () => {
    // 850 = 14:10; 850.999… must display as 14:11, not "14:10.9999999999999".
    expect(formatHHMM(850)).toBe("14:10");
    expect(formatHHMM(850.9999999999)).toBe("14:11");
    expect(formatHHMM(850.4)).toBe("14:10");
  });

  it("round-trips all minutes of the day", () => {
    for (let m = 0; m < 1440; m++) {
      expect(parseHHMM(formatHHMM(m))).toBe(m);
    }
  });

  it("throws on invalid input", () => {
    expect(() => parseHHMM("24:00")).toThrow();
    expect(() => parseHHMM("9:60")).toThrow();
    expect(() => parseHHMM("bad")).toThrow();
  });
});

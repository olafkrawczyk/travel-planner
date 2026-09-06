import { describe, expect, it } from "vitest";
import {
  DayPlanSchema,
  ItinerarySchema,
  LegSchema,
  StopSchema,
  newDayId,
  newPlaceId,
  newTripId,
  openingHoursState,
  parseTrip,
  schemaVersion,
  weekdayOf,
  windowsForDate,
  TripSchema,
} from "./index";
import type { Place, WeeklyPattern } from "./index";
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

  it("rejects a trip with more days than the hard cap, with a clear message (not a raw ZodError dump)", () => {
    const tooLong = {
      ...sampleTrip,
      days: Array.from({ length: 61 }, (_, i) => ({
        ...sampleTrip.days[0],
        id: `day_${i}`,
        date: `2026-04-${String((i % 28) + 1).padStart(2, "0")}`,
      })),
    };
    expect(() => parseTrip(tooLong)).toThrow(/Trip too long/);
    // Not a raw ZodError JSON dump.
    expect(() => parseTrip(tooLong)).not.toThrow(/"code":|"path":/);
  });

  it("accepts a trip at exactly the day cap (60)", () => {
    const atCap = {
      ...sampleTrip,
      days: Array.from({ length: 60 }, (_, i) => ({
        ...sampleTrip.days[0],
        id: `day_${i}`,
        date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}`,
      })),
    };
    expect(() => parseTrip(atCap)).not.toThrow();
  });

  it("rejects a trip with more places than the hard cap", () => {
    const tooManyPlaces = {
      ...sampleTrip,
      places: Array.from({ length: 2001 }, (_, i) => ({
        ...sampleTrip.places[0],
        id: `plc_${i}`,
      })),
    };
    expect(() => parseTrip(tooManyPlaces)).toThrow(/too many places/);
  });

  it("bounds unbounded Place string fields (name, notes, region, osmId)", () => {
    const base = sampleTrip.places[0]!;
    expect(() => TripSchema.parse({ ...sampleTrip, places: [{ ...base, name: "x".repeat(201) }] })).toThrow();
    expect(() => TripSchema.parse({ ...sampleTrip, places: [{ ...base, notes: "x".repeat(5001) }] })).toThrow();
    expect(() =>
      TripSchema.parse({ ...sampleTrip, places: [{ ...base, region: "x".repeat(201) }] }),
    ).toThrow();
    expect(() =>
      TripSchema.parse({ ...sampleTrip, places: [{ ...base, osmId: "x".repeat(201) }] }),
    ).toThrow();
    // At the boundary, all still valid.
    expect(() =>
      TripSchema.parse({
        ...sampleTrip,
        places: [
          { ...base, name: "x".repeat(200), notes: "x".repeat(5000), region: "x".repeat(200), osmId: "x".repeat(200) },
        ],
      }),
    ).not.toThrow();
  });

  it("bounds openingHours: caps windows per date and total dates listed", () => {
    const base = sampleTrip.places[0]!;
    const tooManyWindows = {
      ...sampleTrip,
      places: [
        {
          ...base,
          openingHours: { "2026-04-01": Array.from({ length: 21 }, () => ({ start: "09:00", end: "10:00" })) },
        },
      ],
    };
    expect(() => TripSchema.parse(tooManyWindows)).toThrow();

    const tooManyDates: Record<string, { start: string; end: string }[]> = {};
    for (let i = 0; i < 401; i++) {
      tooManyDates[`2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}-${i}`] = [
        { start: "09:00", end: "10:00" },
      ];
    }
    const tooManyDatesTrip = { ...sampleTrip, places: [{ ...base, openingHours: tooManyDates }] };
    expect(() => TripSchema.parse(tooManyDatesTrip)).toThrow();
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

// ---- Weekly opening-hours pattern (redesign-opening-hours change) ----

const basePlace: Place = {
  id: "plc_weekly",
  name: "Test Place",
  lat: 0,
  lng: 0,
  category: "museum",
  dwellMin: 60,
  priority: 2,
};

/** Mon-Fri 09:00-17:00, closed Sat/Sun. */
const weekdayOpenPattern: WeeklyPattern = {
  mon: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
  tue: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
  wed: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
  thu: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
  fri: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
  sat: { kind: "closed" },
  sun: { kind: "closed" },
};

/** Open every day 09:00-17:00 — used by the override/closed-dates precedence tests. */
const openEveryDayPattern: WeeklyPattern = {
  mon: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
  tue: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
  wed: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
  thu: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
  fri: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
  sat: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
  sun: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
};

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

describe("weekdayOf", () => {
  it("maps concrete dates to the correct local weekday", () => {
    expect(weekdayOf("2026-04-06")).toBe("mon");
    expect(weekdayOf("2026-04-07")).toBe("tue");
    expect(weekdayOf("2026-04-08")).toBe("wed");
    expect(weekdayOf("2026-04-09")).toBe("thu");
    expect(weekdayOf("2026-04-10")).toBe("fri");
    expect(weekdayOf("2026-04-11")).toBe("sat");
    expect(weekdayOf("2026-04-12")).toBe("sun");
  });
});

describe("windowsForDate: weekly pattern expansion", () => {
  it("returns the weekday's windows on an open weekday", () => {
    const place: Place = { ...basePlace, openingHoursWeekly: weekdayOpenPattern };
    // 2026-04-06..10 are Mon..Fri.
    for (const date of ["2026-04-06", "2026-04-07", "2026-04-08", "2026-04-09", "2026-04-10"]) {
      expect(windowsForDate(place, date)).toEqual([{ start: "09:00", end: "17:00" }]);
    }
  });

  it("returns the closed sentinel on a closed weekday", () => {
    const place: Place = { ...basePlace, openingHoursWeekly: weekdayOpenPattern };
    // 2026-04-11 is Sat, 2026-04-12 is Sun — both closed in this pattern.
    for (const date of ["2026-04-11", "2026-04-12"]) {
      const windows = windowsForDate(place, date);
      expect(windows).toEqual([{ start: "23:59", end: "00:00" }]);
    }
  });
});

describe("windowsForDate: closed-vs-unknown distinction", () => {
  it("returns undefined (unknown) for a place with no opening-hours fields at all", () => {
    const place: Place = { ...basePlace };
    expect(windowsForDate(place, "2026-04-06")).toBeUndefined();
    expect(windowsForDate(place, "2026-04-11")).toBeUndefined();
  });

  it("returns a non-empty, unconditionally-unsatisfiable sentinel for a closed weekday", () => {
    const place: Place = { ...basePlace, openingHoursWeekly: weekdayOpenPattern };
    const windows = windowsForDate(place, "2026-04-11"); // Saturday: closed
    expect(windows).toBeDefined();
    expect(windows!.length).toBeGreaterThan(0);
    // Prove the sentinel can never satisfy `start + dwellMin <= close` for any
    // non-negative dwell, matching packages/solver/src/sequence.ts's
    // feasibleVisit gate (a file this package does not own, so this is an
    // arithmetic proxy rather than a direct call into that package).
    for (const w of windows!) {
      const start = toMinutes(w.start);
      const close = toMinutes(w.end);
      for (const dwellMin of [0, 1, 500]) {
        expect(start + dwellMin <= close).toBe(false);
      }
    }
  });
});

describe("windowsForDate: per-date override beats weekly pattern", () => {
  it("prefers the openingHours[date] entry over the weekly pattern for that date", () => {
    const place: Place = {
      ...basePlace,
      openingHoursWeekly: openEveryDayPattern,
      openingHours: { "2026-04-03": [{ start: "10:00", end: "12:00" }] },
    };
    // 2026-04-03 is a Friday, which openEveryDayPattern says is open 09:00-17:00.
    expect(windowsForDate(place, "2026-04-03")).toEqual([{ start: "10:00", end: "12:00" }]);
    // A date with no override still falls through to the weekly pattern.
    expect(windowsForDate(place, "2026-04-04")).toEqual([{ start: "09:00", end: "17:00" }]);
  });
});

describe("windowsForDate: openingHoursClosedDates beats weekly pattern", () => {
  it("treats a listed closed date as closed even though the weekly pattern says open", () => {
    const place: Place = {
      ...basePlace,
      openingHoursWeekly: openEveryDayPattern,
      openingHoursClosedDates: ["2026-04-04"],
    };
    // 2026-04-04 is a Saturday, which openEveryDayPattern says is open.
    expect(windowsForDate(place, "2026-04-04")).toEqual([{ start: "23:59", end: "00:00" }]);
    // An unlisted date still falls through to the weekly pattern.
    expect(windowsForDate(place, "2026-04-03")).toEqual([{ start: "09:00", end: "17:00" }]);
  });
});

describe("migration v2 -> v3", () => {
  it("parses a v2 trip unchanged and windowsForDate behaves identically to before the migration", () => {
    const v2 = {
      id: newTripId(),
      schemaVersion: 2,
      name: "Legacy Trip",
      timezone: "Asia/Tokyo",
      days: [
        {
          id: newDayId(),
          date: "2026-04-02",
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
          name: "Old Place",
          lat: 35.7,
          lng: 139.8,
          category: "museum",
          dwellMin: 60,
          priority: 1,
          openingHours: { "2026-04-02": [{ start: "09:00", end: "17:00" }] },
        },
      ],
      travelOverrides: [],
      settings: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const trip = parseTrip(v2);
    expect(trip.schemaVersion).toBe(schemaVersion);
    const place = trip.places[0]!;
    expect(place.openingHoursWeekly).toBeUndefined();
    expect(place.openingHoursClosedDates).toBeUndefined();
    expect(place.openingHoursAlwaysOpen).toBeUndefined();
    expect(windowsForDate(place, "2026-04-02")).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(windowsForDate(place, "2026-04-03")).toBeUndefined();
  });
});

describe("openingHoursState", () => {
  it("is unknown when no opening-hours field is set", () => {
    expect(openingHoursState({ ...basePlace })).toBe("unknown");
  });

  it("is always_open when the user has explicitly confirmed no restriction", () => {
    expect(openingHoursState({ ...basePlace, openingHoursAlwaysOpen: true })).toBe("always_open");
  });

  it("is has_hours when a weekly pattern is set", () => {
    expect(openingHoursState({ ...basePlace, openingHoursWeekly: weekdayOpenPattern })).toBe("has_hours");
  });

  it("is has_hours when the legacy openingHours map has entries", () => {
    expect(
      openingHoursState({
        ...basePlace,
        openingHours: { "2026-04-02": [{ start: "09:00", end: "17:00" }] },
      }),
    ).toBe("has_hours");
  });

  it("is has_hours when openingHoursClosedDates has entries, even without a weekly pattern", () => {
    expect(openingHoursState({ ...basePlace, openingHoursClosedDates: ["2026-04-04"] })).toBe("has_hours");
  });
});

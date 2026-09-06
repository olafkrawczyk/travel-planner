import { describe, expect, it } from "vitest";
import type { Place, Trip } from "@app/domain";
import {
  nightsRange,
  staysFor,
  validateStays,
  withCheckIn,
  withHotel,
  withNights,
  withoutStay,
  withSplitAt,
  type Stay,
} from "./stays";

function place(id: string): Place {
  return { id, name: id, lat: 0, lng: 0, category: "hotel", dwellMin: 0, priority: 3 };
}

/** A minimal valid trip with `days` days and one place per id in `hotelIds`
 *  (all days initially based at the first hotel — only `places`/`days.length`
 *  matter to these pure helpers and to `validateStays`). */
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
    places: hotelIds.map(place),
    travelOverrides: [],
    settings: {
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

describe("withHotel", () => {
  it("replaces one stay's hotel and leaves the rest untouched", () => {
    const trip = makeTrip(5, ["a", "b"]);
    const stays: Stay[] = [
      { hotelId: "a", checkInDayIdx: 0, nights: 2 },
      { hotelId: "a", checkInDayIdx: 2, nights: 3 },
    ];
    const result = withHotel(stays, 1, "b");
    expect(result).toEqual([
      { hotelId: "a", checkInDayIdx: 0, nights: 2 },
      { hotelId: "b", checkInDayIdx: 2, nights: 3 },
    ]);
    expect(validateStays(result, trip)).toBeNull();
  });

  it("is a no-op for an out-of-range index", () => {
    const stays: Stay[] = [{ hotelId: "a", checkInDayIdx: 0, nights: 5 }];
    expect(withHotel(stays, 3, "b")).toEqual(stays);
  });
});

describe("withCheckIn", () => {
  const trip = makeTrip(10, ["a", "b", "c"]);
  const stays: Stay[] = [
    { hotelId: "a", checkInDayIdx: 0, nights: 3 },
    { hotelId: "b", checkInDayIdx: 3, nights: 4 },
    { hotelId: "c", checkInDayIdx: 7, nights: 3 },
  ];

  it("moves a middle stay's check-in, resizing the previous stay", () => {
    const result = withCheckIn(stays, 1, 5, 10);
    expect(result).toEqual([
      { hotelId: "a", checkInDayIdx: 0, nights: 5 },
      { hotelId: "b", checkInDayIdx: 5, nights: 2 },
      { hotelId: "c", checkInDayIdx: 7, nights: 3 },
    ]);
    expect(validateStays(result, trip)).toBeNull();
  });

  it("clamps the requested day into the gap between neighbours", () => {
    const tooLate = withCheckIn(stays, 1, 10, 10);
    expect(tooLate[1]!.checkInDayIdx).toBe(6); // next stay's check-in (7) - 1
    expect(validateStays(tooLate, trip)).toBeNull();

    const tooEarly = withCheckIn(stays, 1, 0, 10);
    expect(tooEarly[1]!.checkInDayIdx).toBe(1); // previous stay's check-in (0) + 1
    expect(validateStays(tooEarly, trip)).toBeNull();
  });

  it("is a no-op for stay 0 (pinned to day 0)", () => {
    expect(withCheckIn(stays, 0, 5, 10)).toEqual(stays);
  });
});

describe("withNights", () => {
  const trip = makeTrip(10, ["a", "b", "c"]);
  const stays: Stay[] = [
    { hotelId: "a", checkInDayIdx: 0, nights: 3 },
    { hotelId: "b", checkInDayIdx: 3, nights: 4 },
    { hotelId: "c", checkInDayIdx: 7, nights: 3 },
  ];

  it("on a middle stay, shifts later check-ins and lets the last stay absorb the delta", () => {
    const result = withNights(stays, 1, 6, 10);
    expect(result).toEqual([
      { hotelId: "a", checkInDayIdx: 0, nights: 3 },
      { hotelId: "b", checkInDayIdx: 3, nights: 6 },
      { hotelId: "c", checkInDayIdx: 9, nights: 1 },
    ]);
    expect(validateStays(result, trip)).toBeNull();
  });

  it("on the LAST stay, moves its check-in and shrinks the previous stay", () => {
    const result = withNights(stays, 2, 6, 10);
    expect(result).toEqual([
      { hotelId: "a", checkInDayIdx: 0, nights: 3 },
      { hotelId: "b", checkInDayIdx: 3, nights: 1 },
      { hotelId: "c", checkInDayIdx: 4, nights: 6 },
    ]);
    expect(validateStays(result, trip)).toBeNull();
  });

  it("clamps a middle stay's nights instead of producing an invalid list", () => {
    const tooMany = withNights(stays, 1, 99, 10);
    expect(tooMany[2]!.nights).toBe(1); // last stay floors at 1 night
    expect(validateStays(tooMany, trip)).toBeNull();

    const tooFew = withNights(stays, 1, -5, 10);
    expect(tooFew[1]!.nights).toBe(1);
    expect(validateStays(tooFew, trip)).toBeNull();
  });

  it("clamps the last stay's nights instead of producing an invalid list", () => {
    const tooMany = withNights(stays, 2, 99, 10);
    expect(tooMany[1]!.nights).toBe(1); // previous stay floors at 1 night
    expect(validateStays(tooMany, trip)).toBeNull();

    const tooFew = withNights(stays, 2, -5, 10);
    expect(tooFew[2]!.nights).toBe(1);
    expect(validateStays(tooFew, trip)).toBeNull();
  });

  it("pins a single stay's nights to the trip length", () => {
    const single: Stay[] = [{ hotelId: "a", checkInDayIdx: 0, nights: 5 }];
    const singleTrip = makeTrip(5, ["a"]);
    expect(withNights(single, 0, 3, 5)).toEqual(single);
    expect(validateStays(withNights(single, 0, 3, 5), singleTrip)).toBeNull();
  });
});

describe("nightsRange", () => {
  const stays: Stay[] = [
    { hotelId: "a", checkInDayIdx: 0, nights: 3 },
    { hotelId: "b", checkInDayIdx: 3, nights: 4 },
    { hotelId: "c", checkInDayIdx: 7, nights: 3 },
  ];

  it("agrees with withNights at both the min and max end, for a middle stay", () => {
    const { min, max } = nightsRange(stays, 1, 10);
    expect(min).toBe(1);
    expect(max).toBe(6);
    expect(withNights(stays, 1, max, 10)[1]!.nights).toBe(max);
    expect(withNights(stays, 1, max + 1, 10)[1]!.nights).toBe(max); // clamped, not honoured beyond max
    expect(withNights(stays, 1, min, 10)[1]!.nights).toBe(min);
    expect(withNights(stays, 1, min - 1, 10)[1]!.nights).toBe(min); // clamped, not honoured below min
  });

  it("agrees with withNights at both the min and max end, for the last stay", () => {
    const { min, max } = nightsRange(stays, 2, 10);
    expect(min).toBe(1);
    expect(max).toBe(6);
    expect(withNights(stays, 2, max, 10)[2]!.nights).toBe(max);
    expect(withNights(stays, 2, min, 10)[2]!.nights).toBe(min);
  });

  it("pins min === max === days for a single stay", () => {
    const single: Stay[] = [{ hotelId: "a", checkInDayIdx: 0, nights: 5 }];
    expect(nightsRange(single, 0, 5)).toEqual({ min: 5, max: 5 });
  });
});

describe("withSplitAt", () => {
  it("splits the covering stay into two same-hotel stays", () => {
    const trip = makeTrip(5, ["a"]);
    const stays: Stay[] = [{ hotelId: "a", checkInDayIdx: 0, nights: 5 }];
    const result = withSplitAt(stays, 2, 5);
    expect(result).toEqual([
      { hotelId: "a", checkInDayIdx: 0, nights: 2 },
      { hotelId: "a", checkInDayIdx: 2, nights: 3 },
    ]);
    expect(validateStays(result, trip)).toBeNull();
    // The split survives a derive — this is the exact bug this model fixes.
    expect(staysFor({ ...trip, days: applyStays(trip, result) })).toEqual(result);
  });

  it("is a no-op at an existing check-in day or outside the trip", () => {
    const stays: Stay[] = [
      { hotelId: "a", checkInDayIdx: 0, nights: 2 },
      { hotelId: "b", checkInDayIdx: 2, nights: 3 },
    ];
    expect(withSplitAt(stays, 2, 5)).toEqual(stays); // already a check-in day
    expect(withSplitAt(stays, 0, 5)).toEqual(stays); // day 0
    expect(withSplitAt(stays, 5, 5)).toEqual(stays); // outside the trip
  });
});

describe("withoutStay", () => {
  it("merges a stay into the previous one", () => {
    const trip = makeTrip(5, ["a", "b"]);
    const stays: Stay[] = [
      { hotelId: "a", checkInDayIdx: 0, nights: 2 },
      { hotelId: "b", checkInDayIdx: 2, nights: 3 },
    ];
    const result = withoutStay(stays, 1);
    expect(result).toEqual([{ hotelId: "a", checkInDayIdx: 0, nights: 5 }]);
    expect(validateStays(result, trip)).toBeNull();
  });

  it("is a no-op for stay 0 or an out-of-range index", () => {
    const stays: Stay[] = [
      { hotelId: "a", checkInDayIdx: 0, nights: 2 },
      { hotelId: "b", checkInDayIdx: 2, nights: 3 },
    ];
    expect(withoutStay(stays, 0)).toEqual(stays);
    expect(withoutStay(stays, 5)).toEqual(stays);
  });
});

/** Test-only mirror of the store's day write-back (baseStartId/baseEndId/
 *  stayStart), used to exercise the staysFor(...) round trip without pulling
 *  in the store module. */
function applyStays(trip: Trip, stays: Stay[]): Trip["days"] {
  const nights = new Array<string>(trip.days.length);
  const checkIns = new Set(stays.map((s) => s.checkInDayIdx));
  for (const s of stays) {
    for (let k = 0; k < s.nights; k++) nights[s.checkInDayIdx + k] = s.hotelId;
  }
  return trip.days.map((day, d) => ({
    ...day,
    baseEndId: nights[d]!,
    baseStartId: d === 0 ? nights[0]! : nights[d - 1]!,
    ...(checkIns.has(d) ? { stayStart: true as const } : {}),
  }));
}

import { describe, expect, it } from "vitest";
import { solve } from "./solve";
import { validateTripInput, SolverInputError } from "./validate";
import { place, trip } from "./testUtils";

describe("validateTripInput", () => {
  it("accepts a valid trip", () => {
    const t = trip({
      places: [
        place({ lat: 35.68, lng: 139.76 }),
        place({ lat: 35.67, lng: 139.75 }),
        // `day()` defaults the base to "baseA" — it must resolve to a place.
        place({ id: "baseA", lat: 35.68, lng: 139.76, category: "hotel", dwellMin: 0 }),
      ],
      days: [{ id: "d1" }],
    });
    expect(() => validateTripInput(t)).not.toThrow();
  });

  it("rejects a null coordinate naming the offending place id", () => {
    const t = trip(
      {
        places: [
          place({ id: "plc_good", lat: 35.68, lng: 139.76 }),
          place({ id: "plc_bad", name: "Broken Place", lat: null as unknown as number, lng: 139.75 }),
        ],
        days: [{ id: "d1", baseStartId: "baseA", baseEndId: "baseA" }],
      },
      { validate: false },
    );
    expect(() => validateTripInput(t)).toThrow(SolverInputError);
    expect(() => validateTripInput(t)).toThrow(/plc_bad/);
    expect(() => validateTripInput(t)).toThrow(/null/);
  });

  it("rejects non-finite dwell minutes", () => {
    const t = trip(
      {
        places: [place({ id: "plc_nan", lat: 35.68, lng: 139.76, dwellMin: NaN })],
        days: [{ id: "d1" }],
      },
      { validate: false },
    );
    expect(() => validateTripInput(t)).toThrow(/plc_nan/);
  });

  it("rejects invalid travel-override minutes", () => {
    const t = trip(
      {
        places: [place({ lat: 35.68, lng: 139.76 })],
        days: [{ id: "d1" }],
        travelOverrides: [
          { fromId: "plc_1", toId: "plc_2", minutes: null as unknown as number, symmetric: true },
        ],
      },
      { validate: false },
    );
    expect(() => validateTripInput(t)).toThrow(SolverInputError);
    expect(() => validateTripInput(t)).toThrow(/override/i);
  });

  it("rejects a day whose base references a place that no longer exists", () => {
    const t = trip({
      places: [place({ id: "plc_hotel", lat: 35.68, lng: 139.76, category: "hotel", dwellMin: 0 })],
      days: [{ id: "d1", date: "2026-04-02", baseStartId: "plc_deleted_hotel", baseEndId: "plc_hotel" }],
    });
    expect(() => validateTripInput(t)).toThrow(SolverInputError);
    expect(() => validateTripInput(t)).toThrow(/Day 1 \(2026-04-02\)/);
    expect(() => validateTripInput(t)).toThrow(/plc_deleted_hotel/);
    expect(() => validateTripInput(t)).toThrow(/Stays panel/);
  });

  it("rejects a day whose non-base start/end location no longer exists", () => {
    const t = trip(
      {
        places: [place({ id: "plc_hotel", lat: 35.68, lng: 139.76, category: "hotel", dwellMin: 0 })],
        days: [
          {
            id: "d1",
            baseStartId: "plc_hotel",
            baseEndId: "plc_hotel",
            startLocation: "plc_missing_start",
          },
        ],
      },
      { validate: false },
    );
    expect(() => validateTripInput(t)).toThrow(SolverInputError);
    expect(() => validateTripInput(t)).toThrow(/plc_missing_start/);
  });

  it("solve() surfaces the place-identifying error instead of an opaque failure", () => {
    const t = trip(
      {
        places: [place({ id: "plc_null_lat", lat: null as unknown as number, lng: 139.75 })],
        days: [{ id: "d1" }],
      },
      { validate: false },
    );
    expect(() => solve({ trip: t })).toThrow(/plc_null_lat/);
  });
});

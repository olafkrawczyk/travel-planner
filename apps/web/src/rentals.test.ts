import { describe, expect, it } from "vitest";
import type { CarRental, Day } from "@app/domain";
import {
  isDateCoveredByRental,
  isDayCarAvailable,
  isRentalOutOfRange,
  rentalSpanOnTrip,
  validateRental,
} from "./rentals";

function mockDay(id: string, date: string): Day {
  return {
    id,
    date,
    start: "09:00",
    end: "21:00",
    startLocation: "base",
    endLocation: "base",
    baseStartId: "hotel",
    baseEndId: "hotel",
  };
}

describe("rentals helper functions", () => {
  const tripDays: Day[] = [
    mockDay("d1", "2026-06-01"),
    mockDay("d2", "2026-06-02"),
    mockDay("d3", "2026-06-03"),
    mockDay("d4", "2026-06-04"),
    mockDay("d5", "2026-06-05"),
  ];

  const existingRentals: CarRental[] = [
    { id: "r1", startDate: "2026-06-02", endDate: "2026-06-03" },
  ];

  describe("validateRental", () => {
    it("accepts non-overlapping rental inside trip dates", () => {
      const err = validateRental(
        { startDate: "2026-06-04", endDate: "2026-06-05" },
        existingRentals,
        undefined,
        tripDays,
      );
      expect(err).toBeNull();
    });

    it("rejects endDate earlier than startDate", () => {
      const err = validateRental(
        { startDate: "2026-06-05", endDate: "2026-06-04" },
        [],
        undefined,
        tripDays,
      );
      expect(err).toContain("Rental end date cannot be before its start date");
    });

    it("rejects rental out of trip bounds", () => {
      const err = validateRental(
        { startDate: "2026-05-30", endDate: "2026-06-02" },
        [],
        undefined,
        tripDays,
      );
      expect(err).toContain("must be within the trip");
    });

    it("rejects overlapping rental", () => {
      const err = validateRental(
        { startDate: "2026-06-03", endDate: "2026-06-04" },
        existingRentals,
        undefined,
        tripDays,
      );
      expect(err).toContain("Rental dates overlap an existing rental");
    });

    it("allows updating an existing rental without self-overlap conflict", () => {
      const err = validateRental(
        { startDate: "2026-06-02", endDate: "2026-06-04" },
        existingRentals,
        "r1",
        tripDays,
      );
      expect(err).toBeNull();
    });
  });

  describe("isDateCoveredByRental / isDayCarAvailable", () => {
    it("correctly checks date coverage", () => {
      expect(isDateCoveredByRental("2026-06-01", existingRentals)).toBe(false);
      expect(isDateCoveredByRental("2026-06-02", existingRentals)).toBe(true);
      expect(isDateCoveredByRental("2026-06-03", existingRentals)).toBe(true);
      expect(isDateCoveredByRental("2026-06-04", existingRentals)).toBe(false);
    });

    it("isDayCarAvailable respects carOnly", () => {
      expect(isDayCarAvailable(tripDays[0]!, [], true)).toBe(true);
      expect(isDayCarAvailable(tripDays[0]!, existingRentals, false)).toBe(false);
      expect(isDayCarAvailable(tripDays[1]!, existingRentals, false)).toBe(true);
    });
  });

  describe("isRentalOutOfRange", () => {
    it("returns false when fully covered", () => {
      expect(isRentalOutOfRange(existingRentals[0]!, tripDays)).toBe(false);
    });

    it("returns true when outside trip dates", () => {
      const outOfRange: CarRental = { id: "out", startDate: "2026-05-20", endDate: "2026-05-25" };
      expect(isRentalOutOfRange(outOfRange, tripDays)).toBe(true);
    });

    it("returns true when partially outside trip dates", () => {
      const partial: CarRental = { id: "part", startDate: "2026-06-04", endDate: "2026-06-08" };
      expect(isRentalOutOfRange(partial, tripDays)).toBe(true);
    });
  });

  describe("rentalSpanOnTrip", () => {
    it("returns startIdx and day count", () => {
      const span = rentalSpanOnTrip(existingRentals[0]!, tripDays);
      expect(span).toEqual({ startIdx: 1, count: 2 });
    });

    it("returns null when completely outside", () => {
      const out: CarRental = { id: "out", startDate: "2026-07-01", endDate: "2026-07-03" };
      expect(rentalSpanOnTrip(out, tripDays)).toBeNull();
    });
  });
});

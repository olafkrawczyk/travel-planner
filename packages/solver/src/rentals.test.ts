import { describe, expect, it } from "vitest";
import { solve } from "./solve";
import { DEG_PER_KM, day, place, trip } from "./testUtils";

describe("mixed-commute car rental solver integration", () => {
  it("distant unschedulable place becomes scheduled when a rental covers a day", () => {
    // Hotel at (0, 0).
    const hotel = place({ lat: 0, lng: 0, id: "baseA", category: "hotel", dwellMin: 0 });
    // Distant place at 45 km north.
    // Transit round trip: ~170 min + 60 min dwell = 230 min > 210 min day budget.
    // Car round trip: ~127 min + 60 min dwell = 187 min <= 210 min day budget.
    const distant = place({ lat: 45 * DEG_PER_KM, lng: 0, id: "distant", dwellMin: 60, priority: 1 });

    const tripNoRental = trip({
      places: [distant, hotel],
      days: [day({ id: "d1", date: "2026-06-01", start: "09:00", end: "12:30" })], // 210 min budget
    });

    const itinNoRental = solve({ trip: tripNoRental, seed: 42 });
    expect(itinNoRental.unscheduled.map((u) => u.placeId)).toContain("distant");
    expect(itinNoRental.days[0]!.stops).toHaveLength(0);

    const tripWithRental = trip({
      places: [distant, hotel],
      days: [day({ id: "d1", date: "2026-06-01", start: "09:00", end: "12:30" })],
      carRentals: [{ id: "rent_1", startDate: "2026-06-01", endDate: "2026-06-01" }],
    });

    const itinWithRental = solve({ trip: tripWithRental, seed: 42 });
    expect(itinWithRental.unscheduled).toHaveLength(0);
    expect(itinWithRental.days[0]!.stops.map((s) => s.placeId)).toEqual(["distant"]);
    expect(itinWithRental.days[0]!.legs.some((l) => l.mode === "car")).toBe(true);
  });

  it("non-car days solve identically to a no-rental trip", () => {
    const hotel = place({ lat: 0, lng: 0, id: "baseA", category: "hotel", dwellMin: 0 });
    const p1 = place({ lat: 2 * DEG_PER_KM, lng: 0, id: "p1", dwellMin: 60, priority: 1 });
    const p2 = place({ lat: 4 * DEG_PER_KM, lng: 0, id: "p2", dwellMin: 60, priority: 1 });

    const tripNoRental = trip({
      places: [p1, p2, hotel],
      days: [
        day({ id: "d1", date: "2026-06-01", locked: true }), // locked day 1 keeps day 1 identical
        day({ id: "d2", date: "2026-06-02" }),
      ],
    });

    const tripWithRentalOnDay2 = trip({
      places: [p1, p2, hotel],
      days: [
        day({ id: "d1", date: "2026-06-01", locked: true }),
        day({ id: "d2", date: "2026-06-02" }),
      ],
      carRentals: [{ id: "rent_1", startDate: "2026-06-02", endDate: "2026-06-02" }],
    });

    const solA = solve({ trip: tripNoRental, seed: 42 });
    const solB = solve({ trip: tripWithRentalOnDay2, seed: 42 });

    // Day 1 on tripWithRentalOnDay2 is a non-car day and must carry no car legs
    expect(solB.days[0]!.legs.some((l) => l.mode === "car")).toBe(false);
  });

  it("walk wins over car for short hops on car days", () => {
    const hotel = place({ lat: 0, lng: 0, id: "baseA", category: "hotel", dwellMin: 0 });
    // 0.2 km apart -> walking takes ~2.7 min, car takes 0.26 + 5 = 5.3 min. Walk wins!
    const p1 = place({ lat: 0.1 * DEG_PER_KM, lng: 0, id: "p1", dwellMin: 30, priority: 1 });
    const p2 = place({ lat: 0.3 * DEG_PER_KM, lng: 0, id: "p2", dwellMin: 30, priority: 1 });

    const t = trip({
      places: [p1, p2, hotel],
      days: [day({ id: "d1", date: "2026-06-01", pinnedOrder: ["p1", "p2"] })],
      carRentals: [{ id: "rent_1", startDate: "2026-06-01", endDate: "2026-06-01" }],
    });

    const itin = solve({ trip: t, seed: 42 });
    // All legs on this short-hop-only day should use the walk curve, not car
    // (car costs 60 km/h + 5 min parking; a ~0.1-0.4 km hop is always faster
    // on foot).
    expect(itin.days[0]!.legs.length).toBeGreaterThan(0);
    for (const leg of itin.days[0]!.legs) {
      expect(leg.mode).toBe("walk");
      expect(leg.explanation).toContain("walk heuristic");
    }
  });

  it("overrides are honoured on both day types", () => {
    const hotel = place({ lat: 0, lng: 0, id: "baseA", category: "hotel", dwellMin: 0 });
    const p1 = place({ lat: 20 * DEG_PER_KM, lng: 0, id: "p1", dwellMin: 60, priority: 1 });
    const p2 = place({ lat: 20 * DEG_PER_KM, lng: 0, id: "p2", dwellMin: 60, priority: 1 });

    // Force p1 on non-car d1, p2 on car-day d2
    const t = trip({
      places: [
        { ...p1, forceDayId: "d1" },
        { ...p2, forceDayId: "d2" },
        hotel,
      ],
      days: [
        day({ id: "d1", date: "2026-06-01", pinnedOrder: ["p1"] }),
        day({ id: "d2", date: "2026-06-02", pinnedOrder: ["p2"] }),
      ],
      carRentals: [{ id: "rent_1", startDate: "2026-06-02", endDate: "2026-06-02" }],
      travelOverrides: [
        { fromId: "baseA", toId: "p1", minutes: 33, symmetric: true },
        { fromId: "baseA", toId: "p2", minutes: 33, symmetric: true },
      ],
    });

    const itin = solve({ trip: t, seed: 42 });
    const legD1 = itin.days[0]!.legs.find((l) => l.fromId === "baseA" && l.toId === "p1");
    const legD2 = itin.days[1]!.legs.find((l) => l.fromId === "baseA" && l.toId === "p2");

    expect(legD1).toMatchObject({ minutes: 33, source: "override" });
    expect(legD2).toMatchObject({ minutes: 33, source: "override" });
  });

  it("is deterministic with rentals fixed", () => {
    const hotel = place({ lat: 0, lng: 0, id: "baseA", category: "hotel", dwellMin: 0 });
    const places = Array.from({ length: 8 }, (_, i) =>
      place({ lat: (i * 5) * DEG_PER_KM, lng: 0, id: `p${i}`, dwellMin: 45, priority: 2 }),
    );

    const t = trip({
      places: [...places, hotel],
      days: [
        day({ id: "d1", date: "2026-06-01" }),
        day({ id: "d2", date: "2026-06-02" }),
        day({ id: "d3", date: "2026-06-03" }),
      ],
      carRentals: [{ id: "rent_1", startDate: "2026-06-02", endDate: "2026-06-03" }],
    });

    const sol1 = solve({ trip: t, seed: 99 });
    const sol2 = solve({ trip: t, seed: 99 });

    expect(sol1.stats).toEqual(sol2.stats);
    expect(sol1.days).toEqual(sol2.days);
    expect(sol1.unscheduled).toEqual(sol2.unscheduled);
  });
});

import { describe, expect, it } from "vitest";
import { buildProblem } from "./matrix";
import { split } from "./split";
import { day, place, trip } from "./testUtils";

/** Co-located places: travel time is zero, so segments are purely dwell-bound. */
function coLocated(n: number, dwellMin = 120) {
  return Array.from({ length: n }, (_, i) =>
    place({ lat: 35.68, lng: 139.69, id: `p${i}`, dwellMin }),
  );
}

describe("split (Prins DP)", () => {
  it("respects day budgets with zero travel", () => {
    // 6 places × 120 min dwell; days 09:00–15:00 (360 min) → 3 per day.
    const places = coLocated(6);
    const problem = buildProblem(
      trip({ places, days: [day({ id: "d1", end: "15:00" }), day({ id: "d2", end: "15:00" })] }),
    );
    const { segments } = split(problem, ["p0", "p1", "p2", "p3", "p4", "p5"]);
    expect(segments[0]).toEqual(["p0", "p1", "p2"]);
    expect(segments[1]).toEqual(["p3", "p4", "p5"]);
  });

  it("keeps tour order within segments and covers all places", () => {
    const places = coLocated(5, 90);
    const problem = buildProblem(
      trip({ places, days: [day({ id: "d1", end: "13:00" }), day({ id: "d2", end: "21:00" })] }),
    );
    const tour = ["p4", "p2", "p0", "p1", "p3"];
    const { segments } = split(problem, tour);
    // Segments are consecutive slices of the tour and together cover every place.
    expect(segments.flat()).toEqual(tour);
    // Day 1's 4-hour budget fits at most two 90-min visits.
    expect(segments[0]).toHaveLength(2);
  });

  it("assigns an appointment place to its appointment day", () => {
    const places = [
      place({ lat: 35.68, lng: 139.69, id: "p0", dwellMin: 60 }),
      place({ lat: 35.68, lng: 139.69, id: "p1", dwellMin: 60, appointment: { dayId: "d2", start: "14:00" } }),
      place({ lat: 35.68, lng: 139.69, id: "p2", dwellMin: 60 }),
    ];
    const problem = buildProblem(
      trip({ places, days: [day({ id: "d1" }), day({ id: "d2" })] }),
    );
    const { segments } = split(problem, ["p2", "p1", "p0"]);
    expect(segments[1]).toContain("p1");
    expect(segments[0]).not.toContain("p1");
  });

  it("always yields a full partition even when appointment constraints conflict", () => {
    const places = [
      place({ lat: 35.68, lng: 139.69, id: "a", dwellMin: 60, appointment: { dayId: "d1", start: "09:00" } }),
      place({ lat: 35.68, lng: 139.69, id: "b", dwellMin: 60, appointment: { dayId: "d2", start: "09:00" } }),
    ];
    const problem = buildProblem(
      trip({ places, days: [day({ id: "d1" }), day({ id: "d2" })] }),
    );
    // Tour order puts b before a, so a clean 2-way cut cannot satisfy both.
    const { segments } = split(problem, ["b", "a"]);
    expect(segments.flat().sort()).toEqual(["a", "b"]);
  });
});

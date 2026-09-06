import { describe, expect, it } from "vitest";
import { buildProblem } from "./matrix";
import { sequenceDay } from "./sequence";
import { day, place, trip } from "./testUtils";

const TOKYO = { lat: 35.68, lng: 139.69 };

describe("sequenceDay", () => {
  it("computes arrive/depart/wait and legs with forward propagation", () => {
    const places = [
      place({ ...TOKYO, id: "a", dwellMin: 60 }),
      place({ ...TOKYO, id: "b", dwellMin: 30 }),
    ];
    const problem = buildProblem(trip({ places, days: [day({ id: "d1" })] }));
    const res = sequenceDay(problem, problem.dayList[0]!, ["a", "b"]);
    expect(res.order).toEqual(["a", "b"]);
    expect(res.stops[0]).toMatchObject({ placeId: "a", arrive: "09:00", depart: "10:00", waitMin: 0 });
    expect(res.stops[1]).toMatchObject({ placeId: "b", arrive: "10:00", depart: "10:30", waitMin: 0 });
    // Legs: base -> a -> b -> base.
    expect(res.legs.map((l) => `${l.fromId}->${l.toId}`)).toEqual(["baseA->a", "a->b", "b->baseA"]);
    expect(res.travelMin).toBe(0); // co-located with the base
    expect(res.slackMin).toBe(630); // 21:00 - 10:30
  });

  it("makes early arrivals at appointments explicit as wait time", () => {
    const places = [place({ ...TOKYO, id: "a", dwellMin: 60, appointment: { dayId: "d1", start: "14:00" } })];
    const problem = buildProblem(trip({ places, days: [day({ id: "d1" })] }));
    const res = sequenceDay(problem, problem.dayList[0]!, ["a"]);
    expect(res.stops[0]).toMatchObject({ arrive: "14:00", depart: "15:00", waitMin: 300 });
    expect(res.waitMin).toBe(300);
  });

  it("enforces hard appointment windows", () => {
    const places = [
      place({ ...TOKYO, id: "a", dwellMin: 240, appointment: { dayId: "d1", start: "09:00" } }),
      place({ ...TOKYO, id: "b", dwellMin: 60, appointment: { dayId: "d1", start: "10:00" } }),
    ];
    const problem = buildProblem(trip({ places, days: [day({ id: "d1" })] }));
    const res = sequenceDay(problem, problem.dayList[0]!, ["a", "b"]);
    // b can never be reached by 10:00 after a 4-hour visit to a.
    expect(res.order).toEqual(["a"]);
    expect(res.dropped).toEqual([{ placeId: "b", reason: "window_conflict" }]);
  });

  it("never schedules an appointment place on a different day", () => {
    const places = [
      place({ ...TOKYO, id: "a", dwellMin: 60, appointment: { dayId: "d2", start: "10:00" } }),
      place({ ...TOKYO, id: "b", dwellMin: 60 }),
    ];
    const problem = buildProblem(trip({ places, days: [day({ id: "d1" }), day({ id: "d2" })] }));
    const res = sequenceDay(problem, problem.dayList[0]!, ["a", "b"]);
    expect(res.order).toEqual(["b"]);
    expect(res.dropped).toEqual([{ placeId: "a", reason: "window_conflict" }]);
  });

  it("keeps a pinned sub-sequence in pinned relative order", () => {
    const places = [
      place({ ...TOKYO, id: "a", dwellMin: 60 }),
      place({ ...TOKYO, id: "b", dwellMin: 60 }),
      place({ ...TOKYO, id: "c", dwellMin: 60 }),
    ];
    const d1 = day({ id: "d1", pinnedOrder: ["c", "a"] });
    const problem = buildProblem(trip({ places, days: [d1] }));
    const res = sequenceDay(problem, problem.dayList[0]!, ["a", "b", "c"]);
    const pos = (id: string) => res.order.indexOf(id);
    expect(pos("c")).toBeGreaterThanOrEqual(0);
    expect(pos("a")).toBeGreaterThan(pos("c"));
  });

  it("prefers must-visit places when the day is too short", () => {
    const places = [
      place({ ...TOKYO, id: "must", dwellMin: 300, priority: 1 }),
      place({ ...TOKYO, id: "nice", dwellMin: 300, priority: 3 }),
    ];
    const problem = buildProblem(trip({ places, days: [day({ id: "d1", start: "09:00", end: "15:00" })] }));
    const res = sequenceDay(problem, problem.dayList[0]!, ["must", "nice"]);
    expect(res.order).toEqual(["must"]);
    expect(res.dropped).toEqual([{ placeId: "nice", reason: "no_time" }]);
  });

  it("reports places with invalid coordinates as unreachable", () => {
    const places = [
      place({ ...TOKYO, id: "ok", dwellMin: 60 }),
      { ...place({ ...TOKYO, id: "bad", dwellMin: 60 }), lat: Number.NaN },
    ];
    // Bypass validation: the NaN coordinate is intentionally invalid and must
    // be handled defensively by the solver.
    const problem = buildProblem(trip({ places, days: [day({ id: "d1" })] }, { validate: false }));
    const res = sequenceDay(problem, problem.dayList[0]!, ["ok", "bad"]);
    expect(res.order).toEqual(["ok"]);
    expect(res.dropped).toEqual([{ placeId: "bad", reason: "unreachable" }]);
  });

  it("waits for opening when arriving before the window opens", () => {
    const places = [
      place({ ...TOKYO, id: "museum", dwellMin: 60, openingHours: { "2026-04-01": [{ start: "10:00", end: "17:00" }] } }),
    ];
    const problem = buildProblem(trip({ places, days: [day({ id: "d1", date: "2026-04-01" })] }));
    const res = sequenceDay(problem, problem.dayList[0]!, ["museum"]);
    expect(res.order).toEqual(["museum"]);
    // Arrives at 09:00 (day start), waits 60 min, visits 10:00–11:00.
    expect(res.stops[0]).toMatchObject({ placeId: "museum", arrive: "09:00", depart: "11:00", waitMin: 60 });
    expect(res.waitMin).toBe(60);
  });

  it("rejects visits that would end after closing", () => {
    const places = [
      place({ ...TOKYO, id: "late", dwellMin: 120, openingHours: { "2026-04-01": [{ start: "09:00", end: "10:30" }] } }),
    ];
    const problem = buildProblem(trip({ places, days: [day({ id: "d1", date: "2026-04-01" })] }));
    const res = sequenceDay(problem, problem.dayList[0]!, ["late"]);
    expect(res.order).toEqual([]);
    expect(res.dropped).toEqual([{ placeId: "late", reason: "window_conflict" }]);
  });

  it("uses the second window when the first is already past", () => {
    const places = [
      place({
        ...TOKYO,
        id: "museum",
        dwellMin: 60,
        openingHours: { "2026-04-01": [{ start: "08:00", end: "09:00" }, { start: "13:00", end: "18:00" }] },
      }),
    ];
    const problem = buildProblem(trip({ places, days: [day({ id: "d1", date: "2026-04-01" })] }));
    const res = sequenceDay(problem, problem.dayList[0]!, ["museum"]);
    expect(res.order).toEqual(["museum"]);
    // First window closes at 09:00 (before the 09:00 arrival + dwell); the
    // visit starts at the 13:00 opening.
    expect(res.stops[0]).toMatchObject({ arrive: "09:00", depart: "14:00", waitMin: 240 });
  });

  it("schedules an appointment place only when the appointment falls inside a window", () => {
    const places = [
      place({
        ...TOKYO,
        id: "ok",
        dwellMin: 60,
        appointment: { dayId: "d1", start: "14:00" },
        openingHours: { "2026-04-01": [{ start: "13:00", end: "17:00" }] },
      }),
      place({
        ...TOKYO,
        id: "conflict",
        dwellMin: 60,
        appointment: { dayId: "d1", start: "18:00" },
        openingHours: { "2026-04-01": [{ start: "09:00", end: "17:00" }] },
      }),
    ];
    const problem = buildProblem(trip({ places, days: [day({ id: "d1", date: "2026-04-01" })] }));
    const res = sequenceDay(problem, problem.dayList[0]!, ["ok", "conflict"]);
    expect(res.order).toEqual(["ok"]);
    expect(res.stops[0]).toMatchObject({ placeId: "ok", arrive: "14:00", depart: "15:00", waitMin: 300 });
    expect(res.dropped).toEqual([{ placeId: "conflict", reason: "window_conflict" }]);
  });

  it("ignores windows that do not match the day's date", () => {
    const places = [
      place({ ...TOKYO, id: "a", dwellMin: 60, openingHours: { "2026-04-02": [{ start: "20:00", end: "21:00" }] } }),
    ];
    const problem = buildProblem(trip({ places, days: [day({ id: "d1", date: "2026-04-01" })] }));
    const res = sequenceDay(problem, problem.dayList[0]!, ["a"]);
    expect(res.order).toEqual(["a"]);
    expect(res.stops[0]).toMatchObject({ arrive: "09:00", depart: "10:00", waitMin: 0 });
  });
});

/**
 * Regression test for the weights.travel omission (`insertionDelta` in this
 * file, and its sibling `insertPlace` in alns.ts — see alns.test.ts's
 * matching test): both used to rank candidate insertion positions by
 * `travelMin + weights.wait * waitMin`, silently treating weights.travel as
 * always 1 even though `evaluate()`'s acceptance criterion weights it as
 * `w.travel * travelMin + ...`. A trip with weights.travel != 1 could
 * therefore have its construction/local-search phase optimise a DIFFERENT
 * function than the one ALNS judges acceptance against.
 *
 * Scenario: B has an appointment at 11:00 (dwell 5); C is a free place.
 * Visiting C before B ("C","B") costs more travel (65) but less wait (70,
 * since the detour delays arrival closer to the appointment); visiting C
 * after B ("B","C") costs less travel (21) but more wait (119, since B is
 * reached quickly and then waits out the appointment). At the default
 * weights.travel=1, the extra 44 min of travel outweighs the 49 min of wait
 * saved, so "B","C" is cheaper. At weights.travel=0.3, the same travel
 * difference is worth only 13.2 (0.3*44) against the wait saving of 24.5
 * (0.5*49) — "C","B" flips to cheaper. Both orders are equally feasible, so
 * this isolates the weighting bug rather than a feasibility difference.
 */
describe("weights.travel is threaded through insertion cost (not silently treated as 1)", () => {
  function tradeoffProblem(weightsTravel: number) {
    const t = trip({
      places: [
        place({ id: "base", lat: 0, lng: 0, category: "hotel", dwellMin: 0 }),
        place({ id: "B", lat: 0, lng: 0.001, dwellMin: 5, appointment: { dayId: "d1", start: "11:00" } }),
        place({ id: "C", lat: 0, lng: 0.002, dwellMin: 5 }),
      ],
      days: [day({ id: "d1", baseStartId: "base", baseEndId: "base" })],
      travelOverrides: [
        { fromId: "base", toId: "C", minutes: 30, symmetric: false },
        { fromId: "C", toId: "base", minutes: 5, symmetric: false },
        { fromId: "base", toId: "B", minutes: 1, symmetric: false },
        { fromId: "B", toId: "base", minutes: 20, symmetric: false },
        { fromId: "C", toId: "B", minutes: 15, symmetric: true },
      ],
    });
    t.settings.weights = {
      travel: weightsTravel,
      wait: 0.5,
      mustDropped: 1000,
      niceDropped: 10,
      dayImbalance: 1,
      overBudget: 3,
    };
    return buildProblem(t);
  }

  it("prefers the higher-travel/lower-wait order at a low travel weight, and the lower-travel/higher-wait order at the default weight", () => {
    const low = sequenceDay(tradeoffProblem(0.3), tradeoffProblem(0.3).dayList[0]!, ["B", "C"]);
    expect(low.order).toEqual(["C", "B"]);

    const normal = sequenceDay(tradeoffProblem(1), tradeoffProblem(1).dayList[0]!, ["B", "C"]);
    expect(normal.order).toEqual(["B", "C"]);
  });
});

import { describe, expect, it } from "vitest";
import { DayPlanSchema } from "@app/domain";
import { buildProblem } from "./matrix";
import { explainUnscheduled } from "./explain";
import { repairPass, resolve, solve } from "./solve";
import type { State } from "./alns";
import { place, trip } from "./testUtils";

// All nodes share one coordinate → every matrix entry is 0 min, so day
// arithmetic in the assertions is exact.
const HERE = { lat: 35.68, lng: 139.69 };

describe("priority-ordered repair pass (task 1.1)", () => {
  it("inserts a must from the pool while a nice place occupies a day where the must fits", () => {
    const t = trip({
      places: [
        place({ ...HERE, id: "nice", dwellMin: 120, priority: 3 }),
        place({ ...HERE, id: "must", dwellMin: 120, priority: 1 }),
      ],
      days: [{ id: "d1" }],
    });
    const problem = buildProblem(t);
    // ALNS outcome to repair from: nice scheduled, must dropped.
    const state: State = { days: [["nice"]], pool: ["must"] };

    repairPass(problem, state);

    expect(state.pool).toEqual([]);
    expect(state.days[0]).toContain("must");
    expect(state.days[0]).toContain("nice");
  });

  it("prefers dropping nice-to-have over must (solve end-to-end)", () => {
    // Day budget 240 min: the must (180) fits, the nice (120) does not.
    const t = trip({
      places: [
        place({ ...HERE, id: "must_a", dwellMin: 180, priority: 1 }),
        place({ ...HERE, id: "nice_x", dwellMin: 120, priority: 3 }),
        // `day()` defaults the base to "baseA" — it must resolve to a real
        // place (validateTripInput rejects a dangling base reference).
        place({ ...HERE, id: "baseA", category: "hotel", dwellMin: 0 }),
      ],
      days: [{ id: "d1", start: "09:00", end: "13:00" }],
    });
    const itin = solve({ trip: t, seed: 1, maxIterations: 50, budgetMs: 60_000 });
    expect(itin.days[0]!.stops.map((s) => s.placeId)).toContain("must_a");
    expect(itin.unscheduled.map((u) => u.placeId)).toEqual(["nice_x"]);
  });
});

describe("explainUnscheduled (task 2.2)", () => {
  it("quantifies the no_time shortfall (needed minutes vs best day's free slack)", () => {
    const t = trip({
      places: [
        place({ ...HERE, id: "a", dwellMin: 180, priority: 1 }),
        place({ ...HERE, id: "x", dwellMin: 90, priority: 3 }),
      ],
      days: [{ id: "d1", start: "09:00", end: "13:00" }],
    });
    const problem = buildProblem(t);
    const state: State = { days: [["a"]], pool: ["x"] };
    const text = explainUnscheduled(problem, state, "x", "no_time");
    expect(text).toContain("needs ~90 min");
    expect(text).toContain("60 min free");
  });

  it("names the blocking opening window", () => {
    const t = trip({
      places: [
        place({ ...HERE, id: "a", dwellMin: 180, priority: 1 }),
        place({
          ...HERE,
          id: "w",
          dwellMin: 60,
          priority: 3,
          openingHours: { "2026-04-01": [{ start: "06:00", end: "07:00" }] },
        }),
      ],
      days: [{ id: "d1", start: "09:00", end: "13:00" }],
    });
    const problem = buildProblem(t);
    const state: State = { days: [["a"]], pool: ["w"] };
    const text = explainUnscheduled(problem, state, "w", "window_conflict");
    expect(text).toContain("06:00–07:00");
    expect(text).toContain("09:00"); // earliest feasible arrival
  });

  it("guides for unreachable places", () => {
    const t = trip(
      {
        places: [place({ lat: Number.NaN, lng: Number.NaN, id: "bad", dwellMin: 60, priority: 3 })],
        days: [{ id: "d1" }],
      },
      { validate: false },
    );
    const problem = buildProblem(t);
    const state: State = { days: [[]], pool: ["bad"] };
    const text = explainUnscheduled(problem, state, "bad", "unreachable");
    expect(text).toContain("No route");
  });
});

describe("force-insert (task 3.2)", () => {
  it("schedules over budget (slackMin ≤ 0) when forced", () => {
    const t = trip({
      places: [
        place({ ...HERE, id: "a", dwellMin: 180, priority: 1 }),
        place({ ...HERE, id: "x", dwellMin: 90, priority: 2 }),
        place({ ...HERE, id: "baseA", category: "hotel", dwellMin: 0 }),
      ],
      days: [{ id: "d1", start: "09:00", end: "13:00" }],
    });
    const first = solve({ trip: t, seed: 1, maxIterations: 50, budgetMs: 60_000 });
    expect(first.unscheduled.map((u) => u.placeId)).toEqual(["x"]);

    // Persist the force intent (as the store does), then force-insert.
    t.places.find((p) => p.id === "x")!.forceDayId = "d1";
    const second = resolve({
      trip: t,
      previous: first,
      edit: { type: "forceInsert", placeId: "x", dayId: "d1" },
      seed: 1,
      maxIterations: 50,
      budgetMs: 60_000,
    });

    expect(second.unscheduled).toEqual([]);
    const plan = second.days[0]!;
    expect(plan.stops.map((s) => s.placeId)).toContain("x");
    expect(plan.slackMin).toBeLessThanOrEqual(0);
    // 09:00 + 180 + 90 dwell, zero travel → ends 30 min past 13:00.
    expect(plan.slackMin).toBe(-30);
    expect(() => DayPlanSchema.parse(plan)).not.toThrow();
  });

  it("still respects hard opening windows when forced", () => {
    const t = trip({
      places: [
        place({ ...HERE, id: "a", dwellMin: 180, priority: 1 }),
        place({
          ...HERE,
          id: "w",
          dwellMin: 60,
          priority: 2,
          openingHours: { "2026-04-01": [{ start: "06:00", end: "07:00" }] },
        }),
        place({ ...HERE, id: "baseA", category: "hotel", dwellMin: 0 }),
      ],
      days: [{ id: "d1", start: "09:00", end: "13:00" }],
    });
    const first = solve({ trip: t, seed: 1, maxIterations: 50, budgetMs: 60_000 });
    expect(first.unscheduled.map((u) => u.placeId)).toEqual(["w"]);

    t.places.find((p) => p.id === "w")!.forceDayId = "d1";
    const second = resolve({
      trip: t,
      previous: first,
      edit: { type: "forceInsert", placeId: "w", dayId: "d1" },
      seed: 1,
      maxIterations: 50,
      budgetMs: 60_000,
    });

    // Hard window blocks the force → stays unscheduled, with an explanation.
    expect(second.days[0]!.stops.map((s) => s.placeId)).not.toContain("w");
    const entry = second.unscheduled.find((u) => u.placeId === "w")!;
    expect(entry).toBeDefined();
    expect(entry.reason).toBe("window_conflict");
    expect(entry.explanation).toContain("06:00–07:00");
  });
});

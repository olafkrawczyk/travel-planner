import { describe, expect, it } from "vitest";
import { buildProblem } from "./matrix";
import { classifyUnscheduled } from "./explain";
import type { State } from "./alns";
import { DEG_PER_KM, place, trip } from "./testUtils";

const HERE = { lat: 35.68, lng: 139.69 };
// 5km away: outside the 3km adjacency threshold, but easily reachable within
// a 4-hour day window.
const FAR = { lat: 35.68 + 5 * DEG_PER_KM, lng: 139.69 };

describe("classifyUnscheduled: clusterFirst region-aware diagnostic (task 1.3)", () => {
  it("reports no_time (not window_conflict) when the only physically-open day is region-incompatible", () => {
    const t = trip({
      places: [
        // Day 1 is dedicated to region "A" and is loaded to 400 min in a
        // 600-min window (66.7% utilization, above the 65% under-load
        // spillover threshold). It has 200 min free, easily fitting b0's
        // 60-min dwell + ~78-min travel, but clusterFirst region protection
        // refuses the move because Day 1 is already region-loaded.
        place({ ...HERE, id: "a0", dwellMin: 400, priority: 1, region: "A" }),
        // A want-priority "B" place (region B is 5km away, > 3km adjacency).
        place({ ...FAR, id: "b0", dwellMin: 60, priority: 2, region: "B" }),
        place({ ...HERE, id: "baseA", category: "hotel", dwellMin: 0 }),
      ],
      days: [{ id: "d1", start: "09:00", end: "19:00" }],
    });
    t.settings.solverStrategy = "clusterFirst";
    const problem = buildProblem(t);
    const state: State = { days: [["a0"]], pool: ["b0"] };

    expect(classifyUnscheduled(problem, state, "b0")).toBe("no_time");
  });

  it("still reports window_conflict when a region-compatible day has room but hours block it", () => {
    const t = trip({
      places: [
        place({ ...HERE, id: "a0", dwellMin: 60, priority: 1, region: "A" }),
        place({
          ...HERE,
          id: "a1",
          dwellMin: 60,
          priority: 2,
          region: "A",
          openingHours: { "2026-04-01": [{ start: "06:00", end: "07:00" }] },
        }),
        place({ ...HERE, id: "baseA", category: "hotel", dwellMin: 0 }),
      ],
      days: [{ id: "d1", start: "09:00", end: "13:00" }],
    });
    t.settings.solverStrategy = "clusterFirst";
    const problem = buildProblem(t);
    const state: State = { days: [["a0"]], pool: ["a1"] };

    expect(classifyUnscheduled(problem, state, "a1")).toBe("window_conflict");
  });

  it("bypasses region protection for a must-priority place — a mismatched region never masks a real window conflict", () => {
    const t = trip({
      places: [
        place({ ...HERE, id: "a0", dwellMin: 60, priority: 1, region: "A" }),
        place({
          ...FAR,
          id: "b_must",
          dwellMin: 60,
          priority: 1,
          region: "B",
          openingHours: { "2026-04-01": [{ start: "06:00", end: "07:00" }] },
        }),
        place({ ...HERE, id: "baseA", category: "hotel", dwellMin: 0 }),
      ],
      days: [{ id: "d1", start: "09:00", end: "13:00" }],
    });
    t.settings.solverStrategy = "clusterFirst";
    const problem = buildProblem(t);
    const state: State = { days: [["a0"]], pool: ["b_must"] };

    expect(classifyUnscheduled(problem, state, "b_must")).toBe("window_conflict");
  });

  it("routeFirst is unaffected: region never changes the diagnostic", () => {
    const t = trip({
      places: [
        place({ ...HERE, id: "a0", dwellMin: 60, priority: 1, region: "A" }),
        place({ ...FAR, id: "b0", dwellMin: 60, priority: 2, region: "B" }),
        place({ ...HERE, id: "baseA", category: "hotel", dwellMin: 0 }),
      ],
      days: [{ id: "d1", start: "09:00", end: "13:00" }],
    });
    t.settings.solverStrategy = "routeFirst";
    const problem = buildProblem(t);
    const state: State = { days: [["a0"]], pool: ["b0"] };

    expect(classifyUnscheduled(problem, state, "b0")).toBe("window_conflict");
  });
});

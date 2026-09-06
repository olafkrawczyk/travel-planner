import { describe, expect, it } from "vitest";
import { buildProblem } from "./matrix";
import { resolve, solve } from "./solve";
import { DEG_PER_KM, day, place, trip } from "./testUtils";

function makeTrip() {
  let s = 11;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const places = Array.from({ length: 12 }, (_, i) =>
    place({
      lat: 35.66 + (i % 4) * 5 * DEG_PER_KM + rnd() * 0.003,
      lng: 139.68 + Math.floor(i / 4) * 5 * DEG_PER_KM + rnd() * 0.003,
      id: `p${i}`,
      dwellMin: 60,
      priority: 2,
    }),
  );
  // `day()` defaults every day's base to "baseA" — it must resolve to a real
  // place (validateTripInput now rejects a dangling base reference).
  const base = place({ lat: 35.66, lng: 139.68, id: "baseA", category: "hotel", dwellMin: 0 });
  return trip({
    places: [...places, base],
    days: [day({ id: "d1" }), day({ id: "d2" }), day({ id: "d3" })],
  });
}

const SOLVE_OPTS = { seed: 5, maxIterations: 100, budgetMs: 60_000 } as const;

describe("resolve (incremental re-solve)", () => {
  it("dragToDay: moves the place to the target day and leaves other days unchanged", () => {
    const t = makeTrip();
    const first = solve({ trip: t, ...SOLVE_OPTS });
    const moved = "p0";
    const fromDay = first.days.findIndex((d) => d.stops.some((s) => s.placeId === moved));
    const targetDay = (fromDay + 1) % first.days.length;
    const dayId = t.days[targetDay]!.id;

    const second = resolve({
      trip: t,
      previous: first,
      edit: { type: "dragToDay", placeId: moved, dayId },
      ...SOLVE_OPTS,
    });

    expect(second.days[targetDay]!.stops.map((s) => s.placeId)).toContain(moved);
    expect(second.days[fromDay]!.stops.map((s) => s.placeId)).not.toContain(moved);
    // A third day (untouched by the edit) stays identical.
    const untouched = first.days.findIndex((_, i) => i !== fromDay && i !== targetDay);
    expect(second.days[untouched]).toEqual(first.days[untouched]);
    expect(second.days).toHaveLength(first.days.length);
  });

  it("locked day is untouched by a full re-solve", () => {
    const t = makeTrip();
    t.days[1]!.locked = true;
    const first = solve({ trip: t, ...SOLVE_OPTS });
    const lockedPlan = first.days[1]!;

    const second = resolve({ trip: t, previous: first, edit: { type: "full" }, ...SOLVE_OPTS });

    expect(second.days[1]).toEqual(lockedPlan);
  });

  it("dwell change re-times only the affected day", () => {
    const t = makeTrip();
    const first = solve({ trip: t, ...SOLVE_OPTS });
    const dayIdx = first.days.findIndex((d) => d.stops.length > 0);
    const moved = first.days[dayIdx]!.stops[0]!.placeId;
    const otherIdx = (dayIdx + 1) % first.days.length;

    const p = t.places.find((pl) => pl.id === moved)!;
    p.dwellMin += 45;

    const second = resolve({ trip: t, previous: first, edit: { type: "dwellChange", placeId: moved }, ...SOLVE_OPTS });

    const stop = second.days[dayIdx]!.stops.find((s) => s.placeId === moved)!;
    const [h1 = 0, m1 = 0] = stop.arrive.split(":").map(Number);
    const [h2 = 0, m2 = 0] = stop.depart.split(":").map(Number);
    expect(h2 * 60 + m2 - (h1 * 60 + m1) - stop.waitMin).toBe(p.dwellMin);
    expect(second.days[otherIdx]).toEqual(first.days[otherIdx]);
  });

  it("place move (new coordinates) re-optimizes only its day", () => {
    const t = makeTrip();
    const first = solve({ trip: t, ...SOLVE_OPTS });
    const moved = "p7";
    const dayIdx = first.days.findIndex((d) => d.stops.some((s) => s.placeId === moved));
    const otherIdx = (dayIdx + 2) % first.days.length;

    t.places.find((pl) => pl.id === moved)!.lat += 20 * DEG_PER_KM;

    const second = resolve({ trip: t, previous: first, edit: { type: "movePlace", placeId: moved }, ...SOLVE_OPTS });

    expect(second.days[dayIdx]!.stops.map((s) => s.placeId)).toContain(moved);
    expect(second.days[otherIdx]).toEqual(first.days[otherIdx]);
  });

  it("drag involving a locked day is a no-op for the locked day", () => {
    const t = makeTrip();
    const first = solve({ trip: t, ...SOLVE_OPTS });
    const moved = "p2";
    const fromDay = first.days.findIndex((d) => d.stops.some((s) => s.placeId === moved));
    const targetIdx = (fromDay + 1) % first.days.length;
    t.days[targetIdx]!.locked = true;

    const second = resolve({
      trip: t,
      previous: first,
      edit: { type: "dragToDay", placeId: moved, dayId: t.days[targetIdx]!.id },
      ...SOLVE_OPTS,
    });

    expect(second.days[targetIdx]).toEqual(first.days[targetIdx]);
    expect(second.days[fromDay]!.stops.map((s) => s.placeId)).toContain(moved);
  });

  it("reports overflow must-visits as no_time", () => {
    const places = Array.from({ length: 6 }, (_, i) =>
      place({ lat: 35.68, lng: 139.69, id: `m${i}`, dwellMin: 300, priority: 1 }),
    );
    places.push(place({ lat: 35.68, lng: 139.69, id: "baseA", category: "hotel", dwellMin: 0 }));
    const t = trip({ places, days: [day({ id: "d1", start: "09:00", end: "13:00" })] });
    const itin = solve({ trip: t, seed: 1, maxIterations: 50, budgetMs: 60_000 });
    expect(itin.unscheduled).toHaveLength(6);
    for (const u of itin.unscheduled) expect(u.reason).toBe("no_time");
  });

  it("reports an unreachable appointment as window_conflict", () => {
    const places = [
      place({ lat: 35.68, lng: 139.69, id: "a", dwellMin: 240, priority: 1, appointment: { dayId: "d1", start: "09:00" } }),
      place({ lat: 35.68, lng: 139.69, id: "b", dwellMin: 60, priority: 1, appointment: { dayId: "d1", start: "10:00" } }),
      place({ lat: 35.68, lng: 139.69, id: "baseA", category: "hotel", dwellMin: 0 }),
    ];
    const t = trip({ places, days: [day({ id: "d1" })] });
    const itin = solve({ trip: t, seed: 1, maxIterations: 50, budgetMs: 60_000 });
    expect(itin.unscheduled).toEqual([
      { placeId: "b", reason: "window_conflict", explanation: expect.any(String) },
    ]);
    expect(itin.days[0]!.stops.map((s) => s.placeId)).toEqual(["a"]);
  });
});

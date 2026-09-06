import { describe, expect, it } from "vitest";
import { kMeans } from "./kmeans";
import { place, DEG_PER_KM } from "./testUtils";

describe("kMeans", () => {
  it("returns an empty assignment for k <= 0", () => {
    const places = [place({ id: "a", lat: 0, lng: 0 })];
    expect(kMeans(places, 0)).toEqual([]);
    expect(kMeans(places, -1)).toEqual([]);
  });

  it("assigns one place per cluster when k >= places.length", () => {
    const places = [place({ id: "a", lat: 0, lng: 0 }), place({ id: "b", lat: 1, lng: 1 })];
    expect(kMeans(places, 5)).toEqual([0, 1]);
    expect(kMeans(places, 2)).toEqual([0, 1]);
  });

  it("groups two tight, well-separated clusters correctly", () => {
    // Group A near (0,0), group B ~50km away — far larger than any
    // reasonable cluster radius, so k-means should never confuse them.
    const a1 = place({ id: "a1", lat: 0, lng: 0 });
    const a2 = place({ id: "a2", lat: 0.2 * DEG_PER_KM, lng: 0 });
    const a3 = place({ id: "a3", lat: 0, lng: 0.2 * DEG_PER_KM });
    const b1 = place({ id: "b1", lat: 50 * DEG_PER_KM, lng: 0 });
    const b2 = place({ id: "b2", lat: 50.2 * DEG_PER_KM, lng: 0 });
    const places = [a1, a2, a3, b1, b2];

    const assignments = kMeans(places, 2);
    expect(assignments).toHaveLength(5);
    // The three "a" places share a cluster, distinct from the two "b" places.
    expect(assignments[0]).toBe(assignments[1]);
    expect(assignments[0]).toBe(assignments[2]);
    expect(assignments[3]).toBe(assignments[4]);
    expect(assignments[0]).not.toBe(assignments[3]);
  });

  it("is deterministic across repeated runs on the same input", () => {
    const places = Array.from({ length: 12 }, (_, i) =>
      place({ id: `p${i}`, lat: (i % 4) * DEG_PER_KM, lng: Math.floor(i / 4) * 40 * DEG_PER_KM }),
    );
    const first = kMeans(places, 3);
    const second = kMeans(places, 3);
    expect(second).toEqual(first);
  });

  it("respects a capacity constraint, never overfilling a cluster", () => {
    // 9 places, k=3, capacity=3 -> every cluster must end up with exactly 3.
    const places = Array.from({ length: 9 }, (_, i) =>
      place({ id: `p${i}`, lat: (i % 3) * DEG_PER_KM, lng: Math.floor(i / 3) * 40 * DEG_PER_KM }),
    );
    const assignments = kMeans(places, 3, { capacity: 3 });
    const counts = new Map<number, number>();
    for (const c of assignments) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(3);
    for (const count of counts.values()) expect(count).toBe(3);
  });

  it("assigns every place even when capacity is tighter than an even split", () => {
    const places = Array.from({ length: 7 }, (_, i) => place({ id: `p${i}`, lat: i * DEG_PER_KM, lng: 0 }));
    // capacity * k = 2 * 3 = 6 < 7 places: the safety-net fallback must still
    // place the 7th place somewhere rather than leaving it unassigned.
    const assignments = kMeans(places, 3, { capacity: 2 });
    expect(assignments).toHaveLength(7);
    for (const c of assignments) expect(c).toBeGreaterThanOrEqual(0);
  });
});

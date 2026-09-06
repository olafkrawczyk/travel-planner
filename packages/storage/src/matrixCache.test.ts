import { describe, expect, it, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { DexieMatrixCache, matrixCacheKey, type CachedMatrix } from "./matrixCache";

describe("matrixCacheKey", () => {
  it("is stable across identical inputs", () => {
    const coords = [
      { lat: 35.68123, lng: 139.76712 },
      { lat: 35.71481, lng: 139.79673 },
    ];
    expect(matrixCacheKey(coords, "foot", "https://router.project-osrm.org")).toBe(
      matrixCacheKey(coords.slice(), "foot", "https://router.project-osrm.org"),
    );
  });

  it("rounds coordinates to 4 decimals and encodes profile + base URL", () => {
    const key = matrixCacheKey([{ lat: 35.6812345, lng: 139.7671234 }], "foot", "https://osrm.example.com");
    expect(key).toBe("https://osrm.example.com|foot|35.6812,139.7671");
  });

  it("changes when coords, profile or base URL change", () => {
    const base = [{ lat: 1, lng: 2 }];
    const k0 = matrixCacheKey(base, "foot", "https://a.example.com");
    expect(matrixCacheKey([{ lat: 1.0001, lng: 2 }], "foot", "https://a.example.com")).not.toBe(k0);
    expect(matrixCacheKey(base, "car", "https://a.example.com")).not.toBe(k0);
    expect(matrixCacheKey(base, "foot", "https://b.example.com")).not.toBe(k0);
  });
});

describe("DexieMatrixCache", () => {
  let cache: DexieMatrixCache;

  beforeEach(async () => {
    const name = "matrix-cache-test-" + Math.random();
    cache = new DexieMatrixCache(name);
    await cache.deleteDatabase(); // reset any leftover state
    cache = new DexieMatrixCache(name);
  });

  it("round-trips put/get", async () => {
    const entry: CachedMatrix = {
      key: matrixCacheKey([{ lat: 35.68, lng: 139.69 }], "foot", "https://router.project-osrm.org"),
      durations: [
        [0, 10],
        [15, 0],
      ],
      fetchedAt: "2026-01-01T00:00:00Z",
    };
    await cache.put(entry);
    expect(await cache.get(entry.key)).toEqual(entry);
  });

  it("returns undefined for a missing key", async () => {
    expect(await cache.get("nope")).toBeUndefined();
  });

  it("overwrites entries with the same key", async () => {
    const key = "k";
    await cache.put({ key, durations: [[0, 1]], fetchedAt: "2026-01-01T00:00:00Z" });
    await cache.put({ key, durations: [[0, 2]], fetchedAt: "2026-01-02T00:00:00Z" });
    expect((await cache.get(key))!.durations).toEqual([[0, 2]]);
  });

  it("persists across instances on the same database name", async () => {
    const name = "matrix-cache-persist-" + Math.random();
    const writer = new DexieMatrixCache(name);
    const key = matrixCacheKey([{ lat: 1, lng: 2 }], "foot", "https://x");
    await writer.put({ key, durations: [[0, 5]], fetchedAt: "2026-01-01T00:00:00Z" });
    const reader = new DexieMatrixCache(name);
    expect((await reader.get(key))!.durations).toEqual([[0, 5]]);
    await reader.deleteDatabase();
  });
});

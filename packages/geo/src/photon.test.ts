import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryGeoCache, PhotonClient, type GeoCache, type GeoResult } from "./index";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const photonPayload = {
  features: [
    {
      type: "Feature",
      geometry: { coordinates: [139.7967, 35.7148] },
      properties: {
        osm_id: 123,
        osm_type: "W",
        name: "Sensō-ji",
        city: "Tokyo",
        country: "Japan",
        street: "Marszałkowska",
        housenumber: "12",
      },
    },
    {
      type: "Feature",
      geometry: { coordinates: [0, 0] },
      properties: { country: "Nowhere" }, // no name → filtered out
    },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("PhotonClient", () => {
  it("debounces bursts into a single request", async () => {
    const fetchFn = vi.fn().mockImplementation(() => jsonResponse(photonPayload));
    const client = new PhotonClient({ fetchFn, debounceMs: 300 });
    const p1 = client.search("sensoji");
    const p2 = client.search("sensoji");
    const p3 = client.search("sensoji");
    vi.advanceTimersByTime(400);
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(r1).toHaveLength(1);
    expect(r1[0]!.name).toBe("Sensō-ji");
    expect(r1[0]!.street).toBe("Marszałkowska 12");
    expect(r2).toEqual(r1);
    expect(r3).toEqual(r1);
  });

  it("caches results so repeated queries do not hit the network", async () => {
    const fetchFn = vi.fn().mockImplementation(() => jsonResponse(photonPayload));
    const client = new PhotonClient({ fetchFn, debounceMs: 0 });
    const first = client.search("sensoji");
    vi.advanceTimersByTime(10);
    const awaitedFirst = await first;
    const second = await client.search("sensoji"); // cache hit, no debounce wait needed
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(second).toEqual(awaitedFirst);
    expect(awaitedFirst).toHaveLength(1);
  });

  it("uses a provided cache implementation", async () => {
    class Recorder implements GeoCache {
      store = new Map<string, unknown>();
      get(key: string): GeoResult[] | undefined {
        return this.store.get(key) as GeoResult[] | undefined;
      }
      set(key: string, v: GeoResult[]) {
        this.store.set(key, v);
      }
    }
    const cache = new Recorder();
    const fetchFn = vi.fn().mockImplementation(() => jsonResponse(photonPayload));
    const client = new PhotonClient({ fetchFn, cache, debounceMs: 0 });
    const first = client.search("sensoji");
    vi.advanceTimersByTime(10);
    await first;
    expect(cache.store.size).toBe(1);
    expect(cache.get("en:10:sensoji")).toHaveLength(1);
    expect(new MemoryGeoCache() instanceof MemoryGeoCache).toBe(true);
  });
});

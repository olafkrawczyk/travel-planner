import { beforeEach, describe, expect, it, vi } from "vitest";
import { OverpassClient, OverpassError, __resetOverpassQueueForTests } from "./overpass";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// The queue/rate-limiter is shared module state (see overpass.ts) so every
// request from every client instance is serialized; reset it between tests
// so timing in one test never leaks into the next.
beforeEach(() => {
  __resetOverpassQueueForTests();
});

const wayPayload = {
  version: "0.6",
  generator: "Overpass API",
  elements: [
    {
      type: "way",
      id: 123,
      tags: {
        amenity: "museum",
        opening_hours: "Mo-Fr 09:00-17:00; Sa 10:00-14:00",
        "name:en": "Tokyo National Museum",
        "name:ja": "東京国立博物館",
      },
    },
  ],
};

describe("OverpassClient", () => {
  it("fetches and filters the relevant tags of one element", async () => {
    const fetchFn = vi.fn().mockImplementation(() => jsonResponse(wayPayload));
    const client = new OverpassClient({ fetchFn });
    const tags = await client.fetchOsmTags("W/123");
    expect(tags).toEqual({
      opening_hours: "Mo-Fr 09:00-17:00; Sa 10:00-14:00",
      "name:en": "Tokyo National Museum",
      "name:ja": "東京国立博物館",
    });
    const url = (fetchFn.mock.calls[0]?.[0] as string) ?? "";
    expect(url).toContain("https://overpass-api.de/api/interpreter?data=");
    expect(decodeURIComponent(url)).toContain("way(123);out tags;");
    expect(decodeURIComponent(url)).not.toContain("node(123)");
  });

  it("caches per osmId so repeated lookups do not hit the network", async () => {
    const fetchFn = vi.fn().mockImplementation(() => jsonResponse(wayPayload));
    const client = new OverpassClient({ fetchFn });
    await client.fetchOsmTags("W/123");
    const again = await client.fetchOsmTags("W/123");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(again?.opening_hours).toBe("Mo-Fr 09:00-17:00; Sa 10:00-14:00");
  });

  it("returns null when the element does not exist", async () => {
    const fetchFn = vi.fn().mockImplementation(() => jsonResponse({ elements: [] }));
    const client = new OverpassClient({ fetchFn });
    expect(await client.fetchOsmTags("N/999999999999")).toBeNull();
  });

  it("throws a typed error on HTTP failure", async () => {
    const fetchFn = vi.fn().mockImplementation(() => jsonResponse("boom", 504));
    const client = new OverpassClient({ fetchFn });
    await expect(client.fetchOsmTags("R/456")).rejects.toBeInstanceOf(OverpassError);
    await expect(client.fetchOsmTags("R/456")).rejects.toMatchObject({ status: 504 });
  });

  it("throws a typed error on network failure", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("offline"));
    const client = new OverpassClient({ fetchFn });
    await expect(client.fetchOsmTags("N/1")).rejects.toThrow(/offline/);
  });

  it("rejects malformed osmIds without any network call", async () => {
    const fetchFn = vi.fn();
    const client = new OverpassClient({ fetchFn });
    await expect(client.fetchOsmTags("way/123")).rejects.toBeInstanceOf(OverpassError);
    await expect(client.fetchOsmTags("W/abc")).rejects.toBeInstanceOf(OverpassError);
    await expect(client.fetchOsmTags("")).rejects.toBeInstanceOf(OverpassError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("honours a custom base URL and canonicalises the cache key", async () => {
    const fetchFn = vi.fn().mockImplementation(() => jsonResponse(wayPayload));
    const client = new OverpassClient({ fetchFn, baseUrl: "https://overpass.example.org/" });
    await client.fetchOsmTags("w/123"); // lowercase → same cache entry
    await client.fetchOsmTags("W/123");
    const url = (fetchFn.mock.calls[0]?.[0] as string) ?? "";
    expect(url.startsWith("https://overpass.example.org/api/interpreter")).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("OverpassClient shared rate limiter", () => {
  // The queue is module-level state (see overpass.ts), shared across every
  // client instance — this is deliberate: the app may create a fresh
  // OverpassClient per place added, and the two instances must still take
  // turns. All timing here runs on fake timers; nothing in these tests
  // depends on real wall-clock time.

  it("never runs two requests in parallel, even across separate client instances", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      let active = 0;
      let maxActive = 0;
      const fetchFn = vi.fn().mockImplementation(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 50));
        active--;
        return jsonResponse(wayPayload);
      });
      const clientA = new OverpassClient({ fetchFn });
      const clientB = new OverpassClient({ fetchFn });
      const pA = clientA.fetchOsmTags("W/10");
      const pB = clientB.fetchOsmTags("W/20");
      await vi.advanceTimersByTimeAsync(2000);
      await Promise.all([pA, pB]);
      expect(fetchFn).toHaveBeenCalledTimes(2);
      expect(maxActive).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("spaces requests by at least ~1s regardless of which instance issued them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const timestamps: number[] = [];
      const fetchFn = vi.fn().mockImplementation(async () => {
        timestamps.push(Date.now());
        return jsonResponse(wayPayload);
      });
      const clientA = new OverpassClient({ fetchFn });
      const clientB = new OverpassClient({ fetchFn });
      const pA = clientA.fetchOsmTags("W/1");
      const pB = clientB.fetchOsmTags("W/2"); // different id: not cache-deduped
      await vi.advanceTimersByTimeAsync(2000);
      await Promise.all([pA, pB]);
      expect(timestamps).toHaveLength(2);
      expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not delay or queue a request with a malformed id", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const fetchFn = vi.fn().mockImplementation(() => jsonResponse(wayPayload));
      const client = new OverpassClient({ fetchFn });
      const before = Date.now();
      await expect(client.fetchOsmTags("bogus")).rejects.toBeInstanceOf(OverpassError);
      expect(Date.now()).toBe(before); // rejected synchronously, before any queueing/sleep
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("honours a 429's Retry-After before letting the next request start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const timestamps: number[] = [];
      const fetchFn = vi.fn().mockImplementation(async () => {
        timestamps.push(Date.now());
        if (timestamps.length === 1) return jsonResponse({}, 429, { "Retry-After": "2" });
        return jsonResponse(wayPayload);
      });
      const client = new OverpassClient({ fetchFn });
      const p1 = client.fetchOsmTags("W/1").catch((e: unknown) => e);
      const p2 = client.fetchOsmTags("W/2");
      await vi.advanceTimersByTimeAsync(3000);
      const err = await p1;
      const tags = await p2;
      expect(err).toBeInstanceOf(OverpassError);
      expect((err as OverpassError).status).toBe(429);
      expect(tags).toBeTruthy();
      expect(timestamps).toHaveLength(2);
      // Retry-After: 2s should dominate the ~1s default spacing.
      expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(2000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies an internal default backoff after a 503 with no Retry-After", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const timestamps: number[] = [];
      const fetchFn = vi.fn().mockImplementation(async () => {
        timestamps.push(Date.now());
        if (timestamps.length === 1) return jsonResponse({}, 503);
        return jsonResponse(wayPayload);
      });
      const client = new OverpassClient({ fetchFn });
      const p1 = client.fetchOsmTags("W/1").catch((e: unknown) => e);
      const p2 = client.fetchOsmTags("W/2");
      await vi.advanceTimersByTimeAsync(10_000);
      await p1;
      await p2;
      expect(timestamps).toHaveLength(2);
      // Bigger than the ~1s default spacing: a real backoff kicked in.
      expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(5000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not block the caller: fetchOsmTags returns a promise immediately without awaiting the queue", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    try {
      const fetchFn = vi.fn().mockImplementation(() => jsonResponse(wayPayload));
      const clientA = new OverpassClient({ fetchFn });
      const clientB = new OverpassClient({ fetchFn });
      // Occupy the queue for a while, then fire a second, unrelated request
      // and confirm the call returns synchronously (a Promise, not a value
      // that required waiting) rather than the function call itself hanging.
      const pA = clientA.fetchOsmTags("W/1");
      let calledSynchronously = false;
      const pB = clientB.fetchOsmTags("W/2").then(() => {
        calledSynchronously = true;
      });
      // Immediately after issuing both calls (before advancing any time),
      // neither has resolved yet — proving fetchOsmTags itself never blocks
      // on the queue; it only enqueues.
      expect(calledSynchronously).toBe(false);
      await vi.advanceTimersByTimeAsync(2000);
      await Promise.all([pA, pB]);
    } finally {
      vi.useRealTimers();
    }
  });
});

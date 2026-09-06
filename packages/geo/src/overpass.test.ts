import { describe, expect, it, vi } from "vitest";
import { OverpassClient, OverpassError } from "./overpass";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

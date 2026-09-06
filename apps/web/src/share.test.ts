import { describe, expect, it } from "vitest";
import { parseTrip } from "@app/domain";
import { FRAGMENT_PREFIX, MAX_DECOMPRESSED_BYTES, MAX_FRAGMENT, ShareError, decodeTrip, encodeTrip } from "./share";

const tripJson = JSON.stringify({
  id: "trip_abc",
  schemaVersion: 1,
  name: "Test trip",
  places: [{ id: "place_1", name: "A", lat: 1, lng: 2 }],
});

describe("encodeTrip/decodeTrip", () => {
  it("round-trips JSON through the fragment", async () => {
    const fragment = await encodeTrip(tripJson);
    expect(fragment.startsWith(FRAGMENT_PREFIX)).toBe(true);
    expect(fragment.length).toBeLessThanOrEqual(MAX_FRAGMENT);
    expect(await decodeTrip(fragment)).toBe(tripJson);
  });

  it("decodes a bare payload without the prefix", async () => {
    const fragment = await encodeTrip(tripJson);
    const payload = fragment.slice(FRAGMENT_PREFIX.length);
    expect(await decodeTrip(payload)).toBe(tripJson);
  });

  it("compresses repetitive JSON well below the raw size", async () => {
    const big = JSON.stringify({ name: "x".repeat(2000) });
    const fragment = await encodeTrip(big);
    expect(fragment.length).toBeLessThan(2000);
    expect(await decodeTrip(fragment)).toBe(big);
  });
});

describe("oversize guard", () => {
  it("rejects payloads that would exceed MAX_FRAGMENT", async () => {
    // High-entropy hex text: ~4 bits/char, so it cannot compress below the guard.
    const bytes = crypto.getRandomValues(new Uint8Array(10_000));
    const huge = JSON.stringify({ filler: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") });
    const err = await encodeTrip(huge).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShareError);
    expect((err as ShareError).code).toBe("oversize");
  });
});

describe("malformed fragments", () => {
  it("rejects non-base64url payloads", async () => {
    const err = await decodeTrip("#trip=!!!not-base64").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShareError);
    expect((err as ShareError).code).toBe("malformed");
  });

  it("rejects empty payloads", async () => {
    const err = await decodeTrip(FRAGMENT_PREFIX).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShareError);
    expect((err as ShareError).code).toBe("malformed");
  });

  it("rejects payloads that do not decompress", async () => {
    // Valid base64url, but not a deflate-raw stream.
    const garbage = btoa("\x00\x01\x02\x03garbage")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const err = await decodeTrip(FRAGMENT_PREFIX + garbage).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShareError);
    expect((err as ShareError).code).toBe("inflate");
  });

  it("rejects payloads that decompress to non-JSON", async () => {
    const err = await decodeTrip(await encodeTrip("not json at all")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShareError);
    expect((err as ShareError).code).toBe("not-json");
  });
});

describe("decompressed-size cap (item 6: MAX_FRAGMENT only bounds the compressed payload)", () => {
  it("rejects a payload that decompresses past MAX_DECOMPRESSED_BYTES, even though it compresses to well under MAX_FRAGMENT", async () => {
    // Highly repetitive input: deflate crushes this to a tiny fragment even
    // though it decompresses to well over the cap — exactly the shape
    // MAX_FRAGMENT alone (which only bounds the COMPRESSED size) cannot catch.
    const huge = JSON.stringify({ name: "x".repeat(6_000_000) });
    const fragment = await encodeTrip(huge);
    expect(fragment.length).toBeLessThan(MAX_FRAGMENT); // compresses to almost nothing
    const err = await decodeTrip(fragment).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ShareError);
    expect((err as ShareError).code).toBe("inflate");
    expect((err as ShareError).message).toMatch(/too large/i);
  });

  it("accepts a payload right at the decompressed cap", async () => {
    const json = JSON.stringify("x".repeat(MAX_DECOMPRESSED_BYTES - 2)); // quotes bring it to exactly the cap
    expect(new TextEncoder().encode(json).length).toBe(MAX_DECOMPRESSED_BYTES);
    const fragment = await encodeTrip(json);
    expect(await decodeTrip(fragment)).toBe(json);
  });
});

describe("share-URL path and the trip-length cap (item 3)", () => {
  it("decodeTrip round-trips an over-cap trip's JSON unchanged — parseTrip (what importTripJson calls) is what rejects it", async () => {
    // decodeTrip deliberately does no trip-schema validation (see the module
    // doc comment); the day/place-count cap is enforced downstream in
    // @app/domain's parseTrip, which importTripJson calls for every import
    // path (file AND share-URL) uniformly.
    const overCap = {
      id: "trip_x",
      schemaVersion: 2,
      name: "Too long",
      timezone: "UTC",
      days: Array.from({ length: 61 }, (_, i) => ({
        id: `d${i}`,
        date: "2026-01-01",
        start: "09:00",
        end: "21:00",
        startLocation: "base",
        endLocation: "base",
        baseStartId: "h",
        baseEndId: "h",
      })),
      places: [{ id: "h", name: "Hotel", lat: 0, lng: 0, category: "hotel", dwellMin: 0, priority: 3 }],
      travelOverrides: [],
      settings: {},
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const json = JSON.stringify(overCap);
    const fragment = await encodeTrip(json);
    const decoded = await decodeTrip(fragment);
    expect(decoded).toBe(json);
    expect(() => parseTrip(JSON.parse(decoded))).toThrow(/Trip too long/);
  });
});

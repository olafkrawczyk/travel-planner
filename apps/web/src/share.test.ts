import { describe, expect, it } from "vitest";
import { FRAGMENT_PREFIX, MAX_FRAGMENT, ShareError, decodeTrip, encodeTrip } from "./share";

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

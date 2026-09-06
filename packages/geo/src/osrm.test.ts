import { describe, expect, it, vi } from "vitest";
import { OsrmClient, OsrmError } from "./osrm";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 2×2 durations in SECONDS (OSRM returns seconds). */
const secondsMatrix = [
  [0, 600],
  [900, 0],
];

describe("OsrmClient.fetchTable", () => {
  it("requests the demo /table/v1/foot endpoint with lng,lat pairs and parses durations into minutes", async () => {
    const fetchFn = vi.fn().mockImplementation(() => jsonResponse({ durations: secondsMatrix }));
    const client = new OsrmClient({ fetchFn });
    const matrix = await client.fetchTable([
      { lat: 35.6812, lng: 139.7671 },
      { lat: 35.7148, lng: 139.7967 },
    ]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = fetchFn.mock.calls[0]![0] as string;
    expect(url).toBe(
      "https://router.project-osrm.org/table/v1/foot/139.7671,35.6812;139.7967,35.7148?annotations=duration",
    );

    // seconds → minutes, rounded to 1 decimal.
    expect(matrix).toEqual([
      [0, 10],
      [15, 0],
    ]);
  });

  it("rounds fractional minutes to 1 decimal", async () => {
    // 95 seconds = 1.5833… min → 1.6; 1234 seconds = 20.5666… min → 20.6
    const fetchFn = vi.fn().mockImplementation(() => jsonResponse({ durations: [[0, 95], [1234, 0]] }));
    const client = new OsrmClient({ fetchFn });
    const matrix = await client.fetchTable([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
    ]);
    expect(matrix).toEqual([
      [0, 1.6],
      [20.6, 0],
    ]);
  });

  it("honours a custom base URL and profile", async () => {
    const fetchFn = vi.fn().mockImplementation(() => jsonResponse({ durations: [[0]] }));
    const client = new OsrmClient({ fetchFn, baseUrl: "https://osrm.example.com/", profile: "walking" });
    await client.fetchTable([{ lat: 1, lng: 2 }]);
    expect(fetchFn.mock.calls[0]![0]).toBe("https://osrm.example.com/table/v1/walking/2,1?annotations=duration");
  });

  it("throws a typed http error on non-2xx responses", async () => {
    const fetchFn = vi.fn().mockImplementation(() => jsonResponse({ message: "boom" }, 500));
    const client = new OsrmClient({ fetchFn });
    const err = await client
      .fetchTable([{ lat: 0, lng: 0 }])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OsrmError);
    expect((err as OsrmError).kind).toBe("http");
  });

  it("throws a typed network error when fetch rejects", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("offline"));
    const client = new OsrmClient({ fetchFn });
    const err = await client
      .fetchTable([{ lat: 0, lng: 0 }])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OsrmError);
    expect((err as OsrmError).kind).toBe("network");
  });

  it("throws a typed malformed error for invalid JSON", async () => {
    const fetchFn = vi.fn().mockImplementation(
      () =>
        new Response("not json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const client = new OsrmClient({ fetchFn });
    const err = await client
      .fetchTable([{ lat: 0, lng: 0 }])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OsrmError);
    expect((err as OsrmError).kind).toBe("malformed");
  });

  it.each([
    ["missing durations", {}],
    ["wrong row count", { durations: [[0, 1]] }],
    ["wrong row length", { durations: [[0, 1], [2]] }],
    ["null entry", { durations: [[0, null], [1, 0]] }],
    ["non-numeric entry", { durations: [[0, "x"], [1, 0]] }],
  ])("throws a typed malformed error for %s", async (_name, body) => {
    const fetchFn = vi.fn().mockImplementation(() => jsonResponse(body));
    const client = new OsrmClient({ fetchFn });
    const err = await client
      .fetchTable([
        { lat: 0, lng: 0 },
        { lat: 0, lng: 1 },
      ])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OsrmError);
    expect((err as OsrmError).kind).toBe("malformed");
  });

  it("throws a typed oversize error before fetching when the node count exceeds the limit", async () => {
    const fetchFn = vi.fn();
    const client = new OsrmClient({ fetchFn, maxNodes: 3 });
    const coords = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 2 },
      { lat: 0, lng: 3 },
    ];
    const err = await client.fetchTable(coords).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OsrmError);
    expect((err as OsrmError).kind).toBe("oversize");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns an empty matrix for zero coordinates without fetching", async () => {
    const fetchFn = vi.fn();
    const client = new OsrmClient({ fetchFn });
    expect(await client.fetchTable([])).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

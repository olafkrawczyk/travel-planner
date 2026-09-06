import { describe, expect, it, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { parseTrip, schemaVersion, type Trip } from "@app/domain";
import { LocalRepository } from "./localRepository";
import { RepositoryError } from "./repository";

function sampleTrip(id = "trip_1"): Trip {
  return {
    id,
    schemaVersion,
    name: "Tokyo",
    timezone: "Asia/Tokyo",
    days: [
      {
        id: "d1",
        date: "2026-04-01",
        start: "09:00",
        end: "21:00",
        startLocation: "base",
        endLocation: "base",
        baseStartId: "hotel",
        baseEndId: "hotel",
      },
    ],
    places: [
      {
        id: "hotel",
        name: "Hotel",
        lat: 35.68,
        lng: 139.69,
        category: "other",
        dwellMin: 0,
        priority: 3,
      },
      {
        id: "p1",
        name: "Senso-ji",
        lat: 35.7148,
        lng: 139.7967,
        category: "temple",
        dwellMin: 90,
        priority: 1,
        notes: "go early",
      },
    ],
    travelOverrides: [{ fromId: "hotel", toId: "p1", minutes: 45, symmetric: true }],
    settings: {},
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  } as unknown as Trip;
}

describe("LocalRepository", () => {
  let repo: LocalRepository;

  beforeEach(() => {
    void new LocalRepository("test-db-" + Math.random()).deleteDatabase();
    repo = new LocalRepository("test-db-" + Math.random());
  });

  it("round-trips put/get/list/delete", async () => {
    const t = parseTrip(sampleTrip());
    await repo.put(t);
    const got = await repo.get("trip_1");
    expect(got).toEqual(t);

    const { trips, failedCount } = await repo.list();
    expect(trips).toHaveLength(1);
    expect(trips[0]!.id).toBe("trip_1");
    expect(failedCount).toBe(0);

    await repo.delete("trip_1");
    expect(await repo.get("trip_1")).toBeUndefined();
    expect((await repo.list()).trips).toHaveLength(0);
  });

  it("returns undefined for a missing trip", async () => {
    expect(await repo.get("nope")).toBeUndefined();
  });

  it("rejects invalid trips on put", async () => {
    const bad = { ...parseTrip(sampleTrip()), places: "nope" } as unknown as Trip;
    await expect(repo.put(bad)).rejects.toThrow();
  });

  it("exports JSON and imports it back under a fresh id (content otherwise equivalent)", async () => {
    const t = parseTrip(sampleTrip());
    await repo.put(t);
    const json = await repo.exportJson("trip_1");
    expect(JSON.parse(json).schemaVersion).toBe(schemaVersion);

    const other = new LocalRepository("import-db-" + Math.random());
    const imported = await other.importJson(json);
    expect(imported.id).not.toBe(t.id); // never trusts the file's own id
    expect({ ...imported, id: t.id }).toEqual(t); // everything else round-trips
    expect(await other.get(t.id)).toBeUndefined();
    expect(await other.get(imported.id)).toEqual(imported);
  });

  // Regression for the P0 finding: re-importing a file whose id collides
  // with an already-stored trip must never overwrite it (put() upserts by
  // id in Dexie, so keeping the file's id would silently clobber the
  // existing row with no confirmation).
  it("re-importing an exported file never clobbers the original stored trip", async () => {
    const t = parseTrip(sampleTrip());
    await repo.put(t);
    const json = await repo.exportJson("trip_1");

    const imported = await repo.importJson(json); // same repo/db as the original
    expect(imported.id).not.toBe("trip_1");

    const { trips } = await repo.list();
    expect(trips).toHaveLength(2); // original + fresh-id copy, neither clobbered
    expect(await repo.get("trip_1")).toEqual(t); // original untouched
    expect(await repo.get(imported.id)).toEqual(imported);
  });

  it("rejects invalid import JSON with a clear error and leaves data unchanged", async () => {
    await repo.put(sampleTrip());
    const before = (await repo.list()).trips;

    await expect(repo.importJson("not json")).rejects.toThrow(RepositoryError);
    await expect(repo.importJson("{\"schemaVersion\": 1}")).rejects.toThrow(RepositoryError);
    await expect(
      repo.importJson(JSON.stringify({ ...parseTrip(sampleTrip("trip_2")), places: [] })),
    ).resolves.toBeTruthy(); // places: [] is schema-valid

    // The failed imports did not corrupt existing data.
    expect((await repo.list()).trips).toHaveLength(before.length + 1);
  });

  it("rejects import with an unsupported future schema version", async () => {
    const future = { ...parseTrip(sampleTrip("trip_9")), schemaVersion: 999 };
    await expect(repo.importJson(JSON.stringify(future))).rejects.toThrow(/schema version/);
  });

  // Item 3: MAX_TRIP_DAYS is enforced in the schema (@app/domain) now, so
  // every path into the store is covered uniformly — including import, which
  // never called `validateTripLength` itself.
  it("rejects importing a trip with more days than the schema's hard cap, with a readable message", async () => {
    const base = parseTrip(sampleTrip("trip_toolong"));
    const oversized = {
      ...base,
      days: Array.from({ length: 61 }, (_, i) => ({
        ...base.days[0],
        id: `d${i}`,
        date: `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      })),
    };
    const err = await repo.importJson(JSON.stringify(oversized)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepositoryError);
    expect((err as Error).message).toContain("Trip too long");
    expect((err as Error).message).not.toMatch(/"code":|"path":/); // not a raw ZodError dump
  });

  it("exportJson throws for a missing trip", async () => {
    await expect(repo.exportJson("nope")).rejects.toThrow(RepositoryError);
  });

  // Item 4: a stored row that fails to parse/validate (corrupt, or written by
  // a newer/incompatible build) must be signalled, not silently dropped.
  it("list() signals unparseable rows via failedCount instead of silently omitting them", async () => {
    const t = parseTrip(sampleTrip());
    await repo.put(t);
    // Bypass put()'s validation to write a genuinely unparseable row directly
    // (e.g. corrupted JSON, or a shape no migration recognizes).
    await (repo as unknown as { trips: { put(row: { id: string; json: string }): Promise<unknown> } }).trips.put({
      id: "corrupt",
      json: "{not valid json",
    });

    const { trips, failedCount } = await repo.list();
    expect(trips.map((x) => x.id)).toEqual(["trip_1"]); // the corrupt row is excluded...
    expect(failedCount).toBe(1); // ...but its loss is signalled, not silent
  });
});

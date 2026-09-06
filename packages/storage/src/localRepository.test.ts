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

    const list = await repo.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe("trip_1");

    await repo.delete("trip_1");
    expect(await repo.get("trip_1")).toBeUndefined();
    expect(await repo.list()).toHaveLength(0);
  });

  it("returns undefined for a missing trip", async () => {
    expect(await repo.get("nope")).toBeUndefined();
  });

  it("rejects invalid trips on put", async () => {
    const bad = { ...parseTrip(sampleTrip()), places: "nope" } as unknown as Trip;
    await expect(repo.put(bad)).rejects.toThrow();
  });

  it("exports JSON and imports it back equivalently", async () => {
    const t = parseTrip(sampleTrip());
    await repo.put(t);
    const json = await repo.exportJson("trip_1");
    expect(JSON.parse(json).schemaVersion).toBe(schemaVersion);

    const other = new LocalRepository("import-db-" + Math.random());
    const imported = await other.importJson(json);
    expect(imported).toEqual(t);
    expect(await other.get("trip_1")).toEqual(t);
  });

  it("rejects invalid import JSON with a clear error and leaves data unchanged", async () => {
    await repo.put(sampleTrip());
    const before = await repo.list();

    await expect(repo.importJson("not json")).rejects.toThrow(RepositoryError);
    await expect(repo.importJson("{\"schemaVersion\": 1}")).rejects.toThrow(RepositoryError);
    await expect(
      repo.importJson(JSON.stringify({ ...parseTrip(sampleTrip("trip_2")), places: [] })),
    ).resolves.toBeTruthy(); // places: [] is schema-valid

    // The failed imports did not corrupt existing data.
    expect(await repo.list()).toHaveLength(before.length + 1);
  });

  it("rejects import with an unsupported future schema version", async () => {
    const future = { ...parseTrip(sampleTrip("trip_9")), schemaVersion: 999 };
    await expect(repo.importJson(JSON.stringify(future))).rejects.toThrow(/schema version/);
  });

  it("exportJson throws for a missing trip", async () => {
    await expect(repo.exportJson("nope")).rejects.toThrow(RepositoryError);
  });
});

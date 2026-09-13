import { describe, expect, it } from "vitest";
import type { TravelOverride } from "@app/domain";
import { upsertTravelOverride, removeTravelOverride } from "./travelOverrides";

describe("upsertTravelOverride", () => {
  it("inserts a new override into an empty list", () => {
    const ov: TravelOverride = {
      fromId: "p1",
      toId: "p2",
      minutes: 180,
      symmetric: true,
    };
    const result = upsertTravelOverride([], ov);
    expect(result).toEqual([ov]);
  });

  it("handles undefined existing list gracefully", () => {
    const ov: TravelOverride = {
      fromId: "p1",
      toId: "p2",
      minutes: 180,
      symmetric: true,
    };
    const result = upsertTravelOverride(undefined, ov);
    expect(result).toEqual([ov]);
  });

  it("replaces an existing override for the same pair in the same direction", () => {
    const existing: TravelOverride[] = [
      { fromId: "p1", toId: "p2", minutes: 120, symmetric: false },
    ];
    const update: TravelOverride = {
      fromId: "p1",
      toId: "p2",
      minutes: 150,
      symmetric: false,
    };
    const result = upsertTravelOverride(existing, update);
    expect(result).toEqual([update]);
  });

  it("replaces an existing symmetric override in the reverse direction", () => {
    const existing: TravelOverride[] = [
      { fromId: "p2", toId: "p1", minutes: 120, symmetric: true },
    ];
    const update: TravelOverride = {
      fromId: "p1",
      toId: "p2",
      minutes: 150,
      symmetric: true,
    };
    const result = upsertTravelOverride(existing, update);
    expect(result).toEqual([update]);
  });

  it("replaces an existing symmetric reverse override even when the new override is asymmetric", () => {
    const existing: TravelOverride[] = [
      { fromId: "p2", toId: "p1", minutes: 120, symmetric: true },
    ];
    const update: TravelOverride = {
      fromId: "p1",
      toId: "p2",
      minutes: 200,
      symmetric: false,
    };
    const result = upsertTravelOverride(existing, update);
    expect(result).toEqual([update]);
  });

  it("preserves non-matching overrides", () => {
    const existing: TravelOverride[] = [
      { fromId: "p3", toId: "p4", minutes: 45, symmetric: true },
    ];
    const update: TravelOverride = {
      fromId: "p1",
      toId: "p2",
      minutes: 100,
      symmetric: true,
    };
    const result = upsertTravelOverride(existing, update);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(existing[0]);
    expect(result).toContainEqual(update);
  });
});

describe("removeTravelOverride", () => {
  it("removes an override matching the pair", () => {
    const existing: TravelOverride[] = [
      { fromId: "p1", toId: "p2", minutes: 60, symmetric: false },
      { fromId: "p3", toId: "p4", minutes: 90, symmetric: true },
    ];
    const result = removeTravelOverride(existing, "p1", "p2");
    expect(result).toEqual([{ fromId: "p3", toId: "p4", minutes: 90, symmetric: true }]);
  });

  it("removes a symmetric override when queried in reverse", () => {
    const existing: TravelOverride[] = [
      { fromId: "p1", toId: "p2", minutes: 60, symmetric: true },
    ];
    const result = removeTravelOverride(existing, "p2", "p1");
    expect(result).toEqual([]);
  });

  it("handles undefined gracefully", () => {
    expect(removeTravelOverride(undefined, "p1", "p2")).toEqual([]);
  });
});

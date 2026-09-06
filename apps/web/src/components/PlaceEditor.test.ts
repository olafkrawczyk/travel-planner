import { describe, expect, it } from "vitest";
import { collectRegionOptions, isAutoRegionName } from "./PlaceEditor";

// Pure-logic coverage for the region picker/legibility helpers added for
// task 4.3 (see PlaceEditor.tsx). `apps/web/src/components/**` otherwise has
// no component test harness (no jsdom/testing-library in this repo), so
// these two exported pure functions are what's reachable without inventing
// one — see the task brief's note on this.

describe("collectRegionOptions", () => {
  it("de-duplicates and sorts via localeCompare", () => {
    expect(collectRegionOptions(["Shinjuku", "Ginza", "Shinjuku", "Asakusa"])).toEqual([
      "Asakusa",
      "Ginza",
      "Shinjuku",
    ]);
  });

  it("filters out empty strings from the existing list", () => {
    expect(collectRegionOptions(["", "Ginza", ""])).toEqual(["Ginza"]);
  });

  it("folds `current` in when it isn't already present", () => {
    expect(collectRegionOptions(["Ginza"], "Shinjuku")).toEqual(["Ginza", "Shinjuku"]);
  });

  it("does not duplicate `current` when it's already in `existing`", () => {
    expect(collectRegionOptions(["Ginza", "Shinjuku"], "Shinjuku")).toEqual(["Ginza", "Shinjuku"]);
  });

  it("omits `current` entirely when undefined", () => {
    expect(collectRegionOptions(["Ginza", "Asakusa"])).toEqual(["Asakusa", "Ginza"]);
  });

  it("ignores an empty-string `current` (falsy, treated as 'no current')", () => {
    expect(collectRegionOptions(["Ginza"], "")).toEqual(["Ginza"]);
  });

  it("returns an empty array when there's nothing at all", () => {
    expect(collectRegionOptions([])).toEqual([]);
  });
});

describe("isAutoRegionName", () => {
  it("matches the exact auto-cluster naming convention", () => {
    expect(isAutoRegionName("District 1")).toBe(true);
    expect(isAutoRegionName("District 12")).toBe(true);
  });

  it("does not match a bare 'District' with no number", () => {
    expect(isAutoRegionName("District")).toBe(false);
  });

  it("does not match a trailing non-digit suffix", () => {
    expect(isAutoRegionName("District 1a")).toBe(false);
  });

  it("is case-sensitive — lowercase 'district' does not match", () => {
    expect(isAutoRegionName("district 1")).toBe(false);
  });

  it("does not match when 'District N' is only part of the name", () => {
    expect(isAutoRegionName("My District 3")).toBe(false);
  });

  it("does not match an empty string", () => {
    expect(isAutoRegionName("")).toBe(false);
  });
});

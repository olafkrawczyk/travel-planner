import { describe, expect, it } from "vitest";
import type { Place } from "@app/domain";
import { hotelNeedsLocation } from "./StaysPanel";

// Pure-logic coverage for the "needs a location" hotel detector (P1 #5). No
// component-render harness in this repo — see PlaceEditor.test.ts.

function place(overrides: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "New hotel (edit me)",
    lat: 35.0,
    lng: 139.0,
    category: "hotel",
    dwellMin: 0,
    priority: 3,
    notes: "Created from the stays panel — edit to set name and location.",
    ...overrides,
  };
}

describe("hotelNeedsLocation", () => {
  it("flags a freshly created hotel that still carries the auto-creation notes", () => {
    expect(hotelNeedsLocation(place())).toBe(true);
  });

  it("clears once the notes field has been edited (even without touching lat/lng)", () => {
    expect(hotelNeedsLocation(place({ notes: "The Grand Hyatt, Shinjuku" }))).toBe(false);
  });

  it("clears once notes is removed entirely", () => {
    expect(hotelNeedsLocation(place({ notes: undefined }))).toBe(false);
  });

  it("never flags a non-hotel place, even with matching notes text", () => {
    expect(hotelNeedsLocation(place({ category: "museum" }))).toBe(false);
  });

  it("never flags a hotel manually converted via the editor (no auto-creation notes)", () => {
    expect(hotelNeedsLocation(place({ notes: undefined, category: "hotel" }))).toBe(false);
  });

  it("returns false for undefined (no hotel resolved for this stay)", () => {
    expect(hotelNeedsLocation(undefined)).toBe(false);
  });
});

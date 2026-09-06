import { describe, expect, it } from "vitest";
import type { Place } from "@app/domain";
import {
  defaultRecommendationOpen,
  formatAvgOneWayMin,
  formatRadiusKm,
  gmapsHotelSearchLink,
  hotelNeedsLocation,
} from "./StaysPanel";

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

// Pure-logic coverage for the hotel-area-recommendation UI helpers
// (add-hotel-area-recommendation) — same no-render-harness convention.

describe("formatRadiusKm", () => {
  it("formats to one decimal with a leading ~ and unit", () => {
    expect(formatRadiusKm(0.8)).toBe("~0.8 km radius");
  });

  it("formats the 0.3 km floor correctly", () => {
    expect(formatRadiusKm(0.3)).toBe("~0.3 km radius");
  });

  it("pads a whole number to one decimal", () => {
    expect(formatRadiusKm(2)).toBe("~2.0 km radius");
  });
});

describe("formatAvgOneWayMin", () => {
  it("rounds to the nearest minute", () => {
    expect(formatAvgOneWayMin(14.4)).toBe("~14 min avg one-way");
    expect(formatAvgOneWayMin(14.6)).toBe("~15 min avg one-way");
  });

  it("handles zero", () => {
    expect(formatAvgOneWayMin(0)).toBe("~0 min avg one-way");
  });
});

describe("gmapsHotelSearchLink", () => {
  it("builds a Google Maps search URL biased to the given coordinates", () => {
    const url = new URL(gmapsHotelSearchLink(35.6812, 139.7671));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/search/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("query")).toBe("hotels near 35.6812,139.7671");
  });
});

describe("defaultRecommendationOpen", () => {
  it("is open when there is no hotel resolved yet", () => {
    expect(defaultRecommendationOpen(undefined)).toBe(true);
  });

  it("is open when the hotel is still at its auto-created placeholder location", () => {
    expect(defaultRecommendationOpen(place())).toBe(true);
  });

  it("is closed once the hotel has a deliberate (non-placeholder) location", () => {
    expect(defaultRecommendationOpen(place({ notes: "The Grand Hyatt, Shinjuku" }))).toBe(false);
  });
});

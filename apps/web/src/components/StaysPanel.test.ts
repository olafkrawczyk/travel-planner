import { describe, expect, it } from "vitest";
import type { Place } from "@app/domain";
import {
  defaultRecommendationOpen,
  formatAvgOneWayMin,
  formatRadiusKm,
  formatSavingsMin,
  gmapsHotelSearchLink,
  hotelNeedsLocation,
  suggestedBaseBadgeText,
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

describe("formatSavingsMin", () => {
  it("formats rounded savings with Save ~ prefix", () => {
    expect(formatSavingsMin(45.2)).toBe("Save ~45 min");
    expect(formatSavingsMin(59.8)).toBe("Save ~60 min");
    expect(formatSavingsMin(0)).toBe("Save ~0 min");
  });
});

describe("suggestedBaseBadgeText (kind-dependent badge)", () => {
  it("renders rescued-places text for capacity-expander suggestions (never savingsMin)", () => {
    expect(
      suggestedBaseBadgeText({ kind: "capacity-expander", savingsMin: -120, rescuedCount: 12 }),
    ).toBe("Visit 12 more places");
    expect(
      suggestedBaseBadgeText({ kind: "capacity-expander", savingsMin: -30, rescuedCount: 1 }),
    ).toBe("Visit 1 more place");
  });

  it("renders the savings badge for transit-saver suggestions", () => {
    expect(suggestedBaseBadgeText({ kind: "transit-saver", savingsMin: 120, rescuedCount: 0 })).toBe(
      "Save ~120 min",
    );
  });

  it("renders a commute-relief badge for slightly-negative transit-saver suggestions (route-aware regression allowance)", () => {
    expect(
      suggestedBaseBadgeText({ kind: "transit-saver", savingsMin: -40, rescuedCount: 0 }),
    ).toBe("Commute relief");
    expect(
      suggestedBaseBadgeText({ kind: "transit-saver", savingsMin: 0, rescuedCount: 0 }),
    ).toBe("Commute relief");
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

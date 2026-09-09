import { describe, expect, it } from "vitest";
import { icelandRingSample } from "./samples/iceland-ring";
import { multiHotelSampleTrip } from "./tripFactory";
import {
  createSpeculativeTrip,
  DEFAULT_MAX_TRAVEL_REGRESSION_MIN,
  evaluateBaseSuggestions,
  solve,
} from "@app/solver";
import { staysFor } from "./stays";

/**
 * End-to-end check of `route-aware-base-suggestions` on the Iceland Ring
 * Road sample: starting from a single Reykjavik base, sequentially accepting
 * the top suggested base must progressively lower total travel time (toward
 * the multi-hotel sample's comfort level) without the discovery loop getting
 * stuck, and no single step may regress travel beyond the permissive gate.
 */
describe("Iceland Ring Road sequential base addition integration", () => {
  it("progressively lowers travel time and covers the ring road without getting stuck", () => {
    const fullTrip = multiHotelSampleTrip(icelandRingSample, "2026-07-01");
    // Collapse the 12 curated hotels into a single Reykjavik base: the exact
    // "one hotel, ring road of places" shape that the old engine broke on.
    const reykjavik = fullTrip.places.find((p) => p.name === "The Reykjavik EDITION")!;
    let currentTrip = {
      ...fullTrip,
      places: [reykjavik, ...fullTrip.places.filter((p) => p.category !== "hotel")],
      days: fullTrip.days.map((d) => ({
        ...d,
        baseStartId: reykjavik.id,
        baseEndId: reykjavik.id,
      })),
    };

    let currentItin = solve({ trip: currentTrip, seed: 42, budgetMs: 50 });
    const initialTravel = currentItin.stats.totalTravelMin;
    const initialUnscheduled = currentItin.unscheduled.length;
    // Sanity: the 1-base itinerary is a commuting disaster.
    expect(initialUnscheduled).toBeGreaterThan(0);

    let additions = 0;
    const maxAdditions = 10;

    while (additions < maxAdditions) {
      const suggestions = evaluateBaseSuggestions(currentTrip, currentItin, {
        seed: 42,
        budgetMs: 50,
      });
      if (suggestions.length === 0) break;

      const top = suggestions[0]!;
      const beforeTravel = currentItin.stats.totalTravelMin;

      currentTrip = createSpeculativeTrip(currentTrip, top.candidateHotel, top.suggestedStays);
      currentItin = solve({ trip: currentTrip, seed: 42, budgetMs: 50 });
      additions++;

      // Permissive gate (design.md Decision 4): each accepted step may not
      // inflate total travel beyond the configured allowance.
      expect(currentItin.stats.totalTravelMin).toBeLessThanOrEqual(
        beforeTravel + DEFAULT_MAX_TRAVEL_REGRESSION_MIN,
      );
    }

    // Discovery must not get stuck after one or two bases.
    expect(additions).toBeGreaterThanOrEqual(3);

    // Sequential addition must make real progress: substantially lower travel
    // time and no (or far fewer) dropped places than the 1-base start.
    expect(currentItin.stats.totalTravelMin).toBeLessThan(initialTravel);
    expect(initialTravel - currentItin.stats.totalTravelMin).toBeGreaterThan(500);
    expect(currentItin.unscheduled.length).toBeLessThan(initialUnscheduled);

    // Stays remain a valid full cover of the trip, in a route-ordered
    // multi-base sequence.
    const finalStays = staysFor(currentTrip);
    expect(finalStays.length).toBe(additions + 1);
    expect(finalStays.reduce((sum, s) => sum + s.nights, 0)).toBe(12);
    expect(finalStays[0]!.hotelId).toBe(reykjavik.id);
  });
});

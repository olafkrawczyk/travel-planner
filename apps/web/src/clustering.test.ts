import { describe, expect, it } from "vitest";
import { produce } from "immer";
import type { Day, Place, Trip } from "@app/domain";
import { schemaVersion } from "@app/domain";
import { applyAutoCluster, autoClusterTrip } from "./clustering";

let counter = 0;
function place(p: Partial<Place> & Pick<Place, "lat" | "lng">): Place {
  counter++;
  return {
    id: p.id ?? `plc_${counter}`,
    name: p.name ?? `Place ${counter}`,
    lat: p.lat,
    lng: p.lng,
    category: p.category ?? "other",
    dwellMin: p.dwellMin ?? 60,
    priority: p.priority ?? 2,
    region: p.region,
  };
}

function day(id: string, baseId: string): Day {
  return {
    id,
    date: "2026-04-01",
    start: "09:00",
    end: "21:00",
    startLocation: "base",
    endLocation: "base",
    baseStartId: baseId,
    baseEndId: baseId,
  };
}

function makeTrip(places: Place[], dayCount: number, hotelId = "hotel"): Trip {
  const hotel = place({ id: hotelId, lat: 0, lng: 0, category: "hotel", dwellMin: 0 });
  return {
    id: "trip_test",
    schemaVersion,
    name: "Test trip",
    timezone: "UTC",
    days: Array.from({ length: dayCount }, (_, i) => day(`d${i}`, hotelId)),
    places: [hotel, ...places],
    travelOverrides: [],
    settings: {
      carOnly: false,
      solverStrategy: "clusterFirst",
      walkSpeedKmh: 4.5,
      walkMaxKm: 1.5,
      transitSpeedKmh: 18,
      transitOverheadMin: 12,
      regionalSpeedKmh: 80,
      regionalOverheadMin: 30,
      detourFactor: 1.3,
      weights: { travel: 1, wait: 0.5, mustDropped: 1000, niceDropped: 10, dayImbalance: 1, overBudget: 3 },
    },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const DEG_PER_KM = 1 / 111.195;

describe("autoClusterTrip", () => {
  it("is a no-op (same reference) when every place already has a region", () => {
    const trip = makeTrip(
      [place({ id: "a", lat: 1, lng: 1, region: "A" }), place({ id: "b", lat: 2, lng: 2, region: "B" })],
      2,
    );
    expect(autoClusterTrip(trip)).toBe(trip);
  });

  it("never assigns a region to hotels", () => {
    const trip = makeTrip([place({ id: "a", lat: 1, lng: 1 })], 1);
    const next = autoClusterTrip(trip);
    const hotel = next.places.find((p) => p.category === "hotel")!;
    expect(hotel.region).toBeUndefined();
  });

  it("clusters unregioned places into as many districts as there are days when no region exists yet", () => {
    // Two tight, well-separated groups of places, 2 days -> expect 2 districts.
    const group1 = [
      place({ id: "a1", lat: 0, lng: 0 }),
      place({ id: "a2", lat: 0.1 * DEG_PER_KM, lng: 0 }),
    ];
    const group2 = [
      place({ id: "b1", lat: 50 * DEG_PER_KM, lng: 0 }),
      place({ id: "b2", lat: 50.1 * DEG_PER_KM, lng: 0 }),
    ];
    const trip = makeTrip([...group1, ...group2], 2);
    const next = autoClusterTrip(trip);
    const regionOf = (id: string) => next.places.find((p) => p.id === id)!.region;
    expect(regionOf("a1")).toBeDefined();
    expect(regionOf("a1")).toBe(regionOf("a2"));
    expect(regionOf("b1")).toBe(regionOf("b2"));
    expect(regionOf("a1")).not.toBe(regionOf("b1"));
  });

  it("assigns a newly added unregioned place to the nearest existing region rather than re-clustering everything", () => {
    const trip = makeTrip(
      [
        place({ id: "a1", lat: 0, lng: 0, region: "Downtown" }),
        place({ id: "a2", lat: 0.1 * DEG_PER_KM, lng: 0, region: "Downtown" }),
        place({ id: "b1", lat: 50 * DEG_PER_KM, lng: 0, region: "Uptown" }),
        place({ id: "b2", lat: 50.1 * DEG_PER_KM, lng: 0, region: "Uptown" }),
        // One new place, close to the "Downtown" group, still unregioned.
        place({ id: "new", lat: 0.05 * DEG_PER_KM, lng: 0 }),
      ],
      2,
    );
    const next = autoClusterTrip(trip);
    const newPlace = next.places.find((p) => p.id === "new")!;
    expect(newPlace.region).toBe("Downtown");
    // Existing regions are untouched.
    expect(next.places.find((p) => p.id === "a1")!.region).toBe("Downtown");
    expect(next.places.find((p) => p.id === "b1")!.region).toBe("Uptown");
  });

  it("does nothing when there are no schedulable places at all", () => {
    const trip = makeTrip([], 1);
    expect(autoClusterTrip(trip)).toBe(trip);
  });
});

describe("applyAutoCluster", () => {
  it("behaves identically to autoClusterTrip when run as a draft-mutating recipe", () => {
    const trip = makeTrip(
      [place({ id: "a", lat: 0, lng: 0 }), place({ id: "b", lat: 50 * DEG_PER_KM, lng: 0 })],
      2,
    );
    const viaWrapper = autoClusterTrip(trip);
    const viaRecipe = produce(trip, applyAutoCluster);
    expect(viaRecipe.places.map((p) => p.region)).toEqual(viaWrapper.places.map((p) => p.region));
  });
});

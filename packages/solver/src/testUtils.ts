import { TripSchema, TripSettingsSchema, schemaVersion, type Day, type Place, type Trip, type TravelOverride } from "@app/domain";

let counter = 0;

/** Build a Place with sensible defaults. */
export function place(p: Partial<Place> & Pick<Place, "lat" | "lng">): Place {
  counter++;
  return {
    id: p.id ?? `plc_${counter}`,
    name: p.name ?? `Place ${counter}`,
    lat: p.lat,
    lng: p.lng,
    category: p.category ?? "other",
    dwellMin: p.dwellMin ?? 60,
    priority: p.priority ?? 2,
    openingHours: p.openingHours,
    appointment: p.appointment,
    region: p.region,
    notes: p.notes,
  };
}

/** Build a Day with sensible defaults. */
export function day(d: Partial<Day> & { id: string }): Day {
  return {
    id: d.id,
    date: d.date ?? "2026-04-01",
    start: d.start ?? "09:00",
    end: d.end ?? "21:00",
    startLocation: d.startLocation ?? "base",
    endLocation: d.endLocation ?? "base",
    baseStartId: d.baseStartId ?? "baseA",
    baseEndId: d.baseEndId ?? "baseA",
    locked: d.locked,
    pinnedOrder: d.pinnedOrder,
  };
}

/**
 * Build a validated Trip with default settings. Days may be passed as partials
 * (`{ id }` is enough); defaults are filled in. Pass `{ validate: false }` to
 * build a trip that bypasses zod validation (e.g. fixtures with intentionally
 * invalid coordinates, which the solver must handle defensively).
 */
export function trip(
  t: {
    places: Place[];
    days: (Partial<Day> & { id: string })[];
    travelOverrides?: TravelOverride[];
    name?: string;
    id?: string;
  },
  opts?: { validate?: boolean },
): Trip {
  const raw = {
    id: t.id ?? "trip_test",
    schemaVersion,
    name: t.name ?? "Test trip",
    timezone: "Asia/Tokyo",
    days: t.days.map((d) => day(d)),
    places: t.places,
    travelOverrides: t.travelOverrides ?? [],
    settings: {
      solverStrategy: "routeFirst",
      walkSpeedKmh: 4.5,
      walkMaxKm: 1.5,
      transitSpeedKmh: 18,
      transitOverheadMin: 12,
      regionalSpeedKmh: 80,
      regionalOverheadMin: 30,
      detourFactor: 1.3,
      initialBudgetMs: 50,
      editBudgetMs: 50,
    },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
  if (opts?.validate === false) {
    // Fill only the settings defaults the solver relies on, then skip validation.
    return { ...raw, settings: TripSettingsSchema.parse({}) } as unknown as Trip;
  }
  return TripSchema.parse(raw);
}

/** The two standard test base nodes (treated as places for coordinates). */
export const BASE_A = "baseA";
export const BASE_B = "baseB";

/** Degrees of latitude per km, matching the haversine model (R = 6371 km). */
export const DEG_PER_KM = 1 / 111.195;

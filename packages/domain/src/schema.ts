import { z } from "zod";

/** Stored-data schema version. Bump when schemas change; migrations live in migrations.ts. */
export const schemaVersion = 2;

export const IdSchema = z.string().min(1);

export const TimeStringSchema = z.string().regex(/^\d{1,2}:\d{2}$/, "must be HH:mm");

export const ModeSchema = z.enum(["walk", "transit", "car"]);
export type Mode = z.infer<typeof ModeSchema>;

export const CategorySchema = z.enum([
  "museum",
  "viewpoint",
  "cafe",
  "restaurant",
  "shop",
  "park",
  "temple",
  "hotel",
  "other",
]);
export type Category = z.infer<typeof CategorySchema>;

export const TimeWindowSchema = z.object({
  start: TimeStringSchema,
  end: TimeStringSchema,
});
export type TimeWindow = z.infer<typeof TimeWindowSchema>;

export const AppointmentSchema = z.object({
  dayId: IdSchema,
  start: TimeStringSchema,
});
export type Appointment = z.infer<typeof AppointmentSchema>;

/**
 * Bounds below defend against a hostile or corrupt trip file/share-link
 * bloating IndexedDB or blowing up memory — none of them are reachable by any
 * legitimate trip:
 *  - `PLACE_NAME_MAX`/`PLACE_NOTES_MAX`: the longest real place name is a
 *    couple dozen characters; notes are free text but 5,000 chars is several
 *    printed pages — no itinerary note is that long.
 *  - `PLACE_REGION_MAX`/`PLACE_OSM_ID_MAX`: both are short identifiers
 *    (a cluster label, or an OSM `node/12345678`-shaped id) — 200 chars is
 *    already 10x any real value.
 *  - `OPENING_HOURS_MAX_DATES`/`OPENING_HOURS_MAX_WINDOWS_PER_DATE`: a place
 *    has at most one `openingHours` entry per date the trip covers (bounded
 *    by `MAX_TRIP_DAYS` below) and realistically 1-2 open/close windows per
 *    date (e.g. a lunch break); the caps are set an order of magnitude above
 *    that.
 */
const PLACE_NAME_MAX = 200;
const PLACE_NOTES_MAX = 5000;
const PLACE_REGION_MAX = 200;
const PLACE_OSM_ID_MAX = 200;
const OPENING_HOURS_MAX_DATES = 400;
const OPENING_HOURS_MAX_WINDOWS_PER_DATE = 20;

/** Opening-hour windows per concrete date (YYYY-MM-DD). Absent/empty = always
 *  open. See the bounds doc comment above `PLACE_NAME_MAX` for why these caps
 *  are sized the way they are. */
export const OpeningHoursSchema = z
  .record(
    z.string().max(32),
    z
      .array(TimeWindowSchema)
      .max(
        OPENING_HOURS_MAX_WINDOWS_PER_DATE,
        `A single date cannot have more than ${OPENING_HOURS_MAX_WINDOWS_PER_DATE} opening-hour windows.`,
      ),
  )
  .refine((v) => Object.keys(v).length <= OPENING_HOURS_MAX_DATES, {
    message: `openingHours cannot list more than ${OPENING_HOURS_MAX_DATES} dates.`,
  });

export const PlaceSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(PLACE_NAME_MAX),
  nameLocal: z.string().max(PLACE_NAME_MAX).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  category: CategorySchema,
  dwellMin: z.number().int().min(0).max(1440),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]), // 1 = must
  openingHours: OpeningHoursSchema.optional(),
  appointment: AppointmentSchema.optional(),
  /** Soft force: keep this place on the given day, relaxing that day's time budget. */
  forceDayId: IdSchema.optional(),
  region: z.string().min(1).max(PLACE_REGION_MAX).optional(),
  osmId: z.string().max(PLACE_OSM_ID_MAX).optional(),
  notes: z.string().max(PLACE_NOTES_MAX).optional(),
});
export type Place = z.infer<typeof PlaceSchema>;

export const DaySchema = z.object({
  id: IdSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"),
  start: TimeStringSchema,
  end: TimeStringSchema,
  startLocation: z.union([IdSchema, z.literal("base")]),
  endLocation: z.union([IdSchema, z.literal("base")]),
  baseStartId: IdSchema,
  baseEndId: IdSchema,
  luggageForwarded: z.boolean().optional(),
  locked: z.boolean().optional(),
  pinnedOrder: z.array(IdSchema).optional(),
  /** True on a day the traveller checks into a (new) hotel stay. Explicit
   *  boundaries let two consecutive stays use the same hotel; when absent,
   *  stay boundaries are derived from `baseEndId` changes. */
  stayStart: z.boolean().optional(),
});
export type Day = z.infer<typeof DaySchema>;

export const TravelOverrideSchema = z.object({
  fromId: IdSchema,
  toId: IdSchema,
  minutes: z.number().int().min(0).max(1440),
  mode: ModeSchema.optional(),
  symmetric: z.boolean(),
});
export type TravelOverride = z.infer<typeof TravelOverrideSchema>;

export const TripSettingsSchema = z.object({
  carOnly: z.boolean().default(false),
  // routeFirst is the documented, fixture-tested default; clusterFirst stays
  // opt-in behind the DevPanel flag (apps/web/src/store.ts `defaultFlags`,
  // apps/web/src/tripFactory.ts `defaultSettings`) until it's been measured
  // side-by-side against routeFirst on real trips. All three declarations of
  // this default must agree — `LocalRepository` parses every stored trip on
  // read and write, so a disagreeing zod default here silently overrides
  // whatever the UI/tripFactory claim for any trip missing the field.
  solverStrategy: z.enum(["routeFirst", "clusterFirst"]).default("routeFirst"),
  walkSpeedKmh: z.number().positive().default(4.5),
  walkMaxKm: z.number().positive().default(1.5),
  /** Urban transit (metro/bus): flat speed + a fixed overhead for
   *  wait/access/transfer. Realistic for short-to-medium city hops; see
   *  `regionalSpeedKmh`/`regionalOverheadMin` for the long-haul curve that
   *  keeps this pair from being extrapolated across intercity distances. */
  transitSpeedKmh: z.number().positive().default(18),
  transitOverheadMin: z.number().min(0).default(12),
  /** Regional/intercity rail: much higher line-haul speed than urban
   *  transit, but a larger fixed overhead (station access, boarding,
   *  transfers) that a short urban hop should never pay. The heuristic
   *  (packages/solver/src/matrix.ts `heuristicEntry`) evaluates both this
   *  and the urban-transit curve and takes whichever is cheaper, so the
   *  crossover between the two falls out of the arithmetic rather than a
   *  hard distance threshold — the latter would make travel time
   *  non-monotonic in distance (a farther place could price cheaper than a
   *  nearer one), which would let the solver route to it in preference to
   *  the closer option. */
  regionalSpeedKmh: z.number().positive().default(80),
  regionalOverheadMin: z.number().min(0).default(30),
  /**
   * Multiplies great-circle (haversine) distance to approximate real
   * travel distance, applied once before any mode's minutes are computed.
   * It is a fair proxy for street-network wander (the case it was
   * calibrated for) and, empirically, also lands close to real intercity
   * rail routes that must follow valley/coastal corridors (e.g. Tokyo <->
   * Hakone) — so a single shared factor is kept rather than adding a
   * second, under-calibrated per-mode multiplier. What *does* differ
   * between urban and regional travel — the fixed cost of getting to a
   * station, waiting, and transferring — lives in each mode's overhead
   * term instead, which is where that effect actually belongs.
   */
  detourFactor: z.number().positive().default(1.3),
  weights: z
    .object({
      travel: z.number().default(1),
      wait: z.number().default(0.5),
      mustDropped: z.number().default(1000),
      niceDropped: z.number().default(10),
      dayImbalance: z.number().default(1),
      // Cost per minute a day runs past its soft end time (force-relaxed days
      // are exempt — they opted in).
      overBudget: z.number().default(3),
    })
    .default({}),
});
export type TripSettings = z.infer<typeof TripSettingsSchema>;

/**
 * Hard ceiling on `TripSchema.days`, enforced for EVERY path a `Trip` can
 * enter the app through (file import, share-link import, and every read from
 * storage — all go through `parseTrip`/`TripSchema`). This mirrors
 * `apps/web/src/tripFactory.ts`'s `MAX_TRIP_DAYS` (same value, 60) — that one
 * gives a friendly "Trip too long" message at the trip-creation UI boundary,
 * before any solve is even attempted; this one is the schema-level backstop
 * for every other way a trip can reach the store, none of which call
 * `validateTripLength`. See tripFactory.ts's doc comment on its own
 * `MAX_TRIP_DAYS` for why an uncapped day count can pin the solver worker
 * indefinitely. Kept as an independent constant rather than imported —
 * `@app/domain` sits below `apps/web` in the dependency graph — so keep the
 * two values in sync if either ever changes.
 */
const MAX_TRIP_DAYS = 60;
/** Hard ceiling on `TripSchema.places`. Even a full `MAX_TRIP_DAYS`-length
 *  trip with an unusually packed schedule (~10 places/day) lands under 1,000;
 *  2,000 leaves generous headroom for real trips while still bounding a
 *  hostile/corrupt file's ability to bloat IndexedDB or slow the solver. */
const MAX_TRIP_PLACES = 2000;

export const TripSchema = z.object({
  id: IdSchema,
  schemaVersion: z.number().int().positive(),
  name: z.string().min(1),
  timezone: z.string().default("UTC"),
  days: z.array(DaySchema).max(MAX_TRIP_DAYS, `Trip too long: cannot exceed ${MAX_TRIP_DAYS} days.`),
  places: z
    .array(PlaceSchema)
    .max(MAX_TRIP_PLACES, `Trip has too many places: cannot exceed ${MAX_TRIP_PLACES} places.`),
  travelOverrides: z.array(TravelOverrideSchema),
  settings: TripSettingsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Trip = z.infer<typeof TripSchema>;

// ---- Solver output ----

export const LegSourceSchema = z.enum(["heuristic", "api", "override"]);

export const LegSchema = z.object({
  fromId: IdSchema,
  toId: IdSchema,
  minutes: z.number().min(0),
  mode: ModeSchema,
  source: LegSourceSchema,
  /** Human-readable explanation, e.g. "walk heuristic (0.8 km)", "urban
   *  transit heuristic (2.9 km)", or "regional rail heuristic (101.3 km)". */
  explanation: z.string().optional(),
});
export type Leg = z.infer<typeof LegSchema>;

export const StopSchema = z.object({
  placeId: IdSchema,
  arrive: TimeStringSchema,
  depart: TimeStringSchema,
  waitMin: z.number().int().min(0),
});
export type Stop = z.infer<typeof StopSchema>;

export const DayPlanSchema = z.object({
  dayId: IdSchema,
  stops: z.array(StopSchema),
  legs: z.array(LegSchema),
  /**
   * Minutes of headroom before the day's soft end time. Signed and never
   * clamped: negative means the day runs past its soft end (surfaced by the
   * UI as "over by N min"). Matches the solver's internal `SequenceResult`
   * field of the same name (packages/solver/src/sequence.ts).
   */
  slackMin: z.number().int(),
});
export type DayPlan = z.infer<typeof DayPlanSchema>;

export const UnscheduledReasonSchema = z.enum(["no_time", "window_conflict", "unreachable"]);
export type UnscheduledReason = z.infer<typeof UnscheduledReasonSchema>;

export const ItinerarySchema = z.object({
  days: z.array(DayPlanSchema),
  unscheduled: z.array(
    z.object({
      placeId: IdSchema,
      reason: UnscheduledReasonSchema,
      /** Human-readable explanation of why the place could not be scheduled. */
      explanation: z.string().optional(),
    }),
  ),
  stats: z.object({
    totalTravelMin: z.number(),
    totalWaitMin: z.number(),
    score: z.number(),
  }),
});
export type Itinerary = z.infer<typeof ItinerarySchema>;

// ---- Migration hook ----

export type Migration = (trip: Record<string, unknown>) => Record<string, unknown>;

/** Migrations per target version; extend as schemaVersion increases. */
export const migrations: Record<number, Migration> = {
  1: (t) => t,
  // v1 → v2: date-less `Place.timeWindows` (never written) replaced by
  // per-date `Place.openingHours`; the legacy field is dropped.
  2: (t) => ({
    ...t,
    places: Array.isArray(t.places)
      ? t.places.map((p) => {
          const { timeWindows: _legacy, ...rest } = p as Record<string, unknown>;
          return rest;
        })
      : t.places,
  }),
};

/** Opening-hour windows for a place on a concrete date; undefined = always open that day. */
export function windowsForDate(place: Place, date: string): TimeWindow[] | undefined {
  return place.openingHours?.[date];
}

/**
 * Parse a stored/exported trip: migrate to current version, then zod-validate.
 * Throws a plain `Error` with a readable message on failure — never the raw
 * `ZodError` (whose default `.message` is a JSON-stringified issue array,
 * unreadable if it reaches a toast or an import-error banner unmodified).
 */
export function parseTrip(raw: unknown): Trip {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const v = typeof obj.schemaVersion === "number" ? obj.schemaVersion : 0;
  let cur = obj;
  for (let version = Math.max(1, v); version <= schemaVersion; version++) {
    const migrate = migrations[version];
    if (migrate) cur = migrate(cur);
    cur = { ...cur, schemaVersion: version };
  }
  const result = TripSchema.safeParse(cur);
  if (!result.success) {
    const detail = result.error.issues.map((i) => i.message).join("; ") || "invalid trip data";
    throw new Error(`Trip is invalid: ${detail}`);
  }
  return result.data;
}

import { type Category, type Day, type Place, type Trip, newDayId, newPlaceId, newTripId, schemaVersion } from "@app/domain";

export const DEFAULT_DAY_START = "09:00";
export const DEFAULT_DAY_END = "21:00";

/**
 * Hard cap on how many days a trip may have. `evaluate()` (in `@app/solver`)
 * calls `computeTimes` once per day on every ALNS iteration, so an uncapped
 * multi-year date range (e.g. ~1,460 days for four years) pins the worker for
 * its whole solve budget without ever producing a usable itinerary. 60 days
 * (two months) comfortably covers every real trip this app targets — the
 * longest curated sample is 12 days — while keeping a full solve tractable
 * within the existing time budgets. Enforced at the creation boundary (see
 * `createTrip` in `store.ts`), not here — `dateRange` stays a pure date
 * function so callers that already know their range is in-bounds (samples,
 * tests) never have to think about the cap.
 */
export const MAX_TRIP_DAYS = 60;

/** One curated place in a sample-trip dataset (see `src/samples/`). */
export interface SamplePlace {
  name: string;
  lat: number;
  lng: number;
  category: Category;
  dwellMin: number;
  priority: 1 | 2 | 3;
  region?: string;
  notes?: string;
}

/** A curated sample-trip dataset loadable with one click from the trip list. */
export interface SampleTripData {
  name: string;
  city: string;
  days: number;
  hotel: { name: string; lat: number; lng: number; notes?: string };
  places: readonly SamplePlace[];
}

/** One hotel in a multi-hotel sample: stays `nights` nights from day `daysFromStart` (0-based). */
export interface SampleHotel {
  name: string;
  lat: number;
  lng: number;
  notes?: string;
  daysFromStart: number;
  nights: number;
}

/** A curated sample trip with mid-trip hotel changes (distinct bases per day). */
export interface MultiHotelSampleTripData {
  name: string;
  city: string;
  days: number;
  hotels: readonly SampleHotel[];
  places: readonly SamplePlace[];
}

/** Any curated sample dataset accepted by the trip list's load action. */
export type AnySampleData = SampleTripData | MultiHotelSampleTripData;

/** All dates in [start, end] inclusive as YYYY-MM-DD. */
export function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return dates;
  for (let d = s; d <= e; d = new Date(d.getTime() + 86_400_000)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * Null when `dates` fits within `MAX_TRIP_DAYS`, otherwise a user-facing
 * message naming both the cap and the requested length. Pure and side-effect
 * free — it never truncates `dates` itself; the caller (`createTrip` in
 * store.ts) decides what to do with a violation (refuse with a toast, per
 * that reasoning in `MAX_TRIP_DAYS`'s doc comment above). Kept as a small
 * standalone function, rather than folded into `dateRange`, so `dateRange`
 * stays a pure "what dates does this range cover" function usable by callers
 * (samples, tests) that don't need — or already know they're within — the cap.
 */
export function validateTripLength(dates: string[]): string | null {
  if (dates.length <= MAX_TRIP_DAYS) return null;
  return `Trip too long: ${dates.length} days requested, ${MAX_TRIP_DAYS} max. Pick a shorter date range.`;
}

/**
 * A new trip with one day per date and a default hotel place as the base of
 * every day (editable as an ordinary place afterwards). `baseCoords` seeds the
 * hotel location from the geocoded starting city; without it the previous
 * Tokyo-Station default is kept.
 */
export function emptyTrip(
  name: string,
  dates: string[],
  baseCoords?: { lat: number; lng: number },
): Trip {
  const hotel: Place = {
    id: newPlaceId(),
    name: "Hotel (edit me)",
    lat: baseCoords?.lat ?? 35.6812,
    lng: baseCoords?.lng ?? 139.7671,
    category: "hotel",
    dwellMin: 0,
    priority: 3,
    notes: "Default base — click it on the map or edit to set its location.",
  };
  const now = new Date().toISOString();
  return {
    id: newTripId(),
    schemaVersion,
    name,
    timezone: "UTC",
    days: dates.map(
      (date): Day => ({
        id: newDayId(),
        date,
        start: DEFAULT_DAY_START,
        end: DEFAULT_DAY_END,
        startLocation: "base",
        endLocation: "base",
        baseStartId: hotel.id,
        baseEndId: hotel.id,
      }),
    ),
    places: dates.length > 0 ? [hotel] : [],
    travelOverrides: [],
    settings: defaultSettings(),
    createdAt: now,
    updatedAt: now,
  };
}

/** Default solver weights/heuristics shared by all newly created trips. */
function defaultSettings(): Trip["settings"] {
  return {
    carOnly: false,
    solverStrategy: "routeFirst",
    walkSpeedKmh: 4.5,
    walkMaxKm: 1.5,
    transitSpeedKmh: 18,
    transitOverheadMin: 12,
    regionalSpeedKmh: 80,
    regionalOverheadMin: 30,
    detourFactor: 1.3,
    weights: {
      travel: 1,
      wait: 0.5,
      mustDropped: 1000,
      niceDropped: 10,
      dayImbalance: 1,
      overBudget: 3,
    },
  };
}

function sampleDates(days: number, startDate?: string): string[] {
  const start = startDate ?? new Date().toISOString().slice(0, 10);
  const s = new Date(`${start}T00:00:00Z`);
  return Array.from({ length: Math.max(1, days) }, (_, i) =>
    new Date(s.getTime() + i * 86_400_000).toISOString().slice(0, 10),
  );
}

function placeFromSample(p: SamplePlace): Place {
  return {
    id: newPlaceId(),
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    category: p.category,
    dwellMin: p.dwellMin,
    priority: p.priority,
    ...(p.region ? { region: p.region } : {}),
    ...(p.notes ? { notes: p.notes } : {}),
  };
}

function hotelPlace(h: { name: string; lat: number; lng: number; notes?: string }): Place {
  return {
    id: newPlaceId(),
    name: h.name,
    lat: h.lat,
    lng: h.lng,
    category: "hotel",
    dwellMin: 0,
    priority: 3,
    notes: h.notes ?? "Home base for this trip.",
  };
}

/**
 * A curated sample trip (e.g. Tokyo, Warsaw) with the hotel as the base place
 * (dwellMin 0) of every day and one day per sample day count, starting on
 * `startDate` (default: today). Used by the trip list's one-click sample
 * buttons and covered by the solver's Warsaw/Tokyo fixture regressions.
 */
export function sampleTrip(sample: SampleTripData, startDate?: string): Trip {
  const dates = sampleDates(sample.days, startDate);
  const hotel: Place = hotelPlace(sample.hotel);
  const now = new Date().toISOString();
  return {
    id: newTripId(),
    schemaVersion,
    name: sample.name,
    timezone: "UTC",
    days: dates.map(
      (date): Day => ({
        id: newDayId(),
        date,
        start: DEFAULT_DAY_START,
        end: DEFAULT_DAY_END,
        startLocation: "base",
        endLocation: "base",
        baseStartId: hotel.id,
        baseEndId: hotel.id,
      }),
    ),
    places: [hotel, ...sample.places.map(placeFromSample)],
    travelOverrides: [],
    settings: defaultSettings(),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * A curated sample trip with mid-trip hotel changes. Hotel semantics: a day's
 * `baseStartId` is the hotel you wake in, `baseEndId` the hotel you sleep in.
 * A hotel with `daysFromStart: k` (0-based) first serves as `baseEndId` on day
 * k-1 (the travel day: check out of the old hotel, arrive at the new one) and
 * as `baseStartId` from day k onward. So for hotels [tokyo(0), hakone(3)] over
 * 5 days: days 1–2 stay at tokyo, day 3 wakes in tokyo and sleeps in hakone,
 * days 4–5 stay at hakone.
 */
export function multiHotelSampleTrip(
  sample: MultiHotelSampleTripData,
  startDate?: string,
): Trip {
  const dates = sampleDates(sample.days, startDate);
  const hotels = [...sample.hotels].sort((a, b) => a.daysFromStart - b.daysFromStart);
  const hotelPlaces = hotels.map(hotelPlace);
  /** Last hotel whose stay has begun by day index i. */
  const hotelFor = (i: number): Place => {
    let chosen = hotelPlaces[0];
    for (let h = 0; h < hotels.length; h++) {
      if (hotels[h]!.daysFromStart <= i) chosen = hotelPlaces[h];
    }
    return chosen!;
  };
  const now = new Date().toISOString();
  return {
    id: newTripId(),
    schemaVersion,
    name: sample.name,
    timezone: "UTC",
    days: dates.map(
      (date, i): Day => ({
        id: newDayId(),
        date,
        start: DEFAULT_DAY_START,
        end: DEFAULT_DAY_END,
        startLocation: "base",
        endLocation: "base",
        baseStartId: hotelFor(i).id,
        baseEndId: hotelFor(i + 1).id,
      }),
    ),
    places: [...hotelPlaces, ...sample.places.map(placeFromSample)],
    travelOverrides: [],
    settings: defaultSettings(),
    createdAt: now,
    updatedAt: now,
  };
}

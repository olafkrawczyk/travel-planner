import {
  type Day,
  type Place,
  type Trip,
  type TripSettings,
  type Mode,
  type UnscheduledReason,
} from "@app/domain";
import { haversineKm, DEFAULT_OSRM_PROFILE } from "@app/geo";
import { parseHHMM } from "@app/domain";
import { clusterPlaces, buildAdjacencyMapping } from "./cluster";

export type LegSource = "heuristic" | "override" | "api";

export interface MatrixEntry {
  minutes: number;
  mode: Mode;
  source: LegSource;
  explanation: string;
}

/**
 * Candidate cost curve for one transport mode, already detour-adjusted `km`
 * in: minutes as a function of distance. Every curve here must be
 * non-decreasing in `km` (constant or positive slope, non-negative
 * intercept) — `heuristicEntry` takes the minimum across whichever curves
 * are "available" at that distance, and the minimum of non-decreasing
 * functions is itself non-decreasing, which is what keeps the overall
 * heuristic monotonic in distance (see the module doc below `heuristicEntry`
 * for why that property matters). A hard distance-band switch between modes
 * does NOT have this property in general, which is exactly the trap this
 * formulation avoids.
 */
/**
 * Candidate cost curve for one transport mode, already detour-adjusted `km`
 * in: minutes as a function of distance. Every curve here must be
 * non-decreasing in `km` (constant or positive slope, non-negative
 * intercept) — `heuristicEntry` takes the minimum across whichever curves
 * are "available" at that distance, and the minimum of non-decreasing
 * functions is itself non-decreasing, which is what keeps the overall
 * heuristic monotonic in distance (see the module doc below `heuristicEntry`
 * for why that property matters). A hard distance-band switch between modes
 * does NOT have this property in general, which is exactly the trap this
 * formulation avoids.
 */
export interface ModeCandidate {
  mode: Mode;
  minutes: number;
  explanation: string;
}

/**
 * Return candidate mode evaluations for a detour-adjusted distance `km`.
 * On a car-available day (`carAvailable = true`), the candidate set is
 * `{car, walk (≤walkMaxKm)}`; on a non-car day (`carAvailable = false`), the
 * candidate set is `{walk (≤walkMaxKm), transit, rail}`.
 */
export function modeCandidates(
  km: number,
  settings: TripSettings,
  carAvailable: boolean = settings.carOnly,
): ModeCandidate[] {
  const candidates: ModeCandidate[] = [];
  // People will not walk an arbitrarily long distance — walk is only ever a
  // candidate up to walkMaxKm, unlike the two transit curves below.
  if (km <= settings.walkMaxKm) {
    candidates.push({
      mode: "walk",
      minutes: (km / settings.walkSpeedKmh) * 60,
      explanation: `walk heuristic (${km.toFixed(1)} km)`,
    });
  }

  if (carAvailable) {
    candidates.push({
      mode: "car",
      // Assume 60 km/h + 5 min parking overhead
      minutes: (km / 60) * 60 + 5,
      explanation: `car heuristic (${km.toFixed(1)} km)`,
    });
  } else {
    candidates.push({
      mode: "transit",
      minutes: (settings.transitOverheadMin + (km / settings.transitSpeedKmh) * 60) * 1.15,
      explanation: `urban transit heuristic (${km.toFixed(1)} km)`,
    });
    candidates.push({
      mode: "transit",
      minutes: (settings.regionalOverheadMin + (km / settings.regionalSpeedKmh) * 60) * 1.15,
      explanation: `regional rail heuristic (${km.toFixed(1)} km)`,
    });
  }
  return candidates;
}

/**
 * Travel-time heuristic used whenever no routing-API duration is available
 * (or is rejected as implausible — see `resolveApiOrHeuristic`).
 *
 * Distance is detour-adjusted once, up front, from the great-circle
 * (haversine) distance via `settings.detourFactor` — see the doc comment on
 * `detourFactor` in packages/domain/src/schema.ts for why a single shared
 * factor is used for every mode rather than a separate one for rail.
 *
 * Three cost curves are evaluated against that adjusted distance and the
 * cheapest one wins:
 *   - walk:            d / walkSpeedKmh * 60,        available only up to walkMaxKm
 *   - urban transit:   transitOverheadMin + d / transitSpeedKmh * 60
 *   - regional rail:   regionalOverheadMin + d / regionalSpeedKmh * 60
 *
 * On car days (or when settings.carOnly is true), the candidate set is
 * `{car (60 km/h + 5 min parking), walk (≤walkMaxKm)}`.
 *
 * Each curve is affine and non-decreasing in `d`, and `walk` is the only one
 * whose availability is distance-gated (excluding a candidate from a
 * minimum can only raise or preserve the result, never lower it) — so the
 * combined minimum is non-decreasing over the whole domain. This replaces an
 * earlier single-threshold model (walk below a cutoff, flat-speed transit
 * above it) that had no regional/intercity curve at all: a flat 18 km/h with
 * an 8-minute overhead is a reasonable proxy for a metro/bus ride but wildly
 * overprices a limited-express rail leg (e.g. Hakone -> Tokyo, ~78 km
 * great-circle, priced at ~349 min by the old model vs. ~85-95 min in
 * reality). See matrix.test.ts's "heuristic travel-time model" describe
 * block for the calibration and monotonicity tests.
 */
export function heuristicEntry(
  a: Place,
  b: Place,
  settings: TripSettings,
  carAvailable: boolean = settings.carOnly,
): MatrixEntry {
  const km = haversineKm(a.lat, a.lng, b.lat, b.lng) * settings.detourFactor;
  const candidates = modeCandidates(km, settings, carAvailable);
  const best = candidates.reduce((lowest, c) => (c.minutes < lowest.minutes ? c : lowest));
  return {
    minutes: round1(best.minutes),
    mode: best.mode,
    source: "heuristic",
    explanation: best.explanation,
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * Map an OSRM routing profile to the closest `Mode` (`ModeSchema` in
 * packages/domain/src/schema.ts includes `"walk" | "transit" | "car"`,
 * already zod-validated + persisted on `Leg`). "foot"/"walking" map to
 * "walk"; "car"/"driving" map to "car"; anything else (e.g. a self-hosted
 * server's exotic profile) maps to "transit" as the nearest existing
 * category — never to "walk", which would falsely assert pedestrian travel.
 * The explanation string always names the literal profile, so a non-walking
 * profile is never silently presented as walking.
 */
function apiMode(profile: string): Mode {
  if (profile === "foot" || profile === "walking") return "walk";
  if (profile === "car" || profile === "driving") return "car";
  return "transit";
}

/** Human-readable profile name for the explanation string. */
function apiProfileLabel(profile: string): string {
  return profile === "foot" || profile === "walking" ? "walking" : profile;
}

/**
 * Upper bound on the average speed (km/h) an OSRM-reported duration may
 * imply for the `Mode` we'd otherwise assert, before we refuse to trust it.
 * Computed against the pair's *straight-line* (haversine) distance, which
 * underestimates the true routed distance — so these bounds are already
 * generous on top of realistic maxima (adult brisk walking tops out around
 * 6-7 km/h) to tolerate that undercount, rounding, and terrain shortcuts.
 * They exist to catch gross mislabeling, not to fine-tune plausible times:
 * the Hakone Open-Air Museum → Tokyo Tower report that motivated this guard
 * implied ~51 km/h for a "walk" leg (a car-profile duration mislabeled as
 * foot by a demo server that ignores the requested profile) — an order of
 * magnitude past any of these thresholds.
 */
const MAX_PLAUSIBLE_SPEED_KMH: Record<Mode, number> = {
  walk: 12,
  // Generous enough to admit fast intercity rail without false positives;
  // still catches a "transit" entry that implies flight-speed travel.
  transit: 250,
  // Generous enough for motorway driving without false positives; still
  // catches a "car" entry that implies flight-speed travel.
  car: 130,
};

/** API-sourced entry: real OSRM minutes for `profile`; distance is still haversine (display only). */
function apiEntry(a: Place, b: Place, minutes: number, profile: string): MatrixEntry {
  const mode = apiMode(profile);
  return {
    minutes: round1(minutes),
    mode,
    source: "api",
    explanation: `OSRM ${apiProfileLabel(profile)} (${haversineKm(a.lat, a.lng, b.lat, b.lng).toFixed(1)} km)`,
  };
}

/**
 * Resolve one pair's api-or-heuristic entry, guarding against implausible
 * API durations (see `MAX_PLAUSIBLE_SPEED_KMH`). A rejected API entry falls
 * back to the heuristic but says so in its explanation — never a silent
 * swap — so a bad routing server's fingerprints stay visible in the UI.
 */
function resolveApiOrHeuristic(
  a: Place,
  b: Place,
  apiMinutes: number | undefined,
  profile: string,
  settings: TripSettings,
  carAvailable: boolean = settings.carOnly,
): MatrixEntry {
  if (!carAvailable) {
    if (typeof apiMinutes !== "number" || !Number.isFinite(apiMinutes)) {
      return heuristicEntry(a, b, settings, false);
    }
    
    const mode = apiMode(profile);
    // Apply a 5-minute parking overhead to API car times so short hops don't artificially beat walking
    const adjustedApiMin = mode === "car" ? apiMinutes + 5 : apiMinutes;
    
    const candidate = apiEntry(a, b, adjustedApiMin, profile);
    const km = haversineKm(a.lat, a.lng, b.lat, b.lng);
    const impliedKmh = apiMinutes > 0 ? km / (apiMinutes / 60) : 0; // use raw apiMinutes for speed check
    
    if (impliedKmh > MAX_PLAUSIBLE_SPEED_KMH[candidate.mode]) {
      const fallback = heuristicEntry(a, b, settings, false);
      return {
        ...fallback,
        explanation: `${fallback.explanation} (API rejected: ${candidate.explanation} implied ${impliedKmh.toFixed(0)} km/h, too fast for ${candidate.mode})`,
      };
    }
    
    // Blend car/foot: If the API says we should drive, but the walk heuristic says walking is faster
    // (because of driving's parking overhead), just walk instead.
    if (mode === "car") {
      const walkFallback = heuristicEntry(a, b, settings, false);
      if (walkFallback.mode === "walk" && walkFallback.minutes < candidate.minutes) {
        return {
          ...walkFallback,
          explanation: `${walkFallback.explanation} (faster than API car)`,
        };
      }
    }

    return candidate;
  }

  // Car is available (car-rental day or whole-trip carOnly): evaluate over
  // available modes {car, walk (<= walkMaxKm)}.
  const detourKm = haversineKm(a.lat, a.lng, b.lat, b.lng) * settings.detourFactor;
  const rawKm = haversineKm(a.lat, a.lng, b.lat, b.lng);
  const hasApi = typeof apiMinutes === "number" && Number.isFinite(apiMinutes);
  const mode = apiMode(profile);

  // 1. Car candidate: driving API if available, else heuristic car curve.
  let carCandidate: MatrixEntry;
  if (hasApi && mode === "car") {
    const impliedKmh = apiMinutes > 0 ? rawKm / (apiMinutes / 60) : 0;
    if (impliedKmh <= MAX_PLAUSIBLE_SPEED_KMH.car) {
      carCandidate = apiEntry(a, b, apiMinutes + 5, profile);
    } else {
      const fallback = heuristicEntry(a, b, settings, true);
      carCandidate = {
        ...fallback,
        explanation: `${fallback.explanation} (API rejected: ${candidateExplanation(a, b, apiMinutes + 5, profile)} implied ${impliedKmh.toFixed(0)} km/h, too fast for car)`,
      };
    }
  } else {
    const carMinutes = (detourKm / 60) * 60 + 5;
    carCandidate = {
      minutes: round1(carMinutes),
      mode: "car",
      source: "heuristic",
      explanation: `car heuristic (${detourKm.toFixed(1)} km)`,
    };
  }

  // 2. Walk candidate (available only up to walkMaxKm; foot API duration usable if present).
  if (detourKm <= settings.walkMaxKm) {
    let walkCandidate: MatrixEntry;
    if (hasApi && mode === "walk") {
      const impliedKmh = apiMinutes > 0 ? rawKm / (apiMinutes / 60) : 0;
      if (impliedKmh <= MAX_PLAUSIBLE_SPEED_KMH.walk) {
        walkCandidate = apiEntry(a, b, apiMinutes, profile);
      } else {
        const walkMin = (detourKm / settings.walkSpeedKmh) * 60;
        walkCandidate = {
          minutes: round1(walkMin),
          mode: "walk",
          source: "heuristic",
          explanation: `walk heuristic (${detourKm.toFixed(1)} km) (API rejected: ${candidateExplanation(a, b, apiMinutes, profile)} implied ${impliedKmh.toFixed(0)} km/h, too fast for walk)`,
        };
      }
    } else {
      const walkMin = (detourKm / settings.walkSpeedKmh) * 60;
      walkCandidate = {
        minutes: round1(walkMin),
        mode: "walk",
        source: "heuristic",
        explanation: `walk heuristic (${detourKm.toFixed(1)} km)`,
      };
    }

    if (walkCandidate.minutes < carCandidate.minutes) {
      return walkCandidate;
    }
  }

  return carCandidate;
}

function candidateExplanation(a: Place, b: Place, minutes: number, profile: string): string {
  return `OSRM ${apiProfileLabel(profile)} (${haversineKm(a.lat, a.lng, b.lat, b.lng).toFixed(1)} km)`;
}

/** Asymmetric-capable travel-time matrix over all nodes (places incl. bases). */
export class TravelMatrix {
  readonly nodes: string[];
  readonly indexOf: Map<string, number>;
  readonly entries: MatrixEntry[][];
  private carEntries?: MatrixEntry[][];
  private overrides: Map<string, MatrixEntry>;
  private apiDurations: number[][] | undefined;
  private apiProfile: string;
  private placesById: Map<string, Place>;
  private settings: TripSettings;
  private carByDay: boolean[];

  constructor(
    nodes: string[],
    entries: MatrixEntry[][],
    overrides: Map<string, MatrixEntry>,
    placesById: Map<string, Place>,
    settings: TripSettings,
    apiDurations?: number[][],
    apiProfile: string = DEFAULT_OSRM_PROFILE,
    carByDay: boolean[] = [],
  ) {
    this.nodes = nodes;
    this.indexOf = new Map(nodes.map((id, i) => [id, i]));
    this.entries = entries;
    this.overrides = overrides;
    this.apiDurations = apiDurations;
    this.apiProfile = apiProfile;
    this.placesById = placesById;
    this.settings = settings;
    this.carByDay = carByDay;
  }

  hasCar(dayIdx?: number): boolean {
    if (this.settings.carOnly) return true;
    if (dayIdx === undefined || dayIdx < 0 || dayIdx >= this.carByDay.length) return false;
    return this.carByDay[dayIdx] === true;
  }

  private ensureCarEntries(): MatrixEntry[][] {
    if (!this.carEntries) {
      if (this.settings.carOnly) {
        this.carEntries = this.entries;
      } else {
        this.carEntries = this.nodes.map((from) =>
          this.nodes.map((to) => this.entryFor(from, to, true)),
        );
      }
    }
    return this.carEntries;
  }

  private entryFor(fromId: string, toId: string, carAvailable: boolean = this.settings.carOnly): MatrixEntry {
    const ov = this.overrides.get(`${fromId}->${toId}`);
    if (ov) return ov;
    const a = this.placesById.get(fromId);
    const b = this.placesById.get(toId);
    if (!a || !b) {
      return { minutes: 0, mode: "walk", source: "heuristic", explanation: "no travel data (place missing from trip)" };
    }
    // Precedence: override > api > heuristic (api is guarded — see resolveApiOrHeuristic).
    const i = this.indexOf.get(fromId);
    const j = this.indexOf.get(toId);
    const api = i === undefined || j === undefined ? undefined : this.apiDurations?.[i]?.[j];
    return resolveApiOrHeuristic(a, b, api, this.apiProfile, this.settings, carAvailable);
  }

  get(fromId: string, toId: string): MatrixEntry {
    const i = this.indexOf.get(fromId);
    const j = this.indexOf.get(toId);
    if (i === undefined || j === undefined) {
      // Degenerate node (unknown base): charge nothing but keep the solve going.
      return { minutes: 0, mode: "walk", source: "heuristic", explanation: "no travel data (place missing from trip)" };
    }
    return this.entries[i]![j]!;
  }

  minutes(fromId: string, toId: string): number {
    return this.get(fromId, toId).minutes;
  }

  getForDay(fromId: string, toId: string, dayIdx?: number): MatrixEntry {
    if (!this.hasCar(dayIdx)) {
      return this.get(fromId, toId);
    }
    const i = this.indexOf.get(fromId);
    const j = this.indexOf.get(toId);
    if (i === undefined || j === undefined) {
      return { minutes: 0, mode: "walk", source: "heuristic", explanation: "no travel data (place missing from trip)" };
    }
    return this.ensureCarEntries()[i]![j]!;
  }

  minutesForDay(fromId: string, toId: string, dayIdx?: number): number {
    return this.getForDay(fromId, toId, dayIdx).minutes;
  }

  /** Recompute one node's row and column (e.g. place moved). */
  updateNode(nodeId: string): void {
    const idx = this.indexOf.get(nodeId);
    if (idx === undefined) return;
    for (let k = 0; k < this.nodes.length; k++) {
      this.entries[idx]![k] = this.entryFor(this.nodes[idx]!, this.nodes[k]!, this.settings.carOnly);
      this.entries[k]![idx] = this.entryFor(this.nodes[k]!, this.nodes[idx]!, this.settings.carOnly);
      if (this.carEntries && this.carEntries !== this.entries) {
        this.carEntries[idx]![k] = this.entryFor(this.nodes[idx]!, this.nodes[k]!, true);
        this.carEntries[k]![idx] = this.entryFor(this.nodes[k]!, this.nodes[idx]!, true);
      }
    }
  }
}

/** All node ids referenced by a day (bases and fixed start/end locations). */
export function dayNodeIds(day: Day): string[] {
  const ids: string[] = [day.baseStartId, day.baseEndId];
  if (day.startLocation !== "base") ids.push(day.startLocation);
  if (day.endLocation !== "base") ids.push(day.endLocation);
  return ids;
}

export interface Problem {
  trip: Trip;
  settings: TripSettings;
  places: Place[]; // schedulable (non-base) places
  placesById: Map<string, Place>;
  dayList: Day[];
  baseIdSet: Set<string>;
  matrix: TravelMatrix;
  weights: Required<NonNullable<TripSettings["weights"]>>;
  stayGroups: number[][]; // indices of dayList belonging to each stay
  /**
   * `Place.region` -> set of geographically adjacent regions (centroid
   * distance within `clusterFirst`'s adjacency threshold — see
   * `cluster.ts`'s `clusterPlaces`/`DEFAULT_ADJACENCY_THRESHOLD_KM`).
   * Populated for every solve (regardless of `solverStrategy`) from the same
   * `Place.region` groupings `clusterFirst` construction uses, so
   * `alns.ts`'s `regionCompatible` can allow adjacent regions to share a
   * day without a hard region-name match. Unused (never consulted) when
   * `solverStrategy` is `routeFirst`, where region stays inert.
   */
  regionAdjacency: Map<string, Set<string>>;
  /**
   * Per-day car availability (index-aligned with `dayList`), derived from
   * `Trip.carRentals` date ranges clipped to the trip's actual days (or
   * `true` on every day when `settings.carOnly`). See design.md decision 4
   * in the `mixed-commute-car-rental` change.
   */
  carByDay: boolean[];
  /** Fast-path flag: true when any day in `carByDay` is true. */
  hasAnyCar: boolean;
}

/**
 * Node ids + coordinates in the exact order `buildProblem` indexes its matrix
 * (places first, then any base/day-location ids that are not places). Returns
 * `null` when any matrix node lacks finite coordinates — callers must skip the
 * API matrix in that case, since indices could not be aligned.
 */
export function apiMatrixCoords(trip: Trip): { id: string; lat: number; lng: number }[] | null {
  const placesById = new Map(trip.places.map((p) => [p.id, p]));
  const baseIdSet = new Set<string>();
  for (const d of trip.days) for (const id of dayNodeIds(d)) baseIdSet.add(id);
  const nodes: string[] = [];
  for (const p of trip.places) nodes.push(p.id);
  for (const id of baseIdSet) if (!placesById.has(id)) nodes.push(id);
  const coords: { id: string; lat: number; lng: number }[] = [];
  for (const id of nodes) {
    const p = placesById.get(id);
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
    coords.push({ id, lat: p.lat, lng: p.lng });
  }
  return coords;
}

/**
 * Derive stay-segment groupings from a trip's days: consecutive day indices
 * are grouped together until a new stay begins, signalled either by an
 * explicit `day.stayStart` flag or by `day.baseEndId` changing from the
 * previous day's. Extracted from `buildProblem`'s original inline loop (see
 * design.md decision 3 in the `add-hotel-area-recommendation` change) so
 * `packages/solver/src/hotelArea.ts` can derive the exact same segment
 * boundaries `apps/web/src/stays.ts`'s `staysFor` already reads from the same
 * two fields, without duplicating this logic. Behavior-preserving: produces
 * identical output to the loop it replaced.
 */
export function staySegments(days: Day[]): number[][] {
  const stayGroups: number[][] = [];
  let currentGroup: number[] = [];
  let lastBaseEndId: string | null = null;
  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    const isNewStay = day.stayStart || (lastBaseEndId !== null && day.baseEndId !== lastBaseEndId);
    if (isNewStay && currentGroup.length > 0) {
      stayGroups.push(currentGroup);
      currentGroup = [];
    }
    currentGroup.push(i);
    lastBaseEndId = day.baseEndId;
  }
  if (currentGroup.length > 0) {
    stayGroups.push(currentGroup);
  }
  return stayGroups;
}

export function buildProblem(
  trip: Trip,
  apiDurations?: number[][],
  apiProfile: string = DEFAULT_OSRM_PROFILE,
): Problem {
  const settings = trip.settings;
  const baseIdSet = new Set<string>();
  for (const d of trip.days) for (const id of dayNodeIds(d)) baseIdSet.add(id);

  const placesById = new Map(trip.places.map((p) => [p.id, p]));
  const nodes: string[] = [];
  for (const p of trip.places) nodes.push(p.id);
  for (const id of baseIdSet) if (!placesById.has(id)) nodes.push(id); // tolerate unknown bases

  const overrides = new Map<string, MatrixEntry>();
  for (const o of (trip.travelOverrides || [])) {
    const entry: MatrixEntry = {
      minutes: o.minutes,
      mode: o.mode ?? "transit",
      source: "override",
      explanation: "user override",
    };
    overrides.set(`${o.fromId}->${o.toId}`, entry);
    if (o.symmetric) overrides.set(`${o.toId}->${o.fromId}`, entry);
  }

  const entries: MatrixEntry[][] = nodes.map((from, i) =>
    nodes.map((to, j) => {
      const ov = overrides.get(`${from}->${to}`);
      if (ov) return ov;
      const a = placesById.get(from);
      const b = placesById.get(to);
      if (!a || !b) {
        return { minutes: 0, mode: "walk" as Mode, source: "heuristic" as LegSource, explanation: "no travel data (place missing from trip)" };
      }
      // Precedence: override > api > heuristic (api is guarded — see
      // resolveApiOrHeuristic). apiDurations[i][j] follows the problem node
      // order (places first, then non-place base ids).
      const api = apiDurations?.[i]?.[j];
      return resolveApiOrHeuristic(a, b, api, apiProfile, settings);
    }),
  );

  const weights = {
    travel: settings.weights?.travel ?? 1,
    wait: settings.weights?.wait ?? 0.5,
    mustDropped: settings.weights?.mustDropped ?? 1000,
    niceDropped: settings.weights?.niceDropped ?? 10,
    dayImbalance: settings.weights?.dayImbalance ?? 1,
    overBudget: settings.weights?.overBudget ?? 3,
  };

  // Hotels are sleep bases, not visitable stops: a hotel that is not (yet)
  // referenced by any day's base/start/end location must still never be
  // scheduled into the itinerary as a stop.
  const schedulable = trip.places.filter((p) => !baseIdSet.has(p.id) && p.category !== "hotel");

  const stayGroups: number[][] = staySegments(trip.days);
  const clusters = clusterPlaces(schedulable);
  const regionAdjacency = buildAdjacencyMapping(clusters);

  // Per-day car availability: a day is a car day when any rental's date
  // range (inclusive of both endpoints) covers the day's date, or when the
  // whole trip is `carOnly`. YYYY-MM-DD strings compare lexicographically.
  // Out-of-range rentals (trip dates shrunk later) are stored as-is —
  // availability is simply derived over the existing trip days.
  const carByDay: boolean[] = trip.days.map((day) => {
    if (settings.carOnly) return true;
    return (trip.carRentals ?? []).some((r) => r.startDate <= day.date && day.date <= r.endDate);
  });
  const hasAnyCar = settings.carOnly || carByDay.some(Boolean);

  return {
    trip,
    settings,
    places: schedulable,
    placesById,
    dayList: trip.days,
    baseIdSet,
    matrix: new TravelMatrix(nodes, entries, overrides, placesById, settings, apiDurations, apiProfile, carByDay),
    weights,
    stayGroups,
    regionAdjacency,
    carByDay,
    hasAnyCar,
  };
}

/**
 * Cheap, static, shape-only guess at why a place couldn't be inserted: does
 * NOT probe any actual day/window feasibility, so it cannot distinguish "no
 * day had time" from "the window genuinely blocks every otherwise-viable
 * day" — a place with any opening-hours/appointment data at all is always
 * reported `window_conflict` here, even when the real cause was that no day
 * had room.
 *
 * This is intentionally kept cheap for the two call sites that only need a
 * throwaway, single-place-in-isolation label and never surface it to a
 * user: `sequenceDay`'s per-day `dropped` tracking (discarded by every
 * caller once the place is re-pooled — see `solve.ts`) and `poolReason`'s
 * standalone convenience wrapper. It also predates the opening-hours
 * weekly-pattern rework and only reads the legacy `place.openingHours` map
 * directly, so it now misses places constrained solely by
 * `openingHoursWeekly` — acceptable here because nothing downstream trusts
 * this value.
 *
 * The reason that actually reaches the user (`Itinerary.unscheduled`, built
 * by `finalize` in solve.ts) is decided by `explain.ts`'s
 * `classifyUnscheduled` instead, which runs a real per-day probe via
 * `windowsForDate` and is cheap enough to afford because it only ever runs
 * once per place left in the final pool.
 */
export function reasonFor(p: Place): UnscheduledReason {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return "unreachable";
  if (p.appointment) return "window_conflict";
  // A place with opening windows that could not be inserted did not fit any
  // window (or displaced the day's budget) — report the window conflict.
  if (p.openingHours && Object.values(p.openingHours).some((ws) => ws.length > 0)) {
    return "window_conflict";
  }
  return "no_time";
}

export const MINUTES_IN_DAY = (day: Day): { start: number; end: number } => ({
  start: parseHHMM(day.start),
  end: parseHHMM(day.end),
});

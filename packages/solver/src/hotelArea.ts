import { type Place, type Trip, type TripSettings, type Itinerary } from "@app/domain";
import { haversineKm } from "@app/geo";
import { heuristicEntry } from "./matrix";
import { staySegments } from "./matrix";
import { kMeans } from "./kmeans";
import { solve } from "./solve";

/**
 * One recommended hotel-search-area candidate within a stay segment: a
 * center + radius + plain-language label/rationale, never a fabricated
 * hotel listing. See `add-hotel-area-recommendation`'s design.md decisions
 * 5-9 for the derivation of each field.
 */
export interface HotelAreaCandidate {
  lat: number;
  lng: number;
  /** Weighted RMS haversine distance (km) from this center to the segment's
   *  places, floored at 0.3 km — see design.md decision 8. */
  radiusKm: number;
  /** `"Near <name>"`, naming the closest actual segment place — never a
   *  fabricated neighbourhood name. */
  label: string;
  /** Plain-language explanation (place count, priority mix, average one-way
   *  minutes), in the style of `explain.ts`. */
  rationale: string;
  /** Weighted average one-way `heuristicEntry` minutes from this candidate
   *  to every place in the whole segment (design.md decision 6). */
  avgOneWayMin: number;
}

/** One stay segment's recommendation: which days it covers and its ranked
 *  candidate area(s). `candidates` is empty (with `note` set) only when the
 *  segment has no place with a usable location yet. */
export interface HotelAreaSegment {
  /** Indices into `trip.days` belonging to this segment, in order. */
  dayIndices: number[];
  /** Ranked (ascending cost) candidate areas, best first. At most 3. */
  candidates: HotelAreaCandidate[];
  /** Set only when `candidates` is empty, explaining why. */
  note?: string;
}

/**
 * Each place's influence on the recommendation: a 3:2:1 multiplier for
 * priority (1 = must, mirroring the solver's own must/want/nice ordering)
 * times dwell time floored at 15 minutes (a place is never zero-weight, and
 * a longer planned visit pulls somewhat harder too). See design.md decision
 * 2 for the full rationale.
 */
export function weightForPlace(place: Place): number {
  return (4 - place.priority) * Math.max(place.dwellMin, 15);
}

interface WeightedPoint {
  lat: number;
  lng: number;
  weight: number;
}

/**
 * Weighted geometric median (weighted Fermat-Weber point) of `points` over
 * great-circle distance, solved via Weiszfeld's algorithm: seeded at the
 * weighted arithmetic mean, then iteratively reweighted by inverse distance
 * to the current estimate until convergence or a fixed iteration cap. See
 * design.md decision 5 for why plain distance (not the full `heuristicEntry`
 * curve) is used for this search step.
 *
 * Degenerate-safe: 0 points returns `{lat: 0, lng: 0}` (callers must not
 * rely on this — always guard on an empty segment before calling); 1 point
 * returns that point exactly; coincident points converge immediately
 * without dividing by zero (a small epsilon floors the distance used as a
 * weight denominator).
 */
export function weightedGeometricMedian(points: WeightedPoint[]): { lat: number; lng: number } {
  if (points.length === 0) return { lat: 0, lng: 0 };
  if (points.length === 1) return { lat: points[0]!.lat, lng: points[0]!.lng };

  const totalWeight = points.reduce((sum, p) => sum + p.weight, 0);
  if (!(totalWeight > 0)) {
    // No usable weight signal (e.g. every weight is 0 or negative) — fall
    // back to the plain arithmetic mean rather than dividing by zero.
    let lat = 0;
    let lng = 0;
    for (const p of points) {
      lat += p.lat;
      lng += p.lng;
    }
    return { lat: lat / points.length, lng: lng / points.length };
  }

  let lat = points.reduce((sum, p) => sum + p.lat * p.weight, 0) / totalWeight;
  let lng = points.reduce((sum, p) => sum + p.lng * p.weight, 0) / totalWeight;

  const DIST_EPS_KM = 1e-9;
  const CONVERGE_EPS_DEG = 1e-6;
  const MAX_ITERATIONS = 50;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let weightSum = 0;
    let latSum = 0;
    let lngSum = 0;
    for (const p of points) {
      const d = Math.max(haversineKm(lat, lng, p.lat, p.lng), DIST_EPS_KM);
      const w = p.weight / d;
      weightSum += w;
      latSum += p.lat * w;
      lngSum += p.lng * w;
    }
    if (!(weightSum > 0)) break;
    const nextLat = latSum / weightSum;
    const nextLng = lngSum / weightSum;
    const moved = Math.abs(nextLat - lat) + Math.abs(nextLng - lng);
    lat = nextLat;
    lng = nextLng;
    if (moved < CONVERGE_EPS_DEG) break;
  }

  return { lat, lng };
}

/** A place is eligible for hotel-area consideration when it is not itself a
 *  hotel/base and has a usable (finite) coordinate. */
function isEligiblePlace(p: Place): boolean {
  return p.category !== "hotel" && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

/**
 * Assign each eligible (non-hotel, finite-coordinate) place in `trip` to one
 * of `segments`' day-index groups. Two signals, in order (design.md decision
 * 4):
 *
 * 1. A place naming a concrete day via `appointment.dayId`/`forceDayId`
 *    resolves to that day's segment directly.
 * 2. Everything else is split geographically via capacity-constrained
 *    `kMeans` (skipped — single group — when there is only one segment),
 *    with resulting clusters matched to segments by greedy
 *    nearest-centroid-to-segment-anchor (the segment's first day's
 *    `baseStartId` place).
 *
 * Returns one array of places per entry of `segments`, same order/length.
 */
function assignPlacesToSegments(trip: Trip, segments: number[][]): Place[][] {
  const numSegments = segments.length;
  const result: Place[][] = segments.map(() => []);
  if (numSegments === 0) return result;

  const segmentOfDayId = new Map<string, number>();
  segments.forEach((dayIdxs, segIdx) => {
    for (const i of dayIdxs) {
      const d = trip.days[i];
      if (d) segmentOfDayId.set(d.id, segIdx);
    }
  });

  const eligible = trip.places.filter(isEligiblePlace);
  const remaining: Place[] = [];

  for (const p of eligible) {
    const namedDayId = p.appointment?.dayId ?? p.forceDayId;
    const seg = namedDayId !== undefined ? segmentOfDayId.get(namedDayId) : undefined;
    if (seg !== undefined) {
      result[seg]!.push(p);
    } else {
      remaining.push(p);
    }
  }

  if (remaining.length === 0) return result;

  if (numSegments === 1) {
    result[0]!.push(...remaining);
    return result;
  }

  const capacity = Math.ceil((remaining.length / numSegments) * 1.5);
  const assignments = kMeans(remaining, numSegments, { capacity });

  // Centroid of each resulting cluster (some may be empty).
  const clusterAcc = Array.from({ length: numSegments }, () => ({ lat: 0, lng: 0, count: 0 }));
  for (let i = 0; i < remaining.length; i++) {
    const c = assignments[i]!;
    const acc = clusterAcc[c]!;
    acc.lat += remaining[i]!.lat;
    acc.lng += remaining[i]!.lng;
    acc.count++;
  }

  const placesById = new Map(trip.places.map((p) => [p.id, p]));
  const anchors: ({ lat: number; lng: number } | null)[] = segments.map((dayIdxs) => {
    const firstDay = trip.days[dayIdxs[0]!];
    if (!firstDay) return null;
    const anchorPlace = placesById.get(firstDay.baseStartId);
    if (anchorPlace && Number.isFinite(anchorPlace.lat) && Number.isFinite(anchorPlace.lng)) {
      return { lat: anchorPlace.lat, lng: anchorPlace.lng };
    }
    return null;
  });

  // Greedy nearest-centroid-to-segment-anchor matching: cheapest (cluster,
  // segment) pair claimed first, each side used at most once. `numSegments`
  // is always small (almost always 1, rarely 2-3), so this is exact enough.
  const pairs: { clusterIdx: number; segIdx: number; dist: number }[] = [];
  for (let c = 0; c < numSegments; c++) {
    if (clusterAcc[c]!.count === 0) continue;
    const centroid = { lat: clusterAcc[c]!.lat / clusterAcc[c]!.count, lng: clusterAcc[c]!.lng / clusterAcc[c]!.count };
    for (let s = 0; s < numSegments; s++) {
      const anchor = anchors[s];
      const dist = anchor ? haversineKm(centroid.lat, centroid.lng, anchor.lat, anchor.lng) : Number.POSITIVE_INFINITY;
      pairs.push({ clusterIdx: c, segIdx: s, dist });
    }
  }
  pairs.sort((a, b) => a.dist - b.dist || a.clusterIdx - b.clusterIdx || a.segIdx - b.segIdx);

  const clusterToSeg = new Map<number, number>();
  const segUsed = new Set<number>();
  for (const pair of pairs) {
    if (clusterToSeg.has(pair.clusterIdx) || segUsed.has(pair.segIdx)) continue;
    clusterToSeg.set(pair.clusterIdx, pair.segIdx);
    segUsed.add(pair.segIdx);
  }

  for (let i = 0; i < remaining.length; i++) {
    const c = assignments[i]!;
    const seg = clusterToSeg.get(c) ?? 0; // defensive fallback; should always be mapped
    result[seg]!.push(remaining[i]!);
  }

  return result;
}

/** Minimal synthetic Place-shaped object standing in for a candidate
 *  location, so the real `heuristicEntry` curve can be reused unmodified. */
function candidatePlace(lat: number, lng: number): Place {
  return { id: "candidate", name: "", lat, lng, category: "other", dwellMin: 0, priority: 3 };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * Weighted average one-way `heuristicEntry` minutes from a candidate
 * location to every place in `segmentPlaces` — always scored against the
 * whole segment, not just a sub-cluster, per design.md decision 6.
 */
function candidateCostMin(lat: number, lng: number, segmentPlaces: Place[], settings: TripSettings): number {
  if (segmentPlaces.length === 0) return 0;
  const from = candidatePlace(lat, lng);
  let totalWeight = 0;
  let weightedMinutes = 0;
  for (const p of segmentPlaces) {
    const w = weightForPlace(p);
    const minutes = heuristicEntry(from, p, settings).minutes;
    totalWeight += w;
    weightedMinutes += w * minutes;
  }
  if (!(totalWeight > 0)) {
    let sum = 0;
    for (const p of segmentPlaces) sum += heuristicEntry(from, p, settings).minutes;
    return sum / segmentPlaces.length;
  }
  return weightedMinutes / totalWeight;
}

/** Weighted RMS haversine distance (km) from a candidate to `segmentPlaces`,
 *  floored at 0.3 km so a single/tight cluster still reads as a real area
 *  rather than a meaningless zero (design.md decision 8). */
function candidateRadiusKm(lat: number, lng: number, segmentPlaces: Place[]): number {
  const FLOOR_KM = 0.3;
  if (segmentPlaces.length === 0) return FLOOR_KM;
  let totalWeight = 0;
  let weightedSqSum = 0;
  for (const p of segmentPlaces) {
    const w = weightForPlace(p);
    const d = haversineKm(lat, lng, p.lat, p.lng);
    totalWeight += w;
    weightedSqSum += w * d * d;
  }
  const rms = totalWeight > 0 ? Math.sqrt(weightedSqSum / totalWeight) : 0;
  return Math.max(rms, FLOOR_KM);
}

/** `"Near <name>"` using the closest actual segment place to the candidate,
 *  with a deterministic tie-break (closest distance, then lowest place id) —
 *  design.md decision 8. */
function labelFor(lat: number, lng: number, segmentPlaces: Place[]): string {
  let best: Place | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const p of segmentPlaces) {
    const d = haversineKm(lat, lng, p.lat, p.lng);
    if (best === null || d < bestDist || (d === bestDist && p.id < best.id)) {
      best = p;
      bestDist = d;
    }
  }
  return best ? `Near ${best.name}` : "Unnamed area";
}

/** Plain-language rationale for one candidate — place count, priority mix,
 *  average one-way minutes — in the style of `explain.ts`. */
function buildRationale(segmentPlaces: Place[], avgOneWayMin: number): string {
  const n = segmentPlaces.length;
  const mustCount = segmentPlaces.filter((p) => p.priority === 1).length;
  const wantCount = segmentPlaces.filter((p) => p.priority === 2).length;
  const niceCount = segmentPlaces.filter((p) => p.priority === 3).length;
  const mixParts: string[] = [];
  if (mustCount > 0) mixParts.push(`${mustCount} must-see`);
  if (wantCount > 0) mixParts.push(`${wantCount} want-to-see`);
  if (niceCount > 0) mixParts.push(`${niceCount} nice-to-have`);
  const mix = mixParts.length > 0 ? ` (${mixParts.join(", ")})` : "";
  return `Based on ${n} place${n === 1 ? "" : "s"}${mix}, averaging ~${Math.round(avgOneWayMin)} min one-way from here.`;
}

const DEDUP_KM = 0.05;
const MIN_COMPETITIVE_MARGIN_MIN = 10;
const COMPETITIVE_FRACTION = 0.35;
const MAX_CANDIDATES = 3;

/**
 * Generate up to `MAX_CANDIDATES` ranked candidate areas for one segment's
 * places (design.md decision 7): the primary is the segment-wide weighted
 * geometric median; alternatives are the weighted geometric median of each
 * non-empty cluster from an unweighted `kMeans(segmentPlaces, 2)` split.
 * Candidates within `DEDUP_KM` of each other collapse to one. All are
 * scored against the whole segment (decision 6), sorted ascending by cost;
 * the best is always kept, others only when within
 * `max(MIN_COMPETITIVE_MARGIN_MIN, COMPETITIVE_FRACTION * best cost)` of it.
 */
function generateCandidates(segmentPlaces: Place[], settings: TripSettings): HotelAreaCandidate[] {
  if (segmentPlaces.length === 0) return [];

  const rawCenters: { lat: number; lng: number }[] = [];

  const primary = weightedGeometricMedian(
    segmentPlaces.map((p) => ({ lat: p.lat, lng: p.lng, weight: weightForPlace(p) })),
  );
  rawCenters.push(primary);

  if (segmentPlaces.length > 1) {
    const assignments = kMeans(segmentPlaces, 2);
    const clusters: Place[][] = [[], []];
    for (let i = 0; i < segmentPlaces.length; i++) {
      clusters[assignments[i]!]!.push(segmentPlaces[i]!);
    }
    for (const cluster of clusters) {
      if (cluster.length === 0) continue;
      rawCenters.push(
        weightedGeometricMedian(cluster.map((p) => ({ lat: p.lat, lng: p.lng, weight: weightForPlace(p) }))),
      );
    }
  }

  const deduped: { lat: number; lng: number }[] = [];
  for (const c of rawCenters) {
    if (!deduped.some((d) => haversineKm(d.lat, d.lng, c.lat, c.lng) < DEDUP_KM)) {
      deduped.push(c);
    }
  }

  const scored = deduped
    .map((c) => ({ lat: c.lat, lng: c.lng, cost: candidateCostMin(c.lat, c.lng, segmentPlaces, settings) }))
    .sort((a, b) => a.cost - b.cost);

  const best = scored[0]!;
  const margin = Math.max(MIN_COMPETITIVE_MARGIN_MIN, best.cost * COMPETITIVE_FRACTION);
  const kept = scored.filter((c, i) => i === 0 || c.cost - best.cost <= margin).slice(0, MAX_CANDIDATES);

  return kept.map((c) => ({
    lat: c.lat,
    lng: c.lng,
    radiusKm: round1(candidateRadiusKm(c.lat, c.lng, segmentPlaces)),
    label: labelFor(c.lat, c.lng, segmentPlaces),
    avgOneWayMin: round1(c.cost),
    rationale: buildRationale(segmentPlaces, c.cost),
  }));
}

/**
 * Compute one hotel-search-area recommendation per stay segment of `trip`,
 * using only places and day/stay structure — no solved itinerary required
 * (see `add-hotel-area-recommendation`'s spec.md). Never throws: a trip with
 * no days returns `[]`; a segment with no eligible (non-hotel, finite-
 * coordinate) places returns that segment with `candidates: []` and a
 * `note`.
 */
export function recommendHotelAreas(trip: Trip): HotelAreaSegment[] {
  const days = trip.days ?? [];
  if (days.length === 0) return [];

  const segments = staySegments(days);
  if (segments.length === 0) return [];

  const placesBySegment = assignPlacesToSegments(trip, segments);

  return segments.map((dayIndices, i) => {
    const segmentPlaces = placesBySegment[i] ?? [];
    if (segmentPlaces.length === 0) {
      return {
        dayIndices,
        candidates: [],
        note: "Not enough places with a set location yet.",
      };
    }
    return {
      dayIndices,
      candidates: generateCandidates(segmentPlaces, trip.settings),
    };
  });
}

// ---------------------------------------------------------------------------
// Coarse Clustering (Scale B) & Proactive Base Discovery
// ---------------------------------------------------------------------------

export const DEFAULT_COARSE_THRESHOLD_KM = 25;
export const MIN_TRANSIT_SAVINGS_MIN = 45;
export const MIN_BASE_SEPARATION_MIN = 45;
export const MIN_RESCUED_PLACES = 1;
/** One-way commute minutes from the nearest active base above which a place
 *  counts as "strained" (commute-relief discovery trigger — see design.md
 *  Decision 1 of `route-aware-base-suggestions`). */
export const DEFAULT_COMMUTE_STRAIN_MIN = 45;
/** How much total travel time a candidate base may inflate before the
 *  permissive acceptance gate rejects it (design.md Decision 4). */
export const DEFAULT_MAX_TRAVEL_REGRESSION_MIN = 60;

export interface CoarseCluster {
  id: string;
  places: Place[];
  center: { lat: number; lng: number };
  radiusKm: number;
  label: string;
}

export interface SpeculativeStay {
  hotelId: string;
  checkInDayIdx: number;
  nights: number;
}

export interface SuggestedBase {
  id: string;
  clusterId: string;
  label: string;
  center: { lat: number; lng: number };
  radiusKm: number;
  candidateHotel: Place;
  suggestedStays: SpeculativeStay[];
  suggestedNights: number;
  baselineTravelMin: number;
  candidateTravelMin: number;
  savingsMin: number;
  rationale: string;
  kind: "transit-saver" | "capacity-expander";
  rescuedCount: number;
}

export interface EvaluateBasesOptions {
  seed?: number;
  budgetMs?: number;
  maxCandidates?: number;
  /** Explicit savings threshold. When provided, candidate must achieve at
   *  least this many minutes savings (e.g. for testing threshold suppression). */
  minSavingsMin?: number;
  /** How many minutes the candidate may inflate total travel time and still
   *  surface (design.md Decision 4). Defaults to
   *  `DEFAULT_MAX_TRAVEL_REGRESSION_MIN` (60). */
  maxTravelRegressionMin?: number;
  signal?: { aborted: boolean };
}

/**
 * Union-find coarse clustering over eligible places at `thresholdKm` haversine.
 * Returns non-empty clusters with priority-weighted Fermat-Weber centers.
 */
export function coarseClusterPlaces(
  places: Place[],
  thresholdKm = DEFAULT_COARSE_THRESHOLD_KM,
): CoarseCluster[] {
  const eligible = places.filter(isEligiblePlace);
  if (eligible.length === 0) return [];

  const n = eligible.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i: number): number {
    let root = i;
    while (root !== parent[root]) root = parent[root]!;
    let curr = i;
    while (curr !== root) {
      const nxt = parent[curr]!;
      parent[curr] = root;
      curr = nxt;
    }
    return root;
  }
  function union(i: number, j: number) {
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[ri] = rj;
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (haversineKm(eligible[i]!.lat, eligible[i]!.lng, eligible[j]!.lat, eligible[j]!.lng) <= thresholdKm) {
        union(i, j);
      }
    }
  }

  const clusterMap = new Map<number, Place[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    let list = clusterMap.get(root);
    if (!list) {
      list = [];
      clusterMap.set(root, list);
    }
    list.push(eligible[i]!);
  }

  const clusters: CoarseCluster[] = [];
  let clusterIndex = 0;
  for (const clusterPlaces of clusterMap.values()) {
    const center = weightedGeometricMedian(
      clusterPlaces.map((p) => ({ lat: p.lat, lng: p.lng, weight: weightForPlace(p) })),
    );
    const radiusKm = round1(candidateRadiusKm(center.lat, center.lng, clusterPlaces));
    const label = labelFor(center.lat, center.lng, clusterPlaces);
    clusters.push({
      id: `cluster-${clusterIndex++}`,
      places: clusterPlaces,
      center,
      radiusKm,
      label,
    });
  }

  return clusters;
}

/**
 * Workload estimate in minutes for a cluster: sum of place dwell times plus
 * internal transit estimate across the sequence.
 */
export function estimateClusterWorkloadMin(cluster: CoarseCluster, settings: TripSettings): number {
  const dwellTotal = cluster.places.reduce((sum, p) => sum + p.dwellMin, 0);
  if (cluster.places.length <= 1) return dwellTotal;
  let travelTotal = 0;
  for (let i = 0; i < cluster.places.length - 1; i++) {
    travelTotal += heuristicEntry(cluster.places[i]!, cluster.places[i + 1]!, settings).minutes;
  }
  return Math.round(dwellTotal + travelTotal);
}

/**
 * Workload in minutes of the places assigned to one base: sum of dwell times
 * plus a greedy nearest-neighbor tour connecting them (intra-cluster transit
 * estimate — design.md Decision 2 of `route-aware-base-suggestions`).
 */
function assignedWorkloadMin(assigned: Place[], settings: TripSettings): number {
  const dwell = assigned.reduce((sum, p) => sum + p.dwellMin, 0);
  if (assigned.length <= 1) return dwell;
  const remaining = [...assigned];
  const tour: Place[] = [remaining.shift()!];
  let transit = 0;
  while (remaining.length > 0) {
    const last = tour[tour.length - 1]!;
    let bestIdx = 0;
    let bestMin = Number.POSITIVE_INFINITY;
    remaining.forEach((p, i) => {
      const m = heuristicEntry(last, p, settings).minutes;
      if (m < bestMin) {
        bestMin = m;
        bestIdx = i;
      }
    });
    transit += bestMin;
    tour.push(remaining.splice(bestIdx, 1)[0]!);
  }
  return dwell + transit;
}

/**
 * Distribute `totalNights` among `bases` proportionally to each base's local
 * workload (dwell + intra-cluster transit of the places nearest to it), using
 * largest-remainder rounding so the nights sum exactly to `totalNights` and
 * every base keeps at least one night (design.md Decision 2). Returns a map
 * of base id -> nights.
 */
export function calculateWorkloadNights(
  bases: Place[],
  places: Place[],
  totalNights: number,
  settings: TripSettings,
): Map<string, number> {
  const result = new Map<string, number>();
  if (bases.length === 0 || totalNights <= 0) return result;

  const assigned: Place[][] = bases.map(() => []);
  for (const p of places) {
    if (!isEligiblePlace(p)) continue;
    let bestIdx = 0;
    let bestMin = Number.POSITIVE_INFINITY;
    bases.forEach((b, i) => {
      const m = heuristicEntry(p, b, settings).minutes;
      if (m < bestMin) {
        bestMin = m;
        bestIdx = i;
      }
    });
    assigned[bestIdx]!.push(p);
  }

  const workload = assigned.map((a) => assignedWorkloadMin(a, settings));
  const totalWorkload = workload.reduce((sum, w) => sum + w, 0);

  // Reserve the mandatory 1 night per base, distribute the rest proportionally.
  const nights = bases.map(() => 1);
  let toDistribute = totalNights - bases.length;
  if (toDistribute < 0) toDistribute = 0;

  const shares =
    totalWorkload > 0
      ? workload.map((w) => (w / totalWorkload) * toDistribute)
      : bases.map(() => toDistribute / bases.length);
  shares.forEach((share, i) => {
    const floor = Math.floor(share);
    nights[i]! += floor;
    toDistribute -= floor;
  });

  // Largest-remainder pass: hand out the leftover nights by fractional share.
  const byFraction = shares
    .map((s, i) => ({ i, frac: s - Math.floor(s) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < toDistribute; k++) {
    nights[byFraction[k % byFraction.length]!.i]! += 1;
  }

  bases.forEach((b, i) => result.set(b.id, nights[i]!));
  return result;
}

/**
 * Re-sequence bases to minimize base-to-base travel jumps (design.md
 * Decision 3): nearest-neighbor initial tour improved by 2-opt, treated as an
 * open path pinned to the trip's initial base (`initialBaseId`, which stays
 * first so day 1 still starts where the user started). Falls back to the
 * first base when `initialBaseId` is not among `bases`.
 */
export function orderBasesByRoute(
  bases: Place[],
  initialBaseId: string,
  settings: TripSettings,
): Place[] {
  if (bases.length <= 1) return [...bases];
  const startIdx = bases.findIndex((b) => b.id === initialBaseId);
  const start = startIdx >= 0 ? bases[startIdx]! : bases[0]!;
  const remaining = bases.filter((b) => b.id !== start.id);
  if (remaining.length === 0) return [start];

  // Nearest-neighbor initial tour.
  const tour: Place[] = [start];
  const pool = [...remaining];
  while (pool.length > 0) {
    const last = tour[tour.length - 1]!;
    let bestIdx = 0;
    let bestMin = Number.POSITIVE_INFINITY;
    pool.forEach((p, i) => {
      const m = heuristicEntry(last, p, settings).minutes;
      if (m < bestMin) {
        bestMin = m;
        bestIdx = i;
      }
    });
    tour.push(pool.splice(bestIdx, 1)[0]!);
  }

  // 2-opt improvement over the open path (position 0 stays pinned).
  const pathCost = (t: Place[]): number => {
    let cost = 0;
    for (let i = 0; i < t.length - 1; i++) {
      cost += heuristicEntry(t[i]!, t[i + 1]!, settings).minutes;
    }
    return cost;
  };
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 100) {
    improved = false;
    for (let i = 1; i < tour.length - 1; i++) {
      for (let j = i + 1; j < tour.length; j++) {
        const before = pathCost(tour);
        const candidate = [
          ...tour.slice(0, i),
          ...tour.slice(i, j + 1).reverse(),
          ...tour.slice(j + 1),
        ];
        if (pathCost(candidate) < before - 1e-9) {
          for (let k = 0; k < candidate.length; k++) tour[k] = candidate[k]!;
          improved = true;
        }
      }
    }
  }

  return tour;
}

/**
 * Build the speculative Stay[] for a trip with `candidateHotel` added
 * (design.md Decisions 2-3): the trip's total nights are re-allocated across
 * all bases (existing + candidate) proportionally to workload, and the stays
 * are assigned chronologically in route order (TSP over base coordinates,
 * pinned to the trip's initial base) instead of appending the candidate at
 * the end. Returns null when the trip cannot host another base (fewer than
 * two days, no usable existing base, or no free night for the candidate).
 *
 * Accepts either `(trip, candidateHotel)` or the legacy 5-argument form
 * `(cluster, candidateHotelId, totalDays, existingStays, settings)`.
 */
export function buildSpeculativeStays(
  tripOrCluster: Trip | CoarseCluster,
  candidateHotelOrId: Place | string,
  totalDaysArg?: number,
  existingStaysArg?: SpeculativeStay[],
  settingsArg?: TripSettings,
): SpeculativeStay[] | null {
  const isTrip = "days" in tripOrCluster;

  const totalDays = isTrip ? tripOrCluster.days.length : (totalDaysArg ?? 0);
  const settings = isTrip ? tripOrCluster.settings : settingsArg!;
  const allPlaces = isTrip ? tripOrCluster.places : tripOrCluster.places;

  if (totalDays <= 1) return null;

  let candidateHotel: Place;
  if (typeof candidateHotelOrId === "string") {
    const cluster = tripOrCluster as CoarseCluster;
    candidateHotel = {
      id: candidateHotelOrId,
      name: `Hotel ${cluster.label ?? "Candidate"}`,
      lat: cluster.center.lat,
      lng: cluster.center.lng,
      category: "hotel",
      dwellMin: 0,
      priority: 3,
    };
  } else {
    candidateHotel = candidateHotelOrId;
  }

  let activeBases: Place[];
  let initialBaseId: string;

  if (isTrip) {
    activeBases = getActiveBases(tripOrCluster);
    initialBaseId = tripOrCluster.days[0]?.baseStartId ?? activeBases[0]?.id ?? candidateHotel.id;
  } else {
    const existingStays = existingStaysArg ?? [];
    if (existingStays.length === 0) return null;
    const uniqueIds = Array.from(new Set(existingStays.map((s) => s.hotelId)));
    activeBases = uniqueIds.map((id) => {
      const found = allPlaces.find((p) => p.id === id);
      return (
        found ?? {
          id,
          name: `Hotel ${id}`,
          lat: 0,
          lng: 0,
          category: "hotel",
          dwellMin: 0,
          priority: 3,
        }
      );
    });
    initialBaseId = existingStays[0]?.hotelId ?? activeBases[0]?.id ?? candidateHotel.id;
  }

  if (activeBases.length === 0) return null;
  if (activeBases.length + 1 > totalDays) return null;

  const allBases = [...activeBases, candidateHotel];
  const nightsMap = calculateWorkloadNights(allBases, allPlaces, totalDays, settings);

  const ordered = orderBasesByRoute(allBases, initialBaseId, settings);

  const stays: SpeculativeStay[] = [];
  let cursor = 0;
  for (const base of ordered) {
    const nights = nightsMap.get(base.id) ?? 1;
    stays.push({ hotelId: base.id, checkInDayIdx: cursor, nights });
    cursor += nights;
  }
  return stays;
}

/**
 * Return active base places from trip.days.
 */
function getActiveBases(trip: Trip): Place[] {
  const placesById = new Map(trip.places.map((p) => [p.id, p]));
  const activeBaseIds = new Set<string>();
  for (const d of trip.days) {
    if (d.baseStartId) activeBaseIds.add(d.baseStartId);
    if (d.baseEndId) activeBaseIds.add(d.baseEndId);
  }
  const bases: Place[] = [];
  for (const id of activeBaseIds) {
    const p = placesById.get(id);
    if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
      bases.push(p);
    }
  }
  return bases;
}

/** One-way heuristic travel minutes from `p` to its nearest base in `bases`
 *  (Infinity when `bases` is empty — callers filter first). */
function nearestBaseCommuteMin(p: Place, bases: Place[], settings: TripSettings): number {
  let best = Number.POSITIVE_INFINITY;
  for (const b of bases) {
    const m = heuristicEntry(p, b, settings).minutes;
    if (m < best) best = m;
  }
  return best;
}

/**
 * Commute-relief trigger (design.md Decision 1 of
 * `route-aware-base-suggestions`): every eligible place — scheduled OR
 * unscheduled — whose one-way travel time from its nearest active base is
 * >= `thresholdMin` is "strained": serving it from the current bases forces
 * an unacceptable daily commute, regardless of whether the solver managed
 * to squeeze it into the itinerary.
 *
 * Returns [] when the trip has no usable active base (nothing to relieve).
 */
export function findStrainedPlaces(
  trip: Trip,
  thresholdMin = DEFAULT_COMMUTE_STRAIN_MIN,
): Place[] {
  const bases = getActiveBases(trip);
  if (bases.length === 0) return [];
  return trip.places.filter(
    (p) => isEligiblePlace(p) && nearestBaseCommuteMin(p, bases, trip.settings) >= thresholdMin,
  );
}

/**
 * Commute-relief discovery: cluster the strained places (see
 * `findStrainedPlaces`) coarsely, then pull in nearby eligible places the
 * candidate base would naturally serve (closer to the cluster's center than
 * to their nearest existing base), re-deriving each cluster's center,
 * radius and label over the combined set. Clusters are ranked by severity —
 * workload times excess commute pressure — most severe first, so the worst
 * commuting region becomes the primary candidate region.
 */
export function discoverReliefClusters(
  trip: Trip,
  thresholdKm = DEFAULT_COARSE_THRESHOLD_KM,
  commuteThresholdMin = DEFAULT_COMMUTE_STRAIN_MIN,
): CoarseCluster[] {
  const strained = findStrainedPlaces(trip, commuteThresholdMin);
  if (strained.length === 0) return [];

  const bases = getActiveBases(trip);
  const strainedIds = new Set(strained.map((p) => p.id));
  const pullCandidates = trip.places.filter((p) => isEligiblePlace(p) && !strainedIds.has(p.id));

  const raw = coarseClusterPlaces(strained, thresholdKm);

  const clusters = raw.map((c) => {
    const pulled = pullCandidates.filter((sp) => {
      const nearCluster =
        haversineKm(sp.lat, sp.lng, c.center.lat, c.center.lng) <= thresholdKm ||
        c.places.some((ap) => haversineKm(sp.lat, sp.lng, ap.lat, ap.lng) <= thresholdKm);
      if (!nearCluster) return false;
      if (bases.length === 0) return true;
      const fromCandidate = heuristicEntry(candidatePlace(c.center.lat, c.center.lng), sp, trip.settings).minutes;
      return fromCandidate <= nearestBaseCommuteMin(sp, bases, trip.settings);
    });

    if (pulled.length === 0) return c;

    const combined = [...c.places, ...pulled];
    const center = weightedGeometricMedian(
      combined.map((p) => ({ lat: p.lat, lng: p.lng, weight: weightForPlace(p) })),
    );
    return {
      ...c,
      places: combined,
      center,
      radiusKm: round1(candidateRadiusKm(center.lat, center.lng, combined)),
      label: labelFor(center.lat, center.lng, combined),
    };
  });

  const severity = (c: CoarseCluster): number => {
    const workload = estimateClusterWorkloadMin(c, trip.settings);
    const excess = c.places.reduce(
      (sum, p) => sum + Math.max(0, nearestBaseCommuteMin(p, bases, trip.settings) - commuteThresholdMin),
      0,
    );
    return workload * (excess + 1);
  };

  return clusters.sort((a, b) => severity(b) - severity(a));
}

/**
 * Find coarse clusters that are distinct from all active bases by travel time
 * (one-way travel time >= MIN_BASE_SEPARATION_MIN).
 */
export function findExternalClusters(
  trip: Trip,
  thresholdKm = DEFAULT_COARSE_THRESHOLD_KM,
  minSeparationMin = MIN_BASE_SEPARATION_MIN,
): CoarseCluster[] {
  const clusters = coarseClusterPlaces(trip.places, thresholdKm);
  if (clusters.length === 0) return [];

  const activeBases = getActiveBases(trip);
  if (activeBases.length === 0) return clusters;

  return clusters.filter((c) => {
    const cand = candidatePlace(c.center.lat, c.center.lng);
    return activeBases.every(
      (b) => heuristicEntry(cand, b, trip.settings).minutes >= minSeparationMin,
    );
  });
}

/**
 * Extracts anchor places from baselineItinerary.unscheduled, filtering to
 * reason === "no_time" || reason === "unreachable" (excluding window_conflict).
 */
export function extractAnchorPlaces(trip: Trip, baselineItinerary: Itinerary): Place[] {
  const placesById = new Map(trip.places.map((p) => [p.id, p]));
  const anchors: Place[] = [];
  for (const u of baselineItinerary.unscheduled) {
    if (u.reason === "no_time" || u.reason === "unreachable") {
      const p = placesById.get(u.placeId);
      if (p && isEligiblePlace(p)) {
        anchors.push(p);
      }
    }
  }
  return anchors;
}

/**
 * Anchor & Pull discovery: clusters anchor places from dropped itinerary items,
 * requires at least MIN_RESCUED_PLACES (3), and pulls in nearby scheduled places.
 */
export function discoverAnchorClusters(
  trip: Trip,
  baselineItinerary: Itinerary,
  thresholdKm = DEFAULT_COARSE_THRESHOLD_KM,
): CoarseCluster[] {
  const anchors = extractAnchorPlaces(trip, baselineItinerary);
  if (anchors.length < MIN_RESCUED_PLACES) return [];

  const rawClusters = coarseClusterPlaces(anchors, thresholdKm);
  const qualifying = rawClusters.filter((c) => c.places.length >= MIN_RESCUED_PLACES);
  if (qualifying.length === 0) return [];

  const unscheduledIds = new Set(baselineItinerary.unscheduled.map((u) => u.placeId));
  const scheduledPlaces = trip.places.filter((p) => isEligiblePlace(p) && !unscheduledIds.has(p.id));

  return qualifying.map((c) => {
    const pulled = scheduledPlaces.filter(
      (sp) =>
        haversineKm(sp.lat, sp.lng, c.center.lat, c.center.lng) <= thresholdKm ||
        c.places.some((ap) => haversineKm(sp.lat, sp.lng, ap.lat, ap.lng) <= thresholdKm),
    );
    if (pulled.length === 0) return c;

    const combinedPlaces = [...c.places, ...pulled];
    const center = weightedGeometricMedian(
      combinedPlaces.map((p) => ({ lat: p.lat, lng: p.lng, weight: weightForPlace(p) })),
    );
    const radiusKm = round1(candidateRadiusKm(center.lat, center.lng, combinedPlaces));
    const label = labelFor(center.lat, center.lng, combinedPlaces);
    return {
      ...c,
      places: combinedPlaces,
      center,
      radiusKm,
      label,
    };
  });
}

/**
 * Build a speculative trip with the candidate hotel added and stays updated.
 */
export function createSpeculativeTrip(
  trip: Trip,
  candidateHotel: Place,
  speculativeStays: SpeculativeStay[],
): Trip {
  const nights = new Array<string>(trip.days.length);
  const checkIns = new Set(speculativeStays.map((s) => s.checkInDayIdx));
  for (const s of speculativeStays) {
    for (let k = 0; k < s.nights; k++) nights[s.checkInDayIdx + k] = s.hotelId;
  }
  const nextDays = trip.days.map((d, i) => ({
    ...d,
    baseEndId: nights[i]!,
    baseStartId: i === 0 ? nights[0]! : nights[i - 1]!,
    stayStart: checkIns.has(i) ? true : undefined,
  }));
  return {
    ...trip,
    places: [...trip.places, candidateHotel],
    days: nextDays,
  };
}

function staysForTrip(trip: Trip): SpeculativeStay[] {
  const stays: SpeculativeStay[] = [];
  for (let i = 0; i < trip.days.length; i++) {
    const day = trip.days[i]!;
    const prev = trip.days[i - 1];
    const startsNewStay = i === 0 || day.stayStart === true || prev!.baseEndId !== day.baseEndId;
    if (startsNewStay) stays.push({ hotelId: day.baseEndId, checkInDayIdx: i, nights: 1 });
    else stays[stays.length - 1]!.nights++;
  }
  return stays;
}

/**
 * Evaluate base suggestions via shadow solves over commute-relief clusters
 * (design.md of `route-aware-base-suggestions`): discovery is triggered by
 * strained commutes (scheduled or not), candidate stays are route-ordered and
 * workload-sized, and the acceptance gate is permissive (Decision 4) — a
 * candidate surfaces when it either rescues unscheduled places or does not
 * inflate total travel time beyond `maxTravelRegressionMin`.
 */
export function evaluateBaseSuggestions(
  trip: Trip,
  baselineItinerary: Itinerary,
  options: EvaluateBasesOptions = {},
): SuggestedBase[] {
  const seed = options.seed ?? 42;
  const budgetMs = options.budgetMs ?? 100;
  const maxRegressionMin = options.maxTravelRegressionMin ?? DEFAULT_MAX_TRAVEL_REGRESSION_MIN;
  const maxCandidates = options.maxCandidates ?? 3;

  if (options.signal?.aborted) return [];

  const activeBases = getActiveBases(trip);
  const activeSeparationCheck = (c: CoarseCluster) => {
    if (activeBases.length === 0) return true;
    const cand = candidatePlace(c.center.lat, c.center.lng);
    return activeBases.every(
      (b) => heuristicEntry(cand, b, trip.settings).minutes >= MIN_BASE_SEPARATION_MIN,
    );
  };

  // Commute-relief discovery (design.md Decision 1): replaces the previous
  // haversine-based geography check and the dropped-places-only anchor path —
  // strained places include both scheduled and unscheduled ones.
  const reliefClusters = discoverReliefClusters(trip).filter(activeSeparationCheck);
  const selectedCandidates = reliefClusters.slice(0, maxCandidates);
  const suggestions: SuggestedBase[] = [];

  for (const cluster of selectedCandidates) {
    if (options.signal?.aborted) return [];

    const candidateHotel: Place = {
      id: `hotel_candidate_${cluster.id}`,
      name: `Hotel ${cluster.label}`,
      lat: cluster.center.lat,
      lng: cluster.center.lng,
      category: "hotel",
      dwellMin: 0,
      priority: 3,
      notes: "Located from a hotel-area recommendation.",
    };

    const speculativeStays = buildSpeculativeStays(trip, candidateHotel);
    if (!speculativeStays) continue;

    const candidateStay = speculativeStays.find((s) => s.hotelId === candidateHotel.id);
    const suggestedNights = candidateStay ? candidateStay.nights : 1;

    const specTrip = createSpeculativeTrip(trip, candidateHotel, speculativeStays);
    const candidateItin = solve({ trip: specTrip, seed, budgetMs });

    if (options.signal?.aborted) return [];

    const baselineTravelMin = baselineItinerary.stats.totalTravelMin;
    const candidateTravelMin = candidateItin.stats.totalTravelMin;
    const savingsMin = Math.round(baselineTravelMin - candidateTravelMin);

    const rescuedCount = Math.max(
      0,
      baselineItinerary.unscheduled.length - candidateItin.unscheduled.length,
    );

    // Permissive acceptance gate (design.md Decision 4): either the candidate
    // rescues unscheduled places, or it keeps total travel time within the
    // configured regression allowance — enabling progressive multi-base
    // discovery instead of demanding immediate large savings.
    const rescues = rescuedCount >= MIN_RESCUED_PLACES;
    const withinRegressionAllowance =
      options.minSavingsMin !== undefined
        ? savingsMin >= options.minSavingsMin
        : savingsMin >= -maxRegressionMin;
    if (!rescues && !withinRegressionAllowance) continue;

    const kind: "transit-saver" | "capacity-expander" = rescues
      ? "capacity-expander"
      : "transit-saver";

    // Rationale communicates both capacity expansion and commute relief.
    const avgCommuteMin = cluster.places.length
      ? Math.round(
          cluster.places.reduce(
            (sum, p) => sum + heuristicEntry(candidateHotel, p, trip.settings).minutes,
            0,
          ) / cluster.places.length,
        )
      : 0;
    const rationale = rescues
      ? `Lets you fit ${rescuedCount} more place${rescuedCount === 1 ? "" : "s"} and eases ~${avgCommuteMin} min one-way commutes.`
      : savingsMin > 0
        ? `Saves ~${savingsMin} min transit across ${suggestedNights} night${suggestedNights === 1 ? "" : "s"}.`
        : `Relieves commute times across ${suggestedNights} night${suggestedNights === 1 ? "" : "s"} with comparable transit.`;

    suggestions.push({
      id: `sug_${cluster.id}`,
      clusterId: cluster.id,
      label: cluster.label,
      center: cluster.center,
      radiusKm: cluster.radiusKm,
      candidateHotel,
      suggestedStays: speculativeStays,
      suggestedNights,
      baselineTravelMin,
      candidateTravelMin,
      savingsMin,
      rationale,
      kind,
      rescuedCount,
    });
  }

  // Sort: capacity-expander first (by rescuedCount desc), then transit-saver (by savingsMin desc)
  suggestions.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "capacity-expander" ? -1 : 1;
    }
    if (a.kind === "capacity-expander") {
      return b.rescuedCount - a.rescuedCount;
    }
    return b.savingsMin - a.savingsMin;
  });

  return suggestions;
}

import { type Place, type Trip, type TripSettings } from "@app/domain";
import { haversineKm } from "@app/geo";
import { heuristicEntry } from "./matrix";
import { staySegments } from "./matrix";
import { kMeans } from "./kmeans";

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

import type { Day, Place } from "@app/domain";
import { parseHHMM } from "@app/domain";
import { haversineKm } from "@app/geo";
import type { Problem } from "./matrix";
import { giantTour } from "./giantTour";
import { split } from "./split";

export interface Cluster {
  id: string;
  places: Place[];
  centroid: { lat: number; lng: number };
  adjacentRegions: Set<string>;
}

export const DEFAULT_ADJACENCY_THRESHOLD_KM = 3;

/**
 * Groups places into geographic clusters, strictly by `Place.region` (per
 * `design.md` Decision 1/4 in the cluster-first-strategy change: the solver
 * relies on the frontend-supplied `region` field rather than clustering on
 * its own — real geographic clustering, when a place has no `region` at
 * all, is the frontend's job, `apps/web/src/clustering.ts`'s
 * `autoClusterTrip`).
 *
 * A place that reaches the solver with no `region` at all is given its own
 * singleton `id` here (`unassigned-N`) so `clusterFirstSequence` still has
 * something to compute a centroid from and assign to a day — this is a
 * defensive fallback for missing data (a test fixture, a partially-migrated
 * trip, the frontend not having run yet), not a clustering algorithm, and
 * it is NOT a substitute for `Place.region`: this `id` is never written back
 * to `Place.region`, and the region-protection operator constraint in
 * `alns.ts` (`regionCompatible`) reads `Place.region` directly, so an
 * unregioned place is always treated there as a free agent — never
 * constrained, never constraining. If this fallback instead wrote a
 * distinct `region` per unregioned place, every such place would become an
 * unmovable, un-shareable single-place "district" once combined with that
 * protection, and any day mixing several unregioned places would read as
 * maximally region-mixed; keeping the two concepts separate avoids that.
 *
 * Also computes each cluster's `adjacentRegions`: other cluster ids whose
 * centroid is within `thresholdKm` of this one's (per `design.md` Decision
 * 3 in the refine-cluster-first change) — a small, deliberately
 * conservative spatial slack so `alns.ts`'s `regionCompatible` can treat
 * near-neighbour districts (e.g. Shibuya/Harajuku) as shareable without
 * degenerating into unrestricted cross-region mixing.
 */
export function clusterPlaces(
  places: Place[],
  thresholdKm: number = DEFAULT_ADJACENCY_THRESHOLD_KM,
): Cluster[] {
  const clusters = new Map<string, Place[]>();
  let nextDerivedId = 1;

  for (const p of places) {
    const r = p.region || `unassigned-${nextDerivedId++}`;
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r)!.push(p);
  }

  const result: Cluster[] = Array.from(clusters.entries()).map(([id, group]) => {
    let latSum = 0;
    let lngSum = 0;
    for (const p of group) {
      latSum += p.lat;
      lngSum += p.lng;
    }
    return {
      id,
      places: group,
      centroid: {
        lat: latSum / group.length,
        lng: lngSum / group.length,
      },
      adjacentRegions: new Set<string>(),
    };
  });

  for (let i = 0; i < result.length; i++) {
    const c1 = result[i]!;
    for (let j = i + 1; j < result.length; j++) {
      const c2 = result[j]!;
      const dist = haversineKm(c1.centroid.lat, c1.centroid.lng, c2.centroid.lat, c2.centroid.lng);
      if (dist <= thresholdKm) {
        c1.adjacentRegions.add(c2.id);
        c2.adjacentRegions.add(c1.id);
      }
    }
  }

  return result;
}

/** `Cluster.id` -> its `adjacentRegions` set, for threading into `Problem.regionAdjacency`. */
export function buildAdjacencyMapping(clusters: Cluster[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const c of clusters) {
    map.set(c.id, c.adjacentRegions);
  }
  return map;
}

/**
 * Cheap intra-cluster travel estimate: a nearest-neighbour path (no 2-opt
 * improvement — this is a bin-packing comparison key, not a route) starting
 * from the cluster's first place. `clusterFirstSequence` computes the real,
 * improved route below once a cluster's day is decided; this only needs to
 * be in the right ballpark so `assignClustersToDays` doesn't judge a
 * geographically spread cluster solely by its dwell time.
 */
function estimateTravelMin(problem: Problem, placeIds: string[]): number {
  if (placeIds.length <= 1) return 0;
  const remaining = new Set(placeIds);
  let current = placeIds[0]!;
  remaining.delete(current);
  let total = 0;
  while (remaining.size > 0) {
    let bestId: string | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const id of remaining) {
      const c = problem.matrix.minutes(current, id);
      if (c < bestCost) {
        bestCost = c;
        bestId = id;
      }
    }
    total += bestCost;
    current = bestId!;
    remaining.delete(current);
  }
  return total;
}

export interface BaseCamp {
  index: number;
  dayIndices: number[];
  baseStartId: string;
  baseEndId: string;
}

/**
 * Groups the trip's `dayList` into consecutive "base camps" that share the same
 * `baseStartId` and `baseEndId`.
 */
export function groupBaseCamps(days: Day[]): BaseCamp[] {
  const camps: BaseCamp[] = [];
  for (let d = 0; d < days.length; d++) {
    const day = days[d]!;
    const lastCamp = camps[camps.length - 1];
    if (
      lastCamp &&
      lastCamp.baseStartId === day.baseStartId &&
      lastCamp.baseEndId === day.baseEndId
    ) {
      lastCamp.dayIndices.push(d);
    } else {
      camps.push({
        index: camps.length,
        dayIndices: [d],
        baseStartId: day.baseStartId,
        baseEndId: day.baseEndId,
      });
    }
  }
  return camps;
}

/**
 * Assigns clusters to the nearest base camp group whose base locations are nearest
 * to them, then greedily bin-packs clusters onto their tied-nearest base camp by an
 * estimated dwell+travel load compared as a FRACTION of each base camp's total
 * start/end window length.
 */
export function assignClustersToDays(
  problem: Problem,
  clusters: Cluster[],
): { baseCamps: BaseCamp[]; assignments: Map<number, Cluster[]> } {
  const baseCamps = groupBaseCamps(problem.dayList);
  const assignments = new Map<number, Cluster[]>();
  for (const camp of baseCamps) {
    assignments.set(camp.index, []);
  }

  // Find the closest tied base camp group for each cluster
  const clusterToTiedCamps = new Map<string, number[]>();

  for (const cluster of clusters) {
    let bestDist = Number.POSITIVE_INFINITY;
    const tiedCamps: number[] = [];

    for (const camp of baseCamps) {
      const baseStart = problem.placesById.get(camp.baseStartId);
      const baseEnd = problem.placesById.get(camp.baseEndId);

      let distStart = Number.POSITIVE_INFINITY;
      let distEnd = Number.POSITIVE_INFINITY;

      if (baseStart) distStart = haversineKm(cluster.centroid.lat, cluster.centroid.lng, baseStart.lat, baseStart.lng);
      if (baseEnd) distEnd = haversineKm(cluster.centroid.lat, cluster.centroid.lng, baseEnd.lat, baseEnd.lng);

      const dist = Math.min(distStart, distEnd);
      if (dist < bestDist - 1.0) {
        bestDist = dist;
        tiedCamps.length = 0;
        tiedCamps.push(camp.index);
      } else if (Math.abs(dist - bestDist) <= 1.0) {
        tiedCamps.push(camp.index);
      }
    }
    clusterToTiedCamps.set(cluster.id, tiedCamps.length > 0 ? tiedCamps : (baseCamps.length > 0 ? [0] : []));
  }

  // Each base camp's load is tracked as a fraction of its total start/end window minutes
  const campWindowMin = baseCamps.map((camp) =>
    camp.dayIndices.reduce((sum, d) => {
      const day = problem.dayList[d]!;
      return sum + Math.max(1, parseHHMM(day.end) - parseHHMM(day.start));
    }, 0),
  );
  const campLoadMin = new Array(baseCamps.length).fill(0);

  // Estimated dwell+travel load per cluster, computed once and reused for
  // both the sort and the packing key.
  const clusterLoad = new Map<string, number>();
  for (const cluster of clusters) {
    const dwellMin = cluster.places.reduce((sum, p) => sum + p.dwellMin, 0);
    const travelMin = estimateTravelMin(problem, cluster.places.map((p) => p.id));
    clusterLoad.set(cluster.id, dwellMin + travelMin);
  }

  // Sort clusters by estimated load descending (greedy bin packing).
  const sortedClusters = [...clusters].sort((a, b) => clusterLoad.get(b.id)! - clusterLoad.get(a.id)!);

  for (const cluster of sortedClusters) {
    const tiedCamps = clusterToTiedCamps.get(cluster.id)!;
    if (tiedCamps.length === 0) continue;

    // Find the tied base camp with the minimum utilisation fraction so far.
    let bestCamp = tiedCamps[0]!;
    let minFrac = campLoadMin[bestCamp]! / (campWindowMin[bestCamp] || 1);
    for (const c of tiedCamps) {
      const frac = campLoadMin[c]! / (campWindowMin[c] || 1);
      if (frac < minFrac) {
        minFrac = frac;
        bestCamp = c;
      }
    }

    campLoadMin[bestCamp] += clusterLoad.get(cluster.id)!;
    assignments.get(bestCamp)!.push(cluster);
  }

  return { baseCamps, assignments };
}

const ROTATION_CANDIDATES = 8;

/**
 * Splits a tour across the days of a base camp via Prins DP split, testing
 * rotation seams to find the minimum-cost partition.
 */
function splitTourAcrossDays(problem: Problem, tour: string[]): string[][] {
  const n = tour.length;
  if (n === 0) return problem.dayList.map(() => []);
  if (n === 1) return split(problem, tour).segments;

  const edgeCost = (i: number): number => problem.matrix.minutes(tour[i]!, tour[(i + 1) % n]!);
  const byEdgeCostDesc = Array.from({ length: n }, (_, i) => i).sort((a, b) => edgeCost(b) - edgeCost(a));
  const cutStarts: number[] = [];
  const maxCandidates = Math.min(ROTATION_CANDIDATES, n);
  for (const i of byEdgeCostDesc) {
    if (cutStarts.length >= maxCandidates) break;
    cutStarts.push((i + 1) % n);
  }

  let bestSplitCost = Number.POSITIVE_INFINITY;
  let bestSegments: string[][] = [];
  for (const i of cutStarts) {
    const rotated = i === 0 ? tour : [...tour.slice(i), ...tour.slice(0, i)];
    const fwd = split(problem, rotated);
    if (fwd.cost < bestSplitCost) {
      bestSplitCost = fwd.cost;
      bestSegments = fwd.segments;
    }
    const rev = split(problem, [...rotated].reverse());
    if (rev.cost < bestSplitCost) {
      bestSplitCost = rev.cost;
      bestSegments = rev.segments;
    }
  }
  return bestSegments;
}

/**
 * The cluster-first construction strategy.
 * Groups days into base camps, assigns clusters to the nearest base camp,
 * and performs localized DP splitting across each base camp's days.
 */
export function clusterFirstSequence(problem: Problem): string[][] {
  const clusters = clusterPlaces(problem.places);
  const { baseCamps, assignments } = assignClustersToDays(problem, clusters);

  const segments: string[][] = Array.from({ length: problem.dayList.length }, () => []);

  for (const camp of baseCamps) {
    const clustersForCamp = assignments.get(camp.index) ?? [];
    const placeIds = clustersForCamp.flatMap((c) => c.places.map((p) => p.id));
    if (placeIds.length === 0) continue;

    const campDays = camp.dayIndices.map((d) => problem.dayList[d]!);
    const campProblem: Problem = { ...problem, dayList: campDays };

    const tour = giantTour(problem, placeIds);
    const campSegments = splitTourAcrossDays(campProblem, tour);

    for (let i = 0; i < camp.dayIndices.length; i++) {
      const d = camp.dayIndices[i]!;
      segments[d] = campSegments[i] ?? [];
    }
  }

  return segments;
}

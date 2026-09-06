import type { Place } from "@app/domain";
import { parseHHMM } from "@app/domain";
import { haversineKm } from "@app/geo";

export interface Cluster {
  id: string;
  places: Place[];
  centroid: { lat: number; lng: number };
}

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
 */
export function clusterPlaces(places: Place[]): Cluster[] {
  const clusters = new Map<string, Place[]>();
  let nextDerivedId = 1;

  for (const p of places) {
    const r = p.region || `unassigned-${nextDerivedId++}`;
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r)!.push(p);
  }

  return Array.from(clusters.entries()).map(([id, group]) => {
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
    };
  });
}

import type { Problem } from "./matrix";
import { giantTour } from "./giantTour";

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

/**
 * Assigns clusters to the days whose base locations are nearest to them,
 * then greedily bin-packs clusters onto their tied-nearest day by an
 * estimated dwell+travel load, compared as a FRACTION of each day's actual
 * start/end window length (not raw minutes) — a short-window day and a
 * long-window day filling up at the same rate are equally "loaded" this
 * way, whereas comparing raw minutes would always call the long day
 * emptier. Deliberately out of scope here (see `tasks.md` task 4.7 in the
 * cluster-first-strategy change): a day's already-committed
 * appointment/pinned load is not netted out of its window before packing
 * starts, since appointment-day placement for `clusterFirst` happens
 * downstream in `solve.ts`, not in this construction step — packing
 * against the day's full window is the same simplification `routeFirst`'s
 * `split.ts` construction makes, and this only sizes the *initial* state
 * ALNS then improves on.
 */
function assignClustersToDays(problem: Problem, clusters: Cluster[]): Map<number, string[]> {
  const dayAssignments = new Map<number, string[]>();
  for (let d = 0; d < problem.dayList.length; d++) {
    dayAssignments.set(d, []);
  }

  // Find the closest tied days for each cluster
  const clusterToTiedDays = new Map<string, number[]>();
  
  for (const cluster of clusters) {
    let bestDist = Number.POSITIVE_INFINITY;
    const tiedDays: number[] = [];
    
    for (let d = 0; d < problem.dayList.length; d++) {
      const day = problem.dayList[d]!;
      const baseStart = problem.placesById.get(day.baseStartId);
      const baseEnd = problem.placesById.get(day.baseEndId);
      
      let distStart = Number.POSITIVE_INFINITY;
      let distEnd = Number.POSITIVE_INFINITY;

      if (baseStart) distStart = haversineKm(cluster.centroid.lat, cluster.centroid.lng, baseStart.lat, baseStart.lng);
      if (baseEnd) distEnd = haversineKm(cluster.centroid.lat, cluster.centroid.lng, baseEnd.lat, baseEnd.lng);
      
      const dist = Math.min(distStart, distEnd);
      if (dist < bestDist - 1.0) {
        bestDist = dist;
        tiedDays.length = 0;
        tiedDays.push(d);
      } else if (Math.abs(dist - bestDist) <= 1.0) {
        tiedDays.push(d);
      }
    }
    clusterToTiedDays.set(cluster.id, tiedDays);
  }

  // Each day's load is tracked as a fraction of its own start/end window
  // (see this function's doc comment) rather than raw minutes.
  const windowMin = problem.dayList.map((day) => Math.max(1, parseHHMM(day.end) - parseHHMM(day.start)));
  const dayLoadMin = new Array(problem.dayList.length).fill(0);

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
    const tiedDays = clusterToTiedDays.get(cluster.id)!;
    // Find the tied day with the minimum utilisation so far.
    let bestDay = tiedDays[0]!;
    let minFrac = dayLoadMin[bestDay]! / windowMin[bestDay]!;
    for (const d of tiedDays) {
      const frac = dayLoadMin[d]! / windowMin[d]!;
      if (frac < minFrac) {
        minFrac = frac;
        bestDay = d;
      }
    }

    dayLoadMin[bestDay] += clusterLoad.get(cluster.id)!;
    dayAssignments.get(bestDay)!.push(...cluster.places.map(p => p.id));
  }

  return dayAssignments;
}

/**
 * The cluster-first construction strategy.
 */
export function clusterFirstSequence(problem: Problem): string[][] {
  const clusters = clusterPlaces(problem.places);
  const assignments = assignClustersToDays(problem, clusters);
  
  const segments: string[][] = [];
  for (let d = 0; d < problem.dayList.length; d++) {
    const placesForDay = assignments.get(d) ?? [];
    if (placesForDay.length > 0) {
      const tour = giantTour(problem, placesForDay);
      const day = problem.dayList[d]!;
      const baseStart = day.baseStartId;
      const baseEnd = day.baseEndId;
      
      let bestRot = tour;
      let bestCost = Number.POSITIVE_INFINITY;
      
      for (let i = 0; i < tour.length; i++) {
        const fwd = [...tour.slice(i), ...tour.slice(0, i)];
        let fCost = problem.matrix.minutes(baseStart, fwd[0]!);
        for (let j = 0; j < fwd.length - 1; j++) {
          fCost += problem.matrix.minutes(fwd[j]!, fwd[j + 1]!);
        }
        fCost += problem.matrix.minutes(fwd[fwd.length - 1]!, baseEnd);
        if (fCost < bestCost) {
          bestCost = fCost;
          bestRot = fwd;
        }
        
        const rev = [...fwd].reverse();
        let rCost = problem.matrix.minutes(baseStart, rev[0]!);
        for (let j = 0; j < rev.length - 1; j++) {
          rCost += problem.matrix.minutes(rev[j]!, rev[j + 1]!);
        }
        rCost += problem.matrix.minutes(rev[rev.length - 1]!, baseEnd);
        if (rCost < bestCost) {
          bestCost = rCost;
          bestRot = rev;
        }
      }
      segments.push(bestRot);
    } else {
      segments.push([]);
    }
  }
  return segments;
}

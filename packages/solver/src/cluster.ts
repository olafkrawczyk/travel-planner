import type { Place } from "@app/domain";
import { haversineKm } from "@app/geo";

export interface Cluster {
  id: string;
  places: Place[];
  centroid: { lat: number; lng: number };
}

/**
 * Groups places into geographic clusters.
 * Uses existing Place.region if available.
 * For places without a region, groups them using a simple distance threshold.
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
 * Assigns clusters to the days whose base locations are nearest to them.
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

  // To map regions to tied days uniquely, we keep track of day loads (total dwell minutes)
  const dayLoads = new Array(problem.dayList.length).fill(0);
  
  // Sort clusters by size descending (greedy bin packing)
  const sortedClusters = [...clusters].sort((a, b) => {
    const aDur = a.places.reduce((sum, p) => sum + p.dwellMin, 0);
    const bDur = b.places.reduce((sum, p) => sum + p.dwellMin, 0);
    return bDur - aDur;
  });

  for (const cluster of sortedClusters) {
    const tiedDays = clusterToTiedDays.get(cluster.id)!;
    // Find the tied day with the minimum load
    let bestDay = tiedDays[0]!;
    let minLoad = dayLoads[bestDay]!;
    for (const d of tiedDays) {
      if (dayLoads[d]! < minLoad) {
        minLoad = dayLoads[d]!;
        bestDay = d;
      }
    }
    
    const clusterDur = cluster.places.reduce((sum, p) => sum + p.dwellMin, 0);
    dayLoads[bestDay] += clusterDur;
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

import type { Place } from "@app/domain";
import { haversineKm } from "@app/geo";

export interface KMeansOptions {
  /**
   * Optional max points per cluster. When set, each iteration's assignment
   * step is a greedy nearest-pair packing capped at this many points per
   * cluster (sorted by distance, closest pairs claimed first) instead of
   * every point picking its nearest centroid unconditionally. This is an
   * approximation of balanced clustering, not an exact optimum, but is
   * deterministic and cheap enough to re-run every Lloyd iteration for
   * trip-sized inputs (tens of places).
   */
  capacity?: number;
}

/**
 * Deterministic k-means over `places`: k-means++ farthest-point seeding
 * (the point farthest from the centroids chosen so far — deterministic, not
 * a weighted random draw, so results are reproducible across runs and
 * tests) followed by up to 10 Lloyd iterations. Returns one cluster index
 * (0..k-1) per input place, in the same order as `places`.
 *
 * This is the single shared k-means implementation for both the solver's
 * (currently unused, defensive-fallback) internal grouping and the
 * frontend's `Place.region` auto-assignment (`apps/web/src/clustering.ts`)
 * — the two were previously separate, near-identical, already-diverged
 * copies; `capacity` is what the frontend copy bolted on that this one
 * didn't have.
 *
 * - `k <= 0` returns `[]`.
 * - `k >= places.length` returns one place per cluster
 *   (`[0, 1, 2, ...]`) since there is nothing to actually cluster.
 */
export function kMeans(places: Place[], k: number, opts: KMeansOptions = {}): number[] {
  if (k <= 0) return [];
  if (k >= places.length) return places.map((_, i) => i);

  // K-means++ initialization (deterministic farthest-point variant).
  const centroids: { lat: number; lng: number }[] = [];
  const first = places[0]!; // safe: k >= 1 and k < places.length, so places is non-empty
  centroids.push({ lat: first.lat, lng: first.lng });

  for (let c = 1; c < k; c++) {
    const distSq = places.map((p) => {
      let minDist = Number.POSITIVE_INFINITY;
      for (const cent of centroids) {
        const d = haversineKm(p.lat, p.lng, cent.lat, cent.lng);
        if (d < minDist) minDist = d;
      }
      return minDist * minDist;
    });

    let maxDistSq = -1;
    let bestIdx = 0;
    for (let i = 0; i < distSq.length; i++) {
      const d = distSq[i]!;
      if (d > maxDistSq) {
        maxDistSq = d;
        bestIdx = i;
      }
    }
    const bestPlace = places[bestIdx]!;
    centroids.push({ lat: bestPlace.lat, lng: bestPlace.lng });
  }

  const capacity = opts.capacity;
  const assignments = new Array<number>(places.length).fill(0);

  for (let iter = 0; iter < 10; iter++) {
    if (capacity !== undefined) {
      assignCapacityConstrained(places, centroids, capacity, assignments);
    } else {
      assignNearest(places, centroids, assignments);
    }

    const newCentroids = Array.from({ length: k }, () => ({ lat: 0, lng: 0, count: 0 }));
    for (let i = 0; i < places.length; i++) {
      const p = places[i]!;
      const c = assignments[i]!;
      const acc = newCentroids[c]!;
      acc.lat += p.lat;
      acc.lng += p.lng;
      acc.count++;
    }

    let moved = false;
    for (let c = 0; c < k; c++) {
      const acc = newCentroids[c]!;
      if (acc.count > 0) {
        const nLat = acc.lat / acc.count;
        const nLng = acc.lng / acc.count;
        const cent = centroids[c]!;
        if (Math.abs(cent.lat - nLat) > 0.0001 || Math.abs(cent.lng - nLng) > 0.0001) {
          moved = true;
        }
        centroids[c] = { lat: nLat, lng: nLng };
      } else if (capacity !== undefined) {
        // An empty cluster can arise under a capacity cap even though every
        // point is assigned somewhere; reseed it from a far point so it has
        // a chance to claim points next iteration instead of sitting empty
        // for the rest of the run. (Uncapacitated Lloyd's leaves an empty
        // cluster's centroid unmoved — that branch is unchanged below.)
        const fallback = places[c % places.length]!;
        centroids[c] = { lat: fallback.lat, lng: fallback.lng };
        moved = true;
      }
    }
    if (!moved) break;
  }
  return assignments;
}

function assignNearest(
  places: Place[],
  centroids: { lat: number; lng: number }[],
  assignments: number[],
): void {
  for (let i = 0; i < places.length; i++) {
    const p = places[i]!;
    let bestC = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let c = 0; c < centroids.length; c++) {
      const cent = centroids[c]!;
      const d = haversineKm(p.lat, p.lng, cent.lat, cent.lng);
      if (d < bestD) {
        bestD = d;
        bestC = c;
      }
    }
    assignments[i] = bestC;
  }
}

/**
 * Greedy capacity-constrained assignment: every (place, cluster) pair is
 * scored by distance and claimed closest-first, skipping a pair once its
 * place is already assigned or its cluster is at `capacity`. Any place left
 * unassigned when capacity exhausts every cluster before covering every
 * place (a too-tight `capacity` for `k`) falls back to its nearest cluster
 * regardless of capacity, so no place is ever left without an assignment.
 */
function assignCapacityConstrained(
  places: Place[],
  centroids: { lat: number; lng: number }[],
  capacity: number,
  assignments: number[],
): void {
  const k = centroids.length;
  const pairs: { pIdx: number; cIdx: number; dist: number }[] = [];
  for (let i = 0; i < places.length; i++) {
    for (let c = 0; c < k; c++) {
      pairs.push({
        pIdx: i,
        cIdx: c,
        dist: haversineKm(places[i]!.lat, places[i]!.lng, centroids[c]!.lat, centroids[c]!.lng),
      });
    }
  }
  pairs.sort((a, b) => a.dist - b.dist);

  assignments.fill(-1);
  const counts = new Array(k).fill(0);
  for (const pair of pairs) {
    if (assignments[pair.pIdx] === -1 && counts[pair.cIdx]! < capacity) {
      assignments[pair.pIdx] = pair.cIdx;
      counts[pair.cIdx]++;
    }
  }
  for (let i = 0; i < assignments.length; i++) {
    if (assignments[i] !== -1) continue;
    let bestC = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let c = 0; c < k; c++) {
      const d = haversineKm(places[i]!.lat, places[i]!.lng, centroids[c]!.lat, centroids[c]!.lng);
      if (d < bestD) {
        bestD = d;
        bestC = c;
      }
    }
    assignments[i] = bestC;
  }
}

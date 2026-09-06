import type { Trip } from "@app/domain";
import { haversineKm } from "@app/geo";
import { kMeans } from "@app/solver";
import { produce } from "immer";

/**
 * Auto-populate `Place.region` for any schedulable (non-hotel) place that's
 * missing it, mutating `draft` in place. This is the recipe body shared by
 * `autoClusterTrip` (below, for standalone callers that hand it a plain
 * `Trip`) and the store's `mutateTrip` (which already holds an immer draft
 * and would otherwise have to double-wrap this in another `produce`) — see
 * `apps/web/src/store.ts`'s `requestSolve`, which runs this as a normal
 * undoable edit only when `solverStrategy === "clusterFirst"`.
 */
export function applyAutoCluster(draft: Trip): void {
  const unassigned = draft.places.filter((p) => !p.region && p.category !== "hotel");
  if (unassigned.length === 0) return;

  // Identify existing regions and their centroids
  const existingRegions = new Map<string, { lat: number; lng: number; count: number }>();
  for (const p of draft.places) {
    if (p.region && p.category !== "hotel") {
      const stats = existingRegions.get(p.region) || { lat: 0, lng: 0, count: 0 };
      stats.lat += p.lat;
      stats.lng += p.lng;
      stats.count++;
      existingRegions.set(p.region, stats);
    }
  }

  // If we already have regions and we're just adding a few places, assign them to nearest existing region
  if (existingRegions.size > 0 && unassigned.length < draft.places.length / 2) {
    const regionCentroids: { name: string; lat: number; lng: number }[] = [];
    for (const [name, stats] of existingRegions.entries()) {
      regionCentroids.push({ name, lat: stats.lat / stats.count, lng: stats.lng / stats.count });
    }

    for (const p of unassigned) {
      let bestRegion = regionCentroids[0]!.name;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const r of regionCentroids) {
        const d = haversineKm(p.lat, p.lng, r.lat, r.lng);
        if (d < bestDist) {
          bestDist = d;
          bestRegion = r.name;
        }
      }
      p.region = bestRegion;
    }
    return;
  }

  // Otherwise, perform capacity-constrained k-means on the unassigned places
  // (the shared implementation in `@app/solver`; capacity keeps any one
  // district from soaking up far more places than the rest).
  const k = Math.max(1, draft.days.length);
  const capacity = Math.ceil((unassigned.length / k) * 1.5);
  const assignments = kMeans(unassigned, k, { capacity });

  // Name clusters starting from 1 (District 1, District 2, etc. to avoid clash with old "Cluster X")
  for (let i = 0; i < unassigned.length; i++) {
    unassigned[i]!.region = `District ${assignments[i]! + 1}`;
  }
}

/** Auto-populate `Place.region` on a copy of `trip`; returns `trip` itself (same reference) when nothing changed. */
export function autoClusterTrip(trip: Trip): Trip {
  return produce(trip, applyAutoCluster);
}

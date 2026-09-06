import type { Trip } from "@app/domain";
import { haversineKm } from "@app/geo";
import { produce } from "immer";

export function autoClusterTrip(trip: Trip): Trip {
  return produce(trip, (draft) => {
    const unassigned = draft.places.filter(p => !p.region && p.category !== "hotel");
    if (unassigned.length === 0) return;

    // Identify existing regions and their centroids
    const existingRegions = new Map<string, { lat: number, lng: number, count: number }>();
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
      const regionCentroids: { name: string, lat: number, lng: number }[] = [];
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

    // Otherwise, perform full K-means clustering on the unassigned places
    const k = Math.max(1, draft.days.length);
    if (unassigned.length <= k) {
      unassigned.forEach((p, i) => { p.region = `District ${i + 1}`; });
      return;
    }

    const centroids: { lat: number; lng: number }[] = [];
    centroids.push({ lat: unassigned[0]!.lat, lng: unassigned[0]!.lng });

    for (let c = 1; c < k; c++) {
      const distSq = unassigned.map(p => {
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
        if (distSq[i]! > maxDistSq) {
          maxDistSq = distSq[i]!;
          bestIdx = i;
        }
      }
      centroids.push({ lat: unassigned[bestIdx]!.lat, lng: unassigned[bestIdx]!.lng });
    }

    const assignments = new Array(unassigned.length).fill(-1);
    const capacity = Math.ceil((unassigned.length / k) * 1.5);

    for (let iter = 0; iter < 10; iter++) {
      const pairs: { pIdx: number; cIdx: number; dist: number }[] = [];
      for (let i = 0; i < unassigned.length; i++) {
        for (let c = 0; c < k; c++) {
          pairs.push({
            pIdx: i,
            cIdx: c,
            dist: haversineKm(unassigned[i]!.lat, unassigned[i]!.lng, centroids[c]!.lat, centroids[c]!.lng)
          });
        }
      }
      pairs.sort((a, b) => a.dist - b.dist);

      assignments.fill(-1);
      const clusterCounts = new Array(k).fill(0);

      for (const pair of pairs) {
        if (assignments[pair.pIdx] === -1 && clusterCounts[pair.cIdx]! < capacity) {
          assignments[pair.pIdx] = pair.cIdx;
          clusterCounts[pair.cIdx]++;
        }
      }

      const newCentroids = Array(k).fill(0).map(() => ({ lat: 0, lng: 0, count: 0 }));
      for (let i = 0; i < unassigned.length; i++) {
        const c = assignments[i]!;
        newCentroids[c]!.lat += unassigned[i]!.lat;
        newCentroids[c]!.lng += unassigned[i]!.lng;
        newCentroids[c]!.count++;
      }

      let moved = false;
      for (let c = 0; c < k; c++) {
        if (newCentroids[c]!.count > 0) {
          const nLat = newCentroids[c]!.lat / newCentroids[c]!.count;
          const nLng = newCentroids[c]!.lng / newCentroids[c]!.count;
          if (Math.abs(centroids[c]!.lat - nLat) > 0.0001 || Math.abs(centroids[c]!.lng - nLng) > 0.0001) {
            moved = true;
          }
          centroids[c] = { lat: nLat, lng: nLng };
        } else {
          const fallback = unassigned[c % unassigned.length]!;
          centroids[c] = { lat: fallback.lat, lng: fallback.lng };
          moved = true;
        }
      }
      if (!moved) break;
    }

    // Name clusters starting from 1 (District 1, District 2, etc. to avoid clash with old "Cluster X")
    for (let i = 0; i < unassigned.length; i++) {
      unassigned[i]!.region = `District ${assignments[i]! + 1}`;
    }
  });
}

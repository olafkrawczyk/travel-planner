import type { Place } from "@app/domain";
import { haversineKm } from "@app/geo";

export function kMeans(places: Place[], k: number) {
  if (k <= 0) return [];
  if (k >= places.length) return places.map((_, i) => i); // 1 per cluster
  
  // K-means++ initialization
  const centroids: { lat: number; lng: number }[] = [];
  // 1. Choose one center uniformly at random among the data points
  // We'll use a deterministic pseudo-random or just the first point for determinism.
  centroids.push({ lat: places[0].lat, lng: places[0].lng });
  
  for (let c = 1; c < k; c++) {
    // 2. For each data point x, compute D(x), the distance between x and the nearest center that has already been chosen.
    const distSq = places.map(p => {
      let minDist = Number.POSITIVE_INFINITY;
      for (const cent of centroids) {
        const d = haversineKm(p.lat, p.lng, cent.lat, cent.lng);
        if (d < minDist) minDist = d;
      }
      return minDist * minDist;
    });
    
    // 3. Choose one new data point at random as a new center, using a weighted probability distribution where a point x is chosen with probability proportional to D(x)^2.
    // Deterministic max instead of weighted random for reproducible tests!
    let maxDistSq = -1;
    let bestIdx = 0;
    for (let i = 0; i < distSq.length; i++) {
      if (distSq[i] > maxDistSq) {
        maxDistSq = distSq[i];
        bestIdx = i;
      }
    }
    centroids.push({ lat: places[bestIdx].lat, lng: places[bestIdx].lng });
  }

  const assignments = new Array(places.length).fill(0);
  for (let iter = 0; iter < 10; iter++) {
    for (let i = 0; i < places.length; i++) {
      let bestC = 0;
      let bestD = Number.POSITIVE_INFINITY;
      for (let c = 0; c < k; c++) {
        const d = haversineKm(places[i].lat, places[i].lng, centroids[c].lat, centroids[c].lng);
        if (d < bestD) {
          bestD = d;
          bestC = c;
        }
      }
      assignments[i] = bestC;
    }
    
    const newCentroids = Array(k).fill(0).map(() => ({ lat: 0, lng: 0, count: 0 }));
    for (let i = 0; i < places.length; i++) {
      const c = assignments[i];
      newCentroids[c].lat += places[i].lat;
      newCentroids[c].lng += places[i].lng;
      newCentroids[c].count++;
    }
    
    let moved = false;
    for (let c = 0; c < k; c++) {
      if (newCentroids[c].count > 0) {
        const nLat = newCentroids[c].lat / newCentroids[c].count;
        const nLng = newCentroids[c].lng / newCentroids[c].count;
        if (Math.abs(centroids[c].lat - nLat) > 0.0001 || Math.abs(centroids[c].lng - nLng) > 0.0001) {
          moved = true;
        }
        centroids[c] = { lat: nLat, lng: nLng };
      }
    }
    if (!moved) break;
  }
  return assignments;
}

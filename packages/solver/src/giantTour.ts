import type { Problem } from "./matrix";

/**
 * Giant TSP tour over all schedulable places: nearest-neighbour construction
 * (best of all starts), then 2-opt and Or-opt improvement on the symmetric
 * heuristic cost. Deterministic.
 */
export function giantTour(problem: Problem, placeIds?: string[]): string[] {
  const ids = placeIds ?? problem.places.map((p) => p.id);
  const n = ids.length;
  if (n <= 1) return ids;

  // Precompute the symmetric heuristic cost grid once (the heuristic is
  // symmetric; take the min direction to be robust against overrides). This
  // keeps the improvement loops free of Map lookups.
  const d: number[][] = ids.map((_, i) =>
    ids.map((__, j) =>
      i === j
        ? 0
        : Math.min(problem.matrix.minutes(ids[i]!, ids[j]!), problem.matrix.minutes(ids[j]!, ids[i]!)),
    ),
  );
  const cost = (i: number, j: number): number => d[i]![j]!;

  let best: number[] | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let start = 0; start < n; start++) {
    const tour = nearestNeighbour(n, start, cost);
    const c = tourCost(tour, cost);
    if (c < bestCost) {
      bestCost = c;
      best = tour;
    }
  }
  let tour = best!;

  let improved = true;
  let guard = 0;
  while (improved && guard++ < 100) {
    improved = false;
    // 2-opt (tour treated as a cycle)
    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 2; j < n; j++) {
        const a = tour[i - 1 < 0 ? n - 1 : i - 1]!;
        const b = tour[i]!;
        const e = tour[j]!;
        const f = tour[(j + 1) % n]!;
        if (cost(a, e) + cost(b, f) < cost(a, b) + cost(e, f) - 1e-9) {
          const seg = tour.slice(i, j + 1).reverse();
          tour = [...tour.slice(0, i), ...seg, ...tour.slice(j + 1)];
          improved = true;
        }
      }
    }
    // Or-opt: relocate segments of 1..3. Each trial's cost change is computed
    // as an O(1) edge delta (only the <=3 edges touched by removing the
    // segment and re-splicing it in change) instead of rebuilding the array
    // and calling `tourCost` (O(n)) on it — that recompute made this loop
    // O(n) trials x O(n) per trial = O(n^2) per (i, len), times O(n) values
    // of i, i.e. O(n^3) per guard pass, which measured as the dominant cost
    // of `giantTour` (~2s of a ~2.85s total at N=100 — see the perf-defect
    // writeup this fixes; `perf.test.ts`/`giantTour.test.ts` cover the
    // regression). The delta below is mathematically identical to
    // `tourCost(trial) - tourCost(tour)` (same edges, same arithmetic, just
    // without re-summing the O(n) unaffected edges), so the accept/reject
    // decision — and therefore the tour this converges to — is unchanged;
    // the full trial array is only ever built once an improving move is
    // actually found and applied, not for every candidate.
    outer: for (let i = 0; i < n; i++) {
      for (let len = 1; len <= 3 && i + len <= n; len++) {
        const segFirst = tour[i]!;
        const segLast = tour[i + len - 1]!;
        const prev = tour[(i - 1 + n) % n]!;
        const next = tour[(i + len) % n]!;
        // Cost of closing the gap left by removing [i, i+len) from the cycle.
        const removeDelta = cost(prev, next) - cost(prev, segFirst) - cost(segLast, next);
        const without = [...tour.slice(0, i), ...tour.slice(i + len)];
        const m = without.length;
        for (let pos = 0; pos <= m; pos++) {
          if (pos === i) continue;
          const before = without[(pos - 1 + m) % m]!;
          const after = without[pos % m]!;
          const insertDelta = cost(before, segFirst) + cost(segLast, after) - cost(before, after);
          if (removeDelta + insertDelta < -1e-9) {
            const seg = tour.slice(i, i + len);
            tour = [...without.slice(0, pos), ...seg, ...without.slice(pos)];
            improved = true;
            break outer;
          }
        }
      }
    }
  }

  return tour.map((i) => ids[i]!);
}

function nearestNeighbour(
  n: number,
  start: number,
  cost: (i: number, j: number) => number,
): number[] {
  const visited = new Array<boolean>(n).fill(false);
  const tour: number[] = [start];
  visited[start] = true;
  let cur = start;
  for (let step = 1; step < n; step++) {
    let bestJ = -1;
    let bestC = Number.POSITIVE_INFINITY;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && cost(cur, j) < bestC) {
        bestC = cost(cur, j);
        bestJ = j;
      }
    }
    visited[bestJ] = true;
    tour.push(bestJ);
    cur = bestJ;
  }
  return tour;
}

function tourCost(tour: number[], cost: (i: number, j: number) => number): number {
  let sum = 0;
  for (let i = 0; i < tour.length; i++) {
    sum += cost(tour[i]!, tour[(i + 1) % tour.length]!);
  }
  return sum;
}

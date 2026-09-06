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
    // Or-opt: relocate segments of 1..3
    outer: for (let i = 0; i < n; i++) {
      for (let len = 1; len <= 3 && i + len <= n; len++) {
        const seg = tour.slice(i, i + len);
        const without = [...tour.slice(0, i), ...tour.slice(i + len)];
        for (let pos = 0; pos <= without.length; pos++) {
          if (pos === i) continue;
          const trial = [...without.slice(0, pos), ...seg, ...without.slice(pos)];
          if (tourCost(trial, cost) < tourCost(tour, cost) - 1e-9) {
            tour = trial;
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

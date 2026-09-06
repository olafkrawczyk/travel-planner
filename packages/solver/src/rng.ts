/**
 * Deterministic PRNG (mulberry32). The solver must never touch Math.random:
 * same seed + same input => same itinerary.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random integer in [0, n). */
export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/** Pick a random element. */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[randInt(rng, arr.length)] as T;
}

/** In-place Fisher-Yates shuffle (deterministic given rng). */
export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

# Design: fix-time-display-sample-trips

## 1. Time formatting (root cause)

`computeTimes` (packages/solver/src/sequence.ts) adds float travel minutes to integer times, then `formatHHMM` does `m % 60` on the float → "14:10.999…". Two-layer fix:
- `formatHHMM` in packages/domain/src/time.ts rounds its input (`Math.round`) before splitting — makes the function total; no caller can reintroduce the bug.
- `computeTimes` rounds arrive/depart/wait to whole minutes when building stops, so solver output data is clean, not just its display.

## 2. Hotel markers + toggle

Base places (dwellMin === 0 / base markers) already render with a distinct `.base` style. Improve: hotel markers get an "H"-style distinct treatment and clear name-on-hover. Add a store flag `showBases: boolean` (default true) + a small toggle control on the map (top-right, e.g. a "Hotel" chip/button). When off, base markers are skipped in marker construction; route polylines still end at the base.

## 3. Sample trips

Curated datasets live in this change folder (`samples/tokyo.json`, `samples/warsaw.json`) — authored up front with real places and coordinates. Implementation:
- Copy into `apps/web/src/samples/` as TS modules (or JSON imports).
- `tripFactory` gains `sampleTrip(sample, dates)`: hotel becomes the base place (dwellMin 0), all places from the dataset, day count per meta (5 / 4 days starting from today's date or a fixed sensible date).
- `TripList` gets two buttons: "Load sample: Tokyo" / "Load sample: Warsaw", creating + opening the trip via the normal `createTrip`-like path (persist + solve).
- Solver fixtures: add `packages/solver/fixtures/warsaw.ts` from the same data, with regression test `warsaw.test.ts` mirroring `tokyo.test.ts` (deterministic, matches recorded baselines). Record baselines by running the solver once and pasting results.

## Constraints

- No schema changes; samples are plain Trip data.
- Keep the existing tokyo fixture test intact (may replace its synthetic data with the curated Tokyo dataset if convenient, but baselines must be re-recorded and tests kept green).
- `pnpm build` + `pnpm test` green at the end.

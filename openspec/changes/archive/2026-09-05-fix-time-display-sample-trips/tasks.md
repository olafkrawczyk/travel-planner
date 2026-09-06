# Tasks: fix-time-display-sample-trips

## 1. Time formatting

- [x] 1.1 `packages/domain/src/time.ts`: `formatHHMM` rounds float input (Math.round) before splitting into HH:mm — add a unit test for "14:10.999…" → "14:11"
- [x] 1.2 `packages/solver/src/sequence.ts`: round arrive/depart/waitMin to whole minutes when building stops

## 2. Hotel markers + toggle

- [x] 2.1 MapView: distinct hotel styling for base markers (clearly identifiable, name on hover already exists)
- [x] 2.2 Store + MapView: `showBases` flag (default true) with a small map toggle control; hiding removes base markers but keeps routes

## 3. Sample trips

- [x] 3.1 Move `openspec/changes/fix-time-display-sample-trips/samples/{tokyo,warsaw}.json` into `apps/web/src/samples/` (as JSON or TS modules) and add a `sampleTrip()` builder in tripFactory
- [x] 3.2 TripList: "Load sample: Tokyo" and "Load sample: Warsaw" buttons that create + open the trip (persisted, solves on open)
- [x] 3.3 `packages/solver/fixtures/warsaw.ts` + `warsaw.test.ts` regression test (deterministic, recorded baselines for score/totalTravelMin/unscheduled.length); keep the tokyo fixture test green

## 4. Verify

- [x] 4.1 `pnpm build` passes and `pnpm test` is green

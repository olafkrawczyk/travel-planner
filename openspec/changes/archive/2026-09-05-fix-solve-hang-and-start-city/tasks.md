# Tasks: fix-solve-hang-and-start-city

## 1. Fix solve hang

- [x] 1.1 In `apps/web/src/worker/solverClient.ts`, wrap `onProgress`/`onDone` (and any function-valued request fields) with `Comlink.proxy()` in both `solve` and `resolve` so callbacks survive structured cloning
- [x] 1.2 In `apps/web/src/store.ts` `requestSolve`, handle promise rejection: clear `solving` and set an error toast; ensure the indicator can never stick
- [x] 1.3 Clone-harden the bridge: pass `onProgress`/`onDone` as top-level `Comlink.proxy()`-wrapped arguments (keep the request object pure data) so callback delivery does not depend on nested-object serialization; document clearing `apps/web/node_modules/.vite` + site data for stale-bundle cases

## 2. Starting city at trip creation

- [x] 2.1 Add a required "Starting city" input to the create-trip form in `apps/web/src/components/TripList.tsx`
- [x] 2.2 Geocode the city in `store.createTrip` via Photon; pass resulting coordinates into `tripFactory.emptyTrip`; on geocoding failure create the trip with the fallback base and show a toast telling the user to set the base location manually
- [x] 2.3 Update `tripFactory.emptyTrip` to accept base coordinates instead of hardcoded Tokyo; adjust `tripFactory.test.ts` accordingly

## 3. Search hygiene

- [x] 3.1 Debounce the query in `SearchBox` (single trailing request per pause; stale responses discarded)
- [x] 3.2 Show a visible error state in `SearchBox` when the geocoding request fails, distinct from "No results."

## 4. Worker logging + null-field fix

- [x] 4.1 Add structured worker-bridge logging (main side in `solverClient.ts`/`store.ts`, worker side in `solver.worker.ts`): log solve/resolve requests, progress/done deliveries, and errors, gated behind a dev flag; also log the thrown DataCloneError path
- [x] 4.2 Reproduce and fix the worker-side "Expected value to be of type number, but found null" error: find where a null numeric field (lat/lng/dwell or base reference) enters the solver input, fix the source (e.g. PlaceEditor numeric inputs, stale base refs after hotel change), and add defensive validation with a clear place-identifying error at the solver input boundary in `packages/solver`

## 5. Map marker UX

- [x] 5.1 Hovering a map marker shows the place name (tooltip or popup)
- [x] 5.2 Colour-code markers by place category with a fixed category→colour palette; keep per-day numbers readable on the marker and the home base visually distinct

## 6. Right-click place creation

- [x] 6.1 Right-click on the map opens a small context menu at the cursor with "Add place here"; choosing it opens the place editor prefilled with those coordinates (same flow as click-to-add)
- [x] 6.2 Context menu dismisses on click elsewhere, on action, or Escape; suppress the browser's default context menu on the map

## 7. Verify

- [x] 7.1 `pnpm build` passes and `pnpm test` is green


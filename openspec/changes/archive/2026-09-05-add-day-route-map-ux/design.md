# Design: add-day-route-map-ux

## 1. Add-place fix (root cause)

`openPlaceEditor(null, coords)` sets `editingPlaceId: null`, and `PlaceEditor` computes `isNew = !existing && editingPlaceId === "new" && pendingCoords !== null` — so `null` renders nothing. Fix: in `store.openPlaceEditor`, map a null placeId **with coords** to `editingPlaceId: "new"`; a null placeId **without** coords means "close". Verify all three call sites (map click, context-menu action, and any explicit close) behave.

## 2. Route polylines

In `MapView`, maintain one GeoJSON source per day (or a single source with a `dayId`/`color` feature property) fed from `itinerary.days`: coordinates = base start → stops in order → base end, resolved from `trip.places`. Add a `line` layer per day (or one layer with data-driven `line-color`) using `DAY_COLORS[dayIndex]`. Update sources whenever `itinerary` changes. Keep markers above lines (layer order).

## 3. Day-coloured marker borders

Marker element: category-colour fill (existing `CATEGORY_COLORS`) + `border: 3px solid DAY_COLORS[dayIndex]` when scheduled, neutral dashed grey border when unscheduled. Day index comes from the itinerary (existing `markersFor` already maps place → day). Base marker keeps its distinct styling.

## 4. Day card click-to-focus + eye toggle

- Store gains `hiddenDays: Set<string>` (dayId) and `focusDayId: string | null` (UI-only, not persisted), with actions `toggleDayHidden(dayId)` and `focusDay(dayId)`.
- `Timeline` day headers: eye button toggles `hiddenDays`; clicking the day card header calls `focusDay(dayId)`.
- `MapView`: skips hidden days when building markers and route lines; on `focusDayId` change, `map.fitBounds` over that day's route coordinates (with padding) — compute bounds from the day's line coordinates.

## 5. Autosave indicator

Store gains `saveState: "idle" | "saving" | "saved"` + `savedAt: string | null`. `persist()` sets `saving` before the repo call, `saved` + timestamp on success (debounce back to `idle` after ~2 s, optional). `TripScreen` header renders "Saving…" / "Saved HH:MM". Because `mutateTrip` and worker-triggered persistence both flow through `persist`, both paths are covered.

## Constraints

- No schema changes; hidden-days and focus are ephemeral UI state.
- Keep map layer/marker updates efficient (reuse sources; don't recreate the map).
- `pnpm build` and `pnpm test` stay green; add cheap unit coverage for the openPlaceEditor "new" mapping if practical.

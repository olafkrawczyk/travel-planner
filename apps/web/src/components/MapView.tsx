import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Category, Itinerary, Place, Trip } from "@app/domain";
import { BASE_MARKER_COLOR, dayColor, useStore } from "../store";
import { hotelNeedsLocation } from "./StaysPanel";
import { ErrorBoundary, CrashFallbackShell, type CrashFallbackProps } from "./ErrorBoundary";

/**
 * Required attribution (release audit BLOCKER #1). OpenFreeMap's usage
 * policy requires the credit "OpenFreeMap © OpenMapTiles Data from
 * OpenStreetMap" verbatim, alongside the pre-existing OSM/Photon credits this
 * string already carried. This used to be passed to MapLibre's built-in
 * `AttributionControl` as `customAttribution`, but that control *merges*
 * `customAttribution` with any `attribution` strings it finds on the style's
 * own sources — and only de-dupes by exact string match, not substring. The
 * Liberty style's sources apparently carry a short attribution string that
 * prefix-overlaps this one, so the built-in control rendered both
 * concatenated: a visibly duplicated credit line. To guarantee the credit
 * renders exactly once with exactly this content, map creation below
 * disables the built-in control (`attributionControl: false`) and adds the
 * small custom `IControl` defined at `createAttributionControl` instead,
 * which just drops this HTML into a `div` with no merge/dedupe logic at all.
 */
const OSM_ATTR =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors · <a href="https://photon.komoot.io" target="_blank">geocoding by Photon</a> contributors';

/** Minimal custom map control that renders `OSM_ATTR` verbatim, once — see
 *  the doc comment on `OSM_ATTR` above for why this exists instead of
 *  `maplibregl.AttributionControl`. Follows the same `onAdd`/`onRemove`
 *  shape MapLibre's own controls use (`maplibregl-ctrl` is its base class
 *  for control chrome; `map-attribution` carries this file's own styling).
 *  `elRef` is populated with the control's own element so the component can
 *  later measure/reposition it (see the dynamic bottom-offset effect below,
 *  which keeps it clear of the mobile bottom-sheet timeline). */
function createAttributionControl(elRef: { current: HTMLDivElement | null }): maplibregl.IControl {
  let container: HTMLDivElement | null = null;
  return {
    onAdd() {
      container = document.createElement("div");
      container.className = "maplibregl-ctrl map-attribution";
      container.innerHTML = OSM_ATTR;
      elRef.current = container;
      return container;
    },
    onRemove() {
      container?.remove();
      container = null;
      elRef.current = null;
    },
  };
}

/** Small glyph shown as a secondary corner badge on non-hotel markers, so
 *  category survives as information without a second competing colour
 *  channel (day colour already owns the marker fill/border). */
const CATEGORY_GLYPH: Record<Category, string> = {
  museum: "🏛",
  viewpoint: "👁",
  cafe: "☕",
  restaurant: "🍴",
  shop: "🛍",
  park: "🌳",
  temple: "⛩",
  hotel: "🛏",
  other: "•",
};

/** Text form of the category glyph above, for the marker's accessible name
 *  (P0 #3) — the glyph itself stays `aria-hidden`, so category has to reach
 *  screen-reader users some other way. */
const CATEGORY_LABEL: Record<Category, string> = {
  museum: "museum",
  viewpoint: "viewpoint",
  cafe: "cafe",
  restaurant: "restaurant",
  shop: "shop",
  park: "park",
  temple: "temple",
  hotel: "hotel",
  other: "place",
};

/** Hotels (by category) are the lodging/base markers; `dwellMin === 0` is
 *  the legacy base heuristic kept for places without an explicit category. */
function isHotelPlace(place: Place): boolean {
  return place.category === "hotel" || place.dwellMin === 0;
}

/** Marker fill colour: bases use the fixed base-marker colour, scheduled
 *  places use their day's colour, and unscheduled non-hotel places get no
 *  inline colour at all — CSS supplies their neutral dashed/transparent
 *  "unscheduled" styling, which an inline colour would otherwise mask. */
function colorFor(place: Place, dayIndex: number): string | null {
  if (isHotelPlace(place)) return BASE_MARKER_COLOR;
  if (dayIndex >= 0) return dayColor(dayIndex);
  return null;
}

/** Resolve a `var(--token)` string to a concrete colour, for contexts (like
 *  MapLibre GeoJSON feature properties) that can't consume CSS custom
 *  properties directly. Falls back to the neutral `--text-muted` token if
 *  the requested one can't be resolved. */
function resolveCssColor(varExpr: string): string {
  const style = getComputedStyle(document.documentElement);
  const name = /var\((--[\w-]+)\)/.exec(varExpr)?.[1] ?? "--text-muted";
  return style.getPropertyValue(name).trim() || style.getPropertyValue("--text-muted").trim();
}

/** Category colour + day number per place, from the latest itinerary. Base
 *  (hotel) markers are included only when `showBases` is on. */
function markersFor(trip: Trip, itinerary: Itinerary | null, showBases: boolean) {
  const byPlace = new Map<string, { dayIndex: number; number: number; dayId: string }>();
  itinerary?.days.forEach((plan, dayIndex) => {
    plan.stops.forEach((stop, i) => {
      byPlace.set(stop.placeId, { dayIndex, number: i + 1, dayId: plan.dayId });
    });
  });
  return trip.places
    .filter((p) => showBases || p.dwellMin !== 0) // hidden bases: no hotel markers, routes unchanged
    .map((p) => {
    const m = byPlace.get(p.id);
    const dayIndex = m?.dayIndex ?? -1;
    return {
      place: p,
      dayIndex,
      dayId: m?.dayId,
      number: m?.number,
      color: colorFor(p, dayIndex),
    };
  });
}

/** Turn a straight path through `coords` into a gently arced one: each
 *  consecutive pair of points becomes a quadratic-Bezier arc that bulges a
 *  modest fraction of the segment's length away from its midpoint (sides
 *  alternate per segment, so a day's route reads as a gentle wave rather
 *  than a straight-line "star" pattern radiating from a shared hub). The
 *  arc still passes through every real coordinate exactly — only the
 *  in-between geometry is curved — which is enough to visually separate
 *  crossing day routes without attempting real road geometry (out of
 *  scope). */
function curveThroughPoints(coords: [number, number][]): [number, number][] {
  if (coords.length < 2) return coords;
  const OFFSET_FRACTION = 0.1;
  const STEPS_PER_SEGMENT = 14;
  const result: [number, number][] = [coords[0]!];
  for (let i = 0; i < coords.length - 1; i++) {
    const [x0, y0] = coords[i]!;
    const [x1, y1] = coords[i + 1]!;
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const side = i % 2 === 0 ? 1 : -1;
    // Unit vector perpendicular to the segment, flipped every other segment.
    const perpX = len === 0 ? 0 : (-dy / len) * side;
    const perpY = len === 0 ? 0 : (dx / len) * side;
    const controlX = midX + perpX * len * OFFSET_FRACTION;
    const controlY = midY + perpY * len * OFFSET_FRACTION;
    for (let s = 1; s <= STEPS_PER_SEGMENT; s++) {
      const t = s / STEPS_PER_SEGMENT;
      const inv = 1 - t;
      const x = inv * inv * x0 + 2 * inv * t * controlX + t * t * x1;
      const y = inv * inv * y0 + 2 * inv * t * controlY + t * t * y1;
      result.push([x, y]);
    }
  }
  return result;
}

/** GeoJSON line per solved day: base start → ordered stops → base end, in the
 *  day's colour. The colour is resolved to a concrete value here (GeoJSON
 *  feature properties are plain data — MapLibre's `["get", "color"]` paint
 *  expression can't dereference a live CSS custom property), so this must be
 *  re-run whenever the colour scheme changes, not just when the trip does. */
function routeFeatures(
  trip: Trip,
  itinerary: Itinerary | null,
  hiddenDays: Set<string>,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const byId = new Map(trip.places.map((p) => [p.id, p]));
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  itinerary?.days.forEach((plan, dayIndex) => {
    if (hiddenDays.has(plan.dayId)) return;
    const day = trip.days.find((d) => d.id === plan.dayId);
    if (!day) return;
    const ids = [day.baseStartId, ...plan.stops.map((s) => s.placeId), day.baseEndId];
    const coordinates: [number, number][] = [];
    for (const id of ids) {
      const p = byId.get(id);
      if (p) coordinates.push([p.lng, p.lat]);
    }
    if (coordinates.length < 2) return;
    features.push({
      type: "Feature",
      properties: { dayId: plan.dayId, color: resolveCssColor(dayColor(dayIndex)) },
      geometry: { type: "LineString", coordinates: curveThroughPoints(coordinates) },
    });
  });
  return { type: "FeatureCollection", features };
}

/**
 * Center coordinates for the current trip: the day-0 wake-up base (hotel) place,
 * falling back to the first place, then to Tokyo as a last resort.
 */
function baseCenter(trip: Trip | null): [number, number] {
  const byId = trip ? new Map(trip.places.map((p) => [p.id, p])) : null;
  const baseId = trip?.days[0]?.baseStartId;
  const place =
    (baseId ? byId?.get(baseId) : undefined) ?? trip?.places[0];
  return place ? [place.lng, place.lat] : [139.7671, 35.6812];
}

/** Bounds enclosing every place in the trip, for framing the whole trip on
 *  load and on trip change (release audit: initial view used to be just the
 *  hotel at a fixed zoom, which put far-flung stops off-screen). Returns
 *  `null` when the trip has no places yet — `fitBounds` needs at least one
 *  coordinate — so callers fall back to `baseCenter` + a fixed zoom instead.
 *  Reuses the same `coordinates.reduce(...)` pattern the focusDayId effect
 *  below uses to build a single day's bounds. */
function tripBounds(trip: Trip | null): maplibregl.LngLatBounds | null {
  const coordinates: [number, number][] = (trip?.places ?? []).map((p) => [p.lng, p.lat]);
  if (coordinates.length === 0) return null;
  return coordinates.reduce(
    (b, c) => b.extend(c),
    new maplibregl.LngLatBounds(coordinates[0]!, coordinates[0]!),
  );
}

/** Padding for `fitBounds` calls that frame the whole trip. Desktop keeps
 *  generous, roughly even padding for breathing room around floating
 *  controls (search box, hotel toggle, nav control, attribution strip) — the
 *  timeline panel itself is a separate CSS grid column outside the map's own
 *  container, so fitBounds computed against the map canvas already excludes
 *  it without extra right-padding. On mobile the timeline instead becomes a
 *  bottom-sheet overlay covering roughly the bottom half of the map, so
 *  bottom padding is computed from the container's own current height (not
 *  cached — viewport/container size can differ between calls) to keep the
 *  fitted bounds in the visible top portion above the sheet. */
function fitBoundsPadding(containerEl: HTMLElement | null): maplibregl.PaddingOptions {
  const isMobile = window.matchMedia("(max-width: 820px)").matches;
  if (isMobile) {
    const bottom = Math.round((containerEl?.clientHeight ?? 0) * 0.48);
    return { top: 70, bottom: bottom || 200, left: 60, right: 60 };
  }
  return { top: 70, bottom: 70, left: 60, right: 90 };
}

/**
 * Map-scoped crash fallback (release audit BLOCKER #2). `MapView` is by far
 * the most imperative, most crash-prone piece of the UI — direct maplibre-gl
 * DOM/WebGL setup in effects, manual marker DOM construction — so it gets its
 * own boundary (wired up at the bottom of this file) rather than relying
 * solely on the root one in App.tsx. That way a map failure takes down only
 * the map pane: the timeline, stays panel and place editor around it (all
 * siblings of `<MapView/>` in TripScreen) keep working, and the user's
 * itinerary is still visible and editable without the map.
 */
function MapCrashFallback({ error, errorInfo, retry }: CrashFallbackProps) {
  return (
    <div className="map-view crash-fallback-map-pane">
      <CrashFallbackShell
        title="The map couldn't be displayed"
        message={
          <p>
            Your trip and itinerary are unaffected — only the map failed to render. This can happen
            if your browser or device doesn't support the map's graphics requirements (WebGL).
          </p>
        }
        error={error}
        errorInfo={errorInfo}
        actions={<button onClick={retry}>Try showing the map again</button>}
      />
    </div>
  );
}

/** MapLibre map with OpenFreeMap tiles, day-coloured numbered markers (with a
 *  small category glyph badge) and matching route lines, hover tooltips and
 *  hover cross-highlighting, click-to-add and right-click-to-add. */
function MapViewInner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker[]>([]);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  /** placeId → marker pin element, kept across renders so hover/focus (see
   *  the highlight effect below) can toggle a class on the existing DOM
   *  nodes instead of the marker-rebuild effect tearing them all down and
   *  recreating them on every hover (P0 #4). */
  const elByPlaceId = useRef<Map<string, HTMLElement>>(new Map());
  /** The custom attribution control's own element (see
   *  `createAttributionControl`), kept so the effect below can measure the
   *  map/timeline-sheet layout and push it up clear of the sheet on mobile. */
  const attributionElRef = useRef<HTMLDivElement | null>(null);

  /** Right-click context menu state; mirrored in a ref so map event handlers see the latest value. */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; lat: number; lng: number } | null>(
    null,
  );
  const ctxMenuRef = useRef(ctxMenu);
  const menuElRef = useRef<HTMLDivElement | null>(null);

  const trip = useStore((s) => s.currentTrip);
  const itinerary = useStore((s) => s.itinerary);
  const hoveredPlaceId = useStore((s) => s.hoveredPlaceId);
  const hiddenDays = useStore((s) => s.hiddenDays);
  const showBases = useStore((s) => s.showBases);
  const focusDayId = useStore((s) => s.focusDayId);
  const setHovered = useStore((s) => s.setHovered);
  const toggleShowBases = useStore((s) => s.toggleShowBases);
  const openPlaceEditor = useStore((s) => s.openPlaceEditor);
  const [mapLoaded, setMapLoaded] = useState(false);

  /** Update the context-menu state and its event-handler mirror. */
  function updateMenu(next: typeof ctxMenu): void {
    ctxMenuRef.current = next;
    setCtxMenu(next);
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: baseCenter(useStore.getState().currentTrip),
      zoom: 11,
      attributionControl: false,
    });
    // Custom control (see `createAttributionControl` and the doc comment on
    // `OSM_ATTR`) rather than `maplibregl.AttributionControl`: it never
    // auto-collapses to an unlabelled "i" button the way the built-in
    // control's default (non-`compact: false`) behaviour would on narrow
    // viewports, and it can't merge/duplicate the style's own attribution
    // since it doesn't look at the style at all.
    map.addControl(createAttributionControl(attributionElRef), "bottom-left");
    map.addControl(new maplibregl.NavigationControl(), "bottom-right");
    // Suppress the browser's default context menu on the map canvas.
    map.getCanvas().addEventListener("contextmenu", (e) => e.preventDefault());
    map.on("click", (e) => {
      // While the context menu is open, a map click only dismisses it (nothing is created).
      if (ctxMenuRef.current) {
        updateMenu(null);
        return;
      }
      openPlaceEditor(null, { lat: +e.lngLat.lat.toFixed(6), lng: +e.lngLat.lng.toFixed(6) });
    });
    // Right-click opens the "Add place here" context menu at the cursor.
    map.on("contextmenu", (e) => {
      updateMenu({
        x: e.point.x,
        y: e.point.y,
        lat: +e.lngLat.lat.toFixed(6),
        lng: +e.lngLat.lng.toFixed(6),
      });
    });
    // Shared hover tooltip (fast custom popup, replaces the native title).
    const tooltip = document.createElement("div");
    tooltip.className = "marker-tooltip";
    tooltip.hidden = true;
    containerRef.current.appendChild(tooltip);
    tooltipRef.current = tooltip;
    // Route polylines: one GeoJSON source + two data-driven line layers
    // (a wide, light "casing" underneath the coloured line, so crossing day
    // routes stay visually separable), added once at style load; marker DOM
    // elements always render above map layers regardless.
    map.on("load", () => {
      map.addSource("day-routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // Added before the coloured line layer so it paints underneath it.
      map.addLayer({
        id: "day-routes-casing",
        type: "line",
        source: "day-routes",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": resolveCssColor("var(--bg-surface)"),
          "line-width": 6,
          "line-opacity": 0.35,
        },
      });
      map.addLayer({
        id: "day-routes-line",
        type: "line",
        source: "day-routes",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2.5,
          "line-opacity": 0.5,
        },
      });
      // Frame the whole trip on first load (release audit: this used to be
      // just the hotel at a fixed zoom, which left far-flung stops, e.g. a
      // Mt Fuji day trip from a Tokyo hotel, off-screen). `duration: 0` so it
      // snaps rather than animating oddly right as the map appears.
      const bounds = tripBounds(useStore.getState().currentTrip);
      if (bounds) {
        map.fitBounds(bounds, {
          padding: fitBoundsPadding(containerRef.current),
          maxZoom: 14,
          duration: 0,
        });
      }
      setMapLoaded(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      tooltip.remove();
      tooltipRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dismiss the context menu on Escape, or on clicks outside the map and menu
  // (clicks on the map itself are handled by the map "click" handler above).
  useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") updateMenu(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (menuElRef.current?.contains(target)) return;
      const mapEl = mapRef.current?.getCanvas();
      if (mapEl && (target === mapEl || mapEl.contains(target))) return; // map click handler closes it
      updateMenu(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxMenu]);

  // Fit the map to the whole trip's stops whenever the opened trip changes
  // (falls back to centering on the base at a fixed zoom if the trip has no
  // located places yet — `fitBounds` needs at least one coordinate).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !trip) return;
    const bounds = tripBounds(trip);
    if (bounds) {
      map.fitBounds(bounds, {
        padding: fitBoundsPadding(containerRef.current),
        maxZoom: 14,
        duration: 0,
      });
    } else {
      map.jumpTo({ center: baseCenter(trip), zoom: 12 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);

  // Keep the custom attribution strip clear of the timeline panel: on
  // desktop `.timeline-pane` is a side-by-side grid column near the screen's
  // top, so it never overlaps the map's bottom-left corner. On mobile it
  // becomes a draggable bottom-sheet overlay (height between 20vh-85vh) that
  // *does* cover the map's own bottom edge — and since it's a DOM sibling
  // layered above the whole map at the page stacking level, no in-map
  // z-index can win against it (see the release-audit fix for the mobile
  // occlusion bug this replaced a two-part CSS-only attempt at). Instead,
  // this measures how much of the map's bottom the sheet currently covers
  // and pushes the strip up by exactly that much (plus a small gap) via
  // inline `marginBottom` — on desktop that resolves to just the gap itself
  // (coverage clamps to 0), matching the control's existing default margin,
  // so there's no behaviour change there.
  useEffect(() => {
    const map = mapRef.current;
    const containerEl = containerRef.current;
    if (!map || !containerEl) return;
    const GAP = 10;
    const updateOffset = () => {
      const attributionEl = attributionElRef.current;
      if (!attributionEl) return;
      const mapBottom = containerEl.getBoundingClientRect().bottom;
      const sheet = document.querySelector<HTMLElement>(".timeline-pane");
      const coverage = sheet ? Math.max(0, mapBottom - sheet.getBoundingClientRect().top) : 0;
      attributionEl.style.marginBottom = `${coverage + GAP}px`;
    };
    updateOffset();
    window.addEventListener("resize", updateOffset);
    // The sheet is user-draggable (`--sheet-height`), which changes its
    // rendered box size without necessarily firing a window resize —
    // ResizeObserver catches that regardless of what caused it.
    let sheetObserver: ResizeObserver | null = null;
    const sheetEl = document.querySelector<HTMLElement>(".timeline-pane");
    if (sheetEl && typeof ResizeObserver !== "undefined") {
      sheetObserver = new ResizeObserver(updateOffset);
      sheetObserver.observe(sheetEl);
    }
    return () => {
      window.removeEventListener("resize", updateOffset);
      sheetObserver?.disconnect();
    };
  }, [mapLoaded]);

  // Update the route polylines whenever the itinerary, trip or hidden days
  // change — and also on a light/dark scheme switch, since each feature's
  // "color" property is a *resolved* colour baked in at build time (GeoJSON
  // properties can't hold a live CSS var), so it would otherwise freeze at
  // whichever theme was active when the source was last built.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !trip) return;
    const refresh = () => {
      const source = map.getSource("day-routes");
      if (source && "setData" in source) {
        (source as maplibregl.GeoJSONSource).setData(routeFeatures(trip, itinerary, hiddenDays));
      }
      // The casing's colour is also a resolved (non-reactive) value baked in
      // at layer-creation time, same reasoning as the per-feature colours
      // above — re-resolve it here so a scheme switch doesn't leave it
      // frozen at whichever theme was active on first load.
      if (map.getLayer("day-routes-casing")) {
        map.setPaintProperty("day-routes-casing", "line-color", resolveCssColor("var(--bg-surface)"));
      }
    };
    refresh();
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", refresh);
    return () => scheme.removeEventListener("change", refresh);
  }, [trip, itinerary, hiddenDays, mapLoaded]);

  // Cross-highlight routes on hover: where several days' routes overlap (e.g.
  // multiple days crossing central Tokyo), colour alone can't disambiguate a
  // tangle of lines. Hovering a place (or its marker) brightens and widens
  // its own day's route and dims the rest, the same way markers already
  // highlight on hover.
  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      !mapLoaded ||
      !map.getLayer("day-routes-line") ||
      !map.getLayer("day-routes-casing")
    )
      return;
    const plan = itinerary?.days.find((d) => d.stops.some((s) => s.placeId === hoveredPlaceId));
    const hoveredDayId = plan?.dayId;
    if (hoveredDayId) {
      map.setPaintProperty("day-routes-line", "line-opacity", [
        "case",
        ["==", ["get", "dayId"], hoveredDayId],
        0.95,
        0.12,
      ]);
      map.setPaintProperty("day-routes-line", "line-width", [
        "case",
        ["==", ["get", "dayId"], hoveredDayId],
        5,
        2,
      ]);
      map.setPaintProperty("day-routes-casing", "line-opacity", [
        "case",
        ["==", ["get", "dayId"], hoveredDayId],
        0.6,
        0.1,
      ]);
      map.setPaintProperty("day-routes-casing", "line-width", [
        "case",
        ["==", ["get", "dayId"], hoveredDayId],
        8,
        5,
      ]);
    } else {
      map.setPaintProperty("day-routes-line", "line-opacity", 0.5);
      map.setPaintProperty("day-routes-line", "line-width", 2.5);
      map.setPaintProperty("day-routes-casing", "line-opacity", 0.35);
      map.setPaintProperty("day-routes-casing", "line-width", 6);
    }
  }, [hoveredPlaceId, itinerary, mapLoaded]);

  // Focus (fit bounds over) a day's route when its card is clicked in the timeline.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusDayId || !trip || !itinerary) return;
    const plan = itinerary.days.find((d) => d.dayId === focusDayId);
    if (!plan) return;
    const byId = new Map(trip.places.map((p) => [p.id, p]));
    const coordinates: [number, number][] = [];
    for (const stop of plan.stops) {
      const p = byId.get(stop.placeId);
      if (p) coordinates.push([p.lng, p.lat]);
    }
    if (coordinates.length === 0) return;
    const bounds = coordinates.reduce(
      (b, c) => b.extend(c),
      new maplibregl.LngLatBounds(coordinates[0]!, coordinates[0]!),
    );
    map.fitBounds(bounds, { padding: 60, maxZoom: 15, duration: 400 });
    // Clear so clicking the same day again re-triggers the fit.
    useStore.setState({ focusDayId: null });
  }, [focusDayId, trip, itinerary]);

  // Rebuild the marker SET when the places actually shown change — trip,
  // itinerary, hidden days or the hotel-marker toggle. Deliberately does NOT
  // depend on `hoveredPlaceId`/focus: on the 100-place sample that would tear
  // down and recreate ~100 DOM nodes on every mouse-enter (P0 #4). Hover and
  // keyboard-focus cross-highlighting are handled by the separate effect
  // below instead, which just toggles a class on the elements built here.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !trip) return;
    // A rebuild orphans the hovered element; start from a hidden tooltip.
    if (tooltipRef.current) tooltipRef.current.hidden = true;
    for (const m of markerRef.current) m.remove();
    elByPlaceId.current.clear();
    markerRef.current = markersFor(trip, itinerary, showBases)
      .filter(({ dayId }) => !dayId || !hiddenDays.has(dayId)) // hidden days: no markers
      .map(({ place, dayIndex, number, color }) => {
        // Hotels (by category) are the lodging markers — 🛏 glyph, distinct
        // base styling. `dwellMin === 0` is only the legacy base heuristic.
        const isHotel = isHotelPlace(place);
        // P1 #5: a hotel created from the Stays panel at a placeholder
        // location stays visibly flagged, here and in StaysPanel's stay
        // rows, until it's actually repositioned — see hotelNeedsLocation.
        const needsLocation = isHotel && hotelNeedsLocation(place);
        const el = document.createElement("div");
        el.className =
          "map-marker" +
          (isHotel ? " base" : "") +
          (!isHotel && dayIndex < 0 ? " unscheduled" : "") +
          (needsLocation ? " needs-location" : "");
        // Unscheduled non-hotel places get no inline background at all —
        // `color` is null for them, so the CSS "unscheduled" (transparent,
        // dashed) styling shows through instead of being masked.
        if (color) el.style.background = color;
        // Scheduled non-hotel markers carry their day's colour as a border
        // too (a touch darker isn't needed — the surrounding halo border on
        // every other marker state already comes from --bg-surface, so this
        // border is what makes a day marker read as one solid coloured
        // shape rather than a coloured fill with a mismatched grey rim).
        if (!isHotel && dayIndex >= 0 && color) {
          el.style.borderColor = color;
        }
        if (number !== undefined && !isHotel) {
          el.textContent = String(number);
        } else {
          // Hotel markers show a bed glyph (wrapped in a span so the marker's
          // -45° rotation is counter-acted and the glyph stays upright);
          // other unscheduled places keep the neutral dot.
          const label = document.createElement("span");
          label.textContent = isHotel ? "🛏" : "•";
          label.className = isHotel ? "hotel-glyph" : "";
          el.appendChild(label);
        }
        // Keyboard/screen-reader access (P0 #3): a bare hover/click-only div
        // is otherwise entirely inert without a mouse. The day number and
        // category glyph are visual-only (the glyph badge stays
        // aria-hidden below), so both have to be folded into the accessible
        // name instead.
        el.tabIndex = 0;
        el.setAttribute("role", "button");
        const dayLabel = isHotel ? "hotel" : dayIndex >= 0 ? `day ${dayIndex + 1}` : "unscheduled";
        const needsLocationSuffix = needsLocation ? ", needs a location" : "";
        el.setAttribute(
          "aria-label",
          isHotel
            ? `${place.name}, hotel${needsLocationSuffix}`
            : `${place.name}, ${CATEGORY_LABEL[place.category]}, ${dayLabel}`,
        );
        const showTooltip = () => {
          const tooltip = tooltipRef.current;
          if (!tooltip) return;
          const pt = map.project([place.lng, place.lat]);
          tooltip.textContent = isHotel
            ? `Hotel · ${place.name}${needsLocation ? " — needs a location" : ""}`
            : place.name + (dayIndex >= 0 ? ` (day ${dayIndex + 1})` : " (unscheduled)");
          tooltip.style.left = `${pt.x}px`;
          tooltip.style.top = `${pt.y}px`;
          tooltip.hidden = false;
        };
        const hideTooltip = () => {
          if (tooltipRef.current) tooltipRef.current.hidden = true;
        };
        el.addEventListener("mouseenter", () => {
          setHovered(place.id);
          showTooltip();
        });
        el.addEventListener("mouseleave", () => {
          setHovered(null);
          hideTooltip();
        });
        // Keyboard focus drives the same cross-highlighting hover does
        // (setHovered is the one signal both the map and the timeline read).
        el.addEventListener("focus", () => {
          setHovered(place.id);
          showTooltip();
        });
        el.addEventListener("blur", () => {
          setHovered(null);
          hideTooltip();
        });
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          openPlaceEditor(place.id);
        });
        el.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
          e.preventDefault(); // matches the click handler; also stops the page from scrolling on Space
          openPlaceEditor(place.id);
        });
        // The pin's own -45° rotation (see CSS) has to live on a plain child,
        // not on the element MapLibre positions: Marker writes its position
        // transform directly onto the element passed to it, which would
        // otherwise clobber the CSS rotation. Wrapping also gives the
        // category badge an unrotated place to sit, independent of the pin.
        const wrap = document.createElement("div");
        wrap.className = "map-marker-wrap";
        // Explicit stacking order (map.css's `:hover`/`:focus-visible` rule
        // overrides this with a much higher z-index so a hovered/focused
        // marker still always reliably lifts to the very top): later stops
        // in a day sit above earlier ones in dense areas, rather than
        // whichever marker happens to be last in DOM order winning.
        // Unscheduled/hotel markers (no `number`) fall back to 0.
        wrap.style.zIndex = String((number ?? 0) * 10);
        wrap.appendChild(el);
        if (!isHotel) {
          const badge = document.createElement("span");
          badge.className = "map-marker-badge";
          badge.textContent = CATEGORY_GLYPH[place.category] ?? "•";
          badge.setAttribute("aria-hidden", "true");
          wrap.appendChild(badge);
        } else if (needsLocation) {
          // Same corner-badge slot the category glyph uses on non-hotel
          // markers, repurposed here — the accessible name above already
          // says "needs a location" in words, so this glyph stays decorative.
          const badge = document.createElement("span");
          badge.className = "map-marker-badge map-marker-badge-warning";
          badge.textContent = "❗";
          badge.setAttribute("aria-hidden", "true");
          wrap.appendChild(badge);
        }
        elByPlaceId.current.set(place.id, el);
        return new maplibregl.Marker({ element: wrap })
          .setLngLat([place.lng, place.lat])
          .addTo(map);
      });
    // Apply whatever is currently hovered/focused to the freshly built set —
    // the highlight effect below won't re-run just because the set changed.
    const currentHover = useStore.getState().hoveredPlaceId;
    if (currentHover) elByPlaceId.current.get(currentHover)?.classList.add("hovered");
  }, [trip, itinerary, hiddenDays, showBases, setHovered, openPlaceEditor]);

  // Hover/focus cross-highlight (P0 #4): toggle a class on the marker
  // elements the effect above already built, rather than rebuilding them.
  useEffect(() => {
    for (const [placeId, el] of elByPlaceId.current) {
      el.classList.toggle("hovered", placeId === hoveredPlaceId);
    }
  }, [hoveredPlaceId]);

  return (
    <div ref={containerRef} className="map-view">
      <button
        className={`map-toggle-bases${showBases ? " active" : ""}`}
        onClick={toggleShowBases}
        title={showBases ? "Hide hotel markers" : "Show hotel markers"}
        aria-pressed={showBases}
      >
        Hotel
      </button>
      {ctxMenu && (
        <div
          ref={menuElRef}
          className="map-context-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            onClick={() => {
              const { lat, lng } = ctxMenu;
              updateMenu(null);
              openPlaceEditor(null, { lat, lng });
            }}
          >
            Add place here
          </button>
        </div>
      )}
    </div>
  );
}

/** Public export: `MapViewInner` wrapped in its own error boundary — see
 *  `MapCrashFallback`'s doc comment above for why the map gets one separate
 *  from the app-wide boundary in App.tsx. */
export function MapView() {
  return (
    <ErrorBoundary fallback={(props) => <MapCrashFallback {...props} />}>
      <MapViewInner />
    </ErrorBoundary>
  );
}

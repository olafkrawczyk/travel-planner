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

/** Text form of the category for the marker's accessible name. */
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

/**
 * Detect places with identical or very close geographic coordinates (< 25m)
 * and fan them out radially around their centroid so overlapping markers
 * remain individually visible, hoverable, and clickable.
 */
function disperseOverlappingCoords(
  items: Array<{ place: Place }>
): Map<string, [number, number]> {
  const THRESHOLD = 0.00025; // ~25 meters
  const groups: Array<Array<{ id: string; lat: number; lng: number }>> = [];

  for (const item of items) {
    const p = item.place;
    let foundGroup = false;
    for (const group of groups) {
      const rep = group[0]!;
      const dLat = Math.abs(rep.lat - p.lat);
      const dLng = Math.abs(rep.lng - p.lng);
      if (dLat < THRESHOLD && dLng < THRESHOLD) {
        group.push({ id: p.id, lat: p.lat, lng: p.lng });
        foundGroup = true;
        break;
      }
    }
    if (!foundGroup) {
      groups.push([{ id: p.id, lat: p.lat, lng: p.lng }]);
    }
  }

  const result = new Map<string, [number, number]>();
  for (const group of groups) {
    if (group.length === 1) {
      result.set(group[0]!.id, [group[0]!.lng, group[0]!.lat]);
    } else {
      const count = group.length;
      const centerLng = group.reduce((sum, g) => sum + g.lng, 0) / count;
      const centerLat = group.reduce((sum, g) => sum + g.lat, 0) / count;
      const radius = 0.00022; // ~20-25m offset
      const cosLat = Math.cos((centerLat * Math.PI) / 180);

      group.forEach((item, i) => {
        const angle = (2 * Math.PI * i) / count - Math.PI / 2;
        const lng = centerLng + (radius * Math.cos(angle)) / cosLat;
        const lat = centerLat + radius * Math.sin(angle);
        result.set(item.id, [lng, lat]);
      });
    }
  }
  return result;
}

const polylineCache = new Map<string, [number, number][]>();

/** GeoJSON line per solved day: base start → ordered stops → base end, in the
 *  day's colour. Uses road polyline if available from OSRM, otherwise clean
 *  diagram geometry. Emphasizes active day and subdues inactive days to eliminate
 *  spiderwebbing. */
function routeFeatures(
  trip: Trip,
  itinerary: Itinerary | null,
  hiddenDays: Set<string>,
  activeDayId: string | null,
  hoveredPlaceId: string | null,
  routeGeometries: Record<string, [number, number][]>,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const byId = new Map(trip.places.map((p) => [p.id, p]));
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];

  const hoveredDayId = hoveredPlaceId
    ? itinerary?.days.find((d) => d.stops.some((s) => s.placeId === hoveredPlaceId))?.dayId ?? null
    : null;

  itinerary?.days.forEach((plan, dayIndex) => {
    if (hiddenDays.has(plan.dayId)) return;
    const day = trip.days.find((d) => d.id === plan.dayId);
    if (!day) return;
    const ids = [day.baseStartId, ...plan.stops.map((s) => s.placeId), day.baseEndId];
    const rawCoords: [number, number][] = [];
    for (const id of ids) {
      const p = byId.get(id);
      if (p) rawCoords.push([p.lng, p.lat]);
    }
    if (rawCoords.length < 2) return;

    // Use road polyline if available, otherwise direct diagram geometry
    const coordinates = routeGeometries[plan.dayId] ?? rawCoords;

    const isFocused = hoveredDayId
      ? plan.dayId === hoveredDayId
      : activeDayId
        ? plan.dayId === activeDayId
        : dayIndex === 0;

    features.push({
      type: "Feature",
      properties: {
        dayId: plan.dayId,
        color: resolveCssColor(dayColor(dayIndex)),
        isFocused: isFocused ? 1 : 0,
      },
      geometry: { type: "LineString", coordinates },
    });
  });

  // Sort so focused route paints on top
  features.sort(
    (a, b) =>
      ((a.properties?.isFocused as number) ?? 0) -
      ((b.properties?.isFocused as number) ?? 0),
  );

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

/**
 * Retrieve coordinates for the active day's planned stops.
 * Fits the active day's actual planned stops rather than the entire trip,
 * ensuring Day 1 at Fuji is properly framed instead of fitting Tokyo.
 */
function getDayCoordinates(
  trip: Trip | null,
  itinerary: Itinerary | null,
  dayId: string | null,
): [number, number][] {
  if (!trip) return [];
  const byId = new Map(trip.places.map((p) => [p.id, p]));
  const targetDay = dayId ? trip.days.find((d) => d.id === dayId) : trip.days[0];
  const targetDayId = targetDay?.id ?? trip.days[0]?.id;

  const plan = itinerary?.days.find((d) => d.dayId === targetDayId);
  const coordinates: [number, number][] = [];

  if (plan && plan.stops.length > 0) {
    for (const stop of plan.stops) {
      const p = byId.get(stop.placeId);
      if (p) coordinates.push([p.lng, p.lat]);
    }
  }

  // If no planned stops yet for this day, fall back to the day's base hotel
  if (coordinates.length === 0 && targetDay) {
    const base = byId.get(targetDay.baseStartId) ?? byId.get(targetDay.baseEndId);
    if (base) coordinates.push([base.lng, base.lat]);
  }

  // Fallback to trip places if day has neither stops nor base
  if (coordinates.length === 0 && trip.places.length > 0) {
    const p = trip.places[0]!;
    coordinates.push([p.lng, p.lat]);
  }

  return coordinates;
}

/** Padding for `fitBounds` calls that frame the active day or trip. */
function fitBoundsPadding(containerEl: HTMLElement | null): maplibregl.PaddingOptions {
  const isMobile = window.matchMedia("(max-width: 820px)").matches;
  if (isMobile) {
    const bottom = Math.round((containerEl?.clientHeight ?? 0) * 0.48);
    return { top: 70, bottom: bottom || 200, left: 60, right: 60 };
  }
  return { top: 70, bottom: 70, left: 60, right: 90 };
}

function fitDayBounds(
  map: maplibregl.Map,
  coordinates: [number, number][],
  containerEl: HTMLElement | null,
  instant: boolean = false,
) {
  if (coordinates.length === 0) return;
  const padding = fitBoundsPadding(containerEl);

  if (coordinates.length === 1) {
    if (instant) {
      map.jumpTo({ center: coordinates[0]!, zoom: 14 });
    } else {
      map.easeTo({ center: coordinates[0]!, zoom: 14, duration: 400 });
    }
    return;
  }

  const bounds = coordinates.reduce(
    (b, c) => b.extend(c),
    new maplibregl.LngLatBounds(coordinates[0]!, coordinates[0]!),
  );

  map.fitBounds(bounds, {
    padding,
    maxZoom: 15,
    duration: instant ? 0 : 400,
  });
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
  const [activeDayId, setActiveDayId] = useState<string | null>(() => trip?.days[0]?.id ?? null);
  const [routeGeometries, setRouteGeometries] = useState<Record<string, [number, number][]>>({});
  const initialFitDoneRef = useRef(false);

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
          "line-width": ["case", ["==", ["get", "isFocused"], 1], 7, 4],
          "line-opacity": ["case", ["==", ["get", "isFocused"], 1], 0.8, 0.4],
        },
      });
      map.addLayer({
        id: "day-routes-line",
        type: "line",
        source: "day-routes",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["==", ["get", "isFocused"], 1], 3.5, 2],
          "line-opacity": ["case", ["==", ["get", "isFocused"], 1], 0.95, 0.35],
        },
      });
      // Frame the active day (Day 1) on first load.
      const currentTrip = useStore.getState().currentTrip;
      const currentItinerary = useStore.getState().itinerary;
      if (currentTrip) {
        const targetDayId = currentTrip.days[0]?.id ?? null;
        const coords = getDayCoordinates(currentTrip, currentItinerary, targetDayId);
        if (coords.length > 0) {
          fitDayBounds(map, coords, containerRef.current, true);
        } else {
          map.jumpTo({ center: baseCenter(currentTrip), zoom: 12 });
        }
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

  // Fit the map to the active day whenever the opened trip changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !trip) return;
    const targetDayId = trip.days[0]?.id ?? null;
    setActiveDayId(targetDayId);
    const coords = getDayCoordinates(trip, itinerary, targetDayId);
    if (coords.length > 0) {
      fitDayBounds(map, coords, containerRef.current, true);
    } else {
      map.jumpTo({ center: baseCenter(trip), zoom: 12 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);

  // Keep the custom attribution strip clear of the timeline panel: on
  // desktop `.timeline-pane` is a side-by-side grid column beside the map,
  // so it shares no horizontal space with the map's bottom-left corner even
  // though their vertical extents overlap. On mobile it becomes a
  // draggable bottom-sheet overlay (height between 20vh-85vh) that *does*
  // cover the map's own bottom edge — and since it's a DOM sibling layered
  // above the whole map at the page stacking level, no in-map z-index can
  // win against it (see the release-audit fix for the mobile occlusion bug
  // this replaced a two-part CSS-only attempt at). Instead, this measures
  // how much of the map's bottom the sheet currently covers, counting only
  // the vertical overlap when the sheet's horizontal extent actually
  // intersects the map's — and pushes the strip up by exactly that much
  // (plus a small gap) via inline `marginBottom`. On desktop the sheet
  // sits beside the map (no horizontal intersection), so coverage clamps
  // to 0 and this resolves to just the gap itself, matching the control's
  // existing default margin — no behaviour change there.
  useEffect(() => {
    const map = mapRef.current;
    const containerEl = containerRef.current;
    if (!map || !containerEl) return;
    const GAP = 10;
    const updateOffset = () => {
      const attributionEl = attributionElRef.current;
      if (!attributionEl) return;
      const mapRect = containerEl.getBoundingClientRect();
      const sheet = document.querySelector<HTMLElement>(".timeline-pane");
      let coverage = 0;
      if (sheet) {
        const sheetRect = sheet.getBoundingClientRect();
        const horizontalOverlap =
          Math.min(mapRect.right, sheetRect.right) - Math.max(mapRect.left, sheetRect.left);
        if (horizontalOverlap > 0) {
          coverage = Math.max(0, mapRect.bottom - sheetRect.top);
        }
      }
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

  // When itinerary first loads / updates, ensure Day 1 stops are framed
  useEffect(() => {
    if (!trip || !itinerary || !mapLoaded) return;
    if (!initialFitDoneRef.current) {
      const targetDayId = activeDayId ?? trip.days[0]?.id ?? null;
      const coords = getDayCoordinates(trip, itinerary, targetDayId);
      if (coords.length > 0) {
        initialFitDoneRef.current = true;
        const map = mapRef.current;
        if (map) fitDayBounds(map, coords, containerRef.current, true);
      }
    }
  }, [trip, itinerary, mapLoaded, activeDayId]);

  // Fetch real road polylines from OSRM for each day's route when itinerary/trip changes.
  useEffect(() => {
    if (!trip || !itinerary) return;
    let cancelled = false;

    const byId = new Map(trip.places.map((p) => [p.id, p]));
    const toFetch: Array<{ dayId: string; coords: [number, number][] }> = [];

    for (const plan of itinerary.days) {
      if (hiddenDays.has(plan.dayId)) continue;
      const day = trip.days.find((d) => d.id === plan.dayId);
      if (!day) continue;
      const ids = [day.baseStartId, ...plan.stops.map((s) => s.placeId), day.baseEndId];
      const coords: [number, number][] = [];
      for (const id of ids) {
        const p = byId.get(id);
        if (p) coords.push([p.lng, p.lat]);
      }
      if (coords.length >= 2) {
        toFetch.push({ dayId: plan.dayId, coords });
      }
    }

    const fetchAll = async () => {
      for (const { dayId, coords } of toFetch) {
        if (cancelled) return;
        const cacheKey = coords.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(";");
        if (polylineCache.has(cacheKey)) {
          const cached = polylineCache.get(cacheKey)!;
          setRouteGeometries((prev) => (prev[dayId] === cached ? prev : { ...prev, [dayId]: cached }));
          continue;
        }

        try {
          const coordStr = coords.map(([lng, lat]) => `${lng},${lat}`).join(";");
          const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
            if (data.code === "Ok" && data.routes?.[0]?.geometry?.coordinates) {
              const polyline = data.routes[0].geometry.coordinates as [number, number][];
              polylineCache.set(cacheKey, polyline);
              if (!cancelled) {
                setRouteGeometries((prev) => ({ ...prev, [dayId]: polyline }));
              }
            }
          }
        } catch {
          // Gracefully fall back to diagram geometry on offline / failure
        }
      }
    };

    void fetchAll();

    return () => {
      cancelled = true;
    };
  }, [trip, itinerary, hiddenDays]);

  // Update the route polylines whenever itinerary, trip, active day, or polylines change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !trip) return;
    const refresh = () => {
      const source = map.getSource("day-routes");
      if (source && "setData" in source) {
        (source as maplibregl.GeoJSONSource).setData(
          routeFeatures(trip, itinerary, hiddenDays, activeDayId, hoveredPlaceId, routeGeometries),
        );
      }
      if (map.getLayer("day-routes-casing")) {
        map.setPaintProperty("day-routes-casing", "line-color", resolveCssColor("var(--bg-surface)"));
      }
    };
    refresh();
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", refresh);
    return () => scheme.removeEventListener("change", refresh);
  }, [trip, itinerary, hiddenDays, activeDayId, hoveredPlaceId, routeGeometries, mapLoaded]);

  // Focus (fit bounds over) a day's route when its card is clicked in the timeline.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusDayId || !trip || !itinerary) return;
    setActiveDayId(focusDayId);
    const coords = getDayCoordinates(trip, itinerary, focusDayId);
    if (coords.length > 0) {
      fitDayBounds(map, coords, containerRef.current, false);
    }
    // Clear so clicking the same day again re-triggers the fit.
    useStore.setState({ focusDayId: null });
  }, [focusDayId, trip, itinerary]);

  // Build markers: dispersed co-located coordinates, priority z-index for active day, no emoji
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !trip) return;
    // A rebuild orphans the hovered element; start from a hidden tooltip.
    if (tooltipRef.current) tooltipRef.current.hidden = true;
    for (const m of markerRef.current) m.remove();
    elByPlaceId.current.clear();

    const filtered = markersFor(trip, itinerary, showBases)
      .filter(({ dayId }) => !dayId || !hiddenDays.has(dayId));
    const dispersedCoords = disperseOverlappingCoords(filtered);

    markerRef.current = filtered.map(({ place, dayIndex, dayId, number, color }) => {
      const isHotel = isHotelPlace(place);
      const needsLocation = isHotel && hotelNeedsLocation(place);
      const isActiveDay = dayId ? dayId === activeDayId : false;

      const el = document.createElement("div");
      el.className =
        "map-marker" +
        (isHotel ? " base" : "") +
        (!isHotel && dayIndex < 0 ? " unscheduled" : "") +
        (!isActiveDay && dayIndex >= 0 ? " inactive-day" : "") +
        (needsLocation ? " needs-location" : "");

      if (color) el.style.background = color;
      if (!isHotel && dayIndex >= 0 && color) {
        el.style.borderColor = color;
      }

      if (number !== undefined && !isHotel) {
        el.textContent = String(number);
      } else {
        if (isHotel) {
          el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none" style="transform: rotate(45deg);"><path d="M1.5 13V5.75a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1V9" stroke="#F7F9F6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.5 13v-2.25a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1V13" stroke="#F7F9F6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        } else {
          const label = document.createElement("span");
          label.textContent = "•";
          el.appendChild(label);
        }
      }

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

      const [mX, mY] = dispersedCoords.get(place.id) ?? [place.lng, place.lat];

      const showTooltip = () => {
        const tooltip = tooltipRef.current;
        if (!tooltip) return;
        const pt = map.project([mX, mY]);
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
        e.preventDefault();
        openPlaceEditor(place.id);
      });

      const wrap = document.createElement("div");
      wrap.className = "map-marker-wrap";
      // Priority z-index: active day markers render above inactive days
      const baseZ = isActiveDay ? 500 : dayIndex >= 0 ? 100 : 10;
      wrap.style.zIndex = String(baseZ + (number ?? 0) * 10);
      wrap.appendChild(el);

      if (isHotel && needsLocation) {
        const badge = document.createElement("span");
        badge.className = "map-marker-badge map-marker-badge-warning";
        badge.textContent = "!";
        badge.setAttribute("aria-hidden", "true");
        wrap.appendChild(badge);
      }

      elByPlaceId.current.set(place.id, el);
      return new maplibregl.Marker({ element: wrap })
        .setLngLat([mX, mY])
        .addTo(map);
    });

    const currentHover = useStore.getState().hoveredPlaceId;
    if (currentHover) elByPlaceId.current.get(currentHover)?.classList.add("hovered");
  }, [trip, itinerary, hiddenDays, showBases, activeDayId, setHovered, openPlaceEditor]);

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

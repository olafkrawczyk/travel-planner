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
 * OpenStreetMap" verbatim; it says this is added automatically with
 * MapLibre, but that only happens when the style JSON's sources carry an
 * `attribution` field — fetching the Liberty style directly shows its
 * `openmaptiles`/`ne2_shaded` sources do NOT, so nothing here is automatic.
 * All three attributions below are therefore explicit `customAttribution`,
 * alongside the pre-existing OSM/Photon credits this string already carried.
 */
const OSM_ATTR =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors · <a href="https://photon.komoot.io" target="_blank">geocoding by Photon</a> contributors';

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
      geometry: { type: "LineString", coordinates },
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
    // `compact: false` forces the control to stay expanded at every viewport
    // width. MapLibre's default (`compact` unset) auto-collapses to an
    // unlabelled "i" button on any map narrower than 640px — which is most
    // phones — the moment the map is first panned; a required credit that
    // vanishes into an icon after one gesture isn't reliably "visible in the
    // UI" on mobile, so this trades a little screen space for the credit
    // actually staying on screen everywhere.
    map.addControl(
      new maplibregl.AttributionControl({ customAttribution: OSM_ATTR, compact: false }),
    );
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
    // Route polylines: one GeoJSON source + one data-driven line layer, added
    // once at style load; marker DOM elements always render above map layers.
    map.on("load", () => {
      map.addSource("day-routes", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "day-routes-line",
        type: "line",
        source: "day-routes",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 3,
          "line-opacity": 0.75,
        },
      });
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

  // Recenter on the trip's base (hotel) whenever the opened trip changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !trip) return;
    map.jumpTo({ center: baseCenter(trip), zoom: 12 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id]);

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
    if (!map || !mapLoaded || !map.getLayer("day-routes-line")) return;
    const plan = itinerary?.days.find((d) => d.stops.some((s) => s.placeId === hoveredPlaceId));
    const hoveredDayId = plan?.dayId;
    if (hoveredDayId) {
      map.setPaintProperty("day-routes-line", "line-opacity", [
        "case",
        ["==", ["get", "dayId"], hoveredDayId],
        0.95,
        0.15,
      ]);
      map.setPaintProperty("day-routes-line", "line-width", [
        "case",
        ["==", ["get", "dayId"], hoveredDayId],
        5,
        2,
      ]);
    } else {
      map.setPaintProperty("day-routes-line", "line-opacity", 0.75);
      map.setPaintProperty("day-routes-line", "line-width", 3);
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

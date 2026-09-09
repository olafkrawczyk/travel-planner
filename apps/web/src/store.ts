import { produce } from "immer";
import { create } from "zustand";
import {
  type Appointment,
  type Category,
  type Itinerary,
  type Place,
  type Trip,
  newPlaceId,
  tryParseHHMM,
} from "@app/domain";
import { LocalRepository, DexieMatrixCache, matrixCacheKey, type MatrixCache } from "@app/storage";
import { MemoryGeoCache, PhotonClient, OsrmClient, OverpassClient, expandOpeningHours } from "@app/geo";
import { apiMatrixCoords, type Edit, type SuggestedBase } from "@app/solver";
import { applyAutoCluster } from "./clustering";
import { solverClient } from "./worker/solverClient";
import { bridgeLog } from "./worker/log";
import {
  dateRange,
  emptyTrip,
  MAX_TRIP_DAYS,
  multiHotelSampleTrip,
  sampleTrip,
  validateTripLength,
  type AnySampleData,
} from "./tripFactory";
import { staysFor, validateStays, withHotel, type Stay } from "./stays";
import { PHOTON_CONTACT } from "./photonContact";

export { dateRange, MAX_TRIP_DAYS };
export { staysFor, validateStays } from "./stays";
export type { Stay } from "./stays";


/** Home-base marker colour — visually distinct from every day colour. */
export const BASE_MARKER_COLOR = "var(--marker-base)";

/** Day-identity colour for the map (markers + route lines) and any other
 *  per-day accent, e.g. the stays coverage bar. Wraps at 12 so trips longer
 *  than the palette still get a (repeating) colour rather than falling back
 *  to grey. `dayIndex` is 0-based, matching `Itinerary.days` indices. */
export function dayColor(dayIndex: number): string {
  const n = (((dayIndex % 12) + 12) % 12) + 1;
  return `var(--day-${n})`;
}

/** Hidden dev-panel feature flags (design decision 9). */
export interface Flags {
  solverStrategy: "routeFirst" | "clusterFirst";
  walkSpeedKmh: number;
  walkMaxKm: number;
  transitSpeedKmh: number;
  transitOverheadMin: number;
  regionalSpeedKmh: number;
  regionalOverheadMin: number;
  detourFactor: number;
  initialBudgetMs: number;
  editBudgetMs: number;
  /**
   * OSRM base URL for the routing-API travel matrix; empty = disabled (the
   * heuristic is then the sole source of truth for every leg).
   *
   * Defaults to disabled. The public demo server
   * (https://router.project-osrm.org) only actually hosts the car/driving
   * profile and silently ignores the profile segment of the request URL —
   * it returns identical durations for `/table/v1/foot/...`,
   * `/table/v1/driving/...` and `/table/v1/walking/...`. This app always
   * requests "foot", so pointing at that demo server means every "walking"
   * time it reports is secretly a driving time — measured live against a
   * ~78 km real-world leg that came back as a 91-minute "walk" (car-accurate,
   * ~21 hours wrong for a pedestrian). Point this at a server you control
   * that genuinely serves the foot profile before enabling it; a plausibility
   * guard in `@app/solver`'s matrix builder rejects individual legs an
   * enabled server reports at an impossible walking speed, but that is a
   * safety net for a misconfigured/partially-honest server, not a reason to
   * default to one already known not to serve the requested profile.
   */
  osrmBaseUrl: string;
  /** Max nodes per OSRM /table request (public demo limit). */
  osrmMaxNodes: number;
  /** Overpass API base URL for OSM tag lookups (opening-hours prefill). */
  overpassBaseUrl: string;
  /** Auto-fetch opening hours from OSM after adding a place via search. */
  autoFetchOpeningHours: boolean;
}

const defaultFlags: Flags = {
  solverStrategy: "routeFirst",
  walkSpeedKmh: 4.5,
  walkMaxKm: 1.5,
  transitSpeedKmh: 18,
  transitOverheadMin: 12,
  regionalSpeedKmh: 80,
  regionalOverheadMin: 30,
  detourFactor: 1.3,
  initialBudgetMs: 10000,
  editBudgetMs: 5000,
  // Disabled by default — see the `osrmBaseUrl` doc comment above: the
  // public demo server does not actually serve the "foot" profile this app
  // requests, so it is not a safe default source of truth for a pedestrian
  // planner. The heuristic is the documented default; the API is opt-in.
  osrmBaseUrl: "",
  osrmMaxNodes: 100,
  overpassBaseUrl: "https://overpass-api.de",
  autoFetchOpeningHours: true,
};

/** One queued toast (P1 #5, additive). See `StoreState.toasts`. */
export interface ToastEntry {
  id: number;
  message: string;
  kind: "info" | "error";
}

export interface StoreState {
  repo: LocalRepository;
  trips: Trip[];
  currentTrip: Trip | null;
  /** Storage-row revision `currentTrip` was last loaded/saved at (release
   *  audit item 3, cross-tab write conflicts) — null when there is no
   *  current trip, or it hasn't round-tripped through storage yet. A
   *  storage-level bookkeeping concern, deliberately not part of the `Trip`
   *  domain object; see `packages/storage`'s `TripRepository.put`. */
  currentTripRev: number | null;
  itinerary: Itinerary | null;
  solving: boolean;
  past: Trip[];
  future: Trip[];
  hoveredPlaceId: string | null;
  /** Place id whose editor is open, or "new" for map-click creation. */
  editingPlaceId: string | null;
  pendingCoords: { lat: number; lng: number } | null;
  /** Day ids hidden on the map via the timeline eye toggle (UI-only). */
  hiddenDays: Set<string>;
  /** Whether hotel (base) markers are shown on the map (UI-only, default true). */
  showBases: boolean;
  /** Day whose route the map should focus/fit next (UI-only, cleared after use). */
  focusDayId: string | null;
  /** Autosave indicator state; `savedAt` is the ISO timestamp of the last save.
   *  `"error"` means the most recent write to storage failed — the trip in
   *  memory is NOT persisted and stays that way until a later save succeeds
   *  (it does not time out back to `"idle"` on its own, unlike `"saved"`). */
  saveState: "idle" | "saving" | "saved" | "error";
  savedAt: string | null;
  /** Underlying error message from the last failed save, or null. Shown in
   *  the save-status indicator's `title` — see `saveState`. */
  saveError: string | null;
  flags: Flags;
  devPanelOpen: boolean;
  importError: string | null;
  toast: string | null;
  /** Queued toast entries surfaced to the UI (P1 #5, additive): every write to
   *  `toast` above — from any existing call site, unchanged — is drained into
   *  this stack by a module-level subscription below, so no call site needed
   *  to change. `kind: "error"` entries persist until dismissed; `"info"`
   *  entries auto-dismiss. See ToastStack / LiveRegion components. */
  toasts: ToastEntry[];
  /** True once the trip has edits the current itinerary does not reflect
   *  (a deferred edit landed since the last solve started). Cleared whenever
   *  a solve starts, since that solve covers the trip as it stands then. */
  dirty: boolean;
  /** Count of deferred edits piled up since the itinerary went stale — purely
   *  informational, for the Regenerate button's label/title. */
  pendingChanges: number;

  init(): Promise<void>;
  createTrip(name: string, city: string, startDate: string, endDate: string): Promise<void>;
  /** Create + open a curated sample trip (persisted, solves on open). */
  loadSampleTrip(sample: AnySampleData): Promise<void>;
  openTrip(id: string): Promise<void>;
  closeTrip(): void;
  deleteTrip(id: string): Promise<void>;
  exportTripJson(id: string): Promise<string | null>;
  importTripJson(json: string): Promise<boolean>;
  /** Immer-mutate the current trip and persist. Live edits (see `LIVE_EDITS`)
   *  solve immediately, same as always; every other edit only marks the trip
   *  `dirty` — the user regenerates explicitly via `regenerate()`. */
  mutateTrip(recipe: (draft: Trip) => void, edit?: Partial<Edit> & { type: Edit["type"] }): void;
  undo(): void;
  redo(): void;
  /** Run a full solve for the current trip and clear the dirty state.
   *  No-op with no current trip; safe to call while a solve is already in
   *  flight (`resolveCounter` supersedes it, as with any other solve). */
  regenerate(): void;
  setHovered(placeId: string | null): void;
  openPlaceEditor(placeId: string | null, coords?: { lat: number; lng: number }): void;
  toggleDayHidden(dayId: string): void;
  isolateDay(dayId: string): void;
  toggleShowBases(): void;
  focusDay(dayId: string): void;
  addPlace(place: Place): void;
  /** Force an unscheduled place into a day: persists Place.forceDayId and
   *  re-solves with the forceInsert edit (soft day budget relaxed; hard
   *  constraints still apply). */
  forceInsert(placeId: string, dayId: string): void;
  /** Raise an unscheduled place's priority to must; marks the trip dirty for
   *  the next full solve rather than solving immediately. */
  raisePriority(placeId: string): void;
  /** Rewrite the trip's stays: validates contiguous coverage from day 0, then
   *  writes each day's baseStartId/baseEndId per the stay semantics and marks
   *  the trip dirty. On a check-in day the wake-up base is the previous hotel
   *  and the sleep base the new one (travel day). Undo/redo via snapshots. */
  setStays(stays: Stay[]): void;
  /** Create a hotel place and assign it to stay `idx`, and write the stays
   *  back — one undoable mutation. Returns the new place id, or null when
   *  there is no current trip. When `location` is omitted, the hotel is
   *  created at the trip's current base location and stamped with the
   *  placeholder-location sentinel notes (`AUTO_HOTEL_NOTES` in
   *  StaysPanel.tsx / `hotelNeedsLocation`). When `location` is given (e.g.
   *  accepting a hotel-area recommendation — see `add-hotel-area-recommendation`),
   *  the hotel is created at that deliberate location instead and is NOT
   *  flagged as needing a location. */
  addHotelForStay(idx: number, name?: string, location?: { lat: number; lng: number }): string | null;
  /** Suggested bases verified via background shadow solves. */
  suggestedBases: SuggestedBase[];
  /** Dismiss one suggested base. */
  dismissSuggestedBase(id: string): void;
  /** Apply a suggested base to the trip. */
  applySuggestedBase(suggestion: SuggestedBase): void;
  updateFlags(partial: Partial<Flags>): void;
  toggleDevPanel(open?: boolean): void;
  setToast(message: string | null): void;
  /** Dismiss one queued toast (P1 #5, additive — see `toasts`). */
  dismissToast(id: number): void;
}

let resolveCounter = 0;

/** Persistent cache for OSRM travel matrices (main thread only — never the worker). */
const matrixCache: MatrixCache = new DexieMatrixCache();

/** Non-debounced geocoder for one-shot lookups (trip creation). */
const creationGeo = new PhotonClient({
  cache: new MemoryGeoCache(),
  debounceMs: 0,
  appName: "travel-planner",
  contactEmail: PHOTON_CONTACT,
});

/**
 * Write `stays` onto `draft.days`' baseStartId/baseEndId/stayStart — the
 * per-day semantics shared by `setStays` and `addHotelForStay`. On a
 * check-in day the wake-up base is the previous hotel and the sleep base the
 * new one (travel day); `stayStart` is set explicitly on check-in days so two
 * consecutive stays sharing a hotel don't get merged back by `staysFor`.
 */
function applyStaysToDays(draft: Trip, stays: Stay[]): void {
  const nights = new Array<string>(draft.days.length);
  const checkIns = new Set(stays.map((s) => s.checkInDayIdx));
  for (const s of stays) {
    for (let k = 0; k < s.nights; k++) nights[s.checkInDayIdx + k] = s.hotelId;
  }
  for (let d = 0; d < draft.days.length; d++) {
    const day = draft.days[d]!;
    day.baseEndId = nights[d]!;
    day.baseStartId = d === 0 ? nights[0]! : nights[d - 1]!;
    if (checkIns.has(d)) day.stayStart = true;
    else delete day.stayStart;
  }
}

function applyFlagsToSettings(trip: Trip, flags: Flags): void {
  trip.settings.solverStrategy = flags.solverStrategy;
  trip.settings.walkSpeedKmh = flags.walkSpeedKmh;
  trip.settings.walkMaxKm = flags.walkMaxKm;
  trip.settings.transitSpeedKmh = flags.transitSpeedKmh;
  trip.settings.transitOverheadMin = flags.transitOverheadMin;
  trip.settings.regionalSpeedKmh = flags.regionalSpeedKmh;
  trip.settings.regionalOverheadMin = flags.regionalOverheadMin;
  trip.settings.detourFactor = flags.detourFactor;
}

export const useStore = create<StoreState>((set, get) => {
  /** A failed solve invocation must clear the indicator and surface an error — never hang. */
  function failSolve(call: number, e: unknown): void {
    if (call !== resolveCounter) return; // superseded by a newer solve
    const message = e instanceof Error ? e.message : String(e);
    bridgeLog("main: solve failed", { error: message });
    set({ solving: false, toast: `Solve failed: ${message}` });
  }

  /**
   * Cache-first OSRM /table fetch on the main thread, then exactly one
   * follow-up solve with the API matrix. Failures degrade to the heuristic
   * times with a toast — the initial heuristic itinerary is never blocked.
   */
  async function fetchApiMatrixThenReSolve(call: number, trip: Trip): Promise<void> {
    const { flags } = get();
    const baseUrl = flags.osrmBaseUrl.trim();
    if (!baseUrl) return; // disabled → heuristic only, silently
    const coords = apiMatrixCoords(trip);
    if (!coords) return; // some node has no usable coordinates → heuristic only
    if (coords.length > flags.osrmMaxNodes) {
      if (call === resolveCounter) set({ toast: "Routing API unavailable — times are estimates" });
      return;
    }
    try {
      let durations: number[][];
      const profile = trip.settings.carOnly ? "driving" : "foot";
      const key = matrixCacheKey(coords, profile, baseUrl);
      const cached = await matrixCache.get(key);
      if (cached) {
        durations = cached.durations;
      } else {
        const client = new OsrmClient({ baseUrl, maxNodes: flags.osrmMaxNodes, profile });
        durations = await client.fetchTable(coords.map((c) => ({ lat: c.lat, lng: c.lng })));
        void matrixCache.put({ key, durations, fetchedAt: new Date().toISOString() });
      }
      if (call !== resolveCounter) return; // superseded by a newer solve/edit
      set({ solving: true });
      const onProgress = (partial: Itinerary) => {
        if (call === resolveCounter) set({ itinerary: partial });
      };
      const onDone = (final: Itinerary) => {
        if (call === resolveCounter) set({ itinerary: final, solving: false });
      };
      await solverClient
        .solve(trip, { seed: 42, budgetMs: get().flags.initialBudgetMs, apiMatrix: durations, apiProfile: profile }, onProgress, onDone)
        .catch((e) => failSolve(call, e));
    } catch (e) {
      bridgeLog("main: OSRM matrix unavailable", { error: String(e) });
      if (call === resolveCounter) set({ toast: "Routing API unavailable — times are estimates" });
    }
  }

  /**
   * Edits that ARE the solver rather than merely inputs to it, and so must
   * solve immediately instead of just marking the trip dirty:
   *  - `dragToDay`'s recipe is a deliberate no-op — the place only actually
   *    moves because the incremental resolve applies the edit. Deferring it
   *    would make drag-and-drop and the "Move to day…" menu do nothing.
   *  - `forceInsert` is the "couldn't fit" tray's mechanism for placing an
   *    unscheduled place; the relaxed-budget resolve has to run right away
   *    for the tray action to do anything visible.
   */
  const LIVE_EDITS = new Set<Edit["type"]>(["dragToDay", "forceInsert"]);

  /** Kick off a solve for the current trip in the worker. */
  function requestSolve(edit: Edit): void {
    let { currentTrip, itinerary, flags } = get();
    if (!currentTrip) return;

    // Auto-derive missing `Place.region` values only for clusterFirst trips
    // — routeFirst never reads `region`, so running this unconditionally
    // relabelled unrelated places on every solve (including every drag) for
    // no visible effect. Routed through `mutateTrip` (default "full" edit,
    // not a LIVE_EDIT) so this is a normal undoable step — pushed onto the
    // undo stack and persisted like any other edit — instead of the bare
    // `set()`+`persist()` this used to be, which was invisible to undo and
    // fired unconditionally. `mutateTrip` no-ops (no undo entry, no persist)
    // when `applyAutoCluster` doesn't actually change anything.
    if (currentTrip.settings.solverStrategy === "clusterFirst") {
      get().mutateTrip(applyAutoCluster);
      currentTrip = get().currentTrip!;
    }

    const call = ++resolveCounter;
    solverClient.cancelShadowSolves(call);
    // This solve covers the trip as it stands right now, so any edits
    // pending before it are no longer "not yet planned".
    set({ solving: true, dirty: false, pendingChanges: 0, suggestedBases: [] });
    bridgeLog("main: requestSolve", { tripId: currentTrip.id, edit: edit.type });
    const onProgress = (partial: Itinerary) => {
      if (call === resolveCounter) set({ itinerary: partial });
    };
    const onDone = (final: Itinerary) => {
      if (call === resolveCounter) {
        set({ itinerary: final, solving: false });
        // Background shadow solves for base recommendations on full Regenerate
        if (edit.type === "full" || !itinerary) {
          solverClient
            .evaluateBaseSuggestions(call, currentTrip, final, {
              seed: 42,
              budgetMs: 100,
            })
            .then((suggestions) => {
              if (call === resolveCounter) {
                set({ suggestedBases: suggestions });
              }
            })
            .catch((e) => {
              bridgeLog("main: evaluateBaseSuggestions error", { error: String(e) });
            });
        }
      }
    };
    if (edit.type === "full" || !itinerary) {
      solverClient
        .solve(currentTrip, { seed: 42, budgetMs: flags.initialBudgetMs }, onProgress, onDone)
        .catch((e) => failSolve(call, e));
      // Non-blocking background fetch of the OSRM matrix → one re-solve on arrival.
      void fetchApiMatrixThenReSolve(call, currentTrip);
    } else {
      solverClient
        .resolve(
          currentTrip,
          itinerary,
          edit,
          { seed: 42, budgetMs: flags.editBudgetMs },
          onProgress,
          onDone,
        )
        .catch((e) => failSolve(call, e));
    }
  }

  let saveIdleTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Persist the trip and surface save status (saving → saved, then idle).
   *
   * NEVER rejects: a failed write (quota exhausted, private browsing, a
   * blocked IndexedDB upgrade, ...) is recorded in `saveState`/`saveError`
   * and surfaced via a toast instead of being thrown. Every call site here
   * either fires this with `void` or `await`s it without a `.catch` — a
   * rejection would either become an unhandled promise rejection (the `void`
   * sites) or would need to be handled at each `await` site to keep the trip
   * open after a failed save. Recording the failure in state does both jobs
   * at once and is the only signal a caller needs: check `saveState` (or let
   * the header's indicator do it) rather than the promise's outcome.
   *
   * Cross-tab write conflicts (release audit item 3): passes the last known
   * `currentTripRev` as `expectedRev` whenever `trip` is still the open
   * trip, so a stale base (another tab having saved this same trip since we
   * last read/wrote it) comes back flagged in `repo.put`'s result. The write
   * still happens — see `TripRepository.put`'s doc comment for why refusing
   * to save isn't actually safer here — but the user is told via the
   * existing toast stack rather than the clobber staying silent. Returns the
   * put result (or undefined on a failed save) so call sites that set
   * `currentTrip` *after* awaiting persist (createTrip/loadSampleTrip) can
   * seed `currentTripRev` themselves instead of relying on the id-match
   * check below, which can't succeed for them (currentTrip isn't the new
   * trip yet at the time this runs).
   */
  let persistPromise = Promise.resolve();

  async function persist(trip: Trip): Promise<{ rev: number; conflict: boolean } | undefined> {
    const p = persistPromise.then(async () => {
      set({ saveState: "saving" });
      try {
      const isCurrent = get().currentTrip?.id === trip.id;
      const expectedRev = isCurrent ? (get().currentTripRev ?? undefined) : undefined;
      const result = await get().repo.put(trip, expectedRev);
      set((s) => ({
        saveState: "saved",
        savedAt: new Date().toISOString(),
        saveError: null,
        currentTripRev: s.currentTrip?.id === trip.id ? result.rev : s.currentTripRev,
      }));
      if (result.conflict) {
        set({
          toast:
            "This trip was changed in another tab since you last opened it here — your latest edit was saved on top of that change. Check nothing important got overwritten.",
        });
      }
      clearTimeout(saveIdleTimer);
      saveIdleTimer = setTimeout(() => set({ saveState: "idle" }), 2000);
      return result;
    } catch (e) {
      clearTimeout(saveIdleTimer); // stay in "error" — do not time out back to "idle"
      const message = e instanceof Error ? e.message : String(e);
      bridgeLog("main: persist failed", { error: message });
      set({
        saveState: "error",
        saveError: message,
        toast: `Save failed — your changes are not being saved (${message}).`,
      });
      return undefined;
    }
  });
  persistPromise = p.catch(() => {}) as any;
  return p;
}

  return {
    repo: new LocalRepository(),
    trips: [],
    currentTrip: null,
    currentTripRev: null,
    itinerary: null,
    solving: false,
    past: [],
    future: [],
    hoveredPlaceId: null,
    editingPlaceId: null,
    pendingCoords: null,
    hiddenDays: new Set<string>(),
    showBases: true,
    focusDayId: null,
    saveState: "idle",
    savedAt: null,
    saveError: null,
    flags: defaultFlags,
    devPanelOpen: false,
    importError: null,
    toast: null,
    toasts: [],
    dirty: false,
    pendingChanges: 0,
    suggestedBases: [],

    async init() {
      try {
        const { trips, failedCount } = await get().repo.list();
        set({ trips });
        if (failedCount > 0) {
          set({
            toast: `${failedCount} saved trip${failedCount === 1 ? "" : "s"} could not be loaded (possibly corrupted, or saved by a newer version of the app) and ${failedCount === 1 ? "was" : "were"} skipped — your other trips are unaffected.`,
          });
        }
      } catch (e) {
        // Never let this reject: App.tsx calls `void init()`, so a rejection
        // here becomes an unhandled promise rejection and the user just sees
        // an empty trip list — indistinguishable from a fresh install, even
        // though nothing was actually lost. Surface it instead.
        const message = e instanceof Error ? e.message : String(e);
        bridgeLog("main: init failed", { error: message });
        set({
          toast: `Could not load your saved trips (${message}). Your trips have not been deleted — try reloading, or check that this browser allows local storage (e.g. not private/incognito mode).`,
        });
      }
    },

    async createTrip(name, city, startDate, endDate) {
      const dates = dateRange(startDate, endDate);
      if (dates.length === 0) {
        set({ toast: "Invalid date range" });
        return;
      }
      const lengthError = validateTripLength(dates);
      if (lengthError) {
        set({ toast: lengthError });
        return;
      }
      // Geocode the starting city (one non-debounced lookup per trip creation).
      let baseCoords: { lat: number; lng: number } | undefined;
      const cityQuery = city.trim();
      if (cityQuery) {
        try {
          const [hit] = await creationGeo.search(cityQuery, 1);
          if (hit) baseCoords = { lat: +hit.lat.toFixed(6), lng: +hit.lng.toFixed(6) };
        } catch {
          /* geocoding failure: fall back to the default base and tell the user */
        }
      }
      const trip = emptyTrip(name.trim() || "Untitled trip", dates, baseCoords);
      // persist() can't seed `currentTripRev` itself here — `currentTrip` is
      // still whatever was open before (or null), not yet `trip` — so take
      // its returned revision explicitly instead (see persist's doc comment).
      const result = await persist(trip);
      set((s) => ({
        trips: [trip, ...s.trips],
        currentTrip: trip,
        currentTripRev: result?.rev ?? null,
        itinerary: null,
        past: [],
        future: [],
        dirty: false,
        pendingChanges: 0,
        toast:
          baseCoords
            ? s.toast
            : "Could not geocode the starting city — please set the base location manually.",
      }));
      requestSolve({ type: "full" });
    },

    async loadSampleTrip(sample) {
      const trip = "hotels" in sample ? multiHotelSampleTrip(sample) : sampleTrip(sample);
      const result = await persist(trip); // see createTrip's comment on why the rev comes from here
      set((s) => ({
        trips: [trip, ...s.trips],
        currentTrip: trip,
        currentTripRev: result?.rev ?? null,
        itinerary: null,
        past: [],
        future: [],
        dirty: false,
        pendingChanges: 0,
      }));
      requestSolve({ type: "full" });
    },

    async openTrip(id) {
      // Always consult storage for the row's current revision (release audit
      // item 3) — even when a copy is already sitting in the in-memory
      // `trips` list, its revision could be behind whatever another tab has
      // since written. The in-memory trip object is still preferred for the
      // actual content, since it may hold edits this tab made that are
      // persisting but haven't round-tripped back through `get` yet.
      const memTrip = get().trips.find((t) => t.id === id);
      const row = await get().repo.getWithRevision(id);
      const trip = memTrip ?? row?.trip;
      if (!trip) {
        // P2 #7: this used to leave the user on the current screen with no
        // explanation at all. The app has a toast stack now — use it, same
        // as every other "couldn't do that" path in this file. Phrased as
        // "Could not" (not "Couldn't") so `classifyToast`'s regex below
        // actually matches it and treats this as the error it is (persists
        // until dismissed, rather than auto-dismissing like routine info).
        set({ toast: "Could not open that trip — it may have been deleted." });
        return;
      }
      set({
        currentTrip: trip,
        currentTripRev: row?.rev ?? null,
        itinerary: null,
        past: [],
        future: [],
        importError: null,
        dirty: false,
        pendingChanges: 0,
      });
      requestSolve({ type: "full" });
    },

    closeTrip() {
      resolveCounter++; // invalidate in-flight solves
      solverClient.cancelShadowSolves();
      set({
        currentTrip: null,
        currentTripRev: null,
        itinerary: null,
        past: [],
        future: [],
        dirty: false,
        pendingChanges: 0,
        solving: false,
        suggestedBases: [],
      });
    },

    async deleteTrip(id) {
      try {
        await get().repo.delete(id);
      } catch (e) {
        // Never drop the trip from `trips` on a failed delete — that would
        // make it look gone while it's still sitting in storage.
        const message = e instanceof Error ? e.message : String(e);
        bridgeLog("main: delete failed", { error: message });
        set({ toast: `Delete failed — the trip has not been removed (${message}).` });
        return;
      }
      set((s) => ({
        trips: s.trips.filter((t) => t.id !== id),
        currentTrip: s.currentTrip?.id === id ? null : s.currentTrip,
        currentTripRev: s.currentTrip?.id === id ? null : s.currentTripRev,
        itinerary: s.currentTrip?.id === id ? null : s.itinerary,
      }));
    },

    async exportTripJson(id) {
      try {
        return await get().repo.exportJson(id);
      } catch (e) {
        set({ toast: `Export failed: ${String(e)}` });
        return null;
      }
    },

    async importTripJson(json) {
      try {
        const trip = await get().repo.importJson(json);
        set((s) => ({
          // repo.importJson always assigns a fresh id (never trusts/keeps
          // the file's own id — see localRepository.ts's importJson), so
          // this should always be a brand-new trip, never one already in
          // `trips`. Dedupe the same way `mutateTrip` does anyway: two
          // in-memory list entries backed by a single Dexie row is exactly
          // how `deleteTrip` can end up removing the wrong (or both) entries.
          trips: s.trips.some((t) => t.id === trip.id)
            ? s.trips.map((t) => (t.id === trip.id ? trip : t))
            : [trip, ...s.trips],
          importError: null,
          // Always a copy now (fresh id) — say so, since a re-import of a
          // file you previously exported would otherwise look like nothing
          // happened.
          toast: "Trip imported as a new copy",
        }));
        return true;
      } catch (e) {
        set({ importError: `Invalid trip file: ${e instanceof Error ? e.message : String(e)}` });
        return false;
      }
    },

    mutateTrip(recipe, edit = { type: "full" }) {
      const { currentTrip } = get();
      if (!currentTrip) return;
      const next = produce(currentTrip, (draft) => {
        recipe(draft);
        draft.updatedAt = new Date().toISOString();
      });
      if (next === currentTrip) return;
      set((s) => ({
        past: [...s.past.slice(-49), currentTrip],
        future: [],
        currentTrip: next,
        trips: s.trips.some((t) => t.id === next.id)
          ? s.trips.map((t) => (t.id === next.id ? next : t))
          : [next, ...s.trips],
      }));
      void persist(next);
      const e = edit as Edit;
      if (LIVE_EDITS.has(e.type)) {
        // The itinerary already reflects everything up to this point unless
        // the trip is dirty — in which case an incremental resolve would run
        // against an itinerary that predates the pending edits, so fall back
        // to a full solve (which also clears the dirty state).
        requestSolve(get().dirty ? { type: "full" } : e);
      } else {
        set((s) => ({ dirty: true, pendingChanges: s.pendingChanges + 1 }));
      }
    },

    undo() {
      const { past, currentTrip } = get();
      if (past.length === 0 || !currentTrip) return;
      const previous = past[past.length - 1]!;
      resolveCounter++; // invalidate any in-flight solve for the state we're leaving
      set((s) => ({
        past: s.past.slice(0, -1),
        future: [...s.future, currentTrip],
        currentTrip: previous,
        trips: s.trips.map((t) => (t.id === previous.id ? previous : t)),
        dirty: true,
        pendingChanges: s.pendingChanges + 1,
        // The invalidated solve's onDone will never land now (its `call` no
        // longer matches resolveCounter) — clear the indicator ourselves or
        // it spins forever and permanently disables Regenerate.
        solving: false,
      }));
      void persist(previous);
    },

    redo() {
      const { future, currentTrip } = get();
      if (future.length === 0 || !currentTrip) return;
      const next = future[future.length - 1]!;
      resolveCounter++; // invalidate any in-flight solve for the state we're leaving
      set((s) => ({
        future: s.future.slice(0, -1),
        past: [...s.past, currentTrip],
        currentTrip: next,
        trips: s.trips.map((t) => (t.id === next.id ? next : t)),
        dirty: true,
        pendingChanges: s.pendingChanges + 1,
        // Same as undo(): the invalidated solve's onDone will never fire.
        solving: false,
      }));
      void persist(next);
    },

    regenerate() {
      if (!get().currentTrip) return;
      requestSolve({ type: "full" });
    },

    setHovered(placeId) {
      set({ hoveredPlaceId: placeId });
    },

    openPlaceEditor(placeId, coords) {
      // A null placeId WITH coords means "create at these coordinates" → "new";
      // a null placeId without coords means "close the editor".
      const resolved = placeId === null && coords ? "new" : placeId;
      set({ editingPlaceId: resolved, pendingCoords: coords ?? null });
    },

    toggleDayHidden(dayId) {
      set((s) => {
        const hiddenDays = new Set(s.hiddenDays);
        if (hiddenDays.has(dayId)) hiddenDays.delete(dayId);
        else hiddenDays.add(dayId);
        return { hiddenDays };
      });
    },

    isolateDay(dayId) {
      set((s) => {
        const trip = s.currentTrip;
        if (!trip) return {};
        // If it's ALREADY the only visible day, unhide everything.
        // Otherwise, hide all OTHER days.
        const allOtherDays = trip.days.map((d) => d.id).filter((id) => id !== dayId);
        const isOnlyVisible = s.hiddenDays.size === allOtherDays.length && !s.hiddenDays.has(dayId);
        if (isOnlyVisible) {
          return { hiddenDays: new Set() };
        } else {
          return { hiddenDays: new Set(allOtherDays) };
        }
      });
    },

    toggleShowBases() {
      set((s) => ({ showBases: !s.showBases }));
    },

    focusDay(dayId) {
      set({ focusDayId: dayId });
    },

    addPlace(place) {
      get().mutateTrip((draft) => {
        draft.places.push(place);
      });
      // Auto-prefill from OSM (fire-and-forget, silent failure): only for
      // places with an osmId and no existing windows; one small Overpass
      // request per added place.
      const { flags, currentTrip } = get();
      if (!flags.autoFetchOpeningHours || !place.osmId || place.openingHours) return;
      if (!currentTrip) return;
      const dates = currentTrip.days.map((d) => d.date);
      const tripId = currentTrip.id;
      void (async () => {
        try {
          const client = new OverpassClient({ baseUrl: flags.overpassBaseUrl });
          const tags = await client.fetchOsmTags(place.osmId!);
          const expr = tags?.opening_hours;
          if (!expr) return; // no tag / missing element → leave as always open
          const current = get().currentTrip;
          if (!current || current.id !== tripId) return; // trip switched meanwhile
          const windows = expandOpeningHours(expr, dates);
          if (!windows || Object.keys(windows).length === 0) return;
          get().mutateTrip((draft) => {
            const p = draft.places.find((pl) => pl.id === place.id);
            if (p && !p.openingHours) p.openingHours = windows;
          });
        } catch {
          /* silent failure: manual entry remains the source of truth */
        }
      })();
    },

    forceInsert(placeId, dayId) {
      get().mutateTrip(
        (draft) => {
          const p = draft.places.find((pl) => pl.id === placeId);
          if (p) p.forceDayId = dayId;
        },
        { type: "forceInsert", placeId, dayId },
      );
    },

    raisePriority(placeId) {
      get().mutateTrip(
        (draft) => {
          const p = draft.places.find((pl) => pl.id === placeId);
          if (p) p.priority = 1;
        },
        { type: "full" },
      );
    },

    setStays(stays) {
      const { currentTrip } = get();
      if (!currentTrip) return;
      const error = validateStays(stays, currentTrip);
      if (error) {
        set({ toast: error });
        return;
      }
      get().mutateTrip((draft) => {
        applyStaysToDays(draft, stays);
      });
    },

    addHotelForStay(idx, name, location) {
      const { currentTrip } = get();
      if (!currentTrip) return null;
      const id = newPlaceId();
      get().mutateTrip((draft) => {
        // No explicit location: copy the current base, as before, and stamp
        // the placeholder-location sentinel (`AUTO_HOTEL_NOTES` in
        // StaysPanel.tsx) so `hotelNeedsLocation` flags it. An explicit
        // location (e.g. from a hotel-area recommendation) is deliberate, so
        // it's used as-is and left unflagged — see design.md decision 11 of
        // `add-hotel-area-recommendation`.
        const base = draft.places.find((p) => p.id === draft.days[0]?.baseStartId) ?? draft.places[0];
        const hotel: Place = {
          id,
          name: name?.trim() || "New hotel (edit me)",
          lat: location?.lat ?? base?.lat ?? 0,
          lng: location?.lng ?? base?.lng ?? 0,
          category: "hotel",
          dwellMin: 0,
          priority: 3,
          notes: location
            ? "Located from a hotel-area recommendation."
            : "Created from the stays panel — edit to set name and location.",
        };
        draft.places.push(hotel);
        applyStaysToDays(draft, withHotel(staysFor(draft), idx, id));
      });
      return id;
    },

    dismissSuggestedBase(id) {
      set((s) => ({
        suggestedBases: s.suggestedBases.filter((b) => b.id !== id),
      }));
    },

    applySuggestedBase(suggestion) {
      const { currentTrip } = get();
      if (!currentTrip) return;
      const id = newPlaceId();
      get().mutateTrip((draft) => {
        const hotel: Place = {
          id,
          name: suggestion.candidateHotel.name,
          lat: suggestion.center.lat,
          lng: suggestion.center.lng,
          category: "hotel",
          dwellMin: 0,
          priority: 3,
          notes: "Located from a hotel-area recommendation.",
        };
        draft.places.push(hotel);
        const updatedStays = suggestion.suggestedStays.map((s) => ({
          hotelId: s.hotelId === suggestion.candidateHotel.id ? id : s.hotelId,
          checkInDayIdx: s.checkInDayIdx,
          nights: s.nights,
        }));
        applyStaysToDays(draft, updatedStays);
      });
      set((s) => ({
        suggestedBases: s.suggestedBases.filter((b) => b.id !== suggestion.id),
      }));
      requestSolve({ type: "full" });
    },

    updateFlags(partial) {
      const flags = { ...get().flags, ...partial };
      set({ flags });
      // Heuristic constants live in trip settings — apply to the current trip.
      const { currentTrip } = get();
      if (!currentTrip) return;
      const next = produce(currentTrip, (draft) => {
        applyFlagsToSettings(draft, flags);
        draft.updatedAt = new Date().toISOString();
      });
      set((s) => ({
        past: [...s.past.slice(-49), currentTrip],
        currentTrip: next,
        dirty: true,
        pendingChanges: s.pendingChanges + 1,
      }));
      void persist(next);
    },

    toggleDevPanel(open) {
      set((s) => ({ devPanelOpen: open ?? !s.devPanelOpen }));
    },

    setToast(message) {
      set({ toast: message });
    },

    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },
  };
});

/**
 * P1 #5 (additive, self-contained): every existing `toast` write above —
 * whether through `setToast` or a direct `set({ toast: ... })` in solve/save
 * error paths — remains untouched, including by this subscription: `toast`
 * itself is left exactly as every existing call site (and every existing
 * store test asserting on it directly) already expects. This subscription
 * only *also* appends a queued `ToastEntry` to `toasts` whenever `toast`
 * changes to a new non-null value, so multiple messages (e.g. a save failure
 * followed by a solve failure) can be shown and dismissed independently
 * instead of one clobbering the other. Errors are classified by message
 * content and persist until dismissed; everything else is "info" and
 * auto-dismisses (see ToastStack).
 */
let toastSeq = 0;
function classifyToast(message: string): "info" | "error" {
  // "another tab" (release audit item 3): a cross-tab write-conflict notice
  // is important enough to persist until dismissed, same as any other error
  // here — a user mid-edit is unlikely to be staring at the toast stack
  // during its 4s auto-dismiss window.
  return /\b(fail(ed)?|error|could not|invalid|unavailable|another tab)\b/i.test(message)
    ? "error"
    : "info";
}
useStore.subscribe((state, prev) => {
  if (!state.toast || state.toast === prev.toast) return;
  const entry: ToastEntry = { id: ++toastSeq, message: state.toast, kind: classifyToast(state.toast) };
  useStore.setState((s) => ({ toasts: [...s.toasts, entry] }));
});

/** Convenience: parse an appointment time field, clamping to a default. */
export function appointmentStart(start: string): string {
  const mins = tryParseHHMM(start, 14 * 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export type { Appointment, Category, Place };

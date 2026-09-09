import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The store module instantiates the worker client (module-level `new Worker`)
// and an IndexedDB-backed repository — both unavailable in the node test
// environment, so mock them out.
vi.mock("./worker/solverClient", () => ({
  solverClient: {
    solve: vi.fn(() => new Promise(() => {})),
    resolve: vi.fn(() => new Promise(() => {})),
    evaluateBaseSuggestions: vi.fn(() => Promise.resolve([])),
    cancelShadowSolves: vi.fn(),
  },
}));
vi.mock("@app/storage", () => ({
  // Fake revisions per id, mirroring the real LocalRepository's cross-tab
  // conflict-detection contract (packages/storage/src/localRepository.ts) —
  // store.ts's `persist()` now always reads `.rev`/`.conflict` off `put`'s
  // result, so a mock that resolved `undefined` here would throw.
  LocalRepository: class {
    private revs = new Map<string, number>();
    async put(trip: { id: string }, expectedRev?: number): Promise<{ rev: number; conflict: boolean }> {
      const current = this.revs.get(trip.id) ?? 0;
      const conflict = expectedRev !== undefined && expectedRev !== current;
      const rev = current + 1;
      this.revs.set(trip.id, rev);
      return { rev, conflict };
    }
    async get(): Promise<undefined> {
      return undefined;
    }
    async getWithRevision(): Promise<undefined> {
      return undefined;
    }
    async list(): Promise<{ trips: never[]; failedCount: number }> {
      return { trips: [], failedCount: 0 };
    }
    async delete(): Promise<void> {}
  },
  // In-memory stand-in for the Dexie-backed OSRM matrix cache (node tests
  // have no IndexedDB; the store module instantiates the cache eagerly).
  DexieMatrixCache: class {
    private map = new Map<string, unknown>();
    async get(key: string): Promise<unknown> {
      return this.map.get(key);
    }
    async put(entry: { key: string }): Promise<void> {
      this.map.set(entry.key, entry);
    }
  },
  matrixCacheKey: (coords: { lat: number; lng: number }[], profile: string, baseUrl: string) =>
    `${baseUrl}|${profile}|${coords.map((c) => `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`).join(";")}`,
}));

import type { Itinerary } from "@app/domain";
import { findExternalClusters, evaluateBaseSuggestions, solve, type SuggestedBase } from "@app/solver";
import { LocalRepository } from "@app/storage";
import { multiHotelSampleTrip, emptyTrip, dateRange, MAX_TRIP_DAYS } from "./tripFactory";
import { tokyoHakoneSample } from "./samples/tokyo-hakone";
import { tokyoGrandSample } from "./samples/tokyo-grand";
import { staysFor, useStore, validateStays, type Stay } from "./store";
import { withSplitAt } from "./stays";
import { solverClient } from "./worker/solverClient";
import { hotelNeedsLocation } from "./components/StaysPanel";

const emptyItinerary: Itinerary = {
  days: [],
  unscheduled: [],
  stats: { totalTravelMin: 0, totalWaitMin: 0, score: 0 },
};

describe("openPlaceEditor", () => {
  it("maps a null placeId WITH coords to editingPlaceId 'new' (map-click creation)", () => {
    useStore.setState({ editingPlaceId: null, pendingCoords: null });
    useStore.getState().openPlaceEditor(null, { lat: 35.68, lng: 139.76 });
    expect(useStore.getState().editingPlaceId).toBe("new");
    expect(useStore.getState().pendingCoords).toEqual({ lat: 35.68, lng: 139.76 });
  });

  it("treats a null placeId without coords as 'close the editor'", () => {
    useStore.setState({ editingPlaceId: "new", pendingCoords: { lat: 1, lng: 2 } });
    useStore.getState().openPlaceEditor(null);
    expect(useStore.getState().editingPlaceId).toBeNull();
    expect(useStore.getState().pendingCoords).toBeNull();
  });

  it("opens an existing place by id without pending coords", () => {
    useStore.setState({ editingPlaceId: null, pendingCoords: null });
    useStore.getState().openPlaceEditor("p1");
    expect(useStore.getState().editingPlaceId).toBe("p1");
    expect(useStore.getState().pendingCoords).toBeNull();
  });
});

describe("toggleDayHidden", () => {
  it("adds and removes day ids without touching other entries", () => {
    useStore.setState({ hiddenDays: new Set(["d1"]) });
    useStore.getState().toggleDayHidden("d2");
    expect(useStore.getState().hiddenDays).toEqual(new Set(["d1", "d2"]));
    useStore.getState().toggleDayHidden("d1");
    expect(useStore.getState().hiddenDays).toEqual(new Set(["d2"]));
  });
});

describe("focusDay", () => {
  it("sets focusDayId (UI-only)", () => {
    useStore.setState({ focusDayId: null });
    useStore.getState().focusDay("d3");
    expect(useStore.getState().focusDayId).toBe("d3");
  });
});

describe("staysFor", () => {
  it("derives a single stay for a single-hotel trip", () => {
    const trip = emptyTrip("Test", dateRange("2026-04-01", "2026-04-03"));
    const hotel = trip.places[0]!;
    expect(staysFor(trip)).toEqual([{ hotelId: hotel.id, checkInDayIdx: 0, nights: 3 }]);
  });

  it("derives exactly 2 stays from the Tokyo → Hakone sample (day 3: wake Tokyo, sleep Hakone)", () => {
    const trip = multiHotelSampleTrip(tokyoHakoneSample, "2026-04-01");
    const hotels = trip.places.filter((p) => p.dwellMin === 0);
    const [tokyo, hakone] = hotels as [typeof hotels[0], typeof hotels[0]];
    const stays = staysFor(trip);
    expect(stays).toEqual([
      { hotelId: tokyo!.id, checkInDayIdx: 0, nights: 2 },
      { hotelId: hakone!.id, checkInDayIdx: 2, nights: 3 },
    ]);
    // Check-in day semantics on the stored day: day 3 (index 2) wakes in the
    // old hotel and sleeps in the new one.
    expect(trip.days[2]!.baseStartId).toBe(tokyo!.id);
    expect(trip.days[2]!.baseEndId).toBe(hakone!.id);
  });

  it("tolerates per-day baseStartId inconsistencies by grouping on baseEndId only", () => {
    const trip = emptyTrip("Test", dateRange("2026-04-01", "2026-04-02"));
    const hotel = trip.places[0]!;
    trip.days[0]!.baseStartId = "somewhere-else"; // inconsistent wake-up base
    expect(staysFor(trip)).toEqual([{ hotelId: hotel.id, checkInDayIdx: 0, nights: 2 }]);
  });
});

describe("setStays", () => {
  function tokyoHakoneTrip() {
    return multiHotelSampleTrip(tokyoHakoneSample, "2026-04-01");
  }

  function hotelsOf(trip: ReturnType<typeof tokyoHakoneTrip>) {
    const hotels = trip.places.filter((p) => p.dwellMin === 0);
    return [hotels[0]!, hotels[1]!] as const; // [tokyo, hakone]
  }

  it("writes baseStartId/baseEndId per day from stays", () => {
    const trip = tokyoHakoneTrip();
    const [tokyo, hakone] = hotelsOf(trip);
    useStore.setState({ currentTrip: trip, past: [], future: [] });
    const stays: Stay[] = [
      { hotelId: tokyo.id, checkInDayIdx: 0, nights: 2 },
      { hotelId: hakone.id, checkInDayIdx: 2, nights: 3 },
    ];
    useStore.getState().setStays(stays);
    const next = useStore.getState().currentTrip!;
    const bases = next.days.map((d) => [d.baseStartId, d.baseEndId]);
    expect(bases).toEqual([
      [tokyo.id, tokyo.id], // day 1
      [tokyo.id, tokyo.id], // day 2
      [tokyo.id, hakone.id], // day 3 — check-in day: wake old, sleep new
      [hakone.id, hakone.id], // day 4
      [hakone.id, hakone.id], // day 5
    ]);
  });

  it("round-trips: setStays(staysFor(trip)) leaves the bases unchanged", () => {
    const trip = tokyoHakoneTrip();
    useStore.setState({ currentTrip: trip, past: [], future: [] });
    useStore.getState().setStays(staysFor(trip));
    const next = useStore.getState().currentTrip!;
    expect(next.days.map((d) => [d.baseStartId, d.baseEndId])).toEqual(
      trip.days.map((d) => [d.baseStartId, d.baseEndId]),
    );
  });

  it("rejects non-contiguous coverage with a toast and without mutating", () => {
    const trip = tokyoHakoneTrip();
    const [tokyo] = hotelsOf(trip);
    useStore.setState({ currentTrip: trip, toast: null });
    useStore.getState().setStays([{ hotelId: tokyo.id, checkInDayIdx: 1, nights: 4 }]);
    expect(useStore.getState().toast).toBeTruthy();
    expect(useStore.getState().currentTrip).toBe(trip); // untouched
  });

  it("rejects a stay whose total nights do not fill the trip", () => {
    const trip = tokyoHakoneTrip();
    const [tokyo] = hotelsOf(trip);
    useStore.setState({ currentTrip: trip, toast: null });
    useStore.getState().setStays([{ hotelId: tokyo.id, checkInDayIdx: 0, nights: 3 }]);
    expect(useStore.getState().toast).toBeTruthy();
    expect(useStore.getState().currentTrip).toBe(trip);
  });

  it("validateStays reports unknown hotels", () => {
    const trip = tokyoHakoneTrip();
    expect(validateStays([{ hotelId: "nope", checkInDayIdx: 0, nights: 5 }], trip)).toBeTruthy();
    const [tokyo, hakone] = hotelsOf(trip);
    expect(
      validateStays(
        [
          { hotelId: tokyo.id, checkInDayIdx: 0, nights: 3 },
          { hotelId: hakone.id, checkInDayIdx: 3, nights: 2 },
        ],
        trip,
      ),
    ).toBeNull();
  });

  it("round-trips a split into two same-hotel stays — a plain baseEndId-only derive would merge them back", () => {
    const trip = tokyoHakoneTrip();
    const [tokyo, hakone] = hotelsOf(trip);
    useStore.setState({ currentTrip: trip, past: [], future: [] });
    // The Tokyo stay (days 0-1) is split at day 1, giving two adjacent
    // same-hotel stays; the Hakone stay (day 2 onward) is untouched.
    const split = withSplitAt(staysFor(trip), 1, trip.days.length);
    expect(split).toEqual([
      { hotelId: tokyo.id, checkInDayIdx: 0, nights: 1 },
      { hotelId: tokyo.id, checkInDayIdx: 1, nights: 1 },
      { hotelId: hakone.id, checkInDayIdx: 2, nights: 3 },
    ]);
    useStore.getState().setStays(split);
    const next = useStore.getState().currentTrip!;
    expect(staysFor(next)).toEqual(split);
  });
});

describe("addHotelForStay", () => {
  function tokyoHakoneTrip() {
    return multiHotelSampleTrip(tokyoHakoneSample, "2026-04-01");
  }

  it("creates a hotel place and assigns it to the given stay in one undoable mutation", () => {
    const trip = tokyoHakoneTrip();
    const placesBefore = trip.places.length;
    useStore.setState({ currentTrip: trip, past: [], future: [] });
    const id = useStore.getState().addHotelForStay(1, "New Hakone Inn");
    expect(id).toBeTruthy();
    const next = useStore.getState().currentTrip!;
    expect(next.places).toHaveLength(placesBefore + 1);
    const hotel = next.places.find((p) => p.id === id);
    expect(hotel?.category).toBe("hotel");
    expect(hotel?.name).toBe("New Hakone Inn");
    expect(staysFor(next)[1]?.hotelId).toBe(id); // assigned to the second stay
    // One undo entry covers both the place creation and the stay reassignment.
    expect(useStore.getState().past).toEqual([trip]);
  });

  it("defaults the hotel's name when none is given", () => {
    const trip = tokyoHakoneTrip();
    useStore.setState({ currentTrip: trip, past: [], future: [] });
    const id = useStore.getState().addHotelForStay(0);
    const hotel = useStore.getState().currentTrip!.places.find((p) => p.id === id);
    expect(hotel?.name).toBe("New hotel (edit me)");
  });

  it("returns null and does nothing when there is no current trip", () => {
    useStore.setState({ currentTrip: null, past: [], future: [] });
    expect(useStore.getState().addHotelForStay(0)).toBeNull();
    expect(useStore.getState().past).toEqual([]);
  });

  it("creates the hotel at an explicit location and does not flag it as needing a location, while a no-location call still does", () => {
    const trip = tokyoHakoneTrip();
    useStore.setState({ currentTrip: trip, past: [], future: [] });

    const locatedId = useStore.getState().addHotelForStay(1, "Hakone Ryokan", { lat: 35.23, lng: 139.03 });
    const located = useStore.getState().currentTrip!.places.find((p) => p.id === locatedId);
    expect(located?.lat).toBe(35.23);
    expect(located?.lng).toBe(139.03);
    expect(hotelNeedsLocation(located)).toBe(false);
    expect(staysFor(useStore.getState().currentTrip!)[1]?.hotelId).toBe(locatedId);

    // A no-location call (existing behaviour) still copies the base and is
    // still flagged as needing a location — unaffected by the new parameter.
    const placeholderId = useStore.getState().addHotelForStay(0);
    const placeholder = useStore.getState().currentTrip!.places.find((p) => p.id === placeholderId);
    expect(hotelNeedsLocation(placeholder)).toBe(true);
  });
});

describe("suggested bases (applySuggestedBase / dismissSuggestedBase)", () => {
  function tokyoHakoneTrip() {
    return multiHotelSampleTrip(tokyoHakoneSample, "2026-04-01");
  }

  function sampleSuggestedBase(): SuggestedBase {
    return {
      id: "sug_hakone",
      clusterId: "cluster-2",
      label: "Near Hakone Shrine",
      center: { lat: 35.2, lng: 139.02 },
      radiusKm: 2.5,
      candidateHotel: {
        id: "hotel_candidate_cluster-2",
        name: "Hotel Near Hakone Shrine",
        lat: 35.2,
        lng: 139.02,
        category: "hotel",
        dwellMin: 0,
        priority: 3,
        notes: "Located from a hotel-area recommendation.",
      },
      suggestedStays: [
        { hotelId: "p_tokyo_base", checkInDayIdx: 0, nights: 3 },
        { hotelId: "hotel_candidate_cluster-2", checkInDayIdx: 3, nights: 2 },
      ],
      suggestedNights: 2,
      baselineTravelMin: 240,
      candidateTravelMin: 120,
      savingsMin: 120,
      rationale: "Saves ~120 min transit across 2 nights.",
      kind: "transit-saver",
      rescuedCount: 0,
    };
  }

  it("applies a suggested base: adds the located hotel, writes the stays, and clears the suggestion", () => {
    const trip = tokyoHakoneTrip();
    const initialPlacesCount = trip.places.length;
    const suggestion = sampleSuggestedBase();

    useStore.setState({
      currentTrip: trip,
      past: [],
      future: [],
      suggestedBases: [suggestion],
    });

    useStore.getState().applySuggestedBase(suggestion);

    const nextTrip = useStore.getState().currentTrip!;
    expect(nextTrip.places).toHaveLength(initialPlacesCount + 1);

    // Hotel must be created at recommended location
    const newHotel = nextTrip.places.find((p) => p.name === "Hotel Near Hakone Shrine")!;
    expect(newHotel).toBeDefined();
    expect(newHotel.lat).toBe(35.2);
    expect(newHotel.lng).toBe(139.02);
    expect(newHotel.category).toBe("hotel");
    expect(hotelNeedsLocation(newHotel)).toBe(false);

    // Stays must reflect the candidate stay schedule
    const stays = staysFor(nextTrip);
    expect(stays).toHaveLength(2);
    expect(stays[0]!.nights).toBe(3);
    expect(stays[1]!.nights).toBe(2);
    expect(stays[1]!.hotelId).toBe(newHotel.id);
    expect(stays[1]!.checkInDayIdx).toBe(3);

    // Suggestion must be cleared from state
    expect(useStore.getState().suggestedBases).toEqual([]);
    // Undo step pushed
    expect(useStore.getState().past).toHaveLength(1);
  });

  it("applies a capacity-expander suggested base identically to a transit-saver base", () => {
    const trip = tokyoHakoneTrip();
    const initialPlacesCount = trip.places.length;
    const expanderSuggestion: SuggestedBase = {
      ...sampleSuggestedBase(),
      id: "sug_expander",
      kind: "capacity-expander",
      rescuedCount: 5,
      savingsMin: -40,
      rationale: "Lets you fit 5 more places.",
    };

    useStore.setState({
      currentTrip: trip,
      past: [],
      future: [],
      suggestedBases: [expanderSuggestion],
    });

    useStore.getState().applySuggestedBase(expanderSuggestion);

    const nextTrip = useStore.getState().currentTrip!;
    expect(nextTrip.places).toHaveLength(initialPlacesCount + 1);

    const newHotel = nextTrip.places.find((p) => p.name === "Hotel Near Hakone Shrine")!;
    expect(newHotel).toBeDefined();
    expect(newHotel.lat).toBe(35.2);
    expect(newHotel.lng).toBe(139.02);
    expect(newHotel.category).toBe("hotel");

    const stays = staysFor(nextTrip);
    expect(stays).toHaveLength(2);
    expect(stays[1]!.hotelId).toBe(newHotel.id);

    expect(useStore.getState().suggestedBases).toEqual([]);
    expect(useStore.getState().past).toHaveLength(1);
  });

  it("dismisses a suggested base without modifying the trip", () => {
    const trip = tokyoHakoneTrip();
    const suggestion = sampleSuggestedBase();

    useStore.setState({
      currentTrip: trip,
      suggestedBases: [suggestion],
    });

    useStore.getState().dismissSuggestedBase(suggestion.id);
    expect(useStore.getState().suggestedBases).toEqual([]);
    expect(useStore.getState().currentTrip).toBe(trip);
  });

  it("suggests Tokyo base when Tokyo 100 places have an active hotel in Yokohama", () => {
    const trip = multiHotelSampleTrip(tokyoGrandSample, "2026-04-01");
    // Add Yokohama hotel
    const yokohamaHotel = {
      id: "hotelYokohama",
      name: "Yokohama Bay Hotel",
      lat: 35.455,
      lng: 139.631,
      category: "hotel" as const,
      dwellMin: 0,
      priority: 3 as const,
    };
    trip.places.push(yokohamaHotel);
    // Point all days to Yokohama as active base
    for (const d of trip.days) {
      d.baseStartId = yokohamaHotel.id;
      d.baseEndId = yokohamaHotel.id;
      delete d.stayStart;
    }

    const external = findExternalClusters(trip);
    expect(external.length).toBeGreaterThanOrEqual(1);

    const baseline = solve({ trip, seed: 42, budgetMs: 50 });
    const suggestions = evaluateBaseSuggestions(trip, baseline, { seed: 42, budgetMs: 50 });
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions[0]!.savingsMin).toBeGreaterThanOrEqual(45);
    expect(suggestions[0]!.label).toBeDefined();
  });
});

describe("deferred solving (dirty / pendingChanges / regenerate)", () => {
  function tokyoHakoneTrip() {
    return multiHotelSampleTrip(tokyoHakoneSample, "2026-04-01");
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // mutateTrip's own no-op guard compares the produced trip by reference;
    // an empty recipe (dragToDay's) only changes `updatedAt`, so the clock
    // must tick between creating the trip and mutating it or the two
    // timestamps can land in the same millisecond and immer returns the
    // trip unchanged, masking the solve call these tests assert on.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Advance the fake clock so the next mutateTrip's `updatedAt` differs. */
  function tick() {
    vi.setSystemTime(new Date(Date.now() + 1000));
  }

  it("a deferred edit (raisePriority) marks the trip dirty and does not solve", () => {
    const trip = tokyoHakoneTrip();
    const placeId = trip.places[0]!.id;
    useStore.setState({
      currentTrip: trip,
      itinerary: emptyItinerary,
      past: [],
      future: [],
      dirty: false,
      pendingChanges: 0,
      solving: false,
    });
    useStore.getState().raisePriority(placeId);
    const state = useStore.getState();
    expect(state.dirty).toBe(true);
    expect(state.pendingChanges).toBe(1);
    expect(solverClient.solve).not.toHaveBeenCalled();
    expect(solverClient.resolve).not.toHaveBeenCalled();
  });

  it("a dragToDay edit solves immediately (incremental resolve) when not dirty", () => {
    const trip = tokyoHakoneTrip();
    const placeId = trip.places[0]!.id;
    const dayId = trip.days[0]!.id;
    useStore.setState({
      currentTrip: trip,
      itinerary: emptyItinerary,
      past: [],
      future: [],
      dirty: false,
      pendingChanges: 0,
      solving: false,
    });
    tick();
    useStore.getState().mutateTrip(() => {}, { type: "dragToDay", placeId, dayId });
    expect(solverClient.resolve).toHaveBeenCalledTimes(1);
    expect(solverClient.solve).not.toHaveBeenCalled();
    expect(useStore.getState().dirty).toBe(false);
  });

  it("a dragToDay edit while already dirty does a FULL solve (not resolve) and clears dirty", () => {
    const trip = tokyoHakoneTrip();
    const placeId = trip.places[0]!.id;
    const dayId = trip.days[0]!.id;
    useStore.setState({
      currentTrip: trip,
      itinerary: emptyItinerary,
      past: [],
      future: [],
      dirty: true,
      pendingChanges: 3,
      solving: false,
    });
    tick();
    useStore.getState().mutateTrip(() => {}, { type: "dragToDay", placeId, dayId });
    expect(solverClient.solve).toHaveBeenCalledTimes(1);
    expect(solverClient.resolve).not.toHaveBeenCalled();
    const state = useStore.getState();
    expect(state.dirty).toBe(false);
    expect(state.pendingChanges).toBe(0);
  });

  it("regenerate() runs a full solve and clears dirty state", () => {
    const trip = tokyoHakoneTrip();
    useStore.setState({
      currentTrip: trip,
      itinerary: null,
      past: [],
      future: [],
      dirty: true,
      pendingChanges: 5,
      solving: false,
    });
    useStore.getState().regenerate();
    expect(solverClient.solve).toHaveBeenCalledTimes(1);
    const state = useStore.getState();
    expect(state.dirty).toBe(false);
    expect(state.pendingChanges).toBe(0);
  });

  it("regenerate() is a no-op with no current trip", () => {
    useStore.setState({ currentTrip: null, dirty: false, pendingChanges: 0, solving: false });
    useStore.getState().regenerate();
    expect(solverClient.solve).not.toHaveBeenCalled();
  });

  it("undo() marks dirty and does not solve", () => {
    const trip = tokyoHakoneTrip();
    const previous = tokyoHakoneTrip();
    useStore.setState({
      currentTrip: trip,
      itinerary: emptyItinerary,
      past: [previous],
      future: [],
      dirty: false,
      pendingChanges: 0,
      solving: false,
    });
    useStore.getState().undo();
    const state = useStore.getState();
    expect(state.dirty).toBe(true);
    expect(state.currentTrip).toBe(previous);
    expect(solverClient.solve).not.toHaveBeenCalled();
    expect(solverClient.resolve).not.toHaveBeenCalled();
  });

  it("undo() clears a stuck `solving` flag from an in-flight solve it invalidates", () => {
    // Regression: undo()/redo() bump resolveCounter to invalidate the
    // in-flight solve, but that solve's onDone is guarded by
    // `call === resolveCounter` and so will never fire to clear `solving`.
    // If undo() doesn't clear it itself, the header spinner spins forever
    // and the solving-gated Regenerate button is stuck disabled.
    const trip = tokyoHakoneTrip();
    const previous = tokyoHakoneTrip();
    useStore.setState({
      currentTrip: trip,
      itinerary: emptyItinerary,
      past: [previous],
      future: [],
      dirty: false,
      pendingChanges: 0,
      solving: true, // a solve is "in flight" when undo is invoked
    });
    useStore.getState().undo();
    const state = useStore.getState();
    expect(state.solving).toBe(false);
    expect(state.dirty).toBe(true);
  });
});

/** A repo double whose `put` always rejects — for exercising `persist`'s
 *  error path without touching real storage. */
function failingRepo(message: string) {
  return {
    put: vi.fn(async () => {
      throw new Error(message);
    }),
    get: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ trips: [], failedCount: 0 })),
    delete: vi.fn(async () => {}),
  };
}

describe("persist error handling (save status)", () => {
  it("a failing repo.put leaves the store in the save-error state and sets a toast, without an unhandled rejection", async () => {
    const trip = multiHotelSampleTrip(tokyoHakoneSample, "2026-04-01");
    const repo = failingRepo("quota exceeded");
    useStore.setState({
      currentTrip: trip,
      repo: repo as unknown as ReturnType<typeof useStore.getState>["repo"],
      toast: null,
      saveState: "idle",
      saveError: null,
      past: [],
      future: [],
    });

    // mutateTrip fires persist() with `void` — if persist ever rethrows this
    // becomes an unhandled rejection instead of surfacing here; asserting the
    // call itself doesn't throw only proves the synchronous part is safe, so
    // the real proof is the awaited state below settling into "error" rather
    // than hanging or crashing the process via an unhandled rejection.
    expect(() =>
      useStore.getState().mutateTrip((draft) => {
        draft.name = "Renamed while offline";
      }),
    ).not.toThrow();

    await vi.waitFor(() => {
      expect(useStore.getState().saveState).toBe("error");
    });
    expect(repo.put).toHaveBeenCalled();
    expect(useStore.getState().saveError).toContain("quota exceeded");
    expect(useStore.getState().toast).toContain("quota exceeded");
    // The trip edit itself still applies in memory even though it can't be saved.
    expect(useStore.getState().currentTrip?.name).toBe("Renamed while offline");
  });

  it("a normal save still ends in the saved state", async () => {
    const trip = multiHotelSampleTrip(tokyoHakoneSample, "2026-04-01");
    useStore.setState({
      currentTrip: trip,
      repo: new LocalRepository(),
      toast: null,
      saveState: "idle",
      saveError: null,
      past: [],
      future: [],
    });

    useStore.getState().mutateTrip((draft) => {
      draft.name = "Renamed";
    });

    await vi.waitFor(() => {
      expect(useStore.getState().saveState).toBe("saved");
    });
    expect(useStore.getState().saveError).toBeNull();
  });
});

// Release audit item 3: two tabs open on the same trip each overwrite the
// whole stored row on save, with nothing to notice one clobbered the other's
// edit. `currentTripRev` + `repo.put`'s `expectedRev`/`conflict` contract
// (packages/storage) turns that into a toast instead of silent data loss.
describe("cross-tab write-conflict detection", () => {
  it("flags a stale save with a persistent toast, and still saves this tab's edit", async () => {
    const repo = new LocalRepository();
    const trip = multiHotelSampleTrip(tokyoHakoneSample, "2026-04-01");
    const { rev } = await repo.put(trip); // tab A's baseline read
    useStore.setState({
      currentTrip: trip,
      currentTripRev: rev,
      repo,
      toast: null,
      toasts: [],
      saveState: "idle",
      saveError: null,
      past: [],
      future: [],
    });

    // Another tab (same underlying row) saves a change tab A never saw.
    await repo.put({ ...trip, name: "Changed elsewhere" });

    // Tab A now saves its own edit, still on its stale baseline revision.
    useStore.getState().mutateTrip((draft) => {
      draft.name = "Changed here";
    });

    await vi.waitFor(() => {
      expect(useStore.getState().toast).toMatch(/another tab/i);
    });
    // Last write wins, but the earlier clobber is now a detectable event —
    // not silent — and this tab's own edit is not lost either.
    expect(useStore.getState().currentTrip?.name).toBe("Changed here");
    expect(useStore.getState().toasts.at(-1)?.kind).toBe("error"); // persists until dismissed
  });

  it("no conflict (and no extra toast) when nothing else touched the trip meanwhile", async () => {
    const repo = new LocalRepository();
    const trip = multiHotelSampleTrip(tokyoHakoneSample, "2026-04-01");
    const { rev } = await repo.put(trip);
    useStore.setState({
      currentTrip: trip,
      currentTripRev: rev,
      repo,
      toast: null,
      toasts: [],
      saveState: "idle",
      saveError: null,
      past: [],
      future: [],
    });

    useStore.getState().mutateTrip((draft) => {
      draft.name = "Renamed";
    });

    await vi.waitFor(() => {
      expect(useStore.getState().saveState).toBe("saved");
    });
    expect(useStore.getState().toast).toBeNull();
  });
});

describe("createTrip length cap", () => {
  it("refuses a range longer than MAX_TRIP_DAYS with a toast and creates no trip", async () => {
    useStore.setState({ trips: [], currentTrip: null, toast: null, repo: new LocalRepository() });
    const tripsBefore = useStore.getState().trips;

    // Empty city skips geocoding entirely, so this returns as soon as the
    // length guard trips — no network call, no toast override.
    await useStore.getState().createTrip("Too long", "", "2026-01-01", "2027-06-01");

    const state = useStore.getState();
    expect(state.toast).toContain("Trip too long");
    expect(state.toast).toContain(String(MAX_TRIP_DAYS));
    expect(state.trips).toBe(tripsBefore); // unchanged
    expect(state.currentTrip).toBeNull();
  });

  it("accepts a range at exactly MAX_TRIP_DAYS", async () => {
    useStore.setState({ trips: [], currentTrip: null, toast: null, repo: new LocalRepository() });
    const dates = Array.from({ length: MAX_TRIP_DAYS }, (_, i) =>
      new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    );
    await useStore
      .getState()
      .createTrip("Exactly max", "", dates[0]!, dates[dates.length - 1]!);

    const state = useStore.getState();
    expect(state.toast).not.toContain("Trip too long");
    expect(state.currentTrip?.days).toHaveLength(MAX_TRIP_DAYS);
  });
});

/** A minimal repo double — same shape as `failingRepo`, but callers plug in
 *  whichever method(s) they need to fail. */
function repoDouble(overrides: {
  list?: () => Promise<{ trips: never[]; failedCount: number }>;
  delete?: () => Promise<void>;
  importJson?: () => Promise<unknown>;
}) {
  return {
    put: vi.fn(async () => {}),
    get: vi.fn(async () => undefined),
    list: vi.fn(overrides.list ?? (async () => ({ trips: [], failedCount: 0 }))),
    delete: vi.fn(overrides.delete ?? (async () => {})),
    ...(overrides.importJson ? { importJson: vi.fn(overrides.importJson) } : {}),
  };
}

describe("init() error handling (read path)", () => {
  it("surfaces a user-visible error and does not throw/reject when repo.list() rejects (e.g. IndexedDB unavailable)", async () => {
    const repo = repoDouble({
      list: () => {
        throw new Error("IndexedDB is not available");
      },
    });
    useStore.setState({
      // A pre-existing trip list must survive a failed read — a failed read
      // looking identical to "you have no trips" is the whole bug.
      trips: [{ id: "stale" } as never],
      toast: null,
      repo: repo as unknown as ReturnType<typeof useStore.getState>["repo"],
    });

    await expect(useStore.getState().init()).resolves.toBeUndefined();

    const state = useStore.getState();
    expect(state.toast).toContain("Could not load your saved trips");
    expect(state.toast).toContain("IndexedDB is not available");
    expect(state.trips).toEqual([{ id: "stale" }]);
  });

  it("surfaces a toast counting how many stored rows failed to load, without dropping the ones that did load", async () => {
    const goodTrip = multiHotelSampleTrip(tokyoHakoneSample, "2026-04-01");
    const repo = repoDouble({
      list: async () => ({ trips: [goodTrip] as never[], failedCount: 2 }),
    });
    useStore.setState({
      trips: [],
      toast: null,
      repo: repo as unknown as ReturnType<typeof useStore.getState>["repo"],
    });

    await useStore.getState().init();

    const state = useStore.getState();
    expect(state.trips).toEqual([goodTrip]);
    expect(state.toast).toContain("2");
    expect(state.toast?.toLowerCase()).toContain("could not be loaded");
  });

  it("sets no toast at all when everything loads cleanly", async () => {
    const goodTrip = multiHotelSampleTrip(tokyoHakoneSample, "2026-04-01");
    const repo = repoDouble({ list: async () => ({ trips: [goodTrip] as never[], failedCount: 0 }) });
    useStore.setState({ trips: [], toast: null, repo: repo as unknown as ReturnType<typeof useStore.getState>["repo"] });

    await useStore.getState().init();

    expect(useStore.getState().toast).toBeNull();
    expect(useStore.getState().trips).toEqual([goodTrip]);
  });
});

describe("deleteTrip() error handling", () => {
  it("keeps the trip (and current selection) intact and surfaces a toast when repo.delete() rejects", async () => {
    const trip = multiHotelSampleTrip(tokyoHakoneSample, "2026-04-01");
    const repo = repoDouble({
      delete: () => {
        throw new Error("quota exceeded");
      },
    });
    useStore.setState({
      trips: [trip],
      currentTrip: trip,
      itinerary: emptyItinerary,
      toast: null,
      repo: repo as unknown as ReturnType<typeof useStore.getState>["repo"],
    });

    await useStore.getState().deleteTrip(trip.id);

    const state = useStore.getState();
    expect(state.trips).toEqual([trip]); // not removed — the delete failed
    expect(state.currentTrip).toBe(trip); // not closed either
    expect(state.itinerary).toBe(emptyItinerary);
    expect(state.toast).toContain("Delete failed");
    expect(state.toast).toContain("quota exceeded");
  });

  it("removes the trip and clears the current selection when repo.delete() succeeds", async () => {
    const trip = multiHotelSampleTrip(tokyoHakoneSample, "2026-04-01");
    useStore.setState({
      trips: [trip],
      currentTrip: trip,
      itinerary: emptyItinerary,
      toast: null,
      repo: new LocalRepository(),
    });

    await useStore.getState().deleteTrip(trip.id);

    const state = useStore.getState();
    expect(state.trips).toEqual([]);
    expect(state.currentTrip).toBeNull();
    expect(state.itinerary).toBeNull();
  });
});

describe("importTripJson (fresh-id copy + dedupe + over-cap rejection)", () => {
  it("adds the imported trip and tells the caller it was imported as a copy", async () => {
    const trip = emptyTrip("Imported", dateRange("2026-04-01", "2026-04-02"));
    const repo = repoDouble({ importJson: async () => trip });
    useStore.setState({
      trips: [],
      importError: null,
      toast: null,
      repo: repo as unknown as ReturnType<typeof useStore.getState>["repo"],
    });

    const ok = await useStore.getState().importTripJson("{}");

    expect(ok).toBe(true);
    const state = useStore.getState();
    expect(state.trips).toEqual([trip]);
    expect(state.importError).toBeNull();
    expect(state.toast).toContain("copy");
  });

  // Item 1+2 end-to-end at the store layer: even though `repo.importJson`
  // always mints a fresh id (so this shouldn't be reachable in practice
  // anymore), the in-memory list must dedupe on id the same way `mutateTrip`
  // does — otherwise one Dexie row could still back two list entries, and
  // `deleteTrip`'s `filter(t => t.id !== id)` would remove both at once.
  it("dedupes on id instead of adding a second in-memory entry for the same trip id", async () => {
    const trip = emptyTrip("Imported", dateRange("2026-04-01", "2026-04-02"));
    const staleInMemoryCopy = { ...trip, name: "stale in-memory copy" };
    const repo = repoDouble({ importJson: async () => trip });
    useStore.setState({
      trips: [staleInMemoryCopy],
      importError: null,
      repo: repo as unknown as ReturnType<typeof useStore.getState>["repo"],
    });

    await useStore.getState().importTripJson("{}");

    const state = useStore.getState();
    expect(state.trips).toHaveLength(1); // never two entries for one id
    expect(state.trips[0]).toEqual(trip); // replaced with the freshly-imported version
  });

  it("surfaces the repository's rejection as a readable importError (not a raw ZodError dump)", async () => {
    const repo = repoDouble({
      importJson: () => {
        throw new Error("Import failed: Trip is invalid: Trip too long: cannot exceed 60 days. Existing data is unchanged.");
      },
    });
    useStore.setState({
      trips: [],
      importError: null,
      repo: repo as unknown as ReturnType<typeof useStore.getState>["repo"],
    });

    const ok = await useStore.getState().importTripJson("whatever");

    expect(ok).toBe(false);
    const err = useStore.getState().importError;
    expect(err).toContain("Trip too long");
    expect(err).not.toMatch(/"code":|"path":/);
  });
});

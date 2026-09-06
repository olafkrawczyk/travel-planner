import * as Comlink from "comlink";
import type { Itinerary, Trip } from "@app/domain";
import { solve as solveTrip, resolve as resolveTrip, type Edit } from "@app/solver";
import { bridgeLog } from "./log";

/** Pure data — callbacks are passed as separate top-level (proxied) arguments. */
export interface SolveRequest {
  seed?: number;
  budgetMs?: number;
  maxIterations?: number;
  /**
   * Optional routing-API (OSRM) duration matrix in MINUTES, indexed in
   * `buildProblem`'s node order. Fetched on the MAIN thread (the worker stays
   * network-free and deterministic) and passed in as pure data.
   */
  apiMatrix?: number[][];
  /**
   * The OSRM routing profile that actually produced `apiMatrix` (e.g.
   * "foot" or "driving"). Forwarded verbatim to `solve`/`resolve` as
   * `apiProfile`; optional because a caller with no `apiMatrix` has no
   * profile to report either.
   */
  apiProfile?: string;
}

export interface SolveApi {
  /** Enable/disable bridge logging (workers have no localStorage, so the main thread pushes the flag). */
  setLogging(on: boolean): void;
  solve(
    trip: Trip,
    req: SolveRequest,
    onProgress?: (itinerary: Itinerary) => void,
    onDone?: (itinerary: Itinerary) => void,
  ): Promise<Itinerary>;
  resolve(
    trip: Trip,
    previous: Itinerary,
    edit: Edit,
    req: SolveRequest,
    onProgress?: (itinerary: Itinerary) => void,
    onDone?: (itinerary: Itinerary) => void,
  ): Promise<Itinerary>;
}

/** Worker-side logging flag, pushed from the main thread. */
let logging = false;

/**
 * Freeze a structured clone so the solver receives an immutable snapshot.
 * Comlink already transferred a copy, so freezing here never touches
 * main-thread state.
 */
function freezeSnapshot<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as object)) {
      freezeSnapshot((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function clone<T>(value: T): T {
  return freezeSnapshot(structuredClone(value));
}

const api: SolveApi = {
  setLogging(on) {
    logging = on;
  },
  async solve(trip, req, onProgress, onDone) {
    if (logging) {
      bridgeLog("worker: solve start", {
        tripId: trip.id,
        places: trip.places.length,
        days: trip.days.length,
        budgetMs: req.budgetMs,
      });
    }
    try {
      const frozen = clone(trip);
      const result = solveTrip({
        trip: frozen,
        seed: req.seed ?? 42,
        budgetMs: req.budgetMs,
        maxIterations: req.maxIterations,
        apiDurations: req.apiMatrix,
        apiProfile: req.apiProfile,
        onProgress: onProgress
          ? (itinerary) => {
              if (logging) bridgeLog("worker→main progress", { stats: itinerary.stats });
              // Itineraries are plain data (no functions), so the proxied
              // callback's structured clone always succeeds.
              onProgress(itinerary);
            }
          : undefined,
      });
      if (logging) bridgeLog("worker→main done", { stats: result.stats });
      onDone?.(result);
      return result;
    } catch (e) {
      bridgeLog("worker: solve error", {
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      });
      throw e;
    }
  },
  async resolve(trip, previous, edit, req, onProgress, onDone) {
    if (logging) {
      bridgeLog("worker: resolve start", {
        tripId: trip.id,
        edit: edit.type,
        places: trip.places.length,
        days: trip.days.length,
        budgetMs: req.budgetMs,
      });
    }
    try {
      const frozen = clone(trip);
      const frozenPrev = clone(previous);
      const result = resolveTrip({
        trip: frozen,
        previous: frozenPrev,
        edit,
        seed: req.seed ?? 42,
        budgetMs: req.budgetMs,
        maxIterations: req.maxIterations,
        apiDurations: req.apiMatrix,
        apiProfile: req.apiProfile,
        onProgress: onProgress
          ? (itinerary) => {
              if (logging) bridgeLog("worker→main progress", { stats: itinerary.stats });
              onProgress(itinerary);
            }
          : undefined,
      });
      if (logging) bridgeLog("worker→main done", { stats: result.stats });
      onDone?.(result);
      return result;
    } catch (e) {
      bridgeLog("worker: resolve error", {
        error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
      });
      throw e;
    }
  },
};

export type SolveApiType = typeof api;

Comlink.expose(api);

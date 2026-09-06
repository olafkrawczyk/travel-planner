/**
 * OSRM `/table` client (change add-osrm-travel-matrix, task 1.1).
 *
 * One N×N request per trip covers all places + bases and returns the full
 * duration matrix in minutes. The fetch function is injectable so tests can
 * mock responses; failures surface as typed `OsrmError`s so callers can
 * fall back to the heuristic deterministically. The network never enters
 * the solver worker — this client runs on the main thread only.
 */

export type OsrmErrorKind = "http" | "malformed" | "oversize" | "network";

/** Typed error so callers can distinguish fallback causes. */
export class OsrmError extends Error {
  constructor(
    readonly kind: OsrmErrorKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "OsrmError";
  }
}

export interface OsrmClientOptions {
  /** Base URL override (e.g. self-hosted OSRM). Defaults to the public demo server. */
  baseUrl?: string;
  /** Routing profile path segment (default "foot"). */
  profile?: string;
  /** Max nodes accepted per table request (default 100 — public demo limit). */
  maxNodes?: number;
  /** Injectable fetch for tests. */
  fetchFn?: typeof fetch;
}

export interface LatLng {
  lat: number;
  lng: number;
}

const DEFAULT_BASE_URL = "https://router.project-osrm.org";
/**
 * Default OSRM routing profile requested by this client. Exported so callers
 * that need to know (and honestly label) which profile actually produced a
 * duration — e.g. `@app/solver`'s matrix builder — don't have to duplicate
 * this literal (see the add-osrm-plausibility-guard change).
 */
export const DEFAULT_PROFILE = "foot";
const DEFAULT_MAX_NODES = 100;

/** OSRM /table response (only the fields we consume). */
interface OsrmTableResponse {
  durations?: unknown;
}

export class OsrmClient {
  private baseUrl: string;
  private profile: string;
  private maxNodes: number;
  private fetchFn: typeof fetch;

  constructor(opts: OsrmClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.profile = opts.profile ?? DEFAULT_PROFILE;
    this.maxNodes = opts.maxNodes ?? DEFAULT_MAX_NODES;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  /**
   * Fetch an N×N travel-time matrix (minutes, rounded to 1 decimal) for the
   * given coordinates, in input order: result[i][j] is minutes from
   * coords[i] to coords[j].
   */
  async fetchTable(coords: LatLng[]): Promise<number[][]> {
    if (coords.length > this.maxNodes) {
      throw new OsrmError(
        "oversize",
        `OSRM table request has ${coords.length} nodes (limit ${this.maxNodes})`,
      );
    }
    if (coords.length === 0) return [];

    const coordStr = coords.map((c) => `${c.lng},${c.lat}`).join(";");
    const url = `${this.baseUrl}/table/v1/${this.profile}/${coordStr}?annotations=duration`;

    let res: Response;
    try {
      res = await this.fetchFn(url);
    } catch (err) {
      throw new OsrmError("network", `OSRM request failed: ${String(err)}`, { cause: err });
    }
    if (!res.ok) {
      throw new OsrmError("http", `OSRM /table failed with HTTP ${res.status}`);
    }

    let json: OsrmTableResponse;
    try {
      json = (await res.json()) as OsrmTableResponse;
    } catch (err) {
      throw new OsrmError("malformed", "OSRM response is not valid JSON", { cause: err });
    }
    return parseDurations(json, coords.length);
  }
}

/** Validate the `durations` shape and convert seconds → minutes (1 decimal). */
function parseDurations(json: OsrmTableResponse, n: number): number[][] {
  const durations = json.durations;
  if (!Array.isArray(durations) || durations.length !== n) {
    throw new OsrmError("malformed", `OSRM response durations must be an ${n}×${n} matrix`);
  }
  return durations.map((row, i) => {
    if (!Array.isArray(row) || row.length !== n) {
      throw new OsrmError("malformed", `OSRM durations row ${i} must have ${n} entries`);
    }
    return row.map((seconds, j) => {
      // OSRM legitimately returns `null` for a genuinely unroutable pair
      // (islands, ferries, unsnapped points) — that is real "no API data for
      // this pair", not a malformed response. Discarding the WHOLE N×N
      // matrix (and silently falling the entire trip back to the heuristic)
      // over one such pair throws away every other cell's real routed data
      // for no reason. `@app/solver`'s `resolveApiOrHeuristic` (matrix.ts)
      // already treats a non-finite duration as "fall back to the heuristic
      // for this cell" — so NaN here does exactly the right thing, per cell,
      // with no change needed on the consumer side. Anything else invalid
      // (wrong type, negative, non-finite) is still a genuinely malformed
      // response and still throws.
      if (seconds === null) return NaN;
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
        throw new OsrmError("malformed", `OSRM duration at [${i}][${j}] is not a valid number`);
      }
      return Math.round((seconds / 60) * 10) / 10;
    });
  });
}

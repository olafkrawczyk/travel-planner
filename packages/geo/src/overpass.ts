/**
 * Overpass API client: fetch the tags of a single OSM element by id.
 * Usage-policy hygiene: one small request per call (single element,
 * `out tags` only, no bulk), a small in-memory cache, identifying
 * Accept headers, and an injectable fetch for tests / main-thread use.
 *
 * Rate limiting: Overpass's published fair-use policy asks a *regular
 * ongoing application* (not a one-off script) to stay under ~100
 * queries/day, run nothing in parallel, and back off on 429/503. Because the
 * app may construct a fresh `OverpassClient` per place added (there is no
 * long-lived singleton at the call site), the queue and rate limiter below
 * are module-level state shared by every instance in this process, not
 * per-instance — otherwise two clients created moments apart would each
 * think they were alone and fire in parallel.
 */

export class OverpassError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Parsed `Retry-After` delay in ms, when the server sent one. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "OverpassError";
  }
}

export interface OverpassClientOptions {
  /** Base URL override (e.g. a mirror). Defaults to the public instance. */
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_BASE = "https://overpass-api.de";

/** Only the tags the app consumes today (opening-hours prefill; names for later use). */
const RELEVANT_TAGS = ["opening_hours", "name:en", "name:ja"] as const;

interface OverpassResponse {
  elements?: { tags?: Record<string, unknown> }[];
}

// --- Shared queue / rate limiter (module-level, see file header) ----------

/** Minimum spacing between two Overpass requests, regardless of client instance. */
const MIN_INTERVAL_MS = 1000;
/** Backoff applied on a 429/503 that carries no (or an unparsable) `Retry-After`. */
const DEFAULT_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 60_000;

/** Tail of the serialized task chain: every queued request awaits this first. */
let queueTail: Promise<void> = Promise.resolve();
/** Epoch ms before which no new request may start (spacing + any active backoff). */
let nextAllowedAt = 0;
/** Grows on consecutive un-annotated 429/503s, resets to 0 on any success. */
let currentBackoffMs = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parses a `Retry-After` header value (seconds, or an HTTP date) to ms from now. */
function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return undefined;
}

/**
 * Runs `task` through the shared queue: requests never overlap, and each one
 * waits out both the minimum spacing and any active backoff before starting.
 * A 429/503 pushes `nextAllowedAt` out (honouring `Retry-After` when present,
 * an internal exponential default otherwise); any success resets the backoff.
 */
function scheduleOverpassTask<T>(task: () => Promise<T>): Promise<T> {
  const result = queueTail.then(async () => {
    const wait = nextAllowedAt - Date.now();
    if (wait > 0) await sleep(wait);
    nextAllowedAt = Date.now() + MIN_INTERVAL_MS;
    try {
      const value = await task();
      currentBackoffMs = 0;
      return value;
    } catch (e) {
      if (e instanceof OverpassError && (e.status === 429 || e.status === 503)) {
        const retryMs = e.retryAfterMs ?? nextBackoffMs();
        nextAllowedAt = Date.now() + retryMs;
      }
      throw e;
    }
  });
  // Keep the chain alive past a rejection so later tasks still get their turn.
  queueTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function nextBackoffMs(): number {
  currentBackoffMs = currentBackoffMs === 0 ? DEFAULT_BACKOFF_MS : Math.min(currentBackoffMs * 2, MAX_BACKOFF_MS);
  return currentBackoffMs;
}

/**
 * Test-only: resets the shared queue/rate-limiter state. Not part of the
 * app-facing API — production code never needs to reset a live rate
 * limiter — but keeps tests fast and independent of each other's timing.
 */
export function __resetOverpassQueueForTests(): void {
  queueTail = Promise.resolve();
  nextAllowedAt = 0;
  currentBackoffMs = 0;
}

// --- Client -----------------------------------------------------------------

interface ParsedOsmId {
  kind: "N" | "W" | "R";
  id: string;
}

export class OverpassClient {
  private baseUrl: string;
  private fetchFn: typeof fetch;
  /** In-memory cache keyed by canonical osmId; null = element has no usable tags. */
  private cache = new Map<string, Record<string, string> | null>();

  constructor(opts: OverpassClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  /**
   * Fetch the relevant tags of one OSM element ("N/123" | "W/123" | "R/123").
   * Returns null when the element does not exist (or carries none of the
   * relevant tags); throws OverpassError on network/HTTP failures or an
   * invalid id format. Non-blocking: the returned promise settles once the
   * request has had its turn in the shared queue, but never forces the
   * caller to wait — a fire-and-forget prefetch stays fire-and-forget.
   * Format is validated synchronously (before queueing) so a bad id fails
   * immediately instead of consuming a queue slot.
   */
  async fetchOsmTags(osmId: string): Promise<Record<string, string> | null> {
    const key = osmId.trim().toUpperCase();
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const parsed = parseOsmId(key);
    const tags = await scheduleOverpassTask(() => this.fetchNow(parsed));
    this.cache.set(key, tags);
    return tags;
  }

  private async fetchNow(parsed: ParsedOsmId): Promise<Record<string, string> | null> {
    const elementType = parsed.kind === "N" ? "node" : parsed.kind === "W" ? "way" : "relation";
    const query = `[out:json][timeout:25];${elementType}(${parsed.id});out tags;`;
    const url = `${this.baseUrl}/api/interpreter?data=${encodeURIComponent(query)}`;

    let res: Response;
    try {
      res = await this.fetchFn(url, { headers: { Accept: "application/json" } });
    } catch (e) {
      throw new OverpassError(`Overpass request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) {
      const retryAfterMs = parseRetryAfterMs(res.headers.get("Retry-After"));
      throw new OverpassError(`Overpass request failed: ${res.status}`, res.status, retryAfterMs);
    }

    const json = (await res.json()) as OverpassResponse;
    const tags = json.elements?.[0]?.tags;
    if (!tags) return null; // missing element / no tags at all
    const relevant: Record<string, string> = {};
    for (const k of RELEVANT_TAGS) {
      const v = tags[k];
      if (typeof v === "string" && v.trim()) relevant[k] = v;
    }
    return relevant;
  }
}

function parseOsmId(osmId: string): ParsedOsmId {
  const m = /^(N|W|R)\/(\d+)$/.exec(osmId);
  if (!m) throw new OverpassError(`Invalid OSM id: ${osmId}`);
  return { kind: m[1] as "N" | "W" | "R", id: m[2]! };
}

/**
 * Overpass API client: fetch the tags of a single OSM element by id.
 * Usage-policy hygiene: one small request per call (single element,
 * `out tags` only, no bulk), a small in-memory cache, identifying
 * Accept headers, and an injectable fetch for tests / main-thread use.
 */

export class OverpassError extends Error {
  constructor(
    message: string,
    readonly status?: number,
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
   * invalid id format.
   */
  async fetchOsmTags(osmId: string): Promise<Record<string, string> | null> {
    const key = osmId.trim().toUpperCase();
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const tags = await this.fetchNow(key);
    this.cache.set(key, tags);
    return tags;
  }

  private async fetchNow(osmId: string): Promise<Record<string, string> | null> {
    const m = /^(N|W|R)\/(\d+)$/.exec(osmId);
    if (!m) throw new OverpassError(`Invalid OSM id: ${osmId}`);
    const kind = m[1] as "N" | "W" | "R";
    const elementType = kind === "N" ? "node" : kind === "W" ? "way" : "relation";
    const query = `[out:json][timeout:25];${elementType}(${m[2]});out tags;`;
    const url = `${this.baseUrl}/api/interpreter?data=${encodeURIComponent(query)}`;

    let res: Response;
    try {
      res = await this.fetchFn(url, { headers: { Accept: "application/json" } });
    } catch (e) {
      throw new OverpassError(`Overpass request failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) throw new OverpassError(`Overpass request failed: ${res.status}`, res.status);

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

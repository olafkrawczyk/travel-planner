/**
 * Photon (komoot) geocoding client.
 * Usage-policy hygiene: debounced requests, a pluggable result cache,
 * identifying headers where the environment allows them, typed results.
 */

export interface GeoResult {
  id: string;
  name: string;
  country?: string;
  city?: string;
  /** Street + house number, e.g. "ul. Marszałkowska 12" — lets the UI disambiguate same-named results in the same city. */
  street?: string;
  lat: number;
  lng: number;
  osmId?: string;
}

export interface GeoCache {
  get(key: string): GeoResult[] | undefined | Promise<GeoResult[] | undefined>;
  set(key: string, value: GeoResult[]): void | Promise<void>;
}

/** Simple in-memory cache used when no persistent cache is supplied. */
export class MemoryGeoCache implements GeoCache {
  private map = new Map<string, GeoResult[]>();
  get(key: string): GeoResult[] | undefined {
    return this.map.get(key);
  }
  set(key: string, value: GeoResult[]): void {
    this.map.set(key, value);
  }
}

export interface PhotonClientOptions {
  /** Base URL override (e.g. self-hosted Photon). Defaults to the public instance. */
  baseUrl?: string;
  cache?: GeoCache;
  /** Debounce window in ms (default 300). */
  debounceMs?: number;
  /** Identifying app name sent as User-Agent/From where the environment allows. */
  appName?: string;
  contactEmail?: string;
  /** Language bias for results. */
  lang?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_BASE = "https://photon.komoot.io";
const DEFAULT_DEBOUNCE_MS = 300;

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id?: number;
    osm_type?: string;
    name?: string;
    country?: string;
    city?: string;
    countrycode?: string;
    street?: string;
    housenumber?: string;
  };
  type?: string;
}

function toResults(json: { features?: PhotonFeature[] }): GeoResult[] {
  return (json.features ?? [])
    .filter((f) => f.geometry?.coordinates && f.properties?.name)
    .map((f, i) => ({
      id: `${f.properties.osm_type ?? "n"}${f.properties.osm_id ?? i}`,
      name: f.properties.name!,
      country: f.properties.country ?? f.properties.countrycode,
      city: f.properties.city,
      street: [f.properties.street, f.properties.housenumber].filter(Boolean).join(" ") || undefined,
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
      osmId: f.properties.osm_id ? `${f.properties.osm_type ?? "n"}/${f.properties.osm_id}` : undefined,
    }));
}

export class PhotonClient {
  private cache: GeoCache;
  private baseUrl: string;
  private debounceMs: number;
  private lang: string;
  private fetchFn: typeof fetch;
  private appName: string;
  private contactEmail?: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: { query: string; resolve: (r: GeoResult[]) => void; reject: (e: unknown) => void }[] = [];

  constructor(opts: PhotonClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.cache = opts.cache ?? new MemoryGeoCache();
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.lang = opts.lang ?? "en";
    this.appName = opts.appName ?? "travel-planner";
    this.contactEmail = opts.contactEmail;
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  /** Debounced search: resolves with cached results immediately when available. */
  search(query: string, limit = 10): Promise<GeoResult[]> {
    const key = `${this.lang}:${limit}:${query}`;
    const cached = this.cache.get(key);
    if (Array.isArray(cached)) return Promise.resolve(cached);
    if (cached) {
      // Async cache: honour its promise before enqueueing a network request.
      return Promise.resolve(cached).then((awaited) => awaited ?? this.enqueue(key, query, limit));
    }
    return this.enqueue(key, query, limit);
  }

  /** Install/reset the debounce timer and register this query. */
  private enqueue(key: string, query: string, limit: number): Promise<GeoResult[]> {
    return new Promise((resolve, reject) => {
      this.pending.push({ query: key, resolve, reject });
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        const batch = this.pending.splice(0);
        this.timer = null;
        // Deduplicate identical queries within the batch.
        const byKey = new Map<string, Promise<GeoResult[]>>();
        for (const p of batch) {
          let f = byKey.get(p.query);
          if (!f) {
            f = this.fetchNow(p.query);
            byKey.set(p.query, f);
          }
          f.then(p.resolve, p.reject);
        }
      }, this.debounceMs);
    });
  }

  /** Immediate (non-debounced) fetch. */
  private async fetchNow(cacheKey: string): Promise<GeoResult[]> {
    const parts = cacheKey.split(":");
    const limit = Number(parts[1] ?? 10);
    const query = parts.slice(2).join(":");
    const url = `${this.baseUrl}/api?q=${encodeURIComponent(query)}&lang=${this.lang}&limit=${limit}`;
    const headers: Record<string, string> = {};
    // Identifying headers where the environment allows setting them.
    if (this.contactEmail) headers["From"] = this.contactEmail;
    try {
      headers["User-Agent"] = `${this.appName}/0.1 (${this.contactEmail ?? "local app"})`;
    } catch {
      /* browsers ignore UA overrides; servers/CLI honour them */
    }
    const res = await this.fetchFn(url, { headers });
    if (!res.ok) throw new Error(`Photon search failed: ${res.status}`);
    const results = toResults(await res.json());
    this.cache.set(cacheKey, results);
    return results;
  }
}

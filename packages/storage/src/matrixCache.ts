import Dexie, { type Table } from "dexie";

/**
 * Persistent cache for OSRM /table matrices (change add-osrm-travel-matrix,
 * task 2.1). Entries are keyed by rounded coordinates (4 decimals ≈ 11 m) +
 * profile + OSRM base URL, so reloads and re-solves hit IndexedDB instead of
 * the network; only new or moved places produce a new key.
 */

export interface CachedMatrix {
  key: string;
  /** Minutes matrix in the same node order as the key's coordinates. */
  durations: number[][];
  fetchedAt: string;
}

/** Cache contract (injectable for tests). */
export interface MatrixCache {
  get(key: string): Promise<CachedMatrix | undefined>;
  put(entry: CachedMatrix): Promise<void>;
}

export interface CacheCoord {
  lat: number;
  lng: number;
}

/** Stable cache key: rounded coords (4 decimals) + profile + base URL. */
export function matrixCacheKey(coords: CacheCoord[], profile: string, baseUrl: string): string {
  const rounded = coords.map((c) => `${c.lat.toFixed(4)},${c.lng.toFixed(4)}`).join(";");
  return `${baseUrl}|${profile}|${rounded}`;
}

/** Dexie/IndexedDB-backed `MatrixCache`. */
export class DexieMatrixCache implements MatrixCache {
  private db: Dexie;
  private cache: Table<CachedMatrix, string>;

  constructor(name = "travel-planner-matrix") {
    this.db = new Dexie(name);
    this.db.version(1).stores({ matrixCache: "key" });
    this.cache = this.db.table("matrixCache");
  }

  async get(key: string): Promise<CachedMatrix | undefined> {
    return this.cache.get(key);
  }

  async put(entry: CachedMatrix): Promise<void> {
    await this.cache.put(entry);
  }

  /** Delete the underlying database (used by tests to reset isolated DBs). */
  async deleteDatabase(): Promise<void> {
    this.db.close();
    await Dexie.delete(this.db.name);
  }
}

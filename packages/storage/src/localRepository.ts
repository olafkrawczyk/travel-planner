import Dexie, { type Table } from "dexie";
import { newTripId, parseTrip, schemaVersion, type Trip } from "@app/domain";
import {
  RepositoryError,
  type TripRepository,
  type ListResult,
  type PutResult,
  type TripWithRevision,
} from "./repository";

/** Stored row shape. `rev` is the storage-level revision used for cross-tab
 *  write-conflict detection (see `PutResult` in repository.ts) — deliberately
 *  NOT part of the `Trip` domain object. Optional because rows written before
 *  this field existed have none; `computeNextRevision` treats a missing `rev`
 *  as revision 0. */
interface StoredRow {
  id: string;
  json: string;
  rev?: number;
}

/**
 * Pure decision behind `LocalRepository.put`'s conflict detection, pulled out
 * so it's covered by a plain unit test (no Dexie/IndexedDB needed) — see
 * localRepository.test.ts. `currentRev` is whatever is already stored
 * (`undefined` for a brand-new id, or a legacy row with no `rev` field yet);
 * `expectedRev` is what the caller last read (`undefined` means "don't
 * check"). The next revision always increments off the *actual* stored
 * value, never off the caller's possibly-stale `expectedRev`.
 */
export function computeNextRevision(
  currentRev: number | undefined,
  expectedRev: number | undefined,
): PutResult {
  const baseline = currentRev ?? 0;
  const conflict = expectedRev !== undefined && expectedRev !== baseline;
  return { rev: baseline + 1, conflict };
}

/**
 * Local IndexedDB repository on Dexie. Every stored record carries
 * `schemaVersion`; reads validate through the domain migration hook so older
 * exports are transparently migrated before use.
 */
export class LocalRepository implements TripRepository {
  private db: Dexie;
  private trips: Table<StoredRow, string>;

  constructor(name = "travel-planner") {
    this.db = new Dexie(name);
    // Schema-wise this is still just `id` as the primary key — `rev` lives on
    // the row as plain data (like `json` already does), not as an index, so
    // adding it needs no version bump and every pre-existing row keeps
    // loading unchanged (it simply has no `rev` field yet).
    this.db.version(1).stores({ trips: "id" });
    this.trips = this.db.table("trips");
  }

  async list(): Promise<ListResult> {
    const rows = await this.trips.toArray();
    const trips: Trip[] = [];
    let failedCount = 0;
    for (const r of rows) {
      const t = safeParse(r.json);
      if (t) trips.push(t);
      else failedCount++; // corrupt row, or written by a newer/incompatible build
    }
    trips.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { trips, failedCount };
  }

  async get(id: string): Promise<Trip | undefined> {
    const row = await this.trips.get(id);
    return row ? safeParse(row.json) : undefined;
  }

  async getWithRevision(id: string): Promise<TripWithRevision | undefined> {
    const row = await this.trips.get(id);
    if (!row) return undefined;
    const trip = safeParse(row.json);
    return trip ? { trip, rev: row.rev ?? 0 } : undefined;
  }

  /**
   * See `TripRepository.put`'s doc comment for the conflict-detection
   * contract. Read-current-row + write-next-row runs inside one Dexie
   * transaction so two `put` calls racing in the SAME tab can't compute the
   * same "next" revision off a stale read — cross-TAB races (the actual
   * concern here) can't be closed this way (each tab is a separate process
   * with no shared lock), which is exactly why this returns a conflict flag
   * for the caller to surface, rather than pretending the race can't happen.
   */
  async put(trip: Trip, expectedRev?: number): Promise<PutResult> {
    // Validate on write as well, so corrupt data can never enter the store.
    const valid = parseTrip(trip);
    return this.db.transaction("rw", this.trips, async () => {
      const existing = await this.trips.get(valid.id);
      const result = computeNextRevision(existing?.rev, expectedRev);
      await this.trips.put({ id: valid.id, json: JSON.stringify(valid), rev: result.rev });
      return result;
    });
  }

  async delete(id: string): Promise<void> {
    await this.trips.delete(id);
  }

  /** Delete the underlying database (used by tests to reset isolated DBs). */
  async deleteDatabase(): Promise<void> {
    this.db.close();
    await Dexie.delete(this.db.name);
  }

  async exportJson(id: string): Promise<string> {
    const trip = await this.get(id);
    if (!trip) throw new RepositoryError(`Trip ${id} not found`);
    return JSON.stringify(trip, null, 2);
  }

  async importJson(json: string): Promise<Trip> {
    let trip: Trip;
    try {
      const raw = JSON.parse(json) as Record<string, unknown>;
      // Always import under a fresh id — never trust (or keep) the id stored
      // in the file. `put()` upserts by id, so re-importing a file you
      // previously exported (or one someone else exported and handed you)
      // would otherwise silently overwrite an existing stored trip with no
      // confirmation. Mirrors the share-URL path (apps/web/src/App.tsx),
      // which already does this for the same reason.
      raw.id = newTripId();
      trip = parseTrip(raw);
    } catch (err) {
      throw new RepositoryError(
        `Import failed: ${err instanceof Error ? err.message : "file is not a valid trip"}. Existing data is unchanged.`,
        err,
      );
    }
    if (trip.schemaVersion !== schemaVersion) {
      throw new RepositoryError(
        `Import failed: unsupported schema version ${trip.schemaVersion} (expected ${schemaVersion}).`,
      );
    }
    await this.put(trip);
    return trip;
  }
}

function safeParse(json: string): Trip | undefined {
  try {
    return parseTrip(JSON.parse(json));
  } catch {
    return undefined;
  }
}

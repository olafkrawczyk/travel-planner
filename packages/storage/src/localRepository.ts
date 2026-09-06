import Dexie, { type Table } from "dexie";
import { newTripId, parseTrip, schemaVersion, type Trip } from "@app/domain";
import { RepositoryError, type TripRepository, type ListResult } from "./repository";

/**
 * Local IndexedDB repository on Dexie. Every stored record carries
 * `schemaVersion`; reads validate through the domain migration hook so older
 * exports are transparently migrated before use.
 */
export class LocalRepository implements TripRepository {
  private db: Dexie;
  private trips: Table<{ id: string; json: string }, string>;

  constructor(name = "travel-planner") {
    this.db = new Dexie(name);
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

  async put(trip: Trip): Promise<void> {
    // Validate on write as well, so corrupt data can never enter the store.
    const valid = parseTrip(trip);
    await this.trips.put({ id: valid.id, json: JSON.stringify(valid) });
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

import Dexie, { type Table } from "dexie";
import { parseTrip, schemaVersion, type Trip } from "@app/domain";
import { RepositoryError, type TripRepository } from "./repository";

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

  async list(): Promise<Trip[]> {
    const rows = await this.trips.toArray();
    return rows
      .map((r) => safeParse(r.json))
      .filter((t): t is Trip => t !== undefined)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
      trip = parseTrip(JSON.parse(json));
    } catch (err) {
      throw new RepositoryError(
        "Import failed: file is not a valid trip (schema validation error). Existing data is unchanged.",
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

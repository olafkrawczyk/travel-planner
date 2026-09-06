import { parseTrip, type Trip } from "@app/domain";

/** Errors raised by repository operations (validation, not-found, storage). */
export class RepositoryError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}

/**
 * Persistence boundary for trips. The UI and solver never touch IndexedDB (or
 * any other backend) directly — a future remote implementation can replace
 * `LocalRepository` without changes to callers.
 */
export interface TripRepository {
  /** All stored trips (metadata only is fine, but full trips keeps it simple). */
  list(): Promise<Trip[]>;
  get(id: string): Promise<Trip | undefined>;
  put(trip: Trip): Promise<void>;
  delete(id: string): Promise<void>;
  /** Serialize a trip to a pretty-printed JSON string (schema-validated). */
  exportJson(id: string): Promise<string>;
  /** Parse + validate a JSON string and store it. Rejects invalid files. */
  importJson(json: string): Promise<Trip>;
}

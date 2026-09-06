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

/** Result of `TripRepository.list()`. */
export interface ListResult {
  /** All trips that loaded and validated successfully. */
  trips: Trip[];
  /**
   * Count of stored rows that failed to parse/validate and were therefore
   * excluded from `trips` (a corrupt row, or one written by a newer or
   * incompatible build). Zero on the healthy path. A non-zero count should be
   * surfaced to the user — silently shrinking their trip list is
   * indistinguishable from data loss.
   */
  failedCount: number;
}

/**
 * Persistence boundary for trips. The UI and solver never touch IndexedDB (or
 * any other backend) directly — a future remote implementation can replace
 * `LocalRepository` without changes to callers.
 */
export interface TripRepository {
  /** All stored trips (metadata only is fine, but full trips keeps it simple). */
  list(): Promise<ListResult>;
  get(id: string): Promise<Trip | undefined>;
  put(trip: Trip): Promise<void>;
  delete(id: string): Promise<void>;
  /** Serialize a trip to a pretty-printed JSON string (schema-validated). */
  exportJson(id: string): Promise<string>;
  /** Parse + validate a JSON string and store it. Rejects invalid files. */
  importJson(json: string): Promise<Trip>;
}

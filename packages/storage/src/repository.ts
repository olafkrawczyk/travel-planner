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
 * A trip loaded together with its storage-row revision — see `PutResult` for
 * why this exists (cross-tab write-conflict detection). The revision is a
 * storage concern, deliberately kept off the `Trip` domain object itself.
 */
export interface TripWithRevision {
  trip: Trip;
  rev: number;
}

/**
 * Result of `TripRepository.put()`. `rev` is the row's new revision after
 * this write; `conflict` is true when a `expectedRev` was supplied and did
 * NOT match the revision already stored, meaning some other writer (e.g. the
 * same trip open in another browser tab) persisted a change since the caller
 * last read this row. The write still happens either way — see the doc
 * comment on `put` for why silently refusing to save is worse here — but a
 * caller that gets `conflict: true` back should tell the user.
 */
export interface PutResult {
  rev: number;
  conflict: boolean;
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
  /** Same as `get`, plus the row's current revision — use this instead of
   *  `get` whenever the caller intends to `put` back later and wants
   *  conflict detection (see `put`'s `expectedRev`). A legacy row written
   *  before revisions existed reads back as revision 0. */
  getWithRevision(id: string): Promise<TripWithRevision | undefined>;
  /**
   * Persist a trip. Every write bumps the row's revision by one.
   *
   * `expectedRev`, when given, is compared against the revision already
   * stored for this id *before* the write: a mismatch means another writer
   * (typically the same trip open in a second tab) saved a change this
   * caller never saw — a cross-tab clobber in progress. The write still
   * happens regardless (this repository has no merge capability and no
   * "retry the save" UI, so refusing to persist the caller's in-memory edits
   * would just as likely lose *those* instead — see localRepository.ts), but
   * `conflict: true` in the result makes the clobber a detectable event
   * instead of the silent one it used to be. Omit `expectedRev` (e.g. first
   * save of a brand-new trip) to always write without a conflict check.
   */
  put(trip: Trip, expectedRev?: number): Promise<PutResult>;
  delete(id: string): Promise<void>;
  /** Serialize a trip to a pretty-printed JSON string (schema-validated). */
  exportJson(id: string): Promise<string>;
  /** Parse + validate a JSON string and store it. Rejects invalid files. */
  importJson(json: string): Promise<Trip>;
}

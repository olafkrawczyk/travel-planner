import type { Place, Trip } from "@app/domain";

/**
 * Does `placeId` serve as a day's sleep/wake base or fixed start/end node?
 * Checked BEFORE any delete so a base hotel is never removed while a day
 * still points at it (a dangling base makes the solver's travel matrix treat
 * the id as an unknown node — 0-minute "free" travel — and disables the API
 * matrix and stay validation for the whole trip; see PlaceEditor's onDelete).
 * Returns the first affected day (0-based index, plus its id) or null.
 */
export function baseUsage(trip: Trip, placeId: string): { dayIndex: number; dayId: string } | null {
  for (let i = 0; i < trip.days.length; i++) {
    const day = trip.days[i]!;
    if (
      day.baseStartId === placeId ||
      day.baseEndId === placeId ||
      day.startLocation === placeId ||
      day.endLocation === placeId
    ) {
      return { dayIndex: i, dayId: day.id };
    }
  }
  return null;
}

/**
 * Enforce the "a hotel is a sleep base, not a schedulable stop" invariant
 * that `PlaceSchema` itself doesn't encode. The solver excludes
 * `category === "hotel"` from schedulable places entirely, so these fields
 * are silently ignored on a hotel — normalize them away instead of letting
 * the editor persist values that look meaningful but never do anything:
 *
 *  - `dwellMin`: how long to linger at a stop. A hotel is never visited as a
 *    stop, so there is no dwell to time — forced to 0.
 *  - `priority`: ranks candidates competing for schedule time. Hotels never
 *    enter that competition — pinned to 3 (the lowest weight), i.e. inert.
 *  - `appointment`: books a place into a specific day/time slot in the
 *    timeline. A hotel isn't placed in the timeline at all — stripped.
 *  - `openingHours`: gates *visiting* hours for a scheduled stop. A base has
 *    no visiting hours — stripped.
 *  - `forceDayId`: forces an otherwise-unscheduled place into a day. Hotels
 *    are never unscheduled candidates — stripped.
 *
 * Non-hotels pass through unchanged (same object identity when nothing
 * changes, so callers can cheaply tell whether normalization did anything).
 */
export function normalizePlace(place: Place): Place {
  if (place.category !== "hotel") return place;
  const dirty =
    place.dwellMin !== 0 ||
    place.priority !== 3 ||
    place.appointment !== undefined ||
    place.openingHours !== undefined ||
    place.forceDayId !== undefined;
  if (!dirty) return place;
  const { appointment: _appointment, openingHours: _openingHours, forceDayId: _forceDayId, ...rest } = place;
  return { ...rest, dwellMin: 0, priority: 3 };
}

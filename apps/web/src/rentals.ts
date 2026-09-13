import type { CarRental, Day } from "@app/domain";

/**
 * Validate a proposed rental against existing rentals and trip bounds:
 *  - startDate must be <= endDate
 *  - dates must be within trip's first and last day (when tripDays provided)
 *  - must not overlap any other rental (excluding `currentRentalId` when editing)
 * Returns a human-readable error explanation or null when valid.
 */
export function validateRental(
  candidate: { startDate: string; endDate: string },
  existingRentals: CarRental[],
  currentRentalId?: string,
  tripDays?: Day[],
): string | null {
  if (!candidate.startDate || !candidate.endDate) {
    return "Both start date and end date are required.";
  }
  if (candidate.startDate > candidate.endDate) {
    return "Rental end date cannot be before its start date.";
  }

  if (tripDays && tripDays.length > 0) {
    const minDate = tripDays[0]!.date;
    const maxDate = tripDays[tripDays.length - 1]!.date;
    if (candidate.startDate < minDate || candidate.endDate > maxDate) {
      return `Rental dates must be within the trip (${minDate} to ${maxDate}).`;
    }
  }

  const overlap = existingRentals.find((r) => {
    if (currentRentalId && r.id === currentRentalId) return false;
    return r.startDate <= candidate.endDate && candidate.startDate <= r.endDate;
  });

  if (overlap) {
    return `Rental dates overlap an existing rental (${overlap.startDate} to ${overlap.endDate}).`;
  }

  return null;
}

/** Check if a concrete date is covered by any car rental. */
export function isDateCoveredByRental(date: string, rentals: CarRental[]): boolean {
  return rentals.some((r) => r.startDate <= date && date <= r.endDate);
}

/** Check if a day has car availability (car rental or whole-trip carOnly). */
export function isDayCarAvailable(day: Day, rentals: CarRental[] = [], carOnly = false): boolean {
  if (carOnly) return true;
  return isDateCoveredByRental(day.date, rentals);
}

/**
 * A rental is flagged out of range when the trip dates no longer cover it
 * (e.g. trip dates were shrunk or shifted after the rental was booked).
 */
export function isRentalOutOfRange(rental: CarRental, tripDays: Day[]): boolean {
  if (!tripDays || tripDays.length === 0) return true;
  const minDate = tripDays[0]!.date;
  const maxDate = tripDays[tripDays.length - 1]!.date;
  return rental.startDate < minDate || rental.endDate > maxDate;
}

/**
 * Calculate the segment of trip days covered by a rental (clamped to trip bounds).
 * Returns { startIdx, count } where startIdx is the index of the first covered
 * day, and count is the number of covered days. Returns null if entirely outside.
 */
export function rentalSpanOnTrip(
  rental: CarRental,
  tripDays: Day[],
): { startIdx: number; count: number } | null {
  if (!tripDays || tripDays.length === 0) return null;
  const coveredIndices: number[] = [];
  tripDays.forEach((d, idx) => {
    if (rental.startDate <= d.date && d.date <= rental.endDate) {
      coveredIndices.push(idx);
    }
  });
  if (coveredIndices.length === 0) return null;
  const startIdx = coveredIndices[0]!;
  const count = coveredIndices.length;
  return { startIdx, count };
}

/** Human-readable date range summary for a rental, noting Day N indices when within trip. */
export function formatRentalDates(rental: CarRental, tripDays: Day[]): string {
  const startDayIdx = tripDays.findIndex((d) => d.date === rental.startDate);
  const endDayIdx = tripDays.findIndex((d) => d.date === rental.endDate);
  const startLabel = startDayIdx >= 0 ? `Day ${startDayIdx + 1} (${rental.startDate})` : rental.startDate;
  const endLabel = endDayIdx >= 0 ? `Day ${endDayIdx + 1} (${rental.endDate})` : rental.endDate;
  if (rental.startDate === rental.endDate) return startLabel;
  return `${startLabel} – ${endLabel}`;
}

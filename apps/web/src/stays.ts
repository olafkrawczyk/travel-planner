import type { Trip } from "@app/domain";

/**
 * A trip's `Stay[]` is a view over its per-day hotel bases (`Day.baseStartId`,
 * `baseEndId`, `stayStart`): sleep in `hotelId` from day `checkInDayIdx`
 * (0-based) for `nights` nights. `staysFor` derives that view from a trip;
 * `validateStays` checks a candidate `Stay[]` is a legal write-back. All UI
 * mutations, though, should go through the `with*` helpers below instead of
 * building a `Stay[]` by hand — they are total: given any current stays and
 * any requested edit they always return a NEW, valid, fully-covering stay
 * list (clamping out-of-range requests, and returning the input unchanged
 * when a request genuinely cannot be honoured), so the store never has to
 * reject a UI edit.
 */
export interface Stay {
  hotelId: string;
  checkInDayIdx: number;
  nights: number;
}

/**
 * Derive the trip's stays from its days: a new stay starts on day 0, on any
 * day explicitly marked `stayStart`, or wherever `baseEndId` changes from the
 * previous day. The explicit flag is what lets two adjacent stays share a
 * hotel without being merged back into one on the next derive. (On derive,
 * only `baseEndId`/`stayStart` matter — per-day `baseStartId` inconsistencies
 * are tolerated and fixed on the next `setStays` write-back.)
 */
export function staysFor(trip: Trip): Stay[] {
  const stays: Stay[] = [];
  for (let i = 0; i < trip.days.length; i++) {
    const day = trip.days[i]!;
    const prev = trip.days[i - 1];
    const startsNewStay = i === 0 || day.stayStart === true || prev!.baseEndId !== day.baseEndId;
    if (startsNewStay) stays.push({ hotelId: day.baseEndId, checkInDayIdx: i, nights: 1 });
    else stays[stays.length - 1]!.nights++;
  }
  return stays;
}

/**
 * Validate that stays cover the trip contiguously from day 0: sorted by
 * check-in, first stay starts at day 0, no gaps/overlaps, total nights equal
 * the trip length, and every hotel exists. Returns an error message or null.
 */
export function validateStays(stays: Stay[], trip: Trip): string | null {
  if (stays.length === 0) return "A trip needs at least one stay.";
  let cursor = 0;
  for (const s of stays) {
    if (s.checkInDayIdx !== cursor) return "Stays must cover every day exactly once.";
    if (s.nights < 1) return "A stay needs at least one night.";
    if (!trip.places.some((p) => p.id === s.hotelId)) return "Stay hotel not found.";
    cursor += s.nights;
  }
  if (cursor !== trip.days.length) return "Stays must cover every day exactly once.";
  return null;
}

const clone = (s: Stay): Stay => ({ ...s });

/** Replace stay `idx`'s hotel; out-of-range `idx` is a no-op. */
export function withHotel(stays: Stay[], idx: number, hotelId: string): Stay[] {
  if (idx < 0 || idx >= stays.length) return stays.map(clone);
  return stays.map((s, i) => (i === idx ? { ...s, hotelId } : clone(s)));
}

/**
 * Move stay `idx`'s check-in to `dayIdx` (idx > 0 only — stay 0 is pinned to
 * day 0): the previous stay shrinks/grows to meet it and later stays keep
 * their own check-in days, so `dayIdx` is clamped into the one-day-per-night
 * gap between the previous stay's check-in and the next stay's check-in (or
 * the trip's last day, for the last stay).
 */
export function withCheckIn(stays: Stay[], idx: number, dayIdx: number, days: number): Stay[] {
  if (idx <= 0 || idx >= stays.length) return stays.map(clone);
  const prev = stays[idx - 1]!;
  const next = stays[idx + 1];
  const min = prev.checkInDayIdx + 1;
  const max = next ? next.checkInDayIdx - 1 : days - 1;
  if (min > max) return stays.map(clone);
  const clamped = Math.min(Math.max(dayIdx, min), max);
  const result = stays.map(clone);
  result[idx - 1]!.nights = clamped - prev.checkInDayIdx;
  result[idx]!.checkInDayIdx = clamped;
  result[idx]!.nights = (next ? next.checkInDayIdx : days) - clamped;
  return result;
}

/** The `nights` range `withNights(stays, idx, ·, days)` will actually honour
 *  for stay `idx` — for the UI to bound its number input. */
export function nightsRange(stays: Stay[], idx: number, days: number): { min: number; max: number } {
  if (idx < 0 || idx >= stays.length) return { min: 1, max: days };
  if (stays.length === 1) return { min: days, max: days }; // the only stay always covers the whole trip
  const isLast = idx === stays.length - 1;
  const other = isLast ? stays[idx - 1]! : stays[stays.length - 1]!;
  return { min: 1, max: stays[idx]!.nights + other.nights - 1 };
}

/**
 * Change stay `idx`'s nights. A single stay is pinned to the trip length (a
 * no-op). For any other stay but the last, later check-ins shift by the
 * delta and the LAST stay absorbs it, clamped so the last stay keeps at least
 * one night. For the LAST stay, nights are derived from its check-in day by
 * definition, so instead its check-in moves and the PREVIOUS stay absorbs the
 * delta, clamped so the previous stay keeps at least one night.
 */
export function withNights(stays: Stay[], idx: number, nights: number, days: number): Stay[] {
  if (idx < 0 || idx >= stays.length) return stays.map(clone);
  if (stays.length === 1) return stays.map(clone);
  const result = stays.map(clone);
  const isLast = idx === result.length - 1;
  if (!isLast) {
    const old = result[idx]!.nights;
    const lastIdx = result.length - 1;
    const last = result[lastIdx]!;
    const clamped = Math.min(Math.max(nights, 1), old + last.nights - 1);
    const delta = clamped - old;
    result[idx]!.nights = clamped;
    for (let i = idx + 1; i < result.length; i++) result[i]!.checkInDayIdx += delta;
    last.nights = days - last.checkInDayIdx;
  } else {
    const prev = result[idx - 1]!;
    const old = result[idx]!.nights;
    const clamped = Math.min(Math.max(nights, 1), old + prev.nights - 1);
    result[idx]!.nights = clamped;
    result[idx]!.checkInDayIdx = days - clamped;
    prev.nights = result[idx]!.checkInDayIdx - prev.checkInDayIdx;
  }
  return result;
}

/**
 * Split the stay covering `dayIdx` into two at that day, the new stay
 * starting on `dayIdx` with the SAME hotel (the caller re-assigns it via
 * `withHotel`). A no-op when `dayIdx` is not strictly inside a stay (i.e. it
 * is already a check-in day, or outside the trip).
 */
export function withSplitAt(stays: Stay[], dayIdx: number, days: number): Stay[] {
  if (dayIdx <= 0 || dayIdx >= days) return stays.map(clone);
  const i = stays.findIndex((s) => dayIdx > s.checkInDayIdx && dayIdx < s.checkInDayIdx + s.nights);
  if (i < 0) return stays.map(clone);
  const s = stays[i]!;
  const result = stays.map(clone);
  result[i] = { ...s, nights: dayIdx - s.checkInDayIdx };
  result.splice(i + 1, 0, {
    hotelId: s.hotelId,
    checkInDayIdx: dayIdx,
    nights: s.checkInDayIdx + s.nights - dayIdx,
  });
  return result;
}

/** Remove stay `idx` (idx > 0 only — stay 0 can't be removed): the previous
 *  stay absorbs its nights. */
export function withoutStay(stays: Stay[], idx: number): Stay[] {
  if (idx <= 0 || idx >= stays.length) return stays.map(clone);
  const result = stays.map(clone);
  result[idx - 1]!.nights += result[idx]!.nights;
  result.splice(idx, 1);
  return result;
}

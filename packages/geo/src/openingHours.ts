/**
 * Adapter around the `opening_hours` npm library: expands an OSM
 * `opening_hours` expression into concrete per-date TimeWindows for a
 * trip's date range. Pure computation (no network, no solver changes);
 * every failure mode degrades to null (= leave the place without
 * windows, i.e. always open) so callers can inform the user.
 *
 * Known limitation: OSM hours are local to the POI; this MVP assumes
 * they are local to the trip (a single trip timezone). Location-dependent
 * selectors (sunrise/sunset/PH) are treated as unusable rather than
 * silently wrong.
 */

import opening_hours from "opening_hours";
import type { TimeWindow } from "@app/domain";

/** Per-date windows keyed by YYYY-MM-DD, or null when the tag is
 *  unusable (missing/unparseable/location-dependent) or means 24/7
 *  (= always open, no windows needed). */
export type OpeningHoursExpansion = Record<string, TimeWindow[]> | null;

/** Selectors the parser can only resolve with a position/country context,
 *  which the adapter does not receive → treat as unusable for the MVP. */
const LOCATION_DEPENDENT = /\b(sunrise|sunset|dawn|dusk)\b/i;

const MS_PER_DAY = 86_400_000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local-time HH:mm of a Date (the parser works in machine-local time,
 *  so trip-local dates map onto it consistently). */
function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local midnight of a YYYY-MM-DD string. */
function startOfDay(date: string): Date {
  const parts = date.split("-").map(Number);
  return new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1, 0, 0, 0, 0);
}

/**
 * Expand an OSM opening_hours expression into per-date TimeWindows.
 * Intervals are clipped to each day's bounds (overnight windows split),
 * merged per date, and formatted as HH:mm (end-of-day caps at 23:59).
 * Returns null when the expression cannot be used; an empty record means
 * "parsed fine but closed on every given date".
 */
export function expandOpeningHours(expr: string, dates: string[]): OpeningHoursExpansion {
  const value = expr.trim();
  // "24/7" (and nothing at all) = always open → no windows.
  if (!value || /^24\/7$/i.test(value)) return null;
  if (LOCATION_DEPENDENT.test(value)) return null;

  let oh: InstanceType<typeof opening_hours>;
  try {
    oh = new opening_hours(value);
  } catch {
    return null; // unparseable
  }

  if (dates.length === 0) return {};
  const from = startOfDay(dates[0]!);
  const to = new Date(startOfDay(dates[dates.length - 1]!).getTime() + MS_PER_DAY);
  let intervals: [Date, Date, boolean, string | undefined][];
  try {
    intervals = oh.getOpenIntervals(from, to);
  } catch {
    // e.g. "PH off" without a country/position context.
    return null;
  }

  const result: Record<string, TimeWindow[]> = {};
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i]!;
    const lo = startOfDay(date).getTime();
    const hi = lo + MS_PER_DAY;
    // Clip every interval to this day's bounds (overnight windows split).
    const clipped: [number, number][] = [];
    for (const [start, end] of intervals) {
      const s = Math.max(start.getTime(), lo);
      const e = Math.min(end.getTime(), hi);
      if (e <= s) continue;
      // Cap at one minute before midnight: stored times are HH:mm ≤ 23:59.
      clipped.push([s, Math.min(e, hi - 60_000)]);
    }
    if (clipped.length === 0) continue;
    // Sort and merge overlapping/adjacent intervals per date.
    clipped.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const [s, e] of clipped) {
      const last = merged[merged.length - 1];
      if (last && s <= last[1]) last[1] = Math.max(last[1], e);
      else merged.push([s, e]);
    }
    result[date] = merged.map(([s, e]) => ({
      start: hhmm(new Date(s)),
      end: hhmm(new Date(e)),
    }));
  }
  return result;
}

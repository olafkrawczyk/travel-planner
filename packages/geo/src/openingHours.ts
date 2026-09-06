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
import type { TimeWindow, WeeklyPattern, Weekday, DayPattern } from "@app/domain";
import { weekdayOf } from "@app/domain";

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

/** A single date's resolved state: closed, or open with these windows
 *  (deep-equal on start/end pairs, order-sensitive — `expandOpeningHours`
 *  already returns sorted/merged windows so this is safe). */
type DateState = "closed" | TimeWindow[];

const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function stateKey(state: DateState): string {
  return state === "closed" ? "closed" : JSON.stringify(state);
}

function toDayPattern(state: DateState): DayPattern {
  return state === "closed" ? { kind: "closed" } : { kind: "open", windows: state };
}

/** The shape `deriveWeeklyProposal` returns: a full weekly pattern plus the
 *  per-date exceptions that diverge from it. */
export interface WeeklyProposal {
  weekly: WeeklyPattern;
  exceptions: Record<string, "closed" | TimeWindow[]>;
}

/**
 * Turns `expandOpeningHours`'s flat per-date expansion into the
 * weekly-pattern-plus-exceptions shape the PlaceEditor's OSM-review UI
 * diffs against a place's current stored pattern before the user applies
 * or discards it. Pure computation; never touches `expandOpeningHours`
 * itself or any stored data.
 *
 * - `expansion === null` (tag absent/unparseable/24-7/location-dependent,
 *   see `expandOpeningHours`'s doc comment) means there is nothing to
 *   propose → returns `null`.
 * - Otherwise every date in `dates` gets an actual state: `expansion[date]`
 *   if present and non-empty, else "closed" (per `expandOpeningHours`'s
 *   contract that a date missing from a non-null expansion parsed fine but
 *   is closed that day).
 * - Dates are grouped by weekday. Each of the 7 weekdays that has at least
 *   one date in `dates` gets the state shared by the STRICT MAJORITY of
 *   its dates as the weekly pattern; every date whose actual state differs
 *   from its weekday's chosen pattern is reported in `exceptions`, keyed
 *   by date. On a count tie, "open" is preferred over "closed", and a
 *   further tie between two different open window-sets is broken by
 *   whichever occurs earliest among that weekday's dates — both are
 *   deterministic but otherwise-arbitrary choices, per the task brief.
 * - A weekday with no dates at all in `dates` (e.g. a trip that never
 *   spans a Sunday) still gets an entry in `weekly` (it's a full 7-key
 *   type): it defaults to `{kind:"closed"}` since there is no evidence to
 *   support any other claim, and "closed" is the safer default than
 *   guessing "open" for a day the user never actually visited.
 */
export function deriveWeeklyProposal(
  expansion: OpeningHoursExpansion,
  dates: string[],
): WeeklyProposal | null {
  if (expansion === null) return null;

  const actualByDate = new Map<string, DateState>();
  for (const date of dates) {
    const windows = expansion[date];
    actualByDate.set(date, windows && windows.length > 0 ? windows : "closed");
  }

  const datesByWeekday = new Map<Weekday, string[]>();
  for (const date of dates) {
    const wd = weekdayOf(date);
    const list = datesByWeekday.get(wd);
    if (list) list.push(date);
    else datesByWeekday.set(wd, [date]);
  }

  const weekly = {} as WeeklyPattern;
  const chosenKeyByWeekday = new Map<Weekday, string>();

  for (const wd of WEEKDAYS) {
    const datesForWeekday = datesByWeekday.get(wd);
    if (!datesForWeekday || datesForWeekday.length === 0) {
      weekly[wd] = { kind: "closed" };
      continue;
    }

    // Tally each distinct state (by deep-equal key) among this weekday's dates.
    const counts = new Map<string, { state: DateState; count: number; firstIndex: number }>();
    datesForWeekday.forEach((date, idx) => {
      const state = actualByDate.get(date)!;
      const key = stateKey(state);
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { state, count: 1, firstIndex: idx });
    });

    // Sort by count desc; tie-break prefers "open" over "closed", then
    // whichever state's first occurrence comes earliest for this weekday.
    const ranked = Array.from(counts.entries()).map(([key, v]) => ({ key, ...v }));
    ranked.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const aClosed = a.state === "closed" ? 1 : 0;
      const bClosed = b.state === "closed" ? 1 : 0;
      if (aClosed !== bClosed) return aClosed - bClosed;
      return a.firstIndex - b.firstIndex;
    });
    const chosen = ranked[0]!;

    weekly[wd] = toDayPattern(chosen.state);
    chosenKeyByWeekday.set(wd, chosen.key);
  }

  const exceptions: Record<string, "closed" | TimeWindow[]> = {};
  for (const date of dates) {
    const wd = weekdayOf(date);
    const actual = actualByDate.get(date)!;
    const chosenKey = chosenKeyByWeekday.get(wd);
    if (chosenKey !== undefined && stateKey(actual) !== chosenKey) {
      exceptions[date] = actual;
    }
  }

  return { weekly, exceptions };
}

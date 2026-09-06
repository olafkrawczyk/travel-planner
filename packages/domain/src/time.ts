/**
 * Time representation: the solver works in integer minutes-since-midnight.
 * "HH:mm" strings exist only at the UI/persistence boundary. No `Date`
 * anywhere in solver-facing types.
 */

export type Minutes = number; // minutes since midnight, 0..1439 (may exceed for dwell math)

/** "09:30" -> 570. Throws on malformed input. */
export function parseHHMM(s: string): Minutes {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid time string: ${JSON.stringify(s)}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Invalid time string: ${JSON.stringify(s)}`);
  return h * 60 + min;
}

/** 570 -> "09:30". Float input is rounded to the nearest whole minute first
 *  (14:10.999… -> "14:11"), so fractional travel arithmetic can never leak
 *  into displayed times. Values >= 24h wrap via modulo of the hour part. */
export function formatHHMM(mins: Minutes): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Parse with fallback instead of throwing (UI convenience). */
export function tryParseHHMM(s: string, fallback: Minutes = 0): Minutes {
  try {
    return parseHHMM(s);
  } catch {
    return fallback;
  }
}

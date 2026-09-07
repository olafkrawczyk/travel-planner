/** Minutes as "18h 39m" (or "45m" under an hour) — raw minute counts like
 *  "1119 min" aren't something a reader can size up at a glance. */
export function formatDuration(totalMin: number): string {
  if (!Number.isFinite(totalMin) || totalMin <= 0) return "0m";
  const m = Math.round(totalMin);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm}m`;
  if (mm === 0) return `${h}h`;
  return `${h}h ${mm}m`;
}

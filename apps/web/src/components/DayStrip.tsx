import { useState, type CSSProperties } from "react";
import { tryParseHHMM } from "@app/domain";
import { useStore, dayColor } from "../store";

/** "YYYY-MM-DD" → "MM/DD". String-sliced rather than parsed through `Date` so
 *  there is no UTC/local timezone drift to reason about for a date that has
 *  no time component to begin with. */
function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${m}/${d}`;
}

/** Crosshair glyph for "focus this day on the map" — inline SVG (currentColor,
 *  stroke-width 1.5, 16px) in place of the 🎯 emoji, which renders as an
 *  illegible smudge at badge scale. */
function CrosshairIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" />
      <path d="M8 0.5v2.5M8 13v2.5M0.5 8h2.5M13 8h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Trip overview day strip: one compact tile per day (number, date, load bar)
 * so a 12-day/100-place trip is legible as a whole, not just as several
 * thousand pixels of timeline scroll. Self-contained (reads the store
 * directly, like `Timeline`) so it can be dropped into `TripScreen` with no
 * prop-drilling.
 *
 * Load is derived, not solved: `DayPlan.slackMin` is minutes of headroom
 * before the day's soft end time (signed — negative means overrun), and
 * `committed = window - slack` is exactly the portion of the day's own
 * start–end window that's actually spoken for. That's the number the
 * (recently re-levelled) solver is trying to balance across days, so this is
 * the most direct way to make that balance visible.
 *
 * Rendered as a route diagram, not a row of generic pills: a single neutral
 * hairline (`.day-strip-track::before`) runs behind every day's badge, and
 * each badge is the coloured "station" on that line — the same colour used
 * for that day's map markers and schedule rule, so the strip doubles as the
 * legend binding map to schedule. The line is drawn once, spanning the full
 * (possibly-scrolled) track width, rather than stitched per item, so it stays
 * correct regardless of how many days there are or how wide each tile ends
 * up — no per-item geometry to keep in sync.
 */
export function DayStrip() {
  const trip = useStore((s) => s.currentTrip);
  const itinerary = useStore((s) => s.itinerary);
  const focusDay = useStore((s) => s.focusDay);
  // Local "last clicked" marker for the active tile — separate from the
  // store's `focusDayId`, which MapView clears immediately after fitting the
  // map (a one-shot pulse, not a durable selection).
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!trip) return null;
  const plans = new Map((itinerary?.days ?? []).map((d) => [d.dayId, d]));

  function selectDay(dayId: string, index: number) {
    setSelectedId(dayId);
    focusDay(dayId); // map fits this day's route
    // Timeline (out of scope for this change) renders one .day-section per
    // trip day in the same order — reach across the DOM rather than
    // threading refs through a component we can't edit.
    const sections = document.querySelectorAll<HTMLElement>(".timeline .day-section");
    sections[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="day-strip">
      <div className="day-strip-track" role="group" aria-label="Trip days overview">
        {trip.days.map((day, i) => {
          const plan = plans.get(day.id);
          const budget = Math.max(1, tryParseHHMM(day.end) - tryParseHHMM(day.start));
          const loading = itinerary === null;
          const empty = !loading && (!plan || plan.stops.length === 0);
          const over = (plan?.slackMin ?? 0) < 0;
          const slack = plan?.slackMin ?? budget;
          const loadPercent = Math.max(0, Math.min(100, ((budget - slack) / budget) * 100));
          const overMin = over ? -plan!.slackMin : 0;
          const dateLabel = shortDate(day.date);

          const statusText = loading
            ? "solving…"
            : over
              ? `over by ${overMin} min`
              : empty
                ? "nothing planned"
                : `${Math.round(loadPercent)}% of the day booked`;

          // Visible, self-explanatory label — no reliance on hover/title to
          // learn what the number means.
          const statusLabel = loading
            ? "…"
            : over
              ? `+${overMin}m over`
              : empty
                ? "Empty"
                : `${Math.round(loadPercent)}% booked`;

          // One plain sentence, shared by the aria-label and the hover
          // title — no middle-dot-joined meta fragments.
          const summary = `Day ${i + 1}, ${dateLabel} — ${statusText}`;

          return (
            <div
              key={day.id}
              role="button"
              tabIndex={0}
              className={
                "day-strip-item" +
                (selectedId === day.id ? " active" : "") +
                (over ? " over" : "") +
                (empty ? " empty" : "")
              }
              aria-pressed={selectedId === day.id}
              aria-label={summary}
              title={summary}
              onClick={() => selectDay(day.id, i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  selectDay(day.id, i);
                }
              }}
            >
              <span className="day-strip-top">
                <span
                  className="day-number-badge"
                  aria-hidden="true"
                  style={{ "--day-accent": dayColor(i) } as CSSProperties}
                >
                  {i + 1}
                </span>
                <span className="day-strip-date clock">{dateLabel}</span>
                <button
                  type="button"
                  className="icon-btn day-isolate-btn"
                  title="Focus this day (hides all other days on the map)"
                  aria-label={`Focus day ${i + 1} on the map`}
                  onClick={(e) => {
                    e.stopPropagation();
                    useStore.getState().isolateDay(day.id);
                  }}
                >
                  <CrosshairIcon />
                </button>
              </span>
              <span className="day-strip-bar-row">
                <span
                  className="day-strip-bar"
                  role="progressbar"
                  aria-label={`Day ${i + 1} time booked`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={loading ? undefined : Math.round(Math.min(loadPercent, 100))}
                >
                  <span
                    className="day-strip-fill"
                    style={{ width: `${loading ? 0 : Math.min(loadPercent, 100)}%` }}
                  />
                </span>
                <span className="day-strip-status tnum" aria-hidden="true">
                  {statusLabel}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

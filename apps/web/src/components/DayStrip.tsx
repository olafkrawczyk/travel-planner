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
    <div className="day-strip" role="group" aria-label="Trip days overview">
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
              : `${Math.round(loadPercent)}% booked`;

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
            aria-label={`Day ${i + 1}, ${dateLabel} — ${statusText}`}
            title={`Day ${i + 1} · ${dateLabel} · ${statusText}`}
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
              <span className="day-strip-date">{dateLabel}</span>
              <button
                type="button"
                className="icon-btn day-isolate-btn"
                title="Focus this day (hides all other days on the map)"
                onClick={(e) => {
                  e.stopPropagation();
                  useStore.getState().isolateDay(day.id);
                }}
              >
                🎯
              </button>
            </span>
            <span className="day-strip-bar" aria-hidden="true">
              <span
                className="day-strip-fill"
                style={{ width: `${loading ? 0 : Math.min(loadPercent, 100)}%` }}
              />
            </span>
            <span className="day-strip-status" aria-hidden="true">
              {loading ? "…" : over ? `+${overMin}m` : empty ? "Empty" : `${Math.round(loadPercent)}%`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

import { useState, type CSSProperties } from "react";
import type { DayPlan, Itinerary, Place, TravelOverride } from "@app/domain";
import { useStore, dayColor } from "../store";
import { UnscheduledTray } from "./UnscheduledTray";

function timeToMins(t: string) {
  if (!t) return 0;
  const [h = 0, m = 0] = t.split(':').map(Number);
  return h * 60 + m;
}

function duration(start: string, end: string) {
  let diff = timeToMins(end) - timeToMins(start);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

/**
 * Time-axis scale, in pixels per minute of real elapsed time.
 *
 * The previous 2px/min made a 12-hour day 1440px tall and turned the
 * 12-day/100-place sample trip into ~17,000px of scroll. MINUTE_PX is a
 * quarter of that so a full trip stays scannable, while MIN_*_PX puts a
 * floor under every stop/leg/wait block so it can always hold its content
 * (a short walk or a quick coffee stop no longer collapses to a few
 * pixels). The axis is exactly linear for any block at or above its floor;
 * below the floor it is drawn at the floor height instead — piecewise, not
 * proportional, but still ordered and legible. `track-end-boundary` is
 * positioned from the same floored heights (see `layoutDayTrack`) plus the
 * day's slack, so an overrun stays visible instead of being masked by
 * floor-inflation earlier in the day.
 */
const MINUTE_PX = 0.5;
const MIN_STOP_PX = 40; // number badge + name + times + pin/move in one row
const MIN_LEG_PX = 28; // one line: "12 min walk", source badge, GMaps link
const MIN_WAIT_PX = 24; // a single "wait N min" badge

function blockPx(minutes: number, floor: number): number {
  return Math.max(minutes * MINUTE_PX, floor);
}

interface TrackRow {
  legInPx: number | null;
  waitPx: number;
  stopPx: number;
  legOutPx: number | null;
}

/** Precomputes each block's rendered (floored) pixel height and their sum,
 *  so the end-of-day boundary can be placed relative to what's actually
 *  drawn rather than the raw calendar duration. */
function layoutDayTrack(plan: DayPlan): { rows: TrackRow[]; totalPx: number } {
  let totalPx = 0;
  const rows = plan.stops.map((stop, i) => {
    const legIn = plan.legs[i];
    const isLast = i === plan.stops.length - 1;
    const legOut = isLast ? plan.legs[i + 1] : undefined;
    const legInPx = legIn ? blockPx(legIn.minutes, MIN_LEG_PX) : null;
    const waitPx = stop.waitMin > 0 ? blockPx(stop.waitMin, MIN_WAIT_PX) : 0;
    const stopPx = blockPx(duration(stop.arrive, stop.depart), MIN_STOP_PX);
    const legOutPx = legOut ? blockPx(legOut.minutes, MIN_LEG_PX) : null;
    totalPx += (legInPx ?? 0) + waitPx + stopPx + (legOutPx ?? 0);
    return { legInPx, waitPx, stopPx, legOutPx };
  });
  return { rows, totalPx };
}

function placeOf(places: Place[], id: string): Place | undefined {
  return places.find((p) => p.id === id);
}

function gmapsLink(from: Place | undefined, to: Place | undefined, mode: string): string {
  if (!from || !to) return "#";
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", `${from.lat},${from.lng}`);
  url.searchParams.set("destination", `${to.lat},${to.lng}`);
  
  let gmode = "transit";
  if (mode === "walk") gmode = "walking";
  if (mode === "car") gmode = "driving";
  
  url.searchParams.set("travelmode", gmode);
  return url.toString();
}

/**
 * Timeline: per-day sections with stops and legs, unscheduled tray,
 * drag-between-days + move-to-day menu, pin/lock toggles (tasks 8.1–8.4, 9.1–9.2).
 */
export function Timeline() {
  const trip = useStore((s) => s.currentTrip);
  const itinerary = useStore((s) => s.itinerary);
  const solving = useStore((s) => s.solving);
  const dirty = useStore((s) => s.dirty);
  const saveState = useStore((s) => s.saveState);
  const regenerate = useStore((s) => s.regenerate);
  if (!trip || !itinerary) return null;

  const plans = new Map(itinerary.days.map((d) => [d.dayId, d]));
  // A trip with no schedulable places (hotels don't count — see the
  // solver's own `schedulable` filter in matrix.ts) has nothing for the
  // per-day "nothing scheduled" hints or the "everything fits" tray message
  // to meaningfully report; both would otherwise read as a dead end (P1 #4)
  // or an outright lie ("everything fits" when there was nothing to fit).
  // This one banner replaces both with the actual next step.
  const hasPlaces = trip.places.some((p) => p.category !== "hotel");

  return (
    <div className={"timeline" + (solving ? " solving" : "")}>
      {solving && <div className="solve-banner">Optimising… improvements appear live.</div>}
      {!hasPlaces && (
        <div className="empty-trip-hint hint">
          <strong>No places yet.</strong> Search the map above and add a few — museums, food, a
          viewpoint, whatever you want to see. Once you've added some, hit Regenerate (⟳ or
          Ctrl+Enter) to build the itinerary.
        </div>
      )}
      {dirty && !solving && (
        <div className="stale-banner">
          Itinerary out of date —{" "}
          {saveState === "error"
            ? "your changes are NOT being saved (see the save status above)"
            : "your changes are saved"}
          , but new or moved places won't appear here (or in the "couldn't fit" tray) until you
          regenerate.
          <button onClick={regenerate}>⟳ Regenerate</button>
        </div>
      )}
      {trip.days.map((day, dayIndex) => {
        const plan = plans.get(day.id);
        return (
          <DaySection
            key={day.id}
            dayIndex={dayIndex}
            date={day.date}
            start={day.start}
            end={day.end}
            locked={day.locked ?? false}
            baseStartId={day.baseStartId}
            baseEndId={day.baseEndId}
            plan={plan}
            itinerary={itinerary}
            trip={trip}
          />
        );
      })}
      <UnscheduledTray itinerary={itinerary} trip={trip} />
    </div>
  );
}

function DaySection(props: {
  dayIndex: number;
  date: string;
  start: string;
  end: string;
  locked: boolean;
  baseStartId: string;
  baseEndId: string;
  plan?: DayPlan;
  itinerary: Itinerary;
  trip: NonNullable<ReturnType<typeof useStore.getState>["currentTrip"]>;
}) {
  const { dayIndex, date, plan, trip } = props;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const mutateTrip = useStore((s) => s.mutateTrip);
  const setHovered = useStore((s) => s.setHovered);
  const hoveredPlaceId = useStore((s) => s.hoveredPlaceId);
  const openPlaceEditor = useStore((s) => s.openPlaceEditor);
  const hiddenDays = useStore((s) => s.hiddenDays);
  const toggleDayHidden = useStore((s) => s.toggleDayHidden);
  const isolateDay = useStore((s) => s.isolateDay);
  const focusDay = useStore((s) => s.focusDay);
  const regenerate = useStore((s) => s.regenerate);
  const solving = useStore((s) => s.solving);
  
  const day = trip.days[dayIndex]!;
  const places = trip.places;
  const baseStart = placeOf(places, props.baseStartId);
  const baseEnd = placeOf(places, props.baseEndId);
  const track = plan && plan.stops.length > 0 ? layoutDayTrack(plan) : null;

  return (
    <section
      className={"day-section" + (dropActive ? " drop-active" : "")}
      style={{ "--day-accent": dayColor(dayIndex) } as CSSProperties}
      onDragOver={(e) => {
        e.preventDefault();
        setDropActive(true);
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropActive(false);
        const placeId = e.dataTransfer.getData("text/place-id");
        if (placeId) mutateTrip(() => {}, { type: "dragToDay", placeId, dayId: day.id });
      }}
    >
      <header
        className="day-header"
        title="Click to focus this day on the map"
        onClick={() => focusDay(day.id)}
      >
        <h3>
          <span className="day-number-badge" aria-hidden="true">
            {dayIndex + 1}
          </span>
          Day {dayIndex + 1} <span className="date">{date}</span>
        </h3>
        <span className="day-times">
          <input
            type="time"
            className="time-input-inline"
            value={day.start}
            title="Edit day start time"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              mutateTrip((draft) => {
                draft.days[dayIndex]!.start = e.target.value || day.start;
              })
            }
          />
          <span className="time-sep">–</span>
          <input
            type="time"
            className="time-input-inline"
            value={day.end}
            title="Edit day end time"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              mutateTrip((draft) => {
                draft.days[dayIndex]!.end = e.target.value || day.end;
              })
            }
          />
        </span>
        {plan && plan.slackMin < 0 && (
          <span className="badge badge-danger" title="This day exceeds its end time (e.g. after a force-insert)">
            ⚠ over by {-plan.slackMin} min
          </span>
        )}
        <span className="spacer" />
        <button
          className="icon-btn"
          title="Focus this day (hides all other days on the map)"
          onClick={(e) => {
            e.stopPropagation();
            isolateDay(day.id);
          }}
        >
          🎯
        </button>
        <button
          className={"icon-btn" + (hiddenDays.has(day.id) ? " active" : "")}
          title={hiddenDays.has(day.id) ? "Show this day on the map" : "Hide this day on the map"}
          onClick={(e) => {
            e.stopPropagation();
            toggleDayHidden(day.id);
          }}
        >
          {hiddenDays.has(day.id) ? "🚫" : "👁"}
        </button>
        <button
          className={"icon-btn" + (props.locked ? " active" : "")}
          title={props.locked ? "Unlock day" : "Lock day (re-solves leave it unchanged)"}
          onClick={(e) => {
            e.stopPropagation();
            mutateTrip((draft) => {
              draft.days[dayIndex]!.locked = !props.locked;
            });
          }}
        >
          {props.locked ? "🔒" : "🔓"}
        </button>
        <button
          className="icon-btn"
          title="Day settings"
          onClick={(e) => {
            e.stopPropagation();
            setSettingsOpen(!settingsOpen);
          }}
        >
          ⚙
        </button>
      </header>

      {settingsOpen && (
        <DaySettings dayIndex={dayIndex} />
      )}

      {!plan || plan.stops.length === 0 ? (
        // An empty day is a planning gap, not an error (see the day strip's
        // matching "Empty" tile / dashed --warning box, and the
        // `.day-section .day-empty` override in components.css that gives
        // this the same look) — so this stays a quiet suggestion, not a
        // warning shout, and gives the two ways out of the gap: drag a
        // place in (the section is already a drop target) or regenerate.
        // When the whole trip has no places yet, "drag a place here" isn't
        // actionable (there's nothing to drag) and "regenerate" is a no-op —
        // the top-of-timeline banner already covers that case, so this stays
        // a quiet, unstyled note instead of repeating a warning box on every
        // single day (P1 #4).
        !places.some((p) => p.category !== "hotel") ? (
          <p className="hint day-empty-quiet">No places yet — see the note above.</p>
        ) : (
          <p className="hint day-empty">
            {props.locked ? (
              "Nothing scheduled — this day is locked, so regenerating won't fill it. Drag a place here, or unlock the day first."
            ) : (
              <>
                Nothing scheduled yet. Drag a place here, or{" "}
                <button
                  type="button"
                  className="day-empty-action"
                  disabled={solving}
                  title="Recompute the itinerary (Ctrl+Enter)"
                  onClick={regenerate}
                >
                  regenerate
                </button>{" "}
                to let the solver fill it.
              </>
            )}
          </p>
        )
      ) : (
        <div className="timeline-track">
          <div
            className="track-end-boundary"
            style={{ top: `${track!.totalPx + plan.slackMin * MINUTE_PX}px` }}
          >
            <span className="boundary-text">Day End ({props.end})</span>
          </div>

          <div className="track-blocks">
            {plan.stops.map((stop, i) => {
              const place = placeOf(places, stop.placeId);
              const legIn = plan.legs[i];
              const legOut = plan.legs[i + 1];
              const row = track!.rows[i]!;

              return (
                <div key={stop.placeId} className="track-group">
                  {legIn && (
                    <div className="track-leg" style={{ height: `${row.legInPx}px` }}>
                      <div className="track-leg-content">
                        <LegRow leg={legIn} places={places} onOverride={handleOverride} />
                      </div>
                    </div>
                  )}
                  {stop.waitMin > 0 && (
                    <div className="track-wait" style={{ height: `${row.waitPx}px` }}>
                      <span className="badge badge-warning">wait {stop.waitMin} min</span>
                    </div>
                  )}
                  <div
                    className={"track-stop" + (hoveredPlaceId === stop.placeId ? " hovered" : "")}
                    style={{ height: `${row.stopPx}px` }}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/place-id", stop.placeId);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onMouseEnter={() => setHovered(stop.placeId)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <div className="track-stop-content">
                      <span className="stop-number">{i + 1}</span>
                      <button
                        className="stop-name"
                        onClick={() => openPlaceEditor(stop.placeId)}
                        title="Edit place"
                      >
                        {place?.name ?? stop.placeId}
                      </button>
                      <span className="stop-times">
                        {stop.arrive}–{stop.depart}
                      </span>
                      <span className="spacer" />
                      <PinToggle placeId={stop.placeId} dayIndex={dayIndex} />
                      <MoveMenu placeId={stop.placeId} currentDayIndex={dayIndex} />
                    </div>
                  </div>
                  {legOut && i === plan.stops.length - 1 && (
                    <div className="track-leg" style={{ height: `${row.legOutPx}px` }}>
                      <div className="track-leg-content">
                        <LegRow leg={legOut} places={places} onOverride={handleOverride} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {plan && plan.stops.length > 0 && (
        <p className="day-footnote hint">
          Return to {baseEnd?.name ?? "base"}: {plan.legs[plan.legs.length - 1]?.minutes ?? 0} min · slack{" "}
          {plan.slackMin} min
          {baseStart && baseEnd && ` · bases: ${baseStart.name} → ${baseEnd.name}`}
        </p>
      )}

      {day.pinnedOrder && day.pinnedOrder.length > 0 && (
        <p className="hint">Pinned: {day.pinnedOrder.map((id) => placeOf(places, id)?.name ?? id).join(" → ")}</p>
      )}
    </section>
  );

  function handleOverride(fromId: string, toId: string, minutes: number) {
    mutateTrip(
      (draft) => {
        const ov: TravelOverride = { fromId, toId, minutes, symmetric: true };
        draft.travelOverrides = [
          ...(draft.travelOverrides || []).filter(
            (o) => !((o.fromId === fromId && o.toId === toId) || (o.symmetric && o.fromId === toId && o.toId === fromId)),
          ),
          ov,
        ];
      },
      { type: "full" },
    );
  }
}

/** Day settings: start/end times; bases are read-only info (stays panel is the source of truth). */
function DaySettings({ dayIndex }: { dayIndex: number }) {
  const trip = useStore((s) => s.currentTrip)!;
  const mutateTrip = useStore((s) => s.mutateTrip);
  const day = trip.days[dayIndex]!;
  const baseStart = trip.places.find((p) => p.id === day.baseStartId);
  const baseEnd = trip.places.find((p) => p.id === day.baseEndId);
  return (
    <div className="day-settings">
      <label>
        Start
        <input
          type="time"
          value={day.start}
          onChange={(e) =>
            mutateTrip((draft) => {
              draft.days[dayIndex]!.start = e.target.value || day.start;
            })
          }
        />
      </label>
      <label>
        End
        <input
          type="time"
          value={day.end}
          onChange={(e) =>
            mutateTrip((draft) => {
              draft.days[dayIndex]!.end = e.target.value || day.end;
            })
          }
        />
      </label>
      <p className="hint day-bases-info">
        🛏 {baseStart?.name ?? "?"}
        {baseEnd && baseEnd.id !== baseStart?.id ? ` → 🛏 ${baseEnd.name}` : ""}
        {" · edit in Stays"}
      </p>
    </div>
  );
}

/** Inline leg row: minutes, mode, source badge, explanation tooltip, override edit, Google Maps link. */
function LegRow({
  leg,
  places,
  onOverride,
}: {
  leg: { fromId: string; toId: string; minutes: number; mode: string; source: string; explanation?: string };
  places: Place[];
  onOverride(fromId: string, toId: string, minutes: number): void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(Math.round(leg.minutes)));
  const from = placeOf(places, leg.fromId);
  const to = placeOf(places, leg.toId);

  return (
    <div className="leg-row" title={leg.explanation ?? `${leg.mode} ${leg.minutes} min`}>
      {editing ? (
        <form
          className="leg-edit"
          onSubmit={(e) => {
            e.preventDefault();
            const mins = Math.max(0, Math.round(Number(value)) || 0);
            onOverride(leg.fromId, leg.toId, mins);
            setEditing(false);
          }}
        >
          <input
            type="number"
            min={0}
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => setEditing(false)}
          />
          min
          <button type="submit">✓</button>
        </form>
      ) : (
        <button className="leg-minutes" title="Click to override travel time" onClick={() => setEditing(true)}>
          {Math.round(leg.minutes)} min {leg.mode}
        </button>
      )}
      <span className={"badge " + (leg.source === "override" ? "badge-success" : leg.source === "api" ? "badge-info" : "")}>{leg.source}</span>
      <a
        className="gmaps-link"
        href={gmapsLink(from, to, leg.mode)}
        target="_blank"
        rel="noreferrer"
        title="Check in Google Maps"
      >
        GMaps ↗
      </a>
    </div>
  );
}

function PinToggle({ placeId, dayIndex }: { placeId: string; dayIndex: number }) {
  const trip = useStore((s) => s.currentTrip);
  const mutateTrip = useStore((s) => s.mutateTrip);
  const pinned = trip?.days[dayIndex]?.pinnedOrder?.includes(placeId) ?? false;
  return (
    <button
      className={"icon-btn" + (pinned ? " active" : "")}
      title={pinned ? "Unpin position" : "Pin to position (keeps its relative order on re-solve)"}
      onClick={() =>
        mutateTrip((draft) => {
          const day = draft.days[dayIndex]!;
          const list = new Set(day.pinnedOrder ?? []);
          if (list.has(placeId)) list.delete(placeId);
          else list.add(placeId);
          day.pinnedOrder = list.size > 0 ? [...list] : undefined;
        })
      }
    >
      📌
    </button>
  );
}

/** "Move to day N" fallback menu (mobile-friendly, task 9.1). */
function MoveMenu({ placeId, currentDayIndex }: { placeId: string; currentDayIndex: number }) {
  const trip = useStore((s) => s.currentTrip);
  const mutateTrip = useStore((s) => s.mutateTrip);
  if (!trip) return null;
  return (
    <select
      className="move-menu"
      value=""
      title="Move to day"
      onChange={(e) => {
        const dayId = e.target.value;
        if (dayId) mutateTrip(() => {}, { type: "dragToDay", placeId, dayId });
      }}
    >
      <option value="">Move to…</option>
      {trip.days.map((d, i) => (
        <option key={d.id} value={d.id} disabled={i === currentDayIndex}>
          Day {i + 1}
        </option>
      ))}
    </select>
  );
}


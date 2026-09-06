import { useState } from "react";
import type { DayPattern, Place, TimeWindow, Weekday, WeeklyPattern } from "@app/domain";
import { openingHoursState, weekdayOf } from "@app/domain";

/** The three legible opening-hours states a place can be in (see
 *  `@app/domain`'s `openingHoursState`, which this mirrors exactly). Kept as
 *  a local component-state field name (`mode`) rather than reusing that
 *  export's own type name, since this one also drives which of the
 *  weekly/exceptions editors below render. */
export type OpeningHoursMode = "unknown" | "always_open" | "has_hours";

/** The editor's local, uncommitted opening-hours state — mirrors the four
 *  `Place` fields this whole feature touches, but nothing here is written to
 *  the actual place until the surrounding form's Save button runs
 *  `buildOpeningHoursFields` (see below) and the caller persists the result. */
export interface OpeningHoursLocalState {
  mode: OpeningHoursMode;
  /** Only meaningful when `mode === "has_hours"`. */
  weekly: WeeklyPattern | undefined;
  /** Only meaningful when `mode === "has_hours"`. */
  closedDates: string[];
  /** Only meaningful when `mode === "has_hours"`. The legacy per-date
   *  override map, now serving purely as "exceptions" to `weekly`. */
  openingHours: Record<string, TimeWindow[]>;
}

/**
 * Derive the editor's local state from a `Place` (or a brand-new place,
 * `undefined`). `mode` exactly matches `openingHoursState`'s classification;
 * `weekly`/`closedDates`/`openingHours` are seeded straight from the place's
 * fields regardless of `mode` — harmless since a place produced by this
 * editor's own `buildOpeningHoursFields` never has residual data outside its
 * current mode, and defensively correct for hand-edited/imported data that
 * might.
 */
export function deriveOpeningHoursLocalState(place: Place | undefined): OpeningHoursLocalState {
  if (!place) {
    return { mode: "unknown", weekly: undefined, closedDates: [], openingHours: {} };
  }
  return {
    mode: openingHoursState(place),
    weekly: place.openingHoursWeekly,
    closedDates: place.openingHoursClosedDates ?? [],
    openingHours: place.openingHours ?? {},
  };
}

/** The subset of `Place` fields this editor owns, as produced by
 *  `buildOpeningHoursFields`. Every field is optional/absent exactly when it
 *  should be cleared — the caller spreads this straight into a fresh `Place`
 *  object literal (never onto a spread of the previous place), so an absent
 *  key here really does mean "not set" in the saved place. */
export interface OpeningHoursFields {
  openingHoursWeekly?: WeeklyPattern;
  openingHoursClosedDates?: string[];
  openingHours?: Record<string, TimeWindow[]>;
  openingHoursAlwaysOpen?: boolean;
}

/**
 * Inverse of `deriveOpeningHoursLocalState`: turns the editor's local state
 * back into the `Place` fields to persist on Save.
 *  - `"unknown"` → nothing (all four fields absent).
 *  - `"always_open"` → only `openingHoursAlwaysOpen: true`.
 *  - `"has_hours"` → `openingHoursWeekly`/`openingHoursClosedDates`/
 *    `openingHours` from local state (empty collections become `undefined`
 *    so an untouched exceptions list doesn't persist as `[]`/`{}`).
 */
export function buildOpeningHoursFields(state: OpeningHoursLocalState): OpeningHoursFields {
  if (state.mode === "unknown") return {};
  if (state.mode === "always_open") return { openingHoursAlwaysOpen: true };
  return {
    openingHoursWeekly: state.weekly,
    openingHoursClosedDates: state.closedDates.length > 0 ? state.closedDates : undefined,
    openingHours: Object.keys(state.openingHours).length > 0 ? state.openingHours : undefined,
  };
}

export const WEEKDAY_ORDER: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export const WEEKDAY_SHORT: Record<Weekday, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/** Friendly starting point when a user switches to "has specific hours"
 *  with no weekly pattern yet — every day open 09:00-17:00, matching the old
 *  per-date editor's default new-window hours. This is a UI-only default;
 *  it is unrelated to `deriveWeeklyProposal`'s own all-closed fallback for
 *  weekdays with no OSM evidence. */
export function defaultWeeklyPattern(): WeeklyPattern {
  const pattern = {} as WeeklyPattern;
  for (const wd of WEEKDAY_ORDER) {
    pattern[wd] = { kind: "open", windows: [{ start: "09:00", end: "17:00" }] };
  }
  return pattern;
}

const DEFAULT_WINDOW: TimeWindow = { start: "09:00", end: "17:00" };

function omit<T>(obj: Record<string, T>, key: string): Record<string, T> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

const TIMEZONE_NOTE_TEXT =
  "Sunrise/sunset-based or location-dependent rules aren't supported.";

function TimezoneNote({ timezone }: { timezone: string }) {
  return (
    <p className="hint" role="note">
      Hours are treated as local to the trip ({timezone}). {TIMEZONE_NOTE_TEXT}
    </p>
  );
}

/** One weekday's row: closed toggle + (when open) editable window list. */
function WeekdayRow({
  weekday,
  pattern,
  onChange,
}: {
  weekday: Weekday;
  pattern: DayPattern;
  onChange(next: DayPattern): void;
}) {
  const label = WEEKDAY_LABELS[weekday];
  const closed = pattern.kind === "closed";

  function setWindows(windows: TimeWindow[]) {
    onChange(windows.length > 0 ? { kind: "open", windows } : { kind: "closed" });
  }

  return (
    <div className="oh-weekday-row">
      <span className="oh-weekday-label">{label}</span>
      <label className="oh-closed-toggle">
        <input
          type="checkbox"
          checked={closed}
          aria-label={`${label} closed`}
          onChange={(e) => onChange(e.target.checked ? { kind: "closed" } : { kind: "open", windows: [{ ...DEFAULT_WINDOW }] })}
        />
        Closed
      </label>
      {!closed && (
        <div className="oh-windows">
          {pattern.windows.map((w, wi) => (
            <div className="oh-window-row" key={wi}>
              <input
                type="time"
                aria-label={`${label} opening time, window ${wi + 1}`}
                value={w.start}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const next = [...pattern.windows];
                  next[wi] = { ...w, start: e.target.value };
                  setWindows(next);
                }}
              />
              <input
                type="time"
                aria-label={`${label} closing time, window ${wi + 1}`}
                value={w.end}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const next = [...pattern.windows];
                  next[wi] = { ...w, end: e.target.value };
                  setWindows(next);
                }}
              />
              <button
                type="button"
                aria-label={`Remove ${label} window ${wi + 1}`}
                onClick={() => setWindows(pattern.windows.filter((_, k) => k !== wi))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            aria-label={`Add ${label} window`}
            onClick={() => setWindows([...pattern.windows, { ...DEFAULT_WINDOW }])}
          >
            Add window
          </button>
        </div>
      )}
    </div>
  );
}

function WeeklyGrid({
  weekly,
  onChange,
}: {
  weekly: WeeklyPattern;
  onChange(next: WeeklyPattern): void;
}) {
  return (
    <div className="oh-weekly-grid" role="group" aria-label="Weekly opening hours">
      {WEEKDAY_ORDER.map((wd) => (
        <WeekdayRow
          key={wd}
          weekday={wd}
          pattern={weekly[wd]}
          onChange={(next) => onChange({ ...weekly, [wd]: next })}
        />
      ))}
    </div>
  );
}

/**
 * Secondary "date exceptions" section: overrides `weekly` for specific trip
 * dates (closed, or a different window list) — the union of `closedDates`
 * and `openingHours`'s keys. Visually subordinate to the weekly grid (see
 * opening-hours.css) since it's the secondary affordance per the proposal.
 */
function ExceptionsSection({
  closedDates,
  openingHours,
  days,
  onClosedDatesChange,
  onOpeningHoursChange,
}: {
  closedDates: string[];
  openingHours: Record<string, TimeWindow[]>;
  days: { id: string; date: string }[];
  onClosedDatesChange(next: string[]): void;
  onOpeningHoursChange(next: Record<string, TimeWindow[]>): void;
}) {
  const overridden = new Set<string>([...closedDates, ...Object.keys(openingHours)]);
  const dayIndexByDate = new Map(days.map((d, i) => [d.date, i]));
  const exceptionDays = days.filter((d) => overridden.has(d.date));
  const availableDays = days.filter((d) => !overridden.has(d.date));
  const [pickDate, setPickDate] = useState(availableDays[0]?.date ?? "");
  const effectivePick = availableDays.some((d) => d.date === pickDate)
    ? pickDate
    : (availableDays[0]?.date ?? "");

  function removeException(date: string) {
    onClosedDatesChange(closedDates.filter((d) => d !== date));
    onOpeningHoursChange(omit(openingHours, date));
  }

  function dateLabel(date: string): string {
    const i = dayIndexByDate.get(date);
    const weekday = WEEKDAY_SHORT[weekdayOf(date)];
    return i === undefined ? `${date}, ${weekday}` : `Day ${i + 1} (${date}, ${weekday})`;
  }

  return (
    <div className="oh-exceptions">
      <h4>Date exceptions</h4>
      <p className="hint" role="note">
        Overrides for one specific trip date — a holiday closure, a one-off late opening. A date
        exception beats the weekly pattern for that date only; removing it restores the weekly
        pattern.
      </p>
      {exceptionDays.length === 0 && <p className="hint">No date exceptions set.</p>}
      {exceptionDays.map((d) => {
        const label = dateLabel(d.date);
        const isClosed = closedDates.includes(d.date);
        return (
          <div className="oh-exception-row" key={d.id}>
            <span className="oh-exception-label">{label}</span>
            {isClosed ? (
              <>
                <span className="badge badge-danger">Closed</span>
                <button
                  type="button"
                  onClick={() => {
                    onClosedDatesChange(closedDates.filter((x) => x !== d.date));
                    onOpeningHoursChange({ ...openingHours, [d.date]: [{ ...DEFAULT_WINDOW }] });
                  }}
                >
                  Change to open hours
                </button>
              </>
            ) : (
              <div className="oh-windows">
                {(openingHours[d.date] ?? []).map((w, wi) => (
                  <div className="oh-window-row" key={wi}>
                    <input
                      type="time"
                      aria-label={`${label} opening time, window ${wi + 1}`}
                      value={w.start}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        const next = [...(openingHours[d.date] ?? [])];
                        next[wi] = { ...next[wi]!, start: e.target.value };
                        onOpeningHoursChange({ ...openingHours, [d.date]: next });
                      }}
                    />
                    <input
                      type="time"
                      aria-label={`${label} closing time, window ${wi + 1}`}
                      value={w.end}
                      onChange={(e) => {
                        if (!e.target.value) return;
                        const next = [...(openingHours[d.date] ?? [])];
                        next[wi] = { ...next[wi]!, end: e.target.value };
                        onOpeningHoursChange({ ...openingHours, [d.date]: next });
                      }}
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${label} window ${wi + 1}`}
                      onClick={() => {
                        const next = (openingHours[d.date] ?? []).filter((_, k) => k !== wi);
                        if (next.length === 0) onOpeningHoursChange(omit(openingHours, d.date));
                        else onOpeningHoursChange({ ...openingHours, [d.date]: next });
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  aria-label={`Add ${label} window`}
                  onClick={() =>
                    onOpeningHoursChange({
                      ...openingHours,
                      [d.date]: [...(openingHours[d.date] ?? []), { ...DEFAULT_WINDOW }],
                    })
                  }
                >
                  Add window
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClosedDatesChange([...closedDates, d.date]);
                    onOpeningHoursChange(omit(openingHours, d.date));
                  }}
                >
                  Mark closed instead
                </button>
              </div>
            )}
            <button
              type="button"
              aria-label={`Remove exception for ${label}`}
              onClick={() => removeException(d.date)}
            >
              Remove exception
            </button>
          </div>
        );
      })}
      {availableDays.length > 0 && (
        <div className="row oh-add-exception">
          <label>
            Add exception for
            <select
              aria-label="Date to add an exception for"
              value={effectivePick}
              onChange={(e) => setPickDate(e.target.value)}
            >
              {availableDays.map((d) => (
                <option key={d.id} value={d.date}>
                  {dateLabel(d.date)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!effectivePick}
            onClick={() => effectivePick && onClosedDatesChange([...closedDates, effectivePick])}
          >
            Mark closed
          </button>
          <button
            type="button"
            disabled={!effectivePick}
            onClick={() =>
              effectivePick &&
              onOpeningHoursChange({ ...openingHours, [effectivePick]: [{ ...DEFAULT_WINDOW }] })
            }
          >
            Add open window
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The main opening-hours editor: the three-state mode control, plus (when
 * `mode === "has_hours"`) the weekly grid and the date-exceptions section.
 * Controlled component — the caller (`PlaceEditor.tsx`) owns
 * `OpeningHoursLocalState` and threads it through `buildOpeningHoursFields`
 * on Save. The OSM-fetch/review flow is a separate component
 * (`OpeningHoursOsmReview`) rendered alongside this one by the caller.
 */
export function OpeningHoursEditor({
  state,
  onChange,
  days,
  timezone,
}: {
  state: OpeningHoursLocalState;
  onChange(next: OpeningHoursLocalState): void;
  days: { id: string; date: string }[];
  timezone: string;
}) {
  const { mode, weekly, closedDates, openingHours } = state;

  function setMode(next: OpeningHoursMode) {
    if (next === mode) return;
    if (next === "unknown") {
      onChange({ mode: "unknown", weekly: undefined, closedDates: [], openingHours: {} });
    } else if (next === "always_open") {
      onChange({ mode: "always_open", weekly: undefined, closedDates: [], openingHours: {} });
    } else {
      onChange({
        mode: "has_hours",
        weekly: weekly ?? defaultWeeklyPattern(),
        closedDates,
        openingHours,
      });
    }
  }

  return (
    <div className="oh-editor">
      <fieldset className="oh-mode-group">
        <legend>Opening hours</legend>
        <label className="oh-mode-option">
          <input
            type="radio"
            name="opening-hours-mode"
            value="unknown"
            checked={mode === "unknown"}
            onChange={() => setMode("unknown")}
          />
          Unknown
        </label>
        <label className="oh-mode-option">
          <input
            type="radio"
            name="opening-hours-mode"
            value="always_open"
            checked={mode === "always_open"}
            onChange={() => setMode("always_open")}
          />
          Always open
        </label>
        <label className="oh-mode-option">
          <input
            type="radio"
            name="opening-hours-mode"
            value="has_hours"
            checked={mode === "has_hours"}
            onChange={() => setMode("has_hours")}
          />
          Has specific hours
        </label>
      </fieldset>

      {mode === "unknown" && (
        <p className="hint" role="note">
          Hours haven't been set. The planner currently treats this place as having no time
          restriction, but that's a placeholder, not a confirmed fact — set hours, or confirm
          it's always open, if you know them.
        </p>
      )}
      {mode === "always_open" && (
        <p className="hint" role="note">
          This place has no opening-hour restriction — the planner can schedule a visit at any
          time.
        </p>
      )}
      {mode === "has_hours" && (
        <>
          <TimezoneNote timezone={timezone} />
          <WeeklyGrid
            weekly={weekly ?? defaultWeeklyPattern()}
            onChange={(next) => onChange({ ...state, weekly: next })}
          />
          <ExceptionsSection
            closedDates={closedDates}
            openingHours={openingHours}
            days={days}
            onClosedDatesChange={(next) => onChange({ ...state, closedDates: next })}
            onOpeningHoursChange={(next) => onChange({ ...state, openingHours: next })}
          />
        </>
      )}
    </div>
  );
}

export { TimezoneNote };

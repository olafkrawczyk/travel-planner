import { useState } from "react";
import type { DayPattern, TimeWindow, Weekday, WeeklyPattern } from "@app/domain";
import { OverpassClient, expandOpeningHours, deriveWeeklyProposal, type WeeklyProposal } from "@app/geo";
import { WEEKDAY_LABELS, WEEKDAY_ORDER } from "./OpeningHoursEditor";

/** The current weekly/exceptions state the OSM proposal is diffed against —
 *  a projection of `OpeningHoursLocalState` (see OpeningHoursEditor.tsx)
 *  without its `mode`, since the diff only cares about the underlying data. */
export interface OpeningHoursCurrentForDiff {
  weekly: WeeklyPattern | undefined;
  closedDates: string[];
  openingHours: Record<string, TimeWindow[]>;
}

export interface OpeningHoursProposalDiff {
  changedWeekdays: { weekday: Weekday; from: DayPattern | undefined; to: DayPattern }[];
  addedExceptions: string[];
  removedExceptions: string[];
  changedExceptions: { date: string; from: "closed" | TimeWindow[]; to: "closed" | TimeWindow[] }[];
}

function patternKey(p: DayPattern): string {
  return p.kind === "closed" ? "closed" : JSON.stringify(p.windows);
}

function exceptionKey(v: "closed" | TimeWindow[]): string {
  return v === "closed" ? "closed" : JSON.stringify(v);
}

/**
 * Turns a `deriveWeeklyProposal` result plus the editor's current
 * weekly/exceptions state into a "what will change" description for the
 * review panel. Deliberately a plain list, not a full cell-by-cell diff —
 * per the task brief, a clear "here's what will change" summary is the bar.
 * A weekday with no current pattern at all (`current.weekly === undefined`)
 * is always reported as changed, since there is nothing to compare against.
 */
export function diffOpeningHoursProposal(
  proposal: WeeklyProposal,
  current: OpeningHoursCurrentForDiff,
): OpeningHoursProposalDiff {
  const changedWeekdays: OpeningHoursProposalDiff["changedWeekdays"] = [];
  for (const wd of WEEKDAY_ORDER) {
    const from = current.weekly?.[wd];
    const to = proposal.weekly[wd];
    if (!from || patternKey(from) !== patternKey(to)) {
      changedWeekdays.push({ weekday: wd, from, to });
    }
  }

  const currentExceptions = new Map<string, "closed" | TimeWindow[]>();
  for (const d of current.closedDates) currentExceptions.set(d, "closed");
  for (const [d, w] of Object.entries(current.openingHours)) currentExceptions.set(d, w);

  const addedExceptions: string[] = [];
  const changedExceptions: OpeningHoursProposalDiff["changedExceptions"] = [];
  for (const [date, value] of Object.entries(proposal.exceptions)) {
    const existing = currentExceptions.get(date);
    if (existing === undefined) {
      addedExceptions.push(date);
    } else if (exceptionKey(existing) !== exceptionKey(value)) {
      changedExceptions.push({ date, from: existing, to: value });
    }
  }

  const removedExceptions: string[] = [];
  for (const date of currentExceptions.keys()) {
    if (!(date in proposal.exceptions)) removedExceptions.push(date);
  }

  return { changedWeekdays, addedExceptions, removedExceptions, changedExceptions };
}

export function proposalDiffIsEmpty(diff: OpeningHoursProposalDiff): boolean {
  return (
    diff.changedWeekdays.length === 0 &&
    diff.addedExceptions.length === 0 &&
    diff.removedExceptions.length === 0 &&
    diff.changedExceptions.length === 0
  );
}

/** Splits a `WeeklyProposal`'s `exceptions` map into the `closedDates`/
 *  `openingHours` shape `OpeningHoursLocalState` uses, for Apply. */
export function exceptionsToOverrides(
  exceptions: Record<string, "closed" | TimeWindow[]>,
): { closedDates: string[]; openingHours: Record<string, TimeWindow[]> } {
  const closedDates: string[] = [];
  const openingHours: Record<string, TimeWindow[]> = {};
  for (const [date, value] of Object.entries(exceptions)) {
    if (value === "closed") closedDates.push(date);
    else openingHours[date] = value;
  }
  return { closedDates, openingHours };
}

const FAILURE_COPY = {
  // Both the "no tag at all" and the "tag present but unparseable/24-7/
  // location-dependent" cases previously said "left as always open" — fixed
  // per task 3.4 so neither claims the place IS always open, only that its
  // hours are unknown. The old third message ("no open hours on the trip
  // dates") no longer applies once expandOpeningHours(...) does succeed and
  // deriveWeeklyProposal runs: a valid-but-empty expansion (parses fine,
  // closed on every requested date) is a legitimate, reviewable "closed
  // every trip date" proposal, not a failure — it flows into the normal
  // review panel below instead of a special-cased message.
  noTag: "No opening hours found on OSM — hours remain unknown for this place.",
  unusable:
    "OSM's opening-hours data for this place couldn't be used (unparseable, or a 24/7/location-based rule) — hours remain unknown.",
  network: "Couldn't fetch from OSM — check your connection and try again.",
} as const;

/**
 * OSM fetch button + reviewable-proposal panel (task 3.2/F). Fetching never
 * writes to the editor's committed state directly — it only populates local
 * `proposal` state, rendered as a diff against `current`; nothing changes
 * until "Apply" is clicked, and "Discard" clears the proposal with no other
 * effect (satisfies the "OSM proposal discarded leaves existing hours
 * untouched" spec scenario).
 */
export function OpeningHoursOsmReview({
  osmId,
  days,
  timezone,
  overpassBaseUrl,
  current,
  onApply,
}: {
  osmId: string;
  days: { id: string; date: string }[];
  timezone: string;
  overpassBaseUrl?: string;
  current: OpeningHoursCurrentForDiff;
  onApply(next: { weekly: WeeklyPattern; closedDates: string[]; openingHours: Record<string, TimeWindow[]> }): void;
}) {
  const [fetching, setFetching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [proposal, setProposal] = useState<WeeklyProposal | null>(null);

  async function fetchProposal() {
    if (fetching) return;
    setFetching(true);
    setNote(null);
    setProposal(null);
    try {
      const client = new OverpassClient({ baseUrl: overpassBaseUrl });
      const tags = await client.fetchOsmTags(osmId);
      const expr = tags?.opening_hours;
      if (!expr) {
        setNote(FAILURE_COPY.noTag);
        return;
      }
      const dates = days.map((d) => d.date);
      const expansion = expandOpeningHours(expr, dates);
      if (!expansion) {
        setNote(FAILURE_COPY.unusable);
        return;
      }
      const derived = deriveWeeklyProposal(expansion, dates);
      if (!derived) {
        setNote(FAILURE_COPY.unusable);
        return;
      }
      setProposal(derived);
    } catch {
      setNote(FAILURE_COPY.network);
    } finally {
      setFetching(false);
    }
  }

  function apply() {
    if (!proposal) return;
    const { closedDates, openingHours } = exceptionsToOverrides(proposal.exceptions);
    onApply({ weekly: proposal.weekly, closedDates, openingHours });
    setProposal(null);
    setNote(null);
  }

  function discard() {
    setProposal(null);
  }

  const diff = proposal ? diffOpeningHoursProposal(proposal, current) : null;

  return (
    <div className="oh-osm">
      <div className="row">
        <button type="button" disabled={fetching} onClick={fetchProposal}>
          {fetching ? "Fetching…" : "Fetch opening hours from OSM"}
        </button>
      </div>
      <p className="hint" role="note">
        Hours are treated as local to the trip ({timezone}). Sunrise/sunset-based or
        location-dependent rules aren't supported.
      </p>
      {note && (
        <p className="hint" role="note">
          {note}
        </p>
      )}
      {proposal && diff && (
        <div className="oh-osm-review">
          <h4>Review OSM proposal</h4>
          {proposalDiffIsEmpty(diff) ? (
            <p className="hint">No changes from the current hours.</p>
          ) : (
            <ul className="oh-osm-diff">
              {diff.changedWeekdays.length > 0 && (
                <li>
                  Weekdays that would change:{" "}
                  {diff.changedWeekdays.map((c) => WEEKDAY_LABELS[c.weekday]).join(", ")}
                </li>
              )}
              {diff.addedExceptions.length > 0 && (
                <li>New date exceptions: {diff.addedExceptions.join(", ")}</li>
              )}
              {diff.removedExceptions.length > 0 && (
                <li>Exceptions that would be removed: {diff.removedExceptions.join(", ")}</li>
              )}
              {diff.changedExceptions.length > 0 && (
                <li>
                  Exceptions that would change: {diff.changedExceptions.map((c) => c.date).join(", ")}
                </li>
              )}
            </ul>
          )}
          <div className="row end">
            <button type="button" onClick={discard}>
              Discard
            </button>
            <button type="button" onClick={apply}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

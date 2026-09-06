import { useState } from "react";
import type { Itinerary, Place, UnscheduledReason } from "@app/domain";
import { useStore } from "../store";

/**
 * "Couldn't fit" tray (task 8.3, extended by add-smart-dropping, rewritten
 * for the P0 unscheduled-explanation defect): reason, plain-language
 * explanation, a concrete next step, priority badge and fix actions (force
 * into a day / raise to must) — never silently omit unscheduled places.
 *
 * Split out of Timeline.tsx so the copy/decision logic below (`unscheduledCopy`,
 * `reasonBadge`, `previewForceInsert`, `forcePreviewMessage`) can be
 * unit-tested directly, the same way PlaceEditor.test.ts tests
 * PlaceEditor.tsx's pure helpers — this repo has no component-render harness.
 */

const PRIORITY_LABEL: Record<1 | 2 | 3, string> = { 1: "must", 2: "want", 3: "nice" };

function placeOf(places: Place[], id: string): Place | undefined {
  return places.find((p) => p.id === id);
}

/** Plain-language "why" + "what to do" for one unscheduled place. */
export interface UnscheduledCopy {
  /** What specifically blocked this place, in plain language. */
  why: string;
  /** Concrete next step(s) the user can take, or "" when there's nothing more specific to add. */
  actions: string;
  /**
   * True when `why` is a best guess rather than a firm diagnosis. Exists
   * because of a known solver limitation (see matrix.ts:427's `reasonFor`):
   * ANY place with non-empty `openingHours` is classified `window_conflict`
   * regardless of the real cause, so that reason code alone is not
   * trustworthy. `explain.ts`'s `explainWindowConflict` still probes real
   * per-day appointment/window data before writing its explanation string,
   * and every branch that names a concrete appointment time or opening
   * window is grounded in that real data — only its last-resort fallback (no
   * day's real data pinned down a conflict) carries no such guarantee, so
   * only that fallback is marked tentative here.
   */
  tentative: boolean;
}

/** The literal fallback string `explainWindowConflict` (packages/solver/src/explain.ts)
 *  writes when no allowed day's real appointment/window data could pin down
 *  a concrete conflict — see `UnscheduledCopy.tentative` above for why this
 *  one string, and only this one, needs a hedge. */
const NO_WINDOW_MATCHED = "No opening window fits any day.";
/** The literal string explain.ts writes when the place itself is gone. */
const PLACE_GONE = "This place is no longer part of the trip.";

/**
 * Turn a solver reason code + its `explainUnscheduled` sentence into plain,
 * honest copy. Never invents specificity the solver didn't actually compute:
 * where the explanation already names a real constraint (a day, an
 * appointment time, an opening window), that sentence is shown as-is with a
 * concrete suggestion; where the reason code is known to be unreliable (see
 * `tentative` above), the copy says so instead of asserting a category it
 * can't back up.
 */
export function unscheduledCopy(reason: UnscheduledReason, explanation: string | undefined): UnscheduledCopy {
  const why = explanation?.trim() || "";
  if (!why || why === PLACE_GONE) {
    return { why: why || "This place could not be scheduled.", actions: "", tentative: false };
  }
  if (reason === "no_time") {
    return {
      why,
      actions: "Shorten its visit length, free up room on the day that fits best, or force it in anyway (that day will run over).",
      tentative: false,
    };
  }
  if (reason === "unreachable") {
    return {
      why,
      actions: "Check its coordinates, or add a travel-time override for a leg to/from it.",
      tentative: false,
    };
  }
  // window_conflict
  if (why === NO_WINDOW_MATCHED) {
    return {
      why: "This is flagged as an opening-hours or appointment conflict, but that may not be the real reason — it can also mean every day is simply full.",
      actions: "Check its opening hours and any appointment time, or try a day with more free time.",
      tentative: true,
    };
  }
  if (why.startsWith("Appointment at")) {
    return {
      why,
      actions: "Move the appointment time, give that day more room, or shift other places off it.",
      tentative: false,
    };
  }
  if (why.startsWith("Opening window")) {
    return {
      why,
      actions: "Fix its opening hours if they're wrong, or plan to visit on a day when it's actually open.",
      tentative: false,
    };
  }
  // Unknown/future explanation shape — show it verbatim rather than guessing.
  return { why, actions: "", tentative: false };
}

/** Short badge label + tone for the reason, honest about `tentative` (a
 *  softer "possible conflict" / warning tone instead of a confident
 *  "conflict" / danger tone — see `UnscheduledCopy.tentative`). */
export function reasonBadge(reason: UnscheduledReason, tentative: boolean): { label: string; tone: "danger" | "warning" } {
  if (reason === "no_time") return { label: "no time", tone: "danger" };
  if (reason === "unreachable") return { label: "no route", tone: "danger" };
  return tentative ? { label: "possible conflict", tone: "warning" } : { label: "conflict", tone: "danger" };
}

/** Cost of force-inserting a place, computed from data already in hand (no
 *  solver call): the day's current slack minus the place's dwell time.
 *  Travel time is NOT counted — the real number can therefore only be worse
 *  than this, never better, so this is an honest lower bound rather than a
 *  fabricated precise prediction. */
export interface ForcePreview {
  slackBeforeMin: number;
  slackAfterMin: number;
  /** Minutes already guaranteed to run over from dwell time alone (0 = still fits, ignoring travel). */
  overBy: number;
}

export function previewForceInsert(dwellMin: number, slackBeforeMin: number): ForcePreview {
  const slackAfterMin = slackBeforeMin - dwellMin;
  return { slackBeforeMin, slackAfterMin, overBy: Math.max(0, -slackAfterMin) };
}

/** Human-readable line for the preview above, shown before the user commits to Force. */
export function forcePreviewMessage(dayNumber: number, preview: ForcePreview): string {
  if (preview.overBy > 0) {
    return `Day ${dayNumber} would already run over by at least ${preview.overBy} min from dwell time alone — before travel is even added.`;
  }
  return `Day ${dayNumber} would have about ${preview.slackAfterMin} min free after dwell time (travel not counted yet).`;
}

export function UnscheduledTray({ itinerary, trip }: { itinerary: Itinerary; trip: NonNullable<ReturnType<typeof useStore.getState>["currentTrip"]> }) {
  const openPlaceEditor = useStore((s) => s.openPlaceEditor);
  const hasPlaces = trip.places.some((p) => p.category !== "hotel");
  if (itinerary.unscheduled.length === 0) {
    // Silently rendering nothing here used to be indistinguishable from the
    // tray being broken — someone hunting for a place they just added had no
    // way to tell "it got scheduled" from "this is stuck". A quiet
    // confirmation closes that gap without competing with the tray's real
    // content when there IS something unscheduled (hence no warning/danger
    // styling — this is the success case, not a lesser version of the
    // alert). Suppressed when the trip has no schedulable places at all —
    // "everything fits" is not a meaningful claim when there is nothing to
    // fit, and the empty-trip guidance above the day list already covers it.
    return hasPlaces ? <p className="hint unscheduled-fit">Everything fits — no places left unscheduled.</p> : null;
  }
  return (
    <div className="unscheduled-tray">
      <h3>Couldn’t fit</h3>
      <ul>
        {itinerary.unscheduled.map(({ placeId, reason, explanation }) => {
          const p = placeOf(trip.places, placeId);
          const copy = unscheduledCopy(reason, explanation);
          const badge = reasonBadge(reason, copy.tentative);
          return (
            <li key={placeId}>
              <button className="stop-name" onClick={() => openPlaceEditor(placeId)}>
                {p?.name ?? placeId}
              </button>
              {p && (
                <span className={"badge " + (p.priority === 1 ? "badge-danger" : p.priority === 2 ? "badge-info" : "")} title={`Priority: ${PRIORITY_LABEL[p.priority]}`}>
                  {PRIORITY_LABEL[p.priority]}
                </span>
              )}
              <span className={"badge " + (badge.tone === "warning" ? "badge-warning" : "badge-danger")}>{badge.label}</span>
              <p className="explanation hint">{copy.why}</p>
              {copy.actions && <p className="explanation hint">{copy.actions}</p>}
              <UnscheduledActions placeId={placeId} place={p} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Quick fixes for one unscheduled place: day-select + Force (with an
 *  up-front cost preview, P0 #2 — see `previewForceInsert`), Raise to must. */
function UnscheduledActions({ placeId, place }: { placeId: string; place: Place | undefined }) {
  const trip = useStore((s) => s.currentTrip);
  const itinerary = useStore((s) => s.itinerary);
  const forceInsert = useStore((s) => s.forceInsert);
  const raisePriority = useStore((s) => s.raisePriority);
  const [dayId, setDayId] = useState("");
  if (!trip) return null;

  const targetDayIndex = dayId ? trip.days.findIndex((d) => d.id === dayId) : -1;
  const targetPlan = dayId ? itinerary?.days.find((d) => d.dayId === dayId) : undefined;
  const preview = place && targetPlan ? previewForceInsert(place.dwellMin, targetPlan.slackMin) : null;

  const previewId = `force-preview-${placeId}`;

  return (
    <div className="unscheduled-actions">
      <select
        className="move-menu"
        value={dayId}
        title="Day to force the place into"
        aria-describedby={preview ? previewId : undefined}
        onChange={(e) => setDayId(e.target.value)}
      >
        <option value="">Force into…</option>
        {trip.days.map((d, i) => (
          <option key={d.id} value={d.id}>
            Day {i + 1}
          </option>
        ))}
      </select>
      {preview && (
        <span id={previewId} className={"hint force-preview" + (preview.overBy > 0 ? " force-preview-over" : "")}>
          {forcePreviewMessage(targetDayIndex + 1, preview)}
        </span>
      )}
      <button
        className="icon-btn"
        disabled={!dayId}
        title={
          dayId
            ? `Best-effort insert into day ${targetDayIndex + 1}: hard constraints still apply, and the day may go over budget (see the preview above). Undo (Ctrl+Z) reverses this immediately.`
            : "Pick a day to force this place into"
        }
        onClick={() => {
          if (dayId) {
            forceInsert(placeId, dayId);
            setDayId("");
          }
        }}
      >
        Force
      </button>
      <button
        className="icon-btn"
        title="Raise priority to must and re-solve"
        onClick={() => raisePriority(placeId)}
      >
        Raise to must
      </button>
    </div>
  );
}

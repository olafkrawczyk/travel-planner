import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useStore } from "../store";
import { MapView } from "./MapView";
import { SearchBox } from "./SearchBox";
import { Timeline } from "./Timeline";
import { DayStrip } from "./DayStrip";
import { StaysPanel } from "./StaysPanel";
import { PlaceEditor } from "./PlaceEditor";
import { shareTrip } from "../share";

/** Local-time HH:MM for the "Saved HH:MM" indicator. */
function formatHHMM(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Mobile bottom-sheet height bounds and step, as a percentage of viewport
 *  height (P1 #8). 50 matches the sheet's previous fixed `height: 50vh`, so
 *  a trip screen opened before this change looks identical until dragged. */
const SHEET_MIN_VH = 20;
const SHEET_MAX_VH = 85;
const SHEET_DEFAULT_VH = 50;
const SHEET_KEY_STEP_VH = 5;

function clampSheetVh(vh: number): number {
  return Math.min(SHEET_MAX_VH, Math.max(SHEET_MIN_VH, vh));
}

/**
 * The solver's raw objective includes a 1e9 penalty per infeasible day (and,
 * absent a full solution, can be Infinity) — showing that number as "score
 * 1000000000" tells the user nothing. Anything at or above the penalty scale
 * is reported as an honest phrase instead, with the raw number moved to the
 * title for anyone who wants it.
 */
const INFEASIBLE_SCORE_THRESHOLD = 1e9;

function formatScore(score: number): { text: string; title?: string } {
  if (!Number.isFinite(score) || score >= INFEASIBLE_SCORE_THRESHOLD) {
    const raw = Number.isFinite(score) ? Math.round(score).toLocaleString() : "infinite";
    return {
      text: "some days can't fit their stops",
      title: `Raw solver score: ${raw} — includes a large penalty for at least one infeasible day.`,
    };
  }
  return { text: `score ${Math.round(score)}` };
}

/** Trip screen: split view (map | timeline) on desktop, persistent map + bottom sheet on mobile. */
export function TripScreen() {
  const trip = useStore((s) => s.currentTrip);
  const itinerary = useStore((s) => s.itinerary);
  const solving = useStore((s) => s.solving);
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const mutateTrip = useStore((s) => s.mutateTrip);
  const saveState = useStore((s) => s.saveState);
  const savedAt = useStore((s) => s.savedAt);
  const saveError = useStore((s) => s.saveError);
  const dirty = useStore((s) => s.dirty);
  const pendingChanges = useStore((s) => s.pendingChanges);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const regenerate = useStore((s) => s.regenerate);
  const closeTrip = useStore((s) => s.closeTrip);
  const exportTripJson = useStore((s) => s.exportTripJson);
  const setToast = useStore((s) => s.setToast);

  // Mobile bottom-sheet height (P1 #8): the handle used to be pure decoration
  // (no wiring at all) despite visually promising a resize. `sheetVh` drives
  // `.timeline-pane`'s height via the `--sheet-height` custom property (see
  // mobile.css) — inert on desktop, where the split view doesn't use it.
  const [sheetVh, setSheetVh] = useState(SHEET_DEFAULT_VH);
  const sheetDragRef = useRef<{ startY: number; startVh: number } | null>(null);

  if (!trip) return null;
  const stats = itinerary?.stats;
  const scoreInfo = stats ? formatScore(stats.score) : null;

  /** Copy a share link (or fall back to a file download) — task 2.2. */
  async function handleShare() {
    const json = await exportTripJson(trip!.id);
    if (!json) return;
    setToast(await shareTrip(json, trip!.name));
  }

  /** Pointer-driven bottom-sheet resize (touch + mouse); see `sheetVh` above. */
  function handleSheetPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    sheetDragRef.current = { startY: e.clientY, startVh: sheetVh };
  }
  function handleSheetPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const drag = sheetDragRef.current;
    if (!drag) return;
    // Dragging up (smaller clientY) grows the sheet, so the delta is inverted.
    const deltaVh = ((drag.startY - e.clientY) / window.innerHeight) * 100;
    setSheetVh(clampSheetVh(drag.startVh + deltaVh));
  }
  function handleSheetPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    sheetDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  /** Keyboard equivalent of the drag (role="separator" convention: arrow keys
   *  adjust the value, Home/End jump to the bounds). */
  function handleSheetKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSheetVh((v) => clampSheetVh(v + SHEET_KEY_STEP_VH));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSheetVh((v) => clampSheetVh(v - SHEET_KEY_STEP_VH));
    } else if (e.key === "Home") {
      e.preventDefault();
      setSheetVh(SHEET_MIN_VH);
    } else if (e.key === "End") {
      e.preventDefault();
      setSheetVh(SHEET_MAX_VH);
    }
  }

  return (
    <div className="trip-screen">
      <header className="trip-header">
        <button onClick={closeTrip} title="Back to trips">
          ← Trips
        </button>
        <h2>{trip.name}</h2>
        <span className="hint" title={scoreInfo?.title}>
          {stats
            ? `${Math.round(stats.totalTravelMin)} min travel · ${Math.round(stats.totalWaitMin)} min wait · ${scoreInfo!.text}`
            : "solving…"}
        </span>
        {solving && <span className="spinner" title="Solver running (non-blocking)" />}
        {saveState !== "idle" && (
          <span
            className={"save-status hint" + (saveState === "error" ? " save-error" : "")}
            title={saveState === "error" ? `Not saved: ${saveError}` : undefined}
          >
            {saveState === "saving"
              ? "Saving…"
              : saveState === "error"
                ? "⚠ Not saved"
                : `Saved ${formatHHMM(savedAt)}`}
          </span>
        )}
        <span className="spacer" />
        <button onClick={() => void handleShare()} title="Copy a share link for this trip">
          Share
        </button>
        <button onClick={undo} disabled={past.length === 0} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button onClick={redo} disabled={future.length === 0} title="Redo (Ctrl+Shift+Z)">
          ↷ Redo
        </button>
        <label className="car-only-toggle" title="Use only car/driving travel times (avoids urban transit & regional rail logic)">
          <input
            type="checkbox"
            checked={trip.settings.carOnly ?? false}
            onChange={(e) =>
              mutateTrip((draft) => {
                draft.settings.carOnly = e.target.checked;
              })
            }
          />
          🚗 Car / Foot
        </label>

        <button
          onClick={regenerate}
          disabled={solving}
          className={"regenerate" + (dirty ? " dirty" : "")}
          title={
            dirty
              ? `${pendingChanges} change${pendingChanges === 1 ? "" : "s"} not yet planned — recompute the itinerary (Ctrl+Enter)`
              : "Recompute the itinerary (Ctrl+Enter)"
          }
        >
          ⟳ Regenerate
        </button>
      </header>

      <DayStrip />

      <div className="split-view">
        <div className="map-pane">
          <SearchBox />
          <MapView />
        </div>
        <div className="timeline-pane" style={{ "--sheet-height": `${sheetVh}vh` } as CSSProperties}>
          <div
            className="bottom-sheet-handle"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize itinerary panel"
            aria-valuenow={Math.round(sheetVh)}
            aria-valuemin={SHEET_MIN_VH}
            aria-valuemax={SHEET_MAX_VH}
            tabIndex={0}
            onPointerDown={handleSheetPointerDown}
            onPointerMove={handleSheetPointerMove}
            onPointerUp={handleSheetPointerUp}
            onPointerCancel={handleSheetPointerUp}
            onKeyDown={handleSheetKeyDown}
          ></div>
          <StaysPanel />
          <Timeline />
        </div>
      </div>

      <PlaceEditor />
    </div>
  );
}

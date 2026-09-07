import {
  useEffect,
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

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  );
}

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
 * 1000000000" tells the user nothing, and the ordinary in-range score is an
 * internal solver detail no user can act on either. Only the infeasible case
 * is worth surfacing (as an honest phrase, with the raw number moved to the
 * title for anyone who wants it) — a feasible score renders nothing.
 */
export const INFEASIBLE_SCORE_THRESHOLD = 1e9;

export function formatScore(score: number): { text: string; title: string } | null {
  if (!Number.isFinite(score) || score >= INFEASIBLE_SCORE_THRESHOLD) {
    const raw = Number.isFinite(score) ? Math.round(score).toLocaleString() : "infinite";
    return {
      text: "some days can't fit their stops",
      title: `Raw solver score: ${raw} — includes a large penalty for at least one infeasible day.`,
    };
  }
  return null;
}

/**
 * Stale-itinerary discoverability (P1 #3): edits made through the place
 * editor previously left no trace once the editor closed — the dirty pill
 * lives in the header and the stale banner lives in the (possibly
 * scrolled-out-of-view, or behind the editor's own modal) timeline, so the
 * one moment guaranteed to have the user's attention — closing the editor
 * and landing back on the itinerary — said nothing. This fires a single
 * toast exactly then, and only when something actually changed during that
 * editing session (comparing `pendingChanges` at open vs. at close) — never
 * on a no-op open/close, and never more than once per session, so it can't
 * turn into the nag the task explicitly warns against for something that
 * "happens constantly".
 */
export function shouldNotifyStaleOnEditorClose(
  wasEditing: boolean,
  isEditing: boolean,
  pendingAtOpen: number,
  pendingNow: number,
): boolean {
  return wasEditing && !isEditing && pendingNow > pendingAtOpen;
}

/** Toast copy for the notice above — names the concrete next step
 *  (Regenerate) rather than just flagging that something is stale. */
export function staleEditToastMessage(changeCount: number): string {
  const n = Math.max(1, changeCount);
  return `Saved — the itinerary doesn't reflect ${n} change${n === 1 ? "" : "s"} yet. Regenerate (Ctrl+Enter) to apply.`;
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
  const editingPlaceId = useStore((s) => s.editingPlaceId);

  const [showRegenerateMenu, setShowRegenerateMenu] = useState(false);

  // Mobile bottom-sheet height (P1 #8): the handle used to be pure decoration
  // (no wiring at all) despite visually promising a resize. `sheetVh` drives
  // `.timeline-pane`'s height via the `--sheet-height` custom property (see
  // mobile.css) — inert on desktop, where the split view doesn't use it.
  const [sheetVh, setSheetVh] = useState(SHEET_DEFAULT_VH);
  const sheetDragRef = useRef<{ startY: number; startVh: number } | null>(null);

  // Stale-on-editor-close notice (P1 #3) — see `shouldNotifyStaleOnEditorClose`.
  const wasEditingRef = useRef(false);
  const pendingAtOpenRef = useRef(0);
  useEffect(() => {
    const isEditing = editingPlaceId !== null;
    if (isEditing && !wasEditingRef.current) {
      pendingAtOpenRef.current = pendingChanges;
    } else if (shouldNotifyStaleOnEditorClose(wasEditingRef.current, isEditing, pendingAtOpenRef.current, pendingChanges)) {
      setToast(staleEditToastMessage(pendingChanges - pendingAtOpenRef.current));
    }
    wasEditingRef.current = isEditing;
  }, [editingPlaceId, pendingChanges, setToast]);

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
        <button className="btn-ghost trip-back" onClick={closeTrip} title="Back to trips">
          ← <span className="trip-back-label">Trips</span>
        </button>
        <h2 className="trip-name" title={trip.name}>{trip.name}</h2>

        <div className="trip-stats">
          {stats ? (
            <>
              <span className="stat">
                <span className="stat-value tnum">{formatDuration(stats.totalTravelMin)}</span>
                <span className="stat-label">travel</span>
              </span>
              <span className="stat">
                <span className="stat-value tnum">{formatDuration(stats.totalWaitMin)}</span>
                <span className="stat-label">wait</span>
              </span>
              {scoreInfo && (
                <span className="badge badge-warning" title={scoreInfo.title}>
                  {scoreInfo.text}
                </span>
              )}
            </>
          ) : (
            <span className="hint">solving…</span>
          )}
        </div>

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

        <div className="trip-actions">
          <div className="mode-toggle" role="radiogroup" aria-label="Travel mode">
            <button
              type="button"
              role="radio"
              aria-checked={!(trip.settings.carOnly ?? false)}
              className={"mode-toggle-option" + (!(trip.settings.carOnly ?? false) ? " active" : "")}
              onClick={() =>
                mutateTrip((draft) => {
                  draft.settings.carOnly = false;
                })
              }
              title="Walking, transit and regional rail travel times"
            >
              Walk
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={trip.settings.carOnly ?? false}
              className={"mode-toggle-option" + ((trip.settings.carOnly ?? false) ? " active" : "")}
              onClick={() =>
                mutateTrip((draft) => {
                  draft.settings.carOnly = true;
                })
              }
              title="Car/driving travel times only"
            >
              Car
            </button>
          </div>

          <button
            className="btn-ghost"
            onClick={() => void handleShare()}
            title="Copy a share link for this trip"
            aria-label="Share trip"
          >
            ↗ <span className="btn-label">Share</span>
          </button>
          <button
            className="btn-ghost"
            onClick={undo}
            disabled={past.length === 0}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
          >
            ↶ <span className="btn-label">Undo</span>
          </button>
          <button
            className="btn-ghost"
            onClick={redo}
            disabled={future.length === 0}
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
          >
            ↷ <span className="btn-label">Redo</span>
          </button>

          <div style={{ position: "relative", display: "inline-block" }}>
            <div style={{ display: "flex" }}>
              <button
                onClick={() => { regenerate(); setShowRegenerateMenu(false); }}
                disabled={solving}
                className={"regenerate" + (dirty ? " dirty" : "")}
                title={
                  dirty
                    ? `${pendingChanges} change${pendingChanges === 1 ? "" : "s"} not yet planned — recompute the itinerary (Ctrl+Enter)`
                    : "Recompute the itinerary (Ctrl+Enter)"
                }
                style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
              >
                Regenerate
              </button>
              <button
                className={"regenerate" + (dirty ? " dirty" : "")}
                disabled={solving}
                onClick={() => setShowRegenerateMenu(!showRegenerateMenu)}
                style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, padding: "0 6px", borderLeft: "1px solid var(--border)" }}
                aria-label="Regenerate options"
              >
                <ChevronDownIcon />
              </button>
            </div>
            {showRegenerateMenu && (
              <div style={{ position: "absolute", right: 0, top: "100%", marginTop: "4px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "4px", display: "flex", flexDirection: "column", minWidth: "220px", zIndex: 1000, boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
                <button
                  style={{ padding: "8px 12px", background: "transparent", border: "none", textAlign: "left", width: "100%", cursor: "pointer", fontSize: "14px", borderRadius: "var(--radius-sm)", color: "var(--text)" }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-surface-hover)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  onClick={() => {
                    mutateTrip(draft => { draft.settings.solverStrategy = "clusterFirst"; }, { type: "full" } as any);
                    regenerate();
                    setShowRegenerateMenu(false);
                  }}
                >
                  Generate using clusterFirst
                </button>
              </div>
            )}
          </div>
        </div>
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

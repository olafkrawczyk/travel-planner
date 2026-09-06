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

  if (!trip) return null;
  const stats = itinerary?.stats;
  const scoreInfo = stats ? formatScore(stats.score) : null;

  /** Copy a share link (or fall back to a file download) — task 2.2. */
  async function handleShare() {
    const json = await exportTripJson(trip!.id);
    if (!json) return;
    setToast(await shareTrip(json, trip!.name));
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
        <div className="timeline-pane">
          <div className="bottom-sheet-handle"></div>
          <StaysPanel />
          <Timeline />
        </div>
      </div>

      <PlaceEditor />
    </div>
  );
}

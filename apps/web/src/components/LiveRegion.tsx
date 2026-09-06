import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

/**
 * The app's one aria-live mechanism (P0 #2 — verified zero `aria-live` usages
 * repo-wide before this). Two visually-hidden regions: "polite" for routine
 * status (solve start/finish, save status, informational toasts) and
 * "assertive" for errors (solve/save failures and error toasts), both wired
 * to signals that already drive the visible UI — TripScreen's spinner and
 * save-status indicator, and the store's toast queue (see store.ts's `toasts`
 * and ToastStack) — rather than scattering `aria-live` across many elements.
 * Mounted once, near the top of App.tsx, so it's live regardless of whether
 * TripList or TripScreen is showing.
 */
export function LiveRegion() {
  const solving = useStore((s) => s.solving);
  const itinerary = useStore((s) => s.itinerary);
  const saveState = useStore((s) => s.saveState);
  const toasts = useStore((s) => s.toasts);

  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");
  const wasSolving = useRef(false);
  const lastSaveState = useRef(saveState);
  const seenToastIds = useRef(new Set<number>());

  // Solve start/finish.
  useEffect(() => {
    if (solving && !wasSolving.current) {
      setPolite("Solving itinerary…");
    } else if (!solving && wasSolving.current && itinerary) {
      setPolite("Itinerary updated");
    }
    wasSolving.current = solving;
  }, [solving, itinerary]);

  // Save status — "error" is skipped here: `persist()` already raises a
  // toast for it (see store.ts), which lands in the assertive region below;
  // announcing it twice at two different priorities would be more confusing
  // than helpful.
  useEffect(() => {
    if (saveState !== lastSaveState.current) {
      if (saveState === "saving") setPolite("Saving…");
      else if (saveState === "saved") setPolite("Saved");
      lastSaveState.current = saveState;
    }
  }, [saveState]);

  // Toasts: every entry gets announced once, at the priority its `kind` calls for.
  useEffect(() => {
    for (const t of toasts) {
      if (seenToastIds.current.has(t.id)) continue;
      seenToastIds.current.add(t.id);
      if (t.kind === "error") setAssertive(t.message);
      else setPolite(t.message);
    }
  }, [toasts]);

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
    </>
  );
}

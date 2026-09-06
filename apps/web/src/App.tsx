import { useEffect } from "react";
import { newTripId } from "@app/domain";
import { useStore } from "./store";
import { TripList } from "./components/TripList";
import { TripScreen } from "./components/TripScreen";
import { DevPanel } from "./components/DevPanel";
import { LiveRegion } from "./components/LiveRegion";
import { ToastStack } from "./components/ToastStack";
import { ErrorBoundary, CrashFallbackShell, type CrashFallbackProps } from "./components/ErrorBoundary";
import { decodeTrip, downloadJson, FRAGMENT_PREFIX, ShareError, type ShareErrorCode } from "./share";

/** Plain-language cause for each typed `ShareError` code (P2 #6) — share.ts
 *  already classifies exactly why a share link failed to open; this maps
 *  that classification to something a user (not a developer) can act on,
 *  instead of surfacing the raw `Error.message` string. */
const SHARE_OPEN_ERROR_COPY: Record<ShareErrorCode, string> = {
  unsupported: "This browser can't open shared trip links.",
  oversize: "This share link looks corrupted (unexpectedly large).",
  malformed: "This share link is incomplete or corrupted.",
  inflate: "This share link's data is corrupted.",
  "not-json": "This share link doesn't contain valid trip data.",
  encode: "Something went wrong while opening this link.",
};

/** Full user-facing message for a failed shared-trip open — typed
 *  `ShareError`s get their specific plain-language cause; anything else
 *  (e.g. `importTripJson`'s schema validation, downstream of a successful
 *  decode) gets an honest generic fallback rather than a raw stack/message. */
export function describeShareOpenError(e: unknown): string {
  if (e instanceof ShareError) return `Could not open shared trip: ${SHARE_OPEN_ERROR_COPY[e.code]}`;
  return "Could not open shared trip — the link may be corrupted or out of date.";
}

/**
 * Root crash fallback (release audit BLOCKER #2). Reads/writes the store via
 * `useStore.getState()`/`useStore.setState()` rather than the `useStore(...)`
 * hook throughout — this component renders only once the tree below it has
 * already thrown, so it must not itself depend on any store selector
 * succeeding; the vanilla store object (unlike the crashed React tree) is
 * still perfectly usable.
 */
function AppCrashFallback({ error, errorInfo, retry }: CrashFallbackProps) {
  const trip = useStore.getState().currentTrip;

  /** Export is the user's lifeboat here — safe to wire up because it only
   *  touches storage (packages/storage) and a DOM Blob/anchor download
   *  (share.ts's `downloadJson`), the same path TripList's "Export" button
   *  already uses; neither depends on the crashed component tree at all. */
  async function handleExport() {
    if (!trip) return;
    try {
      const json = await useStore.getState().exportTripJson(trip.id);
      if (json) downloadJson(json, `${trip.name.replace(/[^\w-]+/g, "_")}_recovered.json`);
    } catch {
      /* exportTripJson already records a toast on failure via the store */
    }
  }

  /** The escape hatch: a crash caused by `currentTrip` state would otherwise
   *  re-enter the same crash on every reload. Closing the trip first (via
   *  `setState`, not the `closeTrip` hook action, for the same
   *  don't-touch-a-possibly-broken-store-path reason as above — though
   *  `closeTrip` itself is plain state, this stays consistent with
   *  `handleExport`) then clearing the boundary's own error state returns to
   *  the trip list without a full reload. */
  function handleCloseTrip() {
    useStore.setState({
      currentTrip: null,
      currentTripRev: null,
      itinerary: null,
      past: [],
      future: [],
      dirty: false,
      pendingChanges: 0,
      solving: false,
      editingPlaceId: null,
      pendingCoords: null,
    });
    retry();
  }

  return (
    <CrashFallbackShell
      title="Something went wrong"
      message={
        <>
          <p>
            The app hit an unexpected error and can't display this screen right now. Your trips are
            saved in this browser's storage and have not been affected.
          </p>
          {trip && <p>You were editing "{trip.name}".</p>}
        </>
      }
      error={error}
      errorInfo={errorInfo}
      actions={
        <>
          <button onClick={() => window.location.reload()}>Reload the app</button>
          {trip && <button onClick={handleCloseTrip}>Close this trip and go to your trip list</button>}
          {trip && <button onClick={() => void handleExport()}>Export this trip as a backup file</button>}
        </>
      }
    />
  );
}

export function App() {
  const init = useStore((s) => s.init);
  const currentTrip = useStore((s) => s.currentTrip);
  const setToast = useStore((s) => s.setToast);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const regenerate = useStore((s) => s.regenerate);
  const toggleDevPanel = useStore((s) => s.toggleDevPanel);
  const importTripJson = useStore((s) => s.importTripJson);

  useEffect(() => {
    void init();
  }, [init]);

  // Share-by-URL boot (task 2.1): open a trip passed in the #trip= fragment.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.startsWith(FRAGMENT_PREFIX)) return;
    // Strip the fragment immediately so a refresh can never re-import duplicates.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    void (async () => {
      try {
        const json = await decodeTrip(hash);
        // Fresh local id: importing the same link twice (or in the source
        // browser) must never overwrite the existing trip. decodeTrip already
        // guarantees JSON, so this parse cannot throw.
        const trip = JSON.parse(json) as Record<string, unknown>;
        trip.id = newTripId();
        // importTripJson validates against the schema (same as file import).
        const ok = await importTripJson(JSON.stringify(trip));
        setToast(ok ? "Shared trip imported" : "Could not import shared trip — invalid trip data");
      } catch (e) {
        setToast(describeShareOpenError(e));
      }
    })();
  }, [importTripJson, setToast]);

  // Keyboard shortcuts: undo/redo across all edits + hidden dev panel (task 9.3, 10.2).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        toggleDevPanel();
        return;
      }
      if (!mod) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "Enter") {
        e.preventDefault();
        regenerate();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, regenerate, toggleDevPanel]);

  return (
    <>
      <LiveRegion />
      {/* Root error boundary (release audit BLOCKER #2): LiveRegion/DevPanel/
       *  ToastStack stay outside it deliberately — they're simple, low-risk,
       *  and a save-failure or solve-failure toast should still be visible
       *  even if TripScreen/TripList itself crashes. */}
      <ErrorBoundary fallback={(props) => <AppCrashFallback {...props} />}>
        {currentTrip ? <TripScreen /> : <TripList />}
      </ErrorBoundary>
      <DevPanel />
      <ToastStack />
    </>
  );
}

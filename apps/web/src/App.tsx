import { useEffect } from "react";
import { newTripId } from "@app/domain";
import { useStore } from "./store";
import { TripList } from "./components/TripList";
import { TripScreen } from "./components/TripScreen";
import { DevPanel } from "./components/DevPanel";
import { decodeTrip, FRAGMENT_PREFIX } from "./share";

export function App() {
  const init = useStore((s) => s.init);
  const currentTrip = useStore((s) => s.currentTrip);
  const toast = useStore((s) => s.toast);
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
        setToast(`Could not open shared trip: ${e instanceof Error ? e.message : String(e)}`);
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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  return (
    <>
      {currentTrip ? <TripScreen /> : <TripList />}
      <DevPanel />
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { registerSW } from "virtual:pwa-register";
import { useStore } from "./store";

// Ask the browser to make our IndexedDB storage persistent (best-effort, and
// never load-bearing for boot): without this, trip data can be evicted under
// storage pressure — a real risk for a trip planner that may sit unopened
// for weeks between trips. Guarded against missing APIs and swallowed
// rejections (e.g. no user-activation heuristics met yet) on both sides;
// this never blocks or delays rendering the app.
function requestPersistentStorage(): void {
  try {
    const storage = navigator.storage;
    if (!storage?.persisted || !storage.persist) return;
    void storage
      .persisted()
      .then((already) => (already ? undefined : storage.persist()))
      .catch(() => {
        /* best-effort only: storage just remains evictable */
      });
  } catch {
    /* navigator.storage unavailable in this environment */
  }
}
requestPersistentStorage();

// Only register the service worker in production. In dev it can serve a stale
// bundle (worker chunks included) that shadows HMR updates and resurfaces as
// "fixed but still broken" behaviour. The SW is build output; dev doesn't need it.
//
// registerType is "autoUpdate", so a new service worker activates and
// reloads the tab on its own — but silently, with no warning. Data loss risk
// is low (edits persist to IndexedDB immediately), but an unannounced reload
// mid-session is still a surprise, so we surface it via the store's existing
// toast queue (`setToast`, already consumed by the UI) rather than adding a
// second notification mechanism.
if (import.meta.env.PROD) {
  registerSW({
    immediate: true,
    onNeedRefresh() {
      useStore.getState().setToast("Updated to the latest version — refreshing…");
    },
    onOfflineReady() {
      useStore.getState().setToast("Ready to work offline");
    },
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

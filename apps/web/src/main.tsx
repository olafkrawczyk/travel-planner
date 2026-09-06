import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { registerSW } from "virtual:pwa-register";

// Only register the service worker in production. In dev it can serve a stale
// bundle (worker chunks included) that shadows HMR updates and resurfaces as
// "fixed but still broken" behaviour. The SW is build output; dev doesn't need it.
if (import.meta.env.PROD) {
  registerSW({ immediate: true });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

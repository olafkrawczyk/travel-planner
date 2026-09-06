/**
 * Toggleable worker-bridge logging (design: structured, inspectable message
 * flow across the Comlink boundary). Enable via the dev panel toggle or
 * `localStorage.setItem("solverLog", "1")`, then watch `[solver-bridge]`
 * entries in devtools.
 *
 * Note: Web Workers have no `localStorage`, so the worker side receives the
 * flag over the bridge (`SolveApi.setLogging`) and force-enables the module
 * flag here via `setBridgeLogging`.
 */

const STORAGE_KEY = "solverLog";

let enabled = readFlag();

function readFlag(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Current logging state on this side of the bridge. */
export function solverLogEnabled(): boolean {
  return enabled;
}

/** Persist + apply the flag on the main thread. */
export function setSolverLogEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable: keep the runtime flag only */
  }
}

/** Force-enable/disable the module flag (used by the worker, which has no localStorage). */
export function setBridgeLogging(on: boolean): void {
  enabled = on;
}

/** Structured bridge log; no-ops when disabled. */
export function bridgeLog(event: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  console.info(`[solver-bridge] ${event}`, data ?? {});
}

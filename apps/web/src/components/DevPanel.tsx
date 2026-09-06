import { useStore, type Flags } from "../store";
import { setSolverLogEnabled, solverLogEnabled } from "../worker/log";
import { syncWorkerLogging } from "../worker/solverClient";

/**
 * Hidden dev panel (design decision 9, task 10.2): heuristic constants and
 * solver-strategy flags. Open with Ctrl/Cmd+Alt+D.
 */
export function DevPanel() {
  const open = useStore((s) => s.devPanelOpen);
  const flags = useStore((s) => s.flags);
  const updateFlags = useStore((s) => s.updateFlags);
  const toggleDevPanel = useStore((s) => s.toggleDevPanel);
  if (!open) return null;

  const num = (key: keyof Flags, label: string, step = 0.1) => (
    <label key={key}>
      {label}
      <input
        type="number"
        step={step}
        value={flags[key] as number}
        onChange={(e) => updateFlags({ [key]: Number(e.target.value) } as Partial<Flags>)}
      />
    </label>
  );

  return (
    <div className="dev-panel card">
      <h3>
        Dev panel
        <button className="icon-btn" onClick={() => toggleDevPanel(false)} title="Close">
          ✕
        </button>
      </h3>
      <div className="dev-panel-content">
        <label>
          <span className="label-text">Solver Strategy:</span>
          <select
            value={flags.solverStrategy}
            onChange={(e) => updateFlags({ solverStrategy: e.target.value as Flags["solverStrategy"] })}
          >
            <option value="routeFirst">routeFirst</option>
            <option value="clusterFirst">clusterFirst</option>
          </select>
        </label>
      </div>
      <div className="row">
        {num("walkSpeedKmh", "Walk km/h")}
        {num("walkMaxKm", "Walk max km")}
        {num("detourFactor", "Detour factor")}
      </div>
      <div className="row">
        {num("transitSpeedKmh", "Urban transit km/h")}
        {num("transitOverheadMin", "Urban transit overhead min", 1)}
      </div>
      <div className="row">
        {num("regionalSpeedKmh", "Regional rail km/h")}
        {num("regionalOverheadMin", "Regional rail overhead min", 1)}
      </div>
      <div className="row">
        {num("initialBudgetMs", "Solve budget ms", 1000)}
        {num("editBudgetMs", "Edit budget ms", 500)}
      </div>
      <div className="row">
        <label>
          OSRM base URL (empty = disabled — walking times use the heuristic only)
          <input
            type="text"
            value={flags.osrmBaseUrl}
            placeholder="e.g. a self-hosted OSRM URL — NOT the public demo"
            onChange={(e) => updateFlags({ osrmBaseUrl: e.target.value } as Partial<Flags>)}
          />
          <span className="hint">
            Must be a server that actually serves the "foot" profile this app requests. The
            public demo (router.project-osrm.org) only hosts the driving profile and silently
            returns car times for every profile — enabling it would report car durations as
            walking times.
          </span>
        </label>
        {num("osrmMaxNodes", "OSRM max nodes", 10)}
      </div>
      <div className="row">
        <label>
          Overpass base URL
          <input
            type="text"
            value={flags.overpassBaseUrl}
            placeholder="https://overpass-api.de"
            onChange={(e) => updateFlags({ overpassBaseUrl: e.target.value } as Partial<Flags>)}
          />
        </label>
      </div>
      <label>
        <span>
          <input
            type="checkbox"
            checked={flags.autoFetchOpeningHours}
            onChange={(e) =>
              updateFlags({ autoFetchOpeningHours: e.target.checked } as Partial<Flags>)
            }
          />{" "}
          Auto-fetch opening hours from OSM after search-add
        </span>
      </label>
      <label>
        <span>
          <input
            type="checkbox"
            checked={solverLogEnabled()}
            onChange={(e) => {
              setSolverLogEnabled(e.target.checked);
              syncWorkerLogging();
            }}
          />{" "}
          Worker-bridge logging ([solver-bridge] in console)
        </span>
      </label>
      <p className="hint">Changes apply to the current trip and trigger a full re-solve.</p>
    </div>
  );
}

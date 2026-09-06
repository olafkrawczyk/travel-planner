import { useState } from "react";
import type { Category, Place, TimeWindow } from "@app/domain";
import { newPlaceId } from "@app/domain";
import { OverpassClient, expandOpeningHours } from "@app/geo";
import { appointmentStart, useStore } from "../store";
import { baseUsage, normalizePlace } from "../places";

const CATEGORIES: Category[] = [
  "museum",
  "viewpoint",
  "cafe",
  "restaurant",
  "shop",
  "park",
  "temple",
  "hotel",
  "other",
];

/**
 * Sorted, de-duplicated region names to offer in the "existing regions"
 * picker (task 4.3): `existing` is every non-empty `Place.region` already
 * present in the trip, `current` is folded in too so the place being edited
 * never loses its own value from the list (e.g. a region nobody else has
 * used yet). Matching an *existing* string exactly is what makes places
 * group together in the solver (see `packages/solver/src/cluster.ts`), so a
 * picker over what's already there beats a free-text box that's one typo
 * away from silently creating a new, unshared region.
 */
export function collectRegionOptions(existing: readonly string[], current?: string): string[] {
  const set = new Set(existing.filter((r) => r.length > 0));
  if (current) set.add(current);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * Best-effort "does this look auto-assigned?" signal for the UI, purely
 * cosmetic. `Place` carries no persisted provenance flag distinguishing an
 * auto-derived region from a user-typed one, and adding one is out of scope
 * here (would touch the domain schema and `clustering.ts`, which task 4.3
 * doesn't own) — so this instead recognizes the exact naming convention
 * `applyAutoCluster` uses for freshly-clustered districts ("District 1",
 * "District 2", ...; see `apps/web/src/clustering.ts`). It degrades safely:
 * editing the text at all makes it read as custom immediately, which is the
 * right direction to be wrong in. The only false positive is a user
 * deliberately naming their own region "District N" in that exact form —
 * cosmetic only, since auto-clustering's real "already set?" check is just
 * "does this place have a non-empty region", not this heuristic.
 */
export function isAutoRegionName(region: string): boolean {
  return /^District \d+$/.test(region);
}

/** Place editor modal: create (from map click) or edit (task 7.4). */
export function PlaceEditor() {
  const trip = useStore((s) => s.currentTrip);
  const editingPlaceId = useStore((s) => s.editingPlaceId);
  const pendingCoords = useStore((s) => s.pendingCoords);
  const openPlaceEditor = useStore((s) => s.openPlaceEditor);
  const mutateTrip = useStore((s) => s.mutateTrip);
  const setToast = useStore((s) => s.setToast);

  const existing = trip?.places.find((p) => p.id === editingPlaceId);
  const isNew = !existing && editingPlaceId === "new" && pendingCoords !== null;
  if (!trip || (!existing && !isNew)) return null;

  // Every region already in use anywhere in the trip, for the region picker
  // below — computed here (not in PlaceEditorInner) so it reflects the
  // whole trip, not just the place currently being edited.
  const existingRegions = collectRegionOptions(trip.places.map((p) => p.region ?? ""));

  return (
    <PlaceEditorInner
      key={existing?.id ?? "new"}
      place={existing}
      coords={existing ? { lat: existing.lat, lng: existing.lng } : pendingCoords!}
      days={trip.days}
      existingRegions={existingRegions}
      onClose={() => openPlaceEditor(null)}
      onSave={(p) => {
        const normalized = normalizePlace(p);
        if (existing) {
          mutateTrip((draft) => {
            const idx = draft.places.findIndex((x) => x.id === normalized.id);
            if (idx >= 0) draft.places[idx] = normalized;
          }, { type: "dwellChange", placeId: normalized.id });
        } else {
          mutateTrip((draft) => {
            draft.places.push(normalized);
          });
        }
        openPlaceEditor(null);
      }}
      onDelete={
        existing
          ? () => {
              const id = existing.id;
              // Check BEFORE mutating anything: a place still serving as a
              // day's base must never be deleted (see places.ts's baseUsage
              // doc for the cascading corruption a dangling base causes).
              const usage = baseUsage(trip, id);
              if (usage) {
                setToast(
                  `Can't delete "${existing.name}" — it's the hotel for day ${usage.dayIndex + 1}. ` +
                    "Assign a different hotel in the Stays panel first.",
                );
                return;
              }
              mutateTrip((draft) => {
                draft.places = draft.places.filter((x) => x.id !== id);
                // No early return here — every remaining day's pinnedOrder
                // (and any travelOverrides mentioning this id) must be
                // cleaned up, not just the days processed before a match.
                for (const day of draft.days) {
                  day.pinnedOrder = day.pinnedOrder?.filter((x) => x !== id);
                }
                draft.travelOverrides = (draft.travelOverrides || []).filter(
                  (o) => o.fromId !== id && o.toId !== id,
                );
                // forceDayId/appointment live on the place itself, so they
                // were already removed along with it above.
              });
              openPlaceEditor(null);
            }
          : undefined
      }
    />
  );
}

function PlaceEditorInner(props: {
  place?: Place;
  coords: { lat: number; lng: number };
  days: { id: string; date: string }[];
  existingRegions: string[];
  onClose(): void;
  onSave(place: Place): void;
  onDelete?(): void;
}) {
  const { place, coords, days, existingRegions, onClose, onSave, onDelete } = props;
  const [name, setName] = useState(place?.name ?? "");
  const [category, setCategory] = useState<Category>(place?.category ?? "other");
  const [dwell, setDwell] = useState(place?.dwellMin ?? 60);
  const [priority, setPriority] = useState<1 | 2 | 3>(place?.priority ?? 2);
  const [appointmentDay, setAppointmentDay] = useState(place?.appointment?.dayId ?? "");
  const [appointmentTime, setAppointmentTime] = useState(place?.appointment?.start ?? "14:00");
  const [openingHours, setOpeningHours] = useState<Record<string, TimeWindow[]>>(place?.openingHours ?? {});
  const [newWindowDate, setNewWindowDate] = useState(days[0]?.date ?? "");
  const [region, setRegion] = useState(place?.region ?? "");
  // Whether the region control is in "type a brand-new name" mode (picked
  // "＋ New region…") rather than picking an existing one. See the Region
  // field below for the auto-vs-manual legibility this whole block exists
  // for (task 4.3).
  const [addingRegion, setAddingRegion] = useState(false);
  const regionOptions = collectRegionOptions(existingRegions, addingRegion ? undefined : region);
  const [notes, setNotes] = useState(place?.notes ?? "");
  const [lat, setLat] = useState(coords.lat);
  const [lng, setLng] = useState(coords.lng);
  const flags = useStore((s) => s.flags);
  const [fetchingHours, setFetchingHours] = useState(false);
  const [osmNote, setOsmNote] = useState<string | null>(null);
  // Hotels are sleep bases the solver never schedules as a stop — dwell,
  // priority, appointment and opening-hours controls are meaningless for
  // one (see places.ts's normalizePlace), so hide them the moment the
  // checkbox is toggled, not just after save.
  const isHotel = category === "hotel";

  /** Fetch the OSM `opening_hours` tag, expand it over the trip's dates
   *  and fill the window rows (review before Save — nothing is persisted
   *  until the editor saves). Absence/failure leaves the rows untouched
   *  and explains why via an inline note. */
  async function fetchOpeningHoursFromOsm() {
    if (!place?.osmId || fetchingHours) return;
    setFetchingHours(true);
    setOsmNote(null);
    try {
      const client = new OverpassClient({ baseUrl: flags.overpassBaseUrl });
      const tags = await client.fetchOsmTags(place.osmId);
      const expr = tags?.opening_hours;
      if (!expr) {
        setOsmNote("No opening hours on OSM — left as always open.");
        return;
      }
      const windows = expandOpeningHours(expr, days.map((d) => d.date));
      if (!windows) {
        setOsmNote("OSM opening hours unusable (24/7 or unparseable) — left as always open.");
        return;
      }
      if (Object.keys(windows).length === 0) {
        setOsmNote("OSM has no open hours on the trip dates — left as always open.");
        return;
      }
      setOpeningHours(windows); // replace all rows; review and save
    } catch {
      setOsmNote("Couldn't fetch from OSM — check your connection and try again.");
    } finally {
      setFetchingHours(false);
    }
  }

  /** Replace the windows of one date; empty lists are removed entirely. */
  function setWindows(date: string, next: TimeWindow[]): void {
    setOpeningHours((prev) => {
      const copy = { ...prev };
      if (next.length === 0) delete copy[date];
      else copy[date] = next;
      return copy;
    });
  }

  function save() {
    if (!name.trim()) return;
    // Number inputs can yield NaN/±Infinity (cleared or outlandish input);
    // fall back to the original coordinates so invalid numbers never reach the solver.
    const safeLat = Number.isFinite(lat) ? lat : coords.lat;
    const safeLng = Number.isFinite(lng) ? lng : coords.lng;
    onSave(
      normalizePlace({
        id: place?.id ?? newPlaceId(),
        name: name.trim(),
        lat: safeLat,
        lng: safeLng,
        category,
        dwellMin: Math.max(0, Math.min(1440, Math.round(dwell) || 0)),
        priority,
        appointment:
          appointmentDay && appointmentTime
            ? { dayId: appointmentDay, start: appointmentStart(appointmentTime) }
            : undefined,
        openingHours: Object.keys(openingHours).length > 0 ? openingHours : undefined,
        region: region || undefined,
        notes: notes || undefined,
        osmId: place?.osmId,
      }),
    );
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal card"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2>{place ? "Edit place" : "New place"}</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </label>
        <div className="row">
          <label>
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          {!isHotel && (
            <label>
              Dwell (min)
              <input
                type="number"
                min={0}
                max={1440}
                value={dwell}
                onChange={(e) => setDwell(Number(e.target.value))}
              />
            </label>
          )}
        </div>
        {isHotel && (
          <p className="hint" role="note">
            A hotel is a sleep base assigned in the Stays panel, not a stop the planner
            schedules — dwell time, priority, appointments and opening hours don't apply.
          </p>
        )}
        {!isHotel && (
          <div className="row">
            <label>
              Priority
              <select
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value) as 1 | 2 | 3)}
              >
                <option value={1}>Must</option>
                <option value={2}>Want</option>
                <option value={3}>Nice to have</option>
              </select>
            </label>
            <label>
              Appointment
              <select value={appointmentDay} onChange={(e) => setAppointmentDay(e.target.value)}>
                <option value="">(none)</option>
                {days.map((d, i) => (
                  <option key={d.id} value={d.id}>
                    Day {i + 1} ({d.date})
                  </option>
                ))}
              </select>
            </label>
            <label>
              At
              <input
                type="time"
                value={appointmentTime}
                onChange={(e) => setAppointmentTime(e.target.value)}
                disabled={!appointmentDay}
              />
            </label>
          </div>
        )}
        {!isHotel && (
          <>
            <div className="row">
              <span>Opening hours</span>
              <small>Empty = always open.</small>
              {place?.osmId && (
                <button type="button" disabled={fetchingHours} onClick={fetchOpeningHoursFromOsm}>
                  {fetchingHours ? "Fetching…" : "Fetch opening hours from OSM"}
                </button>
              )}
            </div>
            {osmNote && (
              <p className="hint" role="note">
                {osmNote}
              </p>
            )}
            {days.map((d, i) =>
              (openingHours[d.date] ?? []).map((w, wi) => (
                <div className="row" key={`${d.id}:${wi}`}>
                  <span>
                    Day {i + 1} ({d.date})
                  </span>
                  <input
                    type="time"
                    aria-label={`Opening time, day ${i + 1}`}
                    value={w.start}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      const next = [...(openingHours[d.date] ?? [])];
                      next[wi] = { ...w, start: e.target.value };
                      setWindows(d.date, next);
                    }}
                  />
                  <input
                    type="time"
                    aria-label={`Closing time, day ${i + 1}`}
                    value={w.end}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      const next = [...(openingHours[d.date] ?? [])];
                      next[wi] = { ...w, end: e.target.value };
                      setWindows(d.date, next);
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`Remove window, day ${i + 1}`}
                    onClick={() =>
                      setWindows(d.date, (openingHours[d.date] ?? []).filter((_, k) => k !== wi))
                    }
                  >
                    ✕
                  </button>
                </div>
             )),
            )}
            <div className="row">
              <label>
                Add window for
                <select value={newWindowDate} onChange={(e) => setNewWindowDate(e.target.value)}>
                  {days.map((d, i) => (
                    <option key={d.id} value={d.date}>
                      Day {i + 1} ({d.date})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!newWindowDate}
                onClick={() =>
                  setWindows(newWindowDate, [
                    ...(openingHours[newWindowDate] ?? []),
                    { start: "09:00", end: "17:00" },
                  ])
                }
              >
                Add window
              </button>
            </div>
          </>
        )}
        <div className="row">
          <label>
            Lat
            <input
              type="number"
              step="0.000001"
              value={lat}
              onChange={(e) => setLat(e.target.value === "" ? 0 : Number(e.target.value))}
            />
          </label>
          <label>
            Lng
            <input
              type="number"
              step="0.000001"
              value={lng}
              onChange={(e) => setLng(e.target.value === "" ? 0 : Number(e.target.value))}
            />
          </label>
        </div>
        {/* Visibility decision: keep this control visible under `routeFirst`
            (nearly every user, since `solverStrategy` only lives in the
            hidden DevPanel behind Ctrl/Cmd+Alt+D) rather than hiding it.
            Region data a user enters under routeFirst is not lost or wasted
            — it's exactly what clusterFirst reads the moment someone flips
            the DevPanel switch — so hiding the field would make that data
            invisible and effectively unrecoverable to set up in advance.
            Instead the "only affects grouping under Cluster-first" hint
            below (rendered whenever solverStrategy !== "clusterFirst")
            explains why setting it appears to do nothing today, which is
            what actually addresses the "control that does nothing" risk. */}
        {!isHotel && (
          <label>
            Region
            {addingRegion ? (
              <div className="row">
                <input
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="e.g. Shinjuku"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => {
                    setAddingRegion(false);
                    setRegion(place?.region ?? "");
                  }}
                >
                  Choose existing
                </button>
              </div>
            ) : (
              <select
                value={region}
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setAddingRegion(true);
                    setRegion("");
                  } else {
                    setRegion(e.target.value);
                  }
                }}
              >
                <option value="">(none — auto-assign)</option>
                {regionOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
                <option value="__new__">＋ New region…</option>
              </select>
            )}
            {region ? (
              <span
                className={"badge" + (isAutoRegionName(region) ? " badge-info" : "")}
                title={
                  isAutoRegionName(region)
                    ? "Named by auto-clustering. Pick a different region, or clear it back to “(none)” so auto-clustering can redo it."
                    : "Set manually — auto-clustering will never overwrite this."
                }
              >
                {isAutoRegionName(region) ? "Auto-assigned" : "Custom"}
              </span>
            ) : (
              <p className="hint" role="note">
                Empty — the next Cluster-first solve will assign this to a district automatically.
              </p>
            )}
            {flags.solverStrategy !== "clusterFirst" && (
              <p className="hint" role="note">
                Region only affects itinerary grouping when the Cluster-first solver strategy is
                enabled (dev panel, Ctrl/Cmd+Alt+D) — with routeFirst it's kept but has no effect.
              </p>
            )}
          </label>
        )}
        <label>
          Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </label>
        <div className="row">
          <label>
            <input
              type="checkbox"
              checked={isHotel}
              onChange={(e) => setCategory(e.target.checked ? "hotel" : "other")}
            />
            This is a hotel
          </label>
          <small className="hint">Hotels can be assigned in the Stays panel.</small>
        </div>
        <div className="row end">
          {onDelete && (
            <button type="button" className="danger" onClick={onDelete}>
              Delete
            </button>
          )}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}

import { useState } from "react";
import type { Place } from "@app/domain";
import { dayColor, staysFor, useStore, type Stay } from "../store";
import { nightsRange, withCheckIn, withHotel, withNights, withoutStay, withSplitAt } from "../stays";

/**
 * The exact `notes` text the store's `addHotelForStay` stamps on a hotel it
 * creates at a default (copied-from-base) location — see store.ts. There is
 * no dedicated schema field for "this hotel's location is still a
 * placeholder" (adding one is a schema change out of scope here), so this
 * string is the only signal available that a hotel has never had its real
 * coordinates set. It's cleared the moment the user edits the notes field in
 * the place editor — which is exactly what they're being nudged to do
 * together with fixing the location, so in practice it clears itself as
 * part of the normal fix-up flow.
 */
const AUTO_HOTEL_NOTES = "Created from the stays panel — edit to set name and location.";

/** P1 #5: a toast alone (auto-dismissing, easy to miss) was the only signal
 *  that a freshly-created hotel sits at a placeholder location — this makes
 *  that state persistent and visible on the hotel itself, in every place its
 *  identity shows up (this panel's stay rows, and the map marker in
 *  MapView.tsx), until the user actually repositions it. */
export function hotelNeedsLocation(place: Place | undefined): boolean {
  return !!place && place.category === "hotel" && place.notes === AUTO_HOTEL_NOTES;
}

/**
 * Stays panel: the stays-based view over the trip's bases, shown at the top of
 * the timeline sidebar (collapsible). Rows are hotel / check-in day / nights;
 * a coverage bar shows each stay's span across the trip days with check-in
 * days marked. Every edit goes through the `with*` helpers in `../stays` (which
 * always return a valid, fully-covering stay list) and then the store's
 * `setStays` (one undoable mutation + re-solve). Nights are editable on any
 * stay that has room to change (bounded by `nightsRange`), not just the last
 * one. Adding a stay splits coverage at a chosen day; removing one lets the
 * previous stay absorb its nights.
 */
export function StaysPanel() {
  const trip = useStore((s) => s.currentTrip);
  const setStays = useStore((s) => s.setStays);
  const addHotelForStay = useStore((s) => s.addHotelForStay);
  const setToast = useStore((s) => s.setToast);
  const [open, setOpen] = useState(true);
  const [splitDay, setSplitDay] = useState<string>("");
  if (!trip) return null;

  const hotels = trip.places.filter((p) => p.category === "hotel");
  const stays = staysFor(trip);
  const days = trip.days.length;
  const dateOf = (idx: number) => trip.days[idx]?.date;

  /** Create a new hotel place and assign it to stay `idx` in one undoable
   *  mutation. The user repositions it via the place editor. */
  function addNewHotel(idx: number) {
    const id = addHotelForStay(idx);
    if (!id) return;
    const name = useStore.getState().currentTrip?.places.find((p) => p.id === id)?.name ?? "Hotel";
    // The toast alone used to be the only signal (auto-dismisses, easy to
    // miss) — a "needs location" badge on this row (and on its map marker)
    // now stays up until the hotel is actually repositioned (P1 #5).
    setToast(`Hotel "${name}" added at a placeholder location — open it on the map to set the real one.`);
  }

  return (
    <section className="stays-panel">
      <button className="stays-header" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h3>Stays</h3>
        <span className="spacer" />
        <span className="icon-btn" aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <>
          {hotels.length === 0 && (
            <p className="hint">
              No hotels yet — use “＋ New hotel” in a stay row below, or mark any place as “This is a hotel” in its editor.
            </p>
          )}
          <CoverageBar stays={stays} places={trip.places} days={days} />
          <ul className="stays-list">
            {stays.map((stay, i) => {
              const hotel = trip.places.find((p) => p.id === stay.hotelId);
              const minCheckIn = i === 0 ? 0 : stays[i - 1]!.checkInDayIdx + 1;
              // Mirror withCheckIn's own clamp bound exactly: a day at or past
              // the next stay's check-in is not honoured verbatim, it gets
              // silently clamped back. Only offer days withCheckIn will keep.
              const maxCheckIn = stays[i + 1] ? stays[i + 1]!.checkInDayIdx - 1 : days - 1;
              const checkInFixed = i > 0 && minCheckIn > maxCheckIn;
              const { min: minNights, max: maxNights } = nightsRange(stays, i, days);
              const nightsFixed = minNights >= maxNights;
              return (
                <li key={`stay-${i}`} className="stay-row">
                  <span className="stay-hotel-icon" aria-hidden>🛏</span>
                  <select
                    value={stay.hotelId}
                    aria-label={`Hotel of stay ${i + 1}`}
                    onChange={(e) => {
                      if (e.target.value === "__new__") addNewHotel(i);
                      else setStays(withHotel(stays, i, e.target.value));
                    }}
                  >
                    {[...(hotel && hotel.category === "hotel" ? [] : hotel ? [hotel] : []), ...hotels].map(
                      (h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ),
                    )}
                    <option value="__new__">＋ New hotel…</option>
                  </select>
                  {hotelNeedsLocation(hotel) && (
                    <span
                      className="badge badge-warning"
                      title={`"${hotel!.name}" was created at a default location — open it (on the map or via ✎ edit) to set its real address.`}
                    >
                      needs location
                    </span>
                  )}
                  <label className="stay-field">
                    Check-in
                    {i === 0 ? (
                      <span className="stay-fixed" title="The first stay always starts on day 1">
                        Day 1 ({dateOf(0)})
                      </span>
                    ) : checkInFixed ? (
                      <span
                        className="stay-fixed"
                        title="No room to move — the neighbouring stays leave no day free to check in on"
                      >
                        Day {stay.checkInDayIdx + 1} ({dateOf(stay.checkInDayIdx)})
                      </span>
                    ) : (
                      <select
                        value={stay.checkInDayIdx}
                        aria-label={`Check-in day of stay ${i + 1}`}
                        onChange={(e) => setStays(withCheckIn(stays, i, Number(e.target.value), days))}
                      >
                        {Array.from({ length: maxCheckIn - minCheckIn + 1 }, (_, k) => minCheckIn + k).map(
                          (d) => (
                            <option key={d} value={d}>
                              Day {d + 1} ({dateOf(d)})
                            </option>
                          ),
                        )}
                      </select>
                    )}
                  </label>
                  <label className="stay-field">
                    Nights
                    <NightsInput
                      key={`${stay.checkInDayIdx}-${stay.nights}`}
                      nights={stay.nights}
                      min={minNights}
                      max={maxNights}
                      disabled={nightsFixed}
                      title={
                        nightsFixed
                          ? stays.length === 1
                            ? "The only stay always covers the whole trip"
                            : "No room to change — the neighbouring check-in days leave no nights to move"
                          : undefined
                      }
                      ariaLabel={`Nights of stay ${i + 1}`}
                      onCommit={(n) => setStays(withNights(stays, i, n, days))}
                    />
                  </label>
                  {i > 0 && (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Remove this stay (the previous stay covers its nights)"
                      onClick={() => setStays(withoutStay(stays, i))}
                    >
                      ✕
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {stays.length > 0 && days > 1 && (
            <div className="stays-actions">
              <label className="stay-field">
                Add stay (split) at
                <select value={splitDay} onChange={(e) => setSplitDay(e.target.value)}>
                  <option value="">Day…</option>
                  {Array.from({ length: days - 1 }, (_, k) => k + 1)
                    .filter((d) => {
                      // Only days strictly inside a stay are valid split points:
                      // splitting at an existing check-in day is a no-op that
                      // `withSplitAt` would silently ignore (looks broken).
                      const s = stays.find((x) => d > x.checkInDayIdx && d < x.checkInDayIdx + x.nights);
                      return s !== undefined;
                    })
                    .map((d) => (
                      <option key={d} value={d}>
                        Day {d + 1} ({dateOf(d)})
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!splitDay}
                title="Split coverage: the new stay starts on that day"
                onClick={() => {
                  if (splitDay) {
                    const dayIdx = Number(splitDay);
                    setStays(withSplitAt(stays, dayIdx, days));
                    setToast(`Stay added at day ${dayIdx + 1} — pick a different hotel in the new row (or ＋ New hotel).`);
                  }
                  setSplitDay("");
                }}
              >
                Add stay
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Nights number input, held in local draft state so keystrokes don't push
 *  intermediate values (e.g. the "1" while typing "10") through the store.
 *  Commits on blur and on Enter; Escape reverts to the derived value. The
 *  parent keys this component on the derived stay so an externally-changed
 *  value (undo, another edit shifting this stay) is picked up fresh. */
function NightsInput({
  nights,
  min,
  max,
  disabled,
  title,
  ariaLabel,
  onCommit,
}: {
  nights: number;
  min: number;
  max: number;
  disabled: boolean;
  title: string | undefined;
  ariaLabel: string;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(nights));

  function commit() {
    const n = Number(draft);
    if (Number.isFinite(n) && n !== nights) onCommit(n);
    else setDraft(String(nights));
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      disabled={disabled}
      value={draft}
      aria-label={ariaLabel}
      title={title}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(String(nights));
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** Horizontal coverage bar: one segment per stay, sized by nights, each in
 *  its own colour (the same day-identity ramp the map uses, indexed by stay
 *  order) so consecutive stays are tellable apart at a glance, with check-in
 *  days marked. */
function CoverageBar({ stays, places, days }: { stays: Stay[]; places: Place[]; days: number }) {
  const nameOf = (id: string) => places.find((p) => p.id === id)?.name ?? id;
  return (
    <div className="stays-coverage" role="img" aria-label="Stays coverage across the trip days">
      {stays.map((s, i) => (
        <div
          key={`${s.checkInDayIdx}-${s.hotelId}`}
          className={"stays-coverage-seg" + (i === 0 ? " first" : "")}
          style={{ flexGrow: s.nights, background: dayColor(i) }}
          title={`Day ${s.checkInDayIdx + 1}: check in at ${nameOf(s.hotelId)} · ${s.nights} night${s.nights === 1 ? "" : "s"}`}
        >
          {i > 0 && <span className="checkin-mark" title={`Check-in: day ${s.checkInDayIdx + 1}`} />}
          <span className="seg-label">{nameOf(s.hotelId)}</span>
        </div>
      ))}
      {days === 0 && <span className="hint">No days</span>}
    </div>
  );
}

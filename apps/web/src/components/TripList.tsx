import { useEffect, useRef, useState } from "react";
import { MAX_TRIP_DAYS, useStore } from "../store";
import type { AnySampleData } from "../tripFactory";
import { tokyoSample } from "../samples/tokyo";
import { warsawSample } from "../samples/warsaw";
import { tokyoHakoneSample } from "../samples/tokyo-hakone";
import { tokyoGrandSample } from "../samples/tokyo-grand";
import { tokyoCustomSample } from "../samples/tokyo-custom";
import { downloadJson, shareTrip } from "../share";
import { icelandRingSample } from "../samples/iceland-ring";

import { tokyoKawaguchiSample } from "../samples/tokyo-kawaguchi";


/** Latest end date the creation form will accept for a given start date,
 *  keeping the picker itself from offering a range longer than MAX_TRIP_DAYS
 *  (the store enforces the same cap server-side — this just surfaces it
 *  cleanly to the user). */
function maxEndDate(startDate: string): string | undefined {
  const s = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(s.getTime())) return undefined;
  return new Date(s.getTime() + (MAX_TRIP_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** One entry drives both the first-run hero cards (shown to a brand-new user
 *  with no trips) and the compact bottom-row buttons (shown once trips
 *  exist) — a single source of copy for both presentations. */
interface SampleDescriptor {
  label: string;
  data: AnySampleData;
  blurb: string;
  title: string;
}

const SAMPLES: SampleDescriptor[] = [
  {
    label: "Tokyo & Fuji (5D)",
    data: tokyoKawaguchiSample,
    blurb: "5 days · 32 places · Shinjuku hotel",
    title: "Create a 5-day Tokyo & Lake Kawaguchi trip (32 places, Shinjuku hotel)",
  },
  {
    label: "Iceland Ring (12D)",
    data: icelandRingSample,
    blurb: "12 days · 71 places · 12 distinct hotels",
    title: "Create a 12-day Iceland Ring Road trip (71 places, new hotel every night)",
  },
  {
    label: "Tokyo",
    data: tokyoSample,
    blurb: "5 days · 24 places · Shinjuku hotel",
    title: "Create a curated 5-day Tokyo trip (24 places, Shinjuku hotel)",
  },
  {
    label: "Warsaw",
    data: warsawSample,
    blurb: "4 days · 22 places · Hotel Bristol",
    title: "Create a curated 4-day Warsaw trip (22 places, Hotel Bristol)",
  },
  {
    label: "Tokyo → Hakone",
    data: tokyoHakoneSample,
    blurb: "5 days · mid-trip hotel change (day 3 sleeps in Hakone)",
    title: "Create a curated 5-day Tokyo → Hakone trip with a mid-trip hotel change (day 3 sleeps in Hakone)",
  },
  {
    label: "Tokyo 100",
    data: tokyoGrandSample,
    blurb: "12 days · 100 places · two hotels — see the day strip at full scale",
    title: "Create a curated 12-day Tokyo trip with 100 places and two hotels (Shinjuku, then Asakusa)",
  },
  {
    label: "Tokyo Custom 5-Day",
    data: tokyoCustomSample,
    blurb: "5 days · 20 places · pre-clustered districts",
    title: "Create a curated 5-day Tokyo trip with pre-defined geographical districts",
  },
];

/** Delete confirms twice removed automatically. */
const DELETE_CONFIRM_TIMEOUT_MS = 4000;

/**
 * Delete is destructive and irreversible (the store's `deleteTrip` has no
 * undo path) — this makes it a deliberate two-step action instead of a
 * single click, without leaving the list markup for a native `confirm()`
 * dialog (P0 #1). `aria-live="polite"` on the button itself means the label
 * change ("Delete" → "Really delete?") gets announced to screen readers.
 */
function DeleteTripButton({ name, onConfirm }: { name: string; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timerRef.current), []);

  function handleClick() {
    if (!confirming) {
      setConfirming(true);
      timerRef.current = setTimeout(() => setConfirming(false), DELETE_CONFIRM_TIMEOUT_MS);
      return;
    }
    clearTimeout(timerRef.current);
    setConfirming(false);
    onConfirm();
  }

  return (
    <button
      className={"danger" + (confirming ? " confirming" : "")}
      onClick={handleClick}
      onBlur={() => setConfirming(false)}
      aria-live="polite"
      title={confirming ? `Click again to permanently delete "${name}"` : "Delete trip"}
    >
      {confirming ? "Really delete?" : "Delete"}
    </button>
  );
}

/** Trip list + creation form + JSON export/import (tasks 7.1 creation, 7.5). */
export function TripList() {
  const trips = useStore((s) => s.trips);
  const importError = useStore((s) => s.importError);
  const createTrip = useStore((s) => s.createTrip);
  const openTrip = useStore((s) => s.openTrip);
  const deleteTrip = useStore((s) => s.deleteTrip);
  const exportTripJson = useStore((s) => s.exportTripJson);
  const importTripJson = useStore((s) => s.importTripJson);
  const setToast = useStore((s) => s.setToast);
  const loadSampleTrip = useStore((s) => s.loadSampleTrip);

  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const weekLater = new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10);
    setStart(today);
    setEnd(weekLater);
  }, []);

  async function handleExport(id: string, tripName: string) {
    const json = await exportTripJson(id);
    if (!json) return;
    downloadJson(json, `${tripName.replace(/[^\w-]+/g, "_")}.json`);
  }

  /** Copy a share link (or fall back to a file download) — task 2.2. */
  async function handleShare(id: string, tripName: string) {
    const json = await exportTripJson(id);
    if (!json) return;
    setToast(await shareTrip(json, tripName));
  }

  async function handleImportFile(file: File) {
    const json = await file.text();
    await importTripJson(json);
  }

  return (
    <div className="trip-list">
      <h1>Travel Planner</h1>

      {trips.length === 0 && (
        <section className="first-run">
          <p className="first-run-pitch">
            Travel Planner turns a list of places into a day-by-day itinerary — plotted on a map,
            timed leg by leg, and automatically rebalanced whenever you add, drag, or drop a place.
          </p>
          <div className="sample-grid">
            {SAMPLES.map((s) => (
              <button
                key={s.label}
                className="card sample-card"
                onClick={() => void loadSampleTrip(s.data)}
                title={s.title}
              >
                <strong>{s.label}</strong>
                <span className="hint">{s.blurb}</span>
              </button>
            ))}
          </div>
          <p className="hint first-run-or">Or set up your own trip below.</p>
        </section>
      )}

      <form
        className="card create-form"
        onSubmit={(e) => {
          e.preventDefault();
          void createTrip(name, city, start, end);
          setName("");
          setCity("");
        }}
      >
        <h2>New trip</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tokyo 2026" required />
        </label>
        <label>
          Starting city
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="e.g. Tokyo — seeds the home base location"
            required
          />
        </label>
        <div className="row">
          <label>
            From
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
          </label>
          <label>
            To
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              max={maxEndDate(start)}
              title={`Trips are capped at ${MAX_TRIP_DAYS} days`}
              required
            />
          </label>
        </div>
        <button type="submit">Create trip</button>
        <p className="hint">
          One day is generated per date with default 09:00–21:00 hours; the starting city becomes the
          home base location. Trips are capped at {MAX_TRIP_DAYS} days.
        </p>
      </form>

      {importError && <div className="error-banner" role="alert">{importError}</div>}

      {trips.length > 0 && (
        <>
          <h2>Your trips</h2>
          <ul className="trip-items">
            {trips.map((t) => (
              <li key={t.id} className="card trip-item">
                <button className="trip-open" onClick={() => void openTrip(t.id)}>
                  <strong>{t.name}</strong>
                  <span className="hint">
                    {t.days.length} day{t.days.length === 1 ? "" : "s"} · {t.places.length} places · updated{" "}
                    {new Date(t.updatedAt).toLocaleDateString()}
                  </span>
                </button>
                <div className="trip-actions">
                  <button onClick={() => void handleShare(t.id, t.name)} title="Copy a share link for this trip">
                    Share
                  </button>
                  <button onClick={() => void handleExport(t.id, t.name)} title="Export as JSON">
                    Export
                  </button>
                  <DeleteTripButton name={t.name} onConfirm={() => void deleteTrip(t.id)} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="import-row">
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleImportFile(f);
            e.target.value = "";
          }}
        />
        <button onClick={() => fileRef.current?.click()}>Import trip JSON…</button>
        {/* Once a first trip exists, the first-run hero above is gone — these
         *  compact buttons are the samples' only remaining home, so no one
         *  loses the ability to pull in another sample later. */}
        {trips.length > 0 &&
          SAMPLES.map((s) => (
            <button key={s.label} onClick={() => void loadSampleTrip(s.data)} title={s.title}>
              Load sample: {s.label}
            </button>
          ))}
      </div>
    </div>
  );
}

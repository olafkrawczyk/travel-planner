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

/** One entry drives the sample section (first-run hero + compact "Load
 *  sample" buttons once trips exist) — a single source of copy for both
 *  presentations. The first two entries are the ones featured prominently
 *  in the first-run hero (see `FEATURED_SAMPLE_COUNT`); the rest are near
 *  variations of the same Tokyo trip and are listed compactly instead. */
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
    blurb: "5 days, 32 places, Shinjuku hotel.",
    title: "Create a 5-day Tokyo & Lake Kawaguchi trip (32 places, Shinjuku hotel)",
  },
  {
    label: "Iceland Ring (12D)",
    data: icelandRingSample,
    blurb: "12 days, 71 places, a new hotel every night.",
    title: "Create a 12-day Iceland Ring Road trip (71 places, new hotel every night)",
  },
  {
    label: "Tokyo",
    data: tokyoSample,
    blurb: "5 days, 24 places, Shinjuku hotel.",
    title: "Create a curated 5-day Tokyo trip (24 places, Shinjuku hotel)",
  },
  {
    label: "Warsaw",
    data: warsawSample,
    blurb: "4 days, 22 places, Hotel Bristol.",
    title: "Create a curated 4-day Warsaw trip (22 places, Hotel Bristol)",
  },
  {
    label: "Tokyo & Hakone",
    data: tokyoHakoneSample,
    blurb: "5 days, hotel changes to Hakone on day 3.",
    title: "Create a curated 5-day Tokyo → Hakone trip with a mid-trip hotel change (day 3 sleeps in Hakone)",
  },
  {
    label: "Tokyo (100 places)",
    data: tokyoGrandSample,
    blurb: "12 days, 100 places, two hotels.",
    title: "Create a curated 12-day Tokyo trip with 100 places and two hotels (Shinjuku, then Asakusa)",
  },
  {
    label: "Tokyo (custom)",
    data: tokyoCustomSample,
    blurb: "5 days, 20 places, pre-clustered districts.",
    title: "Create a curated 5-day Tokyo trip with pre-defined geographical districts",
  },
];

/** The first N samples are shown as the large, featured tiles in the
 *  first-run hero; the rest are near-duplicates of the same Tokyo trip and
 *  read better as a compact list (issue: ragged 7-card grid). */
const FEATURED_SAMPLE_COUNT = 2;

/** Delete confirms twice removed automatically. */
const DELETE_CONFIRM_TIMEOUT_MS = 4000;

/** Small inline "x" used for dismiss controls — an SVG rather than a glyph
 *  so it renders at a consistent weight across platforms/fonts. */
function DismissIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
      <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

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

/** A schematic route diagram built only from the day-identity palette: this
 *  is the product's actual subject matter (a multi-day route solved onto a
 *  map, each day in a distinct colour, stops timed leg by leg) rendered as a
 *  static "timetable" strip — the first thing a first-time visitor sees,
 *  before any copy. Purely decorative, so it's hidden from assistive tech. */
function RouteHero() {
  const rows: { color: string; y: number; stops: number[] }[] = [
    { color: "var(--day-1)", y: 34, stops: [60, 190, 330, 480, 610] },
    { color: "var(--day-2)", y: 94, stops: [90, 240, 390, 530, 660, 770] },
    { color: "var(--day-3)", y: 154, stops: [50, 160, 290, 430, 560] },
    { color: "var(--day-4)", y: 214, stops: [100, 270, 430, 590, 730, 860] },
  ];

  return (
    <svg
      className="route-hero"
      viewBox="0 0 920 248"
      role="img"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      {rows.map((row, i) => {
        const next = rows[i + 1];
        return (
          <g key={row.color}>
            {next && (
              <line
                x1={row.stops[row.stops.length - 1]}
                y1={row.y}
                x2={next.stops[0]}
                y2={next.y}
                stroke="var(--border-strong)"
                strokeWidth={1.5}
                strokeDasharray="2 4"
              />
            )}
            <polyline
              points={row.stops.map((x) => `${x},${row.y}`).join(" ")}
              fill="none"
              stroke={row.color}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {row.stops.map((x, si) =>
              si === 0 ? (
                <rect key={x} x={x - 5} y={row.y - 5} width={10} height={10} fill={row.color} />
              ) : (
                <circle key={x} cx={x} cy={row.y} r={5} fill="var(--bg-surface)" stroke={row.color} strokeWidth={3} />
              ),
            )}
          </g>
        );
      })}
      <text x={60} y={16} className="tnum route-hero-time" fill="var(--text-muted)" fontSize={12}>
        09:00
      </text>
      <text x={610} y={16} textAnchor="end" className="tnum route-hero-time" fill="var(--text-muted)" fontSize={12}>
        21:00
      </text>
    </svg>
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

  const isFirstRun = trips.length === 0;
  const featuredSamples = SAMPLES.slice(0, FEATURED_SAMPLE_COUNT);
  const moreSamples = SAMPLES.slice(FEATURED_SAMPLE_COUNT);

  // P2 #6: `importError` only ever cleared on a later *successful* import
  // (see store.ts), so a failed import used to leave a permanent red banner
  // with no way to dismiss it. `importTripJson` isn't in this component's
  // editable surface, so the fix lives here: track dismissal locally, and
  // un-dismiss automatically whenever the store reports a *new* error (a
  // second, different failure must not be hidden by an earlier dismissal).
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const showImportError = importError !== null && importError !== dismissedError;

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
    <div className="trip-home">
      {isFirstRun ? (
        <section className="hero">
          <RouteHero />
          <div className="hero-copy">
            <h1>Every day its own colour. Every stop timed to fit.</h1>
            <p className="hero-sub">
              Add the places you want to see. Travel Planner routes and times them into a day-by-day
              itinerary you can drag, pin, and edit.
            </p>
          </div>
        </section>
      ) : (
        <h1 className="brandmark">Travel Planner</h1>
      )}

      {isFirstRun && (
        <>
          <ol className="steps">
            <li>Add places — search the map once a trip is open, or start from a sample below.</li>
            <li>
              Hit <strong>Regenerate</strong> (⟳ button, or Ctrl+Enter) to build the itinerary.
            </li>
            <li>Tweak: drag between days, pin favourites, or edit details — then regenerate again to apply.</li>
          </ol>

          <section className="samples">
            <h2>Start from a sample</h2>
            <div className="samples-featured">
              {featuredSamples.map((s) => (
                <button
                  key={s.label}
                  className="sample-tile"
                  onClick={() => void loadSampleTrip(s.data)}
                  title={s.title}
                >
                  <strong>{s.label}</strong>
                  <span className="hint">{s.blurb}</span>
                </button>
              ))}
            </div>
            <ul className="samples-more">
              {moreSamples.map((s) => (
                <li key={s.label}>
                  <button className="sample-row" onClick={() => void loadSampleTrip(s.data)} title={s.title}>
                    <strong>{s.label}</strong>
                    <span className="hint">{s.blurb}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <div className="workspace">
        <form
          className="trip-form"
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
          <button type="submit" className="btn-primary">
            Create trip
          </button>
          <p className="hint">
            One day is generated per date with default 09:00–21:00 hours; the starting city becomes the
            home base location. Trips are capped at {MAX_TRIP_DAYS} days.
          </p>
        </form>

        {trips.length > 0 && (
          <section className="trips-panel">
            <h2>Your trips</h2>
            <ul className="trip-rows">
              {trips.map((t) => (
                <li key={t.id} className="trip-row">
                  <button className="trip-row-open" onClick={() => void openTrip(t.id)}>
                    <strong>{t.name}</strong>
                    <span className="hint">
                      {t.days.length} day{t.days.length === 1 ? "" : "s"}, {t.places.length} places, updated{" "}
                      {new Date(t.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                  <div className="trip-row-actions">
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
          </section>
        )}
      </div>

      {showImportError && (
        <div className="error-banner" role="alert">
          <span className="error-banner-message">{importError}</span>
          <button
            type="button"
            className="error-banner-dismiss"
            onClick={() => setDismissedError(importError)}
            aria-label="Dismiss this error"
          >
            <DismissIcon />
          </button>
        </div>
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

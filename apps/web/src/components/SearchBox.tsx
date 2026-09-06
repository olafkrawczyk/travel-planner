import { useEffect, useRef, useState } from "react";
import { MemoryGeoCache, PhotonClient, type GeoResult } from "@app/geo";
import { newPlaceId } from "@app/domain";
import { useStore } from "../store";
import { PHOTON_CONTACT } from "../photonContact";

const photon = new PhotonClient({
  cache: new MemoryGeoCache(),
  debounceMs: 300,
  appName: "travel-planner",
  contactEmail: PHOTON_CONTACT,
});

const DEBOUNCE_MS = 300;

/**
 * Debounced, cached geocoding search that adds places (task 7.3).
 * The query itself is debounced here so typing produces a single trailing
 * request per pause; the client-side debounce stays as a second layer.
 */
export function SearchBox() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addPlace = useStore((s) => s.addPlace);
  const seq = useRef(0);

  // Debounce the raw query: only the final value after the pause proceeds.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (debounced.length < 3) {
      setResults([]);
      setError(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    setError(null);
    const mySeq = ++seq.current;
    photon
      .search(debounced)
      .then((r) => {
        if (seq.current === mySeq) setResults(r);
      })
      .catch(() => {
        if (seq.current === mySeq) {
          setResults([]);
          setError("Search failed — check your connection and try again.");
        }
      })
      .finally(() => {
        if (seq.current === mySeq) setBusy(false);
      });
  }, [debounced]);

  function add(result: GeoResult) {
    addPlace({
      id: newPlaceId(),
      name: result.name,
      lat: +result.lat.toFixed(6),
      lng: +result.lng.toFixed(6),
      category: "other",
      dwellMin: 60,
      priority: 2,
      osmId: result.osmId,
      notes: [result.city, result.country].filter(Boolean).join(", "),
    });
    setQuery("");
    setResults([]);
    setError(null);
  }

  return (
    <div className="search-box">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a place to add…"
        aria-label="Geocoding search"
      />
      {busy && <span className="hint"> searching…</span>}
      {error && (
        <p className="search-error" role="alert">
          {error}
        </p>
      )}
      {results.length > 0 && (
        <ul className="search-results">
          {results.map((r) => (
            <li key={r.id}>
              <button onClick={() => add(r)}>
                <strong>{r.name}</strong>
                <span className="hint">{[r.city, r.country].filter(Boolean).join(", ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {debounced.length >= 3 && !busy && !error && results.length === 0 && (
        <p className="hint">No results.</p>
      )}
    </div>
  );
}

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

function SearchIcon() {
  return (
    <svg
      className="search-input-icon"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

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

  function clearSearch() {
    setQuery("");
    setDebounced("");
    setResults([]);
    setError(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      clearSearch();
    }
  }

  const hasDropdown = Boolean(
    error ||
      results.length > 0 ||
      (debounced.length >= 3 && (busy || results.length === 0)),
  );

  return (
    <div className="search-box">
      <div className="search-input-wrap">
        <SearchIcon />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search a place to add…"
          aria-label="Geocoding search"
        />
        {query && (
          <button
            type="button"
            className="search-clear-btn"
            onClick={clearSearch}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>
      {hasDropdown && (
        <div className="search-dropdown">
          {error && (
            <div className="search-error" role="alert">
              {error}
            </div>
          )}
          {busy && results.length === 0 && (
            <div className="search-feedback">Searching…</div>
          )}
          {results.length > 0 && (
            <ul className="search-results" role="listbox">
              {results.map((r) => (
                <li key={r.id} role="option">
                  <button
                    type="button"
                    className="search-result-item"
                    onClick={() => add(r)}
                  >
                    <span className="search-result-name">{r.name}</span>
                    <span className="search-result-meta">
                      {[r.city, r.country].filter(Boolean).join(", ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {debounced.length >= 3 && !busy && !error && results.length === 0 && (
            <div className="search-feedback">No results found.</div>
          )}
        </div>
      )}
    </div>
  );
}

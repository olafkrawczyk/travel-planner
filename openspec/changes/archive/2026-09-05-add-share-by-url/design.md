# Design: add-share-by-url

## Encoding (apps/web/src/share.ts)

- `encodeTrip(json: string): string` — `CompressionStream('deflate-raw')` the UTF-8 JSON, base64url-encode, return `#trip=...`.
- `decodeTrip(fragment: string): string` — reverse; throws typed errors (malformed base64, inflate failure, not JSON). Schema validation is NOT done here — reuse the existing `repo.importJson` path which validates.
- `MAX_FRAGMENT = 8000` chars guard.
- base64url via btoa/atob with URL-safe substitution; chunked byte→string conversion for large payloads.

## App integration

- `App.tsx` useEffect on mount: read `location.hash`; if `#trip=`, decode → `importTripJson(json)` (existing store action — validates, imports) → toast success/failure → `history.replaceState(null, '', location.pathname + location.search)`.
- Share buttons: TripScreen header + TripList item actions. Handler: `exportTripJson(id)` → encode → if over limit: trigger existing file download + toast "Trip too large for a link — downloaded file instead"; else `navigator.clipboard.writeText(url)` + toast "Link copied".

## Tests

- share.test.ts: round-trip (encode→decode equals input), oversize detection (craft large string), malformed base64/inflate/JSON rejections.
- CompressionStream availability: Node 22 + all target browsers have it; guard with a clear error if absent.

## Constraints

- No new dependencies, no schema changes, no network.
- Keep the fragment stripping immediate so refreshes don't re-import duplicates.

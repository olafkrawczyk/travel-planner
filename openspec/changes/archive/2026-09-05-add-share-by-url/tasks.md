# Tasks: add-share-by-url

## 1. Encoding (apps/web/src/share.ts)

- [x] 1.1 `encodeTrip`/`decodeTrip` with deflate-raw CompressionStream + base64url; MAX_FRAGMENT guard; typed errors; unit tests (round-trip, oversize, malformed inputs)

## 2. App integration

- [x] 2.1 App boot: detect `#trip=` fragment → decode → importTripJson (validates) → toast → strip fragment via history.replaceState; corrupt fragment → error toast, no data change
- [x] 2.2 Share buttons in TripScreen header and TripList items: copy link to clipboard with toast; oversize → JSON file download fallback + explanatory toast

## 3. Verify

- [x] 3.1 `pnpm build` passes; `pnpm test` green

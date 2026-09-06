# Proposal: add-share-by-url

## Why

Cheap collaboration before accounts (v2): a user should be able to send a friend a link that opens the same trip — no backend, no accounts. The spec calls for compressed JSON in the URL fragment (never sent to servers, privacy-friendly).

## What Changes

- **Share**: a "Share link" button (trip header + trip list) copies a URL containing the full trip JSON, deflate-compressed and base64url-encoded in `#trip=...`.
- **Open**: launching the app with such a fragment imports the trip (validated, assigned a fresh local id) and offers to save it locally; the fragment is then stripped from the address bar.
- **Size guard**: if the compressed URL exceeds ~8 KB (safe fragment length), fall back to offering the JSON file download instead with an explanatory toast.
- **Read-only preview vs save**: opening a shared link imports directly into the trip list (simplest honest flow) with a toast "Shared trip imported".

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trip-persistence`: trips SHALL be shareable as compressed-JSON URLs and importable from them, with the same schema validation as file import.

## Impact

- `apps/web/src/share.ts` (new): encode/decode using `CompressionStream('deflate-raw')` (all modern browsers) + base64url; falls back gracefully.
- `apps/web/src/App.tsx`: on boot, detect `#trip=` fragment → decode → import via existing `repo.importJson` path → toast → strip fragment (history.replaceState).
- `TripScreen` header + `TripList` item actions: "Share" button (clipboard copy with toast).
- Tests: round-trip encode/decode, oversize detection, malformed fragment rejection.
- No schema changes; no network.

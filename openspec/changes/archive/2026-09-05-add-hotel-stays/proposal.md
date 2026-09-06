# Proposal: add-hotel-stays

## Why

Changing hotels is currently done via "Set as base from day N onward" — technically correct but unintuitive: travelers think in **stays** ("3 nights in Shinjuku, then 2 nights in Hakone"), not day-index mutations. Also "hotel" is not a category, so base places masquerade as "other".

## What Changes

- **`hotel` category**: added to the category enum (additive; existing places unaffected). Hotel markers get a distinct bed-style look and are the default candidates for bases.
- **Mark as hotel**: place editor gains a "This is a hotel" toggle — sets category to `hotel` (and dwell 0 if used as a base), making it available in the stays editor.
- **Stays editor** (replaces "set as base" controls): a "Stays" panel in the timeline sidebar listing stays as rows — hotel, check-in day, nights — with a visual coverage bar across the trip. Adding a stay splits coverage; removing one extends the previous stay. Editing stays rewrites per-day `baseStartId`/`baseEndId` (check-in day: wake old, sleep new) and re-solves. Undo/redo works via existing snapshots.
- Sample trips continue to work; the Tokyo→Hakone sample shows two stays derived automatically.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trip-management`: hotel category and stay-based base assignment replace per-day "set as base" controls.
- `itinerary-view`: stays panel presentation in the timeline sidebar.

## Impact

- `packages/domain`: category union + `hotel` (no migration needed — additive).
- `apps/web/src/store.ts`: `staysFor(trip)` derivation + `setStays(stays)` mutation (validates contiguous coverage, writes baseStart/baseEnd per day).
- `apps/web/src/components/`: new `StaysPanel.tsx`; PlaceEditor: "This is a hotel" toggle; remove the old "Set as base…" buttons; Timeline: stays panel section.
- Tests: stays derivation + setStays mapping (incl. check-in day semantics: baseStart=old, baseEnd=new), hotel category round-trip.

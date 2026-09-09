## Context

See `proposal.md` for motivation. Currently, `recommendHotelAreas` runs synchronously within `useMemo` in `StaysPanel.tsx`, segmenting places into the trip's existing days/stay segments and estimating travel via `heuristicEntry`. This requires users to manually split days before they can receive hotel recommendations for distant places.

## Goals / Non-Goals

**Goals:**
- Detect natural geographic clusters (Scale B, ~25km radius) independent of day allocations.
- Validate proposed bases using background "shadow solves" in a Web Worker to calculate real transit time savings.
- Provide a clear UI in `StaysPanel` displaying verified savings and allowing one-click application of new bases with auto-sized nights.

**Non-Goals:**
- Live real-time shadow solving on every keystroke or pin drag (shadow solves only trigger after a full Regenerate/solve).
- Completely replacing the manual Stays panel controls (users can still adjust check-in dates and nights manually).

## Decisions

### Decision 1: Coarse Clustering (Scale B) vs District Clustering (Scale A)
- **Choice**: Implement a separate clustering pass with a ~25km distance threshold (or hierarchical clustering) specifically for base area discovery.
- **Rationale**: The existing `Place.region` clustering uses a tight ~3km radius designed for within-day coherence (avoiding daily zigzagging between Shibuya and Ueno). Using that for hotel recommendations would suggest multiple hotels within the same city. Base selection requires a coarser regional scale.
- **Alternatives considered**: Reusing `Place.region` (rejected because it over-fragments cities into multiple hotel stays).

### Decision 2: Asynchronous Background Shadow Solves via Web Worker
- **Choice**: Trigger shadow solves in the background worker only after the primary itinerary solve has completed and rendered.
- **Rationale**: Calculating actual transit time savings requires running `solve()` on a counterfactual trip configuration. Running this synchronously would freeze the UI. By running it in the background on Regenerate, the user receives their itinerary in ~1s, and base suggestions appear ~4-10s later without blocking interaction.
- **Determinism**: Shadow solves will use the same random seed (`seed: 42`) and problem settings as the baseline solve to ensure fair comparison.
- **Alternatives considered**: Pure heuristic delta (rejected because it doesn't account for routing, day packing, or actual ALNS tour changes).

### Decision 3: Speculative Stay Configuration Generation
- **Choice**: For each identified external cluster, estimate the cluster workload (sum of place dwell times + intra-cluster travel heuristic). Convert workload into suggested nights assuming an average daily budget (e.g. 7-8 hours).
- **Placement**: Append the candidate stay to the trip (or splice it adjacent to when its places currently appear) to form a complete, valid `Stay[]` candidate.
- **Filtering**: Only surface candidate bases if the shadow solve shows a net transit time savings above a meaningful threshold (e.g. >45 minutes total saved).

### Decision 4: Top-Level "Suggested Bases" in StaysPanel
- **Choice**: Extract `HotelAreaRecommendation` from inside `<li className="stay-row">` and render a dedicated "Suggested Bases" card at the top of `StaysPanel`.
- **Action**: Clicking "Apply" creates the hotel place at the recommended centroid, updates `Stay[]` with the recommended night split, and triggers a full solve.

## Risks / Trade-offs

- **[Risk] Multiple candidate shadow solves overloading the worker** → Limit speculative candidates to top 2-3 clusters, allocate bounded budget per candidate, and cancel running shadow solves if the user triggers a new solve or edit.
- **[Risk] Shadow solve finding a worse tour by stochastic variance** → Fix seed to 42 and require a minimum time savings margin (e.g. >= 45 min) before surfacing a suggestion.
- **[Risk] Night allocation rounding errors on tight trips** → Clamp suggested nights so that the existing base retains at least 1 night and the total nights match `trip.days.length`.

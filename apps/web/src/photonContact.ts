/**
 * Contact identifier sent as Photon's `From` header (release audit item 4).
 * `User-Agent` is a forbidden header name the fetch spec drops silently
 * (`PhotonClient`'s attempt at it never actually reaches the server), so
 * `From`/`contactEmail` is the only lever that does.
 *
 * No repository URL or role mailbox exists anywhere in this repo yet, so
 * this is an explicit placeholder rather than a real project contact —
 * replace it with the project's repo URL or a real role address once one
 * exists (that decision belongs to the project's owner). Not a personal
 * email address, and not anything found in local git config.
 *
 * Shared by every `PhotonClient` instance in this app (`SearchBox.tsx`'s
 * debounced search client and `store.ts`'s one-shot creation-time
 * geocoder) — previously duplicated as two separate literals because they
 * were authored by concurrent agents each scoped to one file; consolidated
 * here so the placeholder can only drift by being edited once.
 */
export const PHOTON_CONTACT = "travel-planner-app (no project contact configured yet)";

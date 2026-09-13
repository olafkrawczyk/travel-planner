import type { TravelOverride } from "@app/domain";

/**
 * Upserts a travel-time override into the trip's override list. Drops any
 * existing entry for the exact same directed pair, and — matching the
 * existing inline-leg-edit behavior this was extracted from — also drops an
 * existing *symmetric* entry for the reverse pair, since a symmetric
 * override already covers both directions and a stale reverse entry would
 * otherwise linger unused.
 */
export function upsertTravelOverride(
  existing: readonly TravelOverride[] | undefined,
  override: TravelOverride,
): TravelOverride[] {
  const list = existing ?? [];
  const filtered = list.filter(
    (o) =>
      !(
        (o.fromId === override.fromId && o.toId === override.toId) ||
        (o.symmetric && o.fromId === override.toId && o.toId === override.fromId)
      ),
  );
  return [...filtered, override];
}

/**
 * Removes any travel override matching the pair (in either direction if symmetric).
 */
export function removeTravelOverride(
  existing: readonly TravelOverride[] | undefined,
  fromId: string,
  toId: string,
): TravelOverride[] {
  if (!existing) return [];
  return existing.filter(
    (o) =>
      !(
        (o.fromId === fromId && o.toId === toId) ||
        (o.symmetric && o.fromId === toId && o.toId === fromId)
      ),
  );
}

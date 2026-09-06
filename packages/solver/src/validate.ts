import type { Trip } from "@app/domain";

/** Thrown when a trip snapshot contains data the solver cannot use. */
export class SolverInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolverInputError";
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function label(id: string | undefined, name: string | undefined): string {
  const shownId = id || "(unknown id)";
  return name ? `place "${name}" (${shownId})` : `place ${shownId}`;
}

function fmt(v: unknown): string {
  return v === null ? "null" : String(v);
}

/**
 * Defensive validation at the solver input boundary. Trips may carry invalid
 * numeric fields (null/NaN coordinates from hand-edited or pre-validation
 * saves, bad override minutes, non-numeric dwell); fail fast with an error
 * naming the offending place instead of throwing an opaque validation error
 * deep inside the math.
 */
export function validateTripInput(trip: Trip): void {
  if (!trip || !Array.isArray(trip.places)) {
    throw new SolverInputError("Invalid trip snapshot: missing places array");
  }
  for (const p of trip.places) {
    if (!isFiniteNumber(p.lat) || !isFiniteNumber(p.lng)) {
      throw new SolverInputError(
        `${label(p.id, p.name)} has invalid coordinates: lat=${fmt(p.lat)}, lng=${fmt(p.lng)}`,
      );
    }
    if (!isFiniteNumber(p.dwellMin) || p.dwellMin < 0) {
      throw new SolverInputError(
        `${label(p.id, p.name)} has invalid dwell minutes: ${fmt(p.dwellMin)}`,
      );
    }
  }
  for (const o of trip.travelOverrides ?? []) {
    if (!isFiniteNumber(o.minutes) || o.minutes < 0) {
      throw new SolverInputError(
        `Travel override ${o.fromId ?? "?"} → ${o.toId ?? "?"} has invalid minutes: ${fmt(o.minutes)}`,
      );
    }
  }

  // A day's base/start/end must resolve to a real place — otherwise the
  // matrix's defensive "unknown node" fallback (0-minute travel) silently
  // overpacks the day and the itinerary looks confidently wrong. This is
  // reachable when a place a day still references gets deleted elsewhere.
  const placesById = new Map(trip.places.map((p) => [p.id, p]));
  const days = Array.isArray(trip.days) ? trip.days : [];
  days.forEach((day, i) => {
    const dayLabel = `Day ${i + 1}${day?.date ? ` (${day.date})` : ""}`;
    const checkNode = (nodeId: string | undefined, field: string): void => {
      if (nodeId === undefined) return;
      if (!placesById.has(nodeId)) {
        throw new SolverInputError(
          `${dayLabel} ${field} references a place that no longer exists (${nodeId}). ` +
            "Reassign the hotel for this day in the Stays panel.",
        );
      }
    };
    checkNode(day?.baseStartId, "start base");
    checkNode(day?.baseEndId, "end base");
    if (day?.startLocation !== "base") checkNode(day?.startLocation, "start location");
    if (day?.endLocation !== "base") checkNode(day?.endLocation, "end location");
  });
}

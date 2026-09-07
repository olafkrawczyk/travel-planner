import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatScore,
  INFEASIBLE_SCORE_THRESHOLD,
  shouldNotifyStaleOnEditorClose,
  staleEditToastMessage,
} from "./TripScreen";

// Pure-logic coverage for the stale-on-editor-close notice (P1 #3). No
// component-render harness in this repo — see PlaceEditor.test.ts.

describe("formatDuration", () => {
  it("converts raw large minute counts into human hours and mins", () => {
    expect(formatDuration(1119)).toBe("18h 39m");
  });

  it("handles 0 minutes gracefully", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  it("handles sub-hour durations", () => {
    expect(formatDuration(45)).toBe("45m");
  });

  it("handles exact hours without showing 0m", () => {
    expect(formatDuration(120)).toBe("2h");
  });

  it("handles negative or non-finite numbers safely", () => {
    expect(formatDuration(-15)).toBe("0m");
    expect(formatDuration(NaN)).toBe("0m");
    expect(formatDuration(Infinity)).toBe("0m");
  });
});

describe("formatScore", () => {
  it("hides normal feasible solver scores", () => {
    expect(formatScore(1338)).toBeNull();
    expect(formatScore(0)).toBeNull();
    expect(formatScore(999999)).toBeNull();
  });

  it("surfaces infeasible scores as human-readable message", () => {
    const res = formatScore(INFEASIBLE_SCORE_THRESHOLD);
    expect(res).not.toBeNull();
    expect(res?.text).toBe("some days can't fit their stops");
    expect(res?.title).toContain("includes a large penalty");
  });

  it("surfaces Infinity or NaN scores as infeasible warning", () => {
    expect(formatScore(Infinity)?.text).toBe("some days can't fit their stops");
    expect(formatScore(NaN)?.text).toBe("some days can't fit their stops");
  });
});

describe("shouldNotifyStaleOnEditorClose", () => {
  it("fires when the editor was open, is now closed, and something changed while it was open", () => {
    expect(shouldNotifyStaleOnEditorClose(true, false, 2, 5)).toBe(true);
  });

  it("does not fire on a no-op open/close (nothing changed)", () => {
    expect(shouldNotifyStaleOnEditorClose(true, false, 2, 2)).toBe(false);
  });

  it("does not fire while the editor is still open", () => {
    expect(shouldNotifyStaleOnEditorClose(true, true, 2, 5)).toBe(false);
  });

  it("does not fire when the editor was already closed (no close transition)", () => {
    expect(shouldNotifyStaleOnEditorClose(false, false, 2, 5)).toBe(false);
  });

  it("does not fire when opening (transition the other direction)", () => {
    expect(shouldNotifyStaleOnEditorClose(false, true, 2, 2)).toBe(false);
  });

  it("does not fire when pendingChanges went down (e.g. a regenerate ran mid-edit)", () => {
    expect(shouldNotifyStaleOnEditorClose(true, false, 5, 2)).toBe(false);
  });
});

describe("staleEditToastMessage", () => {
  it("pluralizes for more than one change", () => {
    expect(staleEditToastMessage(3)).toBe("Saved — the itinerary doesn't reflect 3 changes yet. Regenerate (Ctrl+Enter) to apply.");
  });

  it("uses singular phrasing for exactly one change", () => {
    expect(staleEditToastMessage(1)).toBe("Saved — the itinerary doesn't reflect 1 change yet. Regenerate (Ctrl+Enter) to apply.");
  });

  it("floors at one change even if called with zero or negative", () => {
    expect(staleEditToastMessage(0)).toContain("1 change");
    expect(staleEditToastMessage(-3)).toContain("1 change");
  });
});

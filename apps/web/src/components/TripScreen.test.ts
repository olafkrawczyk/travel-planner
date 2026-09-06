import { describe, expect, it } from "vitest";
import { shouldNotifyStaleOnEditorClose, staleEditToastMessage } from "./TripScreen";

// Pure-logic coverage for the stale-on-editor-close notice (P1 #3). No
// component-render harness in this repo — see PlaceEditor.test.ts.

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

import { describe, expect, it } from "vitest";
import { forcePreviewMessage, previewForceInsert, reasonBadge, unscheduledCopy } from "./UnscheduledTray";

// Pure-logic coverage for the unscheduled-tray copy/decision helpers (P0 #1,
// P0 #2). `apps/web/src/components/**` otherwise has no component test
// harness (no jsdom/testing-library in this repo) — see PlaceEditor.test.ts
// for the established pattern this follows.

describe("unscheduledCopy", () => {
  it("no_time: shows the solver's quantified explanation verbatim and suggests concrete fixes", () => {
    const copy = unscheduledCopy(
      "no_time",
      "Not enough time on any day — needs ~90 min (dwell 60 + travel), best day has 45 min free.",
    );
    expect(copy.why).toBe("Not enough time on any day — needs ~90 min (dwell 60 + travel), best day has 45 min free.");
    expect(copy.actions).toContain("Shorten its visit length");
    expect(copy.tentative).toBe(false);
  });

  it("unreachable: shows the no-route explanation and suggests fixing coordinates/overrides", () => {
    const copy = unscheduledCopy("unreachable", "No route — check the place's coordinates or add a travel override.");
    expect(copy.why).toBe("No route — check the place's coordinates or add a travel override.");
    expect(copy.actions).toContain("coordinates");
    expect(copy.tentative).toBe(false);
  });

  it("window_conflict: an appointment-specific explanation is treated as firm, not tentative", () => {
    const copy = unscheduledCopy(
      "window_conflict",
      "Appointment at 14:00 on day 2 cannot be reached — earliest feasible arrival is 15:10.",
    );
    expect(copy.why).toContain("Appointment at 14:00");
    expect(copy.tentative).toBe(false);
    expect(copy.actions).toContain("Move the appointment time");
  });

  it("window_conflict: an opening-window-specific explanation is treated as firm, not tentative", () => {
    const copy = unscheduledCopy(
      "window_conflict",
      "Opening window 09:00–17:00 on day 3 but earliest feasible arrival is 18:20.",
    );
    expect(copy.why).toContain("Opening window 09:00");
    expect(copy.tentative).toBe(false);
    expect(copy.actions).toContain("opening hours");
  });

  it("window_conflict: the generic 'no window fits' fallback is flagged tentative about specifics, not the category", () => {
    const copy = unscheduledCopy("window_conflict", "No opening window fits any day.");
    expect(copy.tentative).toBe(true);
    // The category is certain (a real per-day probe already confirmed it) —
    // only which specific day/window is unnamed. Must not cast doubt on the
    // category itself.
    expect(copy.why.toLowerCase()).not.toContain("may not be the real reason");
    expect(copy.why.toLowerCase()).toContain("couldn't pin down");
  });

  it("handles a place that no longer exists without inventing a reason", () => {
    const copy = unscheduledCopy("no_time", "This place is no longer part of the trip.");
    expect(copy.why).toBe("This place is no longer part of the trip.");
    expect(copy.actions).toBe("");
    expect(copy.tentative).toBe(false);
  });

  it("falls back to a plain, non-fabricated message when there's no explanation at all", () => {
    const copy = unscheduledCopy("no_time", undefined);
    expect(copy.why).toBe("This place could not be scheduled.");
    expect(copy.actions).toBe("");
  });
});

describe("reasonBadge", () => {
  it("labels no_time and unreachable as firm, danger-toned reasons", () => {
    expect(reasonBadge("no_time")).toEqual({ label: "no time", tone: "danger" });
    expect(reasonBadge("unreachable")).toEqual({ label: "no route", tone: "danger" });
  });

  // Every reason code is now backed by a real per-day feasibility probe
  // (see UnscheduledCopy.tentative's doc), so window_conflict is always a
  // firm, danger-toned "conflict" — no more "possible conflict" softening.
  it("labels window_conflict as a danger-toned 'conflict'", () => {
    expect(reasonBadge("window_conflict")).toEqual({ label: "conflict", tone: "danger" });
  });
});

describe("previewForceInsert", () => {
  it("computes remaining slack after dwell time alone (travel not counted)", () => {
    expect(previewForceInsert(60, 100)).toEqual({ slackBeforeMin: 100, slackAfterMin: 40, overBy: 0 });
  });

  it("reports a guaranteed overrun when dwell time alone exceeds the day's slack", () => {
    expect(previewForceInsert(90, 40)).toEqual({ slackBeforeMin: 40, slackAfterMin: -50, overBy: 50 });
  });

  it("treats an already-negative slack (a day already over budget) consistently", () => {
    expect(previewForceInsert(30, -10)).toEqual({ slackBeforeMin: -10, slackAfterMin: -40, overBy: 40 });
  });

  it("is a lower bound at the boundary: exact fit reports zero overrun", () => {
    expect(previewForceInsert(50, 50)).toEqual({ slackBeforeMin: 50, slackAfterMin: 0, overBy: 0 });
  });
});

describe("forcePreviewMessage", () => {
  it("names the day and the guaranteed overrun when dwell time alone doesn't fit", () => {
    const msg = forcePreviewMessage(3, { slackBeforeMin: 40, slackAfterMin: -50, overBy: 50 });
    expect(msg).toContain("Day 3");
    expect(msg).toContain("50 min");
    expect(msg.toLowerCase()).toContain("before travel");
  });

  it("names the day and the remaining margin when it should still fit", () => {
    const msg = forcePreviewMessage(1, { slackBeforeMin: 100, slackAfterMin: 40, overBy: 0 });
    expect(msg).toContain("Day 1");
    expect(msg).toContain("40 min");
  });
});

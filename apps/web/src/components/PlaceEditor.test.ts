import { describe, expect, it } from "vitest";
import type { Place, TimeWindow, WeeklyPattern } from "@app/domain";
import type { WeeklyProposal } from "@app/geo";
import { collectRegionOptions, isAutoRegionName } from "./PlaceEditor";
import {
  buildOpeningHoursFields,
  defaultWeeklyPattern,
  deriveOpeningHoursLocalState,
  type OpeningHoursLocalState,
} from "./OpeningHoursEditor";
import {
  diffOpeningHoursProposal,
  exceptionsToOverrides,
  proposalDiffIsEmpty,
} from "./OpeningHoursOsmReview";

// Pure-logic coverage for the region picker/legibility helpers added for
// task 4.3 (see PlaceEditor.tsx). `apps/web/src/components/**` otherwise has
// no component test harness (no jsdom/testing-library in this repo), so
// these two exported pure functions are what's reachable without inventing
// one — see the task brief's note on this.

describe("collectRegionOptions", () => {
  it("de-duplicates and sorts via localeCompare", () => {
    expect(collectRegionOptions(["Shinjuku", "Ginza", "Shinjuku", "Asakusa"])).toEqual([
      "Asakusa",
      "Ginza",
      "Shinjuku",
    ]);
  });

  it("filters out empty strings from the existing list", () => {
    expect(collectRegionOptions(["", "Ginza", ""])).toEqual(["Ginza"]);
  });

  it("folds `current` in when it isn't already present", () => {
    expect(collectRegionOptions(["Ginza"], "Shinjuku")).toEqual(["Ginza", "Shinjuku"]);
  });

  it("does not duplicate `current` when it's already in `existing`", () => {
    expect(collectRegionOptions(["Ginza", "Shinjuku"], "Shinjuku")).toEqual(["Ginza", "Shinjuku"]);
  });

  it("omits `current` entirely when undefined", () => {
    expect(collectRegionOptions(["Ginza", "Asakusa"])).toEqual(["Asakusa", "Ginza"]);
  });

  it("ignores an empty-string `current` (falsy, treated as 'no current')", () => {
    expect(collectRegionOptions(["Ginza"], "")).toEqual(["Ginza"]);
  });

  it("returns an empty array when there's nothing at all", () => {
    expect(collectRegionOptions([])).toEqual([]);
  });
});

describe("isAutoRegionName", () => {
  it("matches the exact auto-cluster naming convention", () => {
    expect(isAutoRegionName("District 1")).toBe(true);
    expect(isAutoRegionName("District 12")).toBe(true);
  });

  it("does not match a bare 'District' with no number", () => {
    expect(isAutoRegionName("District")).toBe(false);
  });

  it("does not match a trailing non-digit suffix", () => {
    expect(isAutoRegionName("District 1a")).toBe(false);
  });

  it("is case-sensitive — lowercase 'district' does not match", () => {
    expect(isAutoRegionName("district 1")).toBe(false);
  });

  it("does not match when 'District N' is only part of the name", () => {
    expect(isAutoRegionName("My District 3")).toBe(false);
  });

  it("does not match an empty string", () => {
    expect(isAutoRegionName("")).toBe(false);
  });
});

// Pure-logic coverage for the opening-hours redesign's editor-state helpers
// (tasks 3.1/3.3/3.8) — same rationale as above, exercised directly since
// there's no component-render harness. `makePlace` fills in only the fields
// `Place` requires; every test sets exactly the opening-hours fields it
// cares about.

function makePlace(overrides: Partial<Place> = {}): Place {
  return {
    id: "p1",
    name: "Test place",
    lat: 35.0,
    lng: 139.0,
    category: "museum",
    dwellMin: 60,
    priority: 2,
    ...overrides,
  };
}

const OPEN_ALL_WEEK: WeeklyPattern = defaultWeeklyPattern();

const OPEN_WEEKDAYS_CLOSED_WEEKENDS: WeeklyPattern = {
  mon: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
  tue: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
  wed: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
  thu: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
  fri: { kind: "open", windows: [{ start: "09:00", end: "17:00" }] },
  sat: { kind: "closed" },
  sun: { kind: "closed" },
};

describe("deriveOpeningHoursLocalState", () => {
  it("is 'unknown' for a brand-new place (undefined)", () => {
    expect(deriveOpeningHoursLocalState(undefined)).toEqual({
      mode: "unknown",
      weekly: undefined,
      closedDates: [],
      openingHours: {},
    });
  });

  it("is 'unknown' for an existing place with no opening-hours fields set", () => {
    const state = deriveOpeningHoursLocalState(makePlace());
    expect(state.mode).toBe("unknown");
    expect(state.weekly).toBeUndefined();
    expect(state.closedDates).toEqual([]);
    expect(state.openingHours).toEqual({});
  });

  it("is 'always_open' when openingHoursAlwaysOpen is set", () => {
    const state = deriveOpeningHoursLocalState(makePlace({ openingHoursAlwaysOpen: true }));
    expect(state.mode).toBe("always_open");
  });

  it("is 'has_hours' and seeds the weekly pattern when openingHoursWeekly is set", () => {
    const state = deriveOpeningHoursLocalState(
      makePlace({ openingHoursWeekly: OPEN_WEEKDAYS_CLOSED_WEEKENDS }),
    );
    expect(state.mode).toBe("has_hours");
    expect(state.weekly).toEqual(OPEN_WEEKDAYS_CLOSED_WEEKENDS);
    expect(state.closedDates).toEqual([]);
    expect(state.openingHours).toEqual({});
  });

  it("is 'has_hours' and seeds closedDates/openingHours from legacy-shaped data with no weekly pattern", () => {
    const legacyWindows: Record<string, TimeWindow[]> = {
      "2026-04-04": [{ start: "10:00", end: "16:00" }],
    };
    const state = deriveOpeningHoursLocalState(
      makePlace({ openingHours: legacyWindows, openingHoursClosedDates: ["2026-04-03"] }),
    );
    expect(state.mode).toBe("has_hours");
    expect(state.weekly).toBeUndefined();
    expect(state.closedDates).toEqual(["2026-04-03"]);
    expect(state.openingHours).toEqual(legacyWindows);
  });
});

describe("buildOpeningHoursFields", () => {
  it("returns no fields for 'unknown'", () => {
    const fields = buildOpeningHoursFields({
      mode: "unknown",
      weekly: OPEN_ALL_WEEK,
      closedDates: ["2026-04-03"],
      openingHours: { "2026-04-04": [{ start: "10:00", end: "16:00" }] },
    });
    expect(fields).toEqual({});
  });

  it("returns only openingHoursAlwaysOpen for 'always_open', clearing the rest", () => {
    const fields = buildOpeningHoursFields({
      mode: "always_open",
      weekly: OPEN_ALL_WEEK,
      closedDates: ["2026-04-03"],
      openingHours: {},
    });
    expect(fields).toEqual({ openingHoursAlwaysOpen: true });
  });

  it("returns weekly-only fields for 'has_hours' with no exceptions", () => {
    const fields = buildOpeningHoursFields({
      mode: "has_hours",
      weekly: OPEN_WEEKDAYS_CLOSED_WEEKENDS,
      closedDates: [],
      openingHours: {},
    });
    expect(fields).toEqual({
      openingHoursWeekly: OPEN_WEEKDAYS_CLOSED_WEEKENDS,
      openingHoursClosedDates: undefined,
      openingHours: undefined,
    });
  });

  it("returns weekly + exceptions fields for 'has_hours' with exceptions, and never openingHoursAlwaysOpen", () => {
    const openingHours = { "2026-04-04": [{ start: "10:00", end: "16:00" }] };
    const fields = buildOpeningHoursFields({
      mode: "has_hours",
      weekly: OPEN_WEEKDAYS_CLOSED_WEEKENDS,
      closedDates: ["2026-04-03"],
      openingHours,
    });
    expect(fields).toEqual({
      openingHoursWeekly: OPEN_WEEKDAYS_CLOSED_WEEKENDS,
      openingHoursClosedDates: ["2026-04-03"],
      openingHours,
    });
    expect(fields.openingHoursAlwaysOpen).toBeUndefined();
  });
});

describe("deriveOpeningHoursLocalState / buildOpeningHoursFields round-trip", () => {
  function roundTrip(place: Place): OpeningHoursLocalState {
    const state1 = deriveOpeningHoursLocalState(place);
    const fields = buildOpeningHoursFields(state1);
    const rebuilt: Place = {
      ...place,
      openingHoursWeekly: fields.openingHoursWeekly,
      openingHoursClosedDates: fields.openingHoursClosedDates,
      openingHours: fields.openingHours,
      openingHoursAlwaysOpen: fields.openingHoursAlwaysOpen,
    };
    return deriveOpeningHoursLocalState(rebuilt);
  }

  it("is idempotent for an 'unknown' place", () => {
    const place = makePlace();
    const state1 = deriveOpeningHoursLocalState(place);
    expect(roundTrip(place)).toEqual(state1);
  });

  it("is idempotent for an 'always_open' place", () => {
    const place = makePlace({ openingHoursAlwaysOpen: true });
    const state1 = deriveOpeningHoursLocalState(place);
    expect(roundTrip(place)).toEqual(state1);
  });

  it("is idempotent for a 'has_hours' place with a weekly pattern only", () => {
    const place = makePlace({ openingHoursWeekly: OPEN_WEEKDAYS_CLOSED_WEEKENDS });
    const state1 = deriveOpeningHoursLocalState(place);
    expect(roundTrip(place)).toEqual(state1);
  });

  it("is idempotent for a 'has_hours' place with a weekly pattern plus exceptions", () => {
    const place = makePlace({
      openingHoursWeekly: OPEN_WEEKDAYS_CLOSED_WEEKENDS,
      openingHoursClosedDates: ["2026-04-03"],
      openingHours: { "2026-04-04": [{ start: "12:00", end: "15:00" }] },
    });
    const state1 = deriveOpeningHoursLocalState(place);
    expect(roundTrip(place)).toEqual(state1);
  });
});

describe("diffOpeningHoursProposal", () => {
  it("flags every weekday as changed when there is no current weekly pattern at all", () => {
    const proposal: WeeklyProposal = { weekly: OPEN_WEEKDAYS_CLOSED_WEEKENDS, exceptions: {} };
    const diff = diffOpeningHoursProposal(proposal, {
      weekly: undefined,
      closedDates: [],
      openingHours: {},
    });
    expect(diff.changedWeekdays).toHaveLength(7);
  });

  it("reports no changes when the proposal exactly matches the current state", () => {
    const proposal: WeeklyProposal = {
      weekly: OPEN_WEEKDAYS_CLOSED_WEEKENDS,
      exceptions: { "2026-04-03": "closed" },
    };
    const diff = diffOpeningHoursProposal(proposal, {
      weekly: OPEN_WEEKDAYS_CLOSED_WEEKENDS,
      closedDates: ["2026-04-03"],
      openingHours: {},
    });
    expect(proposalDiffIsEmpty(diff)).toBe(true);
  });

  it("reports a changed weekday when only that weekday's pattern differs", () => {
    const proposal: WeeklyProposal = {
      weekly: { ...OPEN_WEEKDAYS_CLOSED_WEEKENDS, sat: { kind: "open", windows: [{ start: "10:00", end: "14:00" }] } },
      exceptions: {},
    };
    const diff = diffOpeningHoursProposal(proposal, {
      weekly: OPEN_WEEKDAYS_CLOSED_WEEKENDS,
      closedDates: [],
      openingHours: {},
    });
    expect(diff.changedWeekdays).toHaveLength(1);
    expect(diff.changedWeekdays[0]!.weekday).toBe("sat");
  });

  it("reports added, removed and changed exceptions separately", () => {
    const proposal: WeeklyProposal = {
      weekly: OPEN_WEEKDAYS_CLOSED_WEEKENDS,
      exceptions: {
        "2026-04-05": "closed", // new
        "2026-04-06": [{ start: "11:00", end: "13:00" }], // changed value
      },
    };
    const diff = diffOpeningHoursProposal(proposal, {
      weekly: OPEN_WEEKDAYS_CLOSED_WEEKENDS,
      closedDates: ["2026-04-07"], // present now, absent from proposal -> removed
      openingHours: { "2026-04-06": [{ start: "09:00", end: "17:00" }] },
    });
    expect(diff.addedExceptions).toEqual(["2026-04-05"]);
    expect(diff.removedExceptions).toEqual(["2026-04-07"]);
    expect(diff.changedExceptions).toEqual([
      { date: "2026-04-06", from: [{ start: "09:00", end: "17:00" }], to: [{ start: "11:00", end: "13:00" }] },
    ]);
  });
});

describe("exceptionsToOverrides", () => {
  it("splits a mixed exceptions map into closedDates and openingHours", () => {
    const result = exceptionsToOverrides({
      "2026-04-03": "closed",
      "2026-04-04": [{ start: "10:00", end: "16:00" }],
    });
    expect(result.closedDates).toEqual(["2026-04-03"]);
    expect(result.openingHours).toEqual({ "2026-04-04": [{ start: "10:00", end: "16:00" }] });
  });

  it("returns empty collections for an empty exceptions map", () => {
    expect(exceptionsToOverrides({})).toEqual({ closedDates: [], openingHours: {} });
  });
});

describe("proposalDiffIsEmpty", () => {
  it("is true when every diff bucket is empty", () => {
    expect(
      proposalDiffIsEmpty({
        changedWeekdays: [],
        addedExceptions: [],
        removedExceptions: [],
        changedExceptions: [],
      }),
    ).toBe(true);
  });

  it("is false when any diff bucket is non-empty", () => {
    expect(
      proposalDiffIsEmpty({
        changedWeekdays: [{ weekday: "mon", from: undefined, to: { kind: "closed" } }],
        addedExceptions: [],
        removedExceptions: [],
        changedExceptions: [],
      }),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { deriveWeeklyProposal, expandOpeningHours } from "./openingHours";

/** Local-time date helper (the parser works in machine-local time). */
function localDate(y: number, m: number, d: number, hh = 0, mm = 0): Date {
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

describe("expandOpeningHours", () => {
  it("expands weekday ranges into per-date windows (2026-04-01 is a Wednesday)", () => {
    const windows = expandOpeningHours("Mo-Fr 09:00-17:00; Sa 10:00-14:00", [
      "2026-04-01", // Wed
      "2026-04-02", // Thu
      "2026-04-03", // Fri
      "2026-04-04", // Sat
      "2026-04-05", // Sun
    ]);
    expect(windows).not.toBeNull();
    expect(windows!["2026-04-01"]).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(windows!["2026-04-02"]).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(windows!["2026-04-03"]).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(windows!["2026-04-04"]).toEqual([{ start: "10:00", end: "14:00" }]);
    expect(windows!["2026-04-05"]).toBeUndefined(); // Sunday closed
  });

  it("treats 24/7 as always open (null)", () => {
    expect(expandOpeningHours("24/7", ["2026-04-01", "2026-04-02"])).toBeNull();
  });

  it("expands multi-interval days and keeps both windows", () => {
    const windows = expandOpeningHours("Mo-Fr 08:00-12:00,13:00-18:00", ["2026-04-06"]); // Mon
    expect(windows).toEqual({
      "2026-04-06": [
        { start: "08:00", end: "12:00" },
        { start: "13:00", end: "18:00" },
      ],
    });
  });

  it("splits overnight windows across the two dates and clips to day bounds", () => {
    const windows = expandOpeningHours("Mo 18:00-02:00", ["2026-03-30", "2026-03-31"]); // Mon, Tue
    expect(windows).toEqual({
      "2026-03-30": [{ start: "18:00", end: "23:59" }],
      "2026-03-31": [{ start: "00:00", end: "02:00" }],
    });
  });

  it("merges overlapping/adjacent intervals per date", () => {
    const windows = expandOpeningHours("Mo 09:00-12:00, 11:30-14:00", ["2026-04-06"]); // Mon
    expect(windows).toEqual({ "2026-04-06": [{ start: "09:00", end: "14:00" }] });
  });

  it("returns an empty record when the place is closed on every trip date", () => {
    expect(expandOpeningHours("Jan 10:00-12:00", ["2026-04-01", "2026-04-02"])).toEqual({});
  });

  it("treats unparseable input as unusable (null)", () => {
    expect(expandOpeningHours("sdf @@@ ###", ["2026-04-01"])).toBeNull();
    expect(expandOpeningHours("", ["2026-04-01"])).toBeNull();
  });

  it("treats location-dependent selectors as unusable for the MVP (null)", () => {
    expect(expandOpeningHours("sunrise-sunset", ["2026-04-01"])).toBeNull();
  });

  it("treats public-holiday selectors without country context as unusable (null)", () => {
    expect(expandOpeningHours("Mo-Fr 09:00-17:00; PH off", ["2026-04-01"])).toBeNull();
  });

  it("uses local date arithmetic (window bounds map back to local HH:mm)", () => {
    const windows = expandOpeningHours("Tu-Su 09:30-17:30; Th 09:30-20:00", [
      "2026-04-02", // Thu
      "2026-04-03", // Fri
    ]);
    expect(windows).toEqual({
      "2026-04-02": [{ start: "09:30", end: "20:00" }],
      "2026-04-03": [{ start: "09:30", end: "17:30" }],
    });
    // Sanity: local dates round-trip through the helper.
    expect(localDate(2026, 4, 2, 9, 30).getDate()).toBe(2);
  });
});

describe("deriveWeeklyProposal", () => {
  it("returns null when the expansion is null (no tag / unparseable / 24-7)", () => {
    expect(deriveWeeklyProposal(null, ["2026-04-06"])).toBeNull();
  });

  it("derives a consistent weekly pattern across a two-week trip, using expandOpeningHours for the input (Mondays closed, rest open 09:00-17:00)", () => {
    // 2026-04-06 is a Monday; this spans two full weeks through 2026-04-19 (Sunday).
    const dates: string[] = [];
    for (let d = 6; d <= 19; d++) dates.push(`2026-04-${String(d).padStart(2, "0")}`);

    const expansion = expandOpeningHours("Tu-Su 09:00-17:00", dates);
    const proposal = deriveWeeklyProposal(expansion, dates);

    expect(proposal).not.toBeNull();
    expect(proposal!.exceptions).toEqual({});
    expect(proposal!.weekly.mon).toEqual({ kind: "closed" });
    for (const wd of ["tue", "wed", "thu", "fri", "sat", "sun"] as const) {
      expect(proposal!.weekly[wd]).toEqual({
        kind: "open",
        windows: [{ start: "09:00", end: "17:00" }],
      });
    }
  });

  it("flags a single-date holiday exception while the weekly pattern reflects the majority", () => {
    // Three Tuesdays: two open 09:00-17:00, one (a holiday) closed.
    const dates = ["2026-04-07", "2026-04-14", "2026-04-21"];
    const expansion = {
      "2026-04-07": [{ start: "09:00", end: "17:00" }],
      "2026-04-21": [{ start: "09:00", end: "17:00" }],
      // "2026-04-14" absent → closed that date.
    };

    const proposal = deriveWeeklyProposal(expansion, dates);

    expect(proposal).not.toBeNull();
    expect(proposal!.weekly.tue).toEqual({
      kind: "open",
      windows: [{ start: "09:00", end: "17:00" }],
    });
    expect(proposal!.exceptions).toEqual({ "2026-04-14": "closed" });
  });

  it("derives a closed weekday when every date on that weekday is absent from the expansion", () => {
    // Both dates are Wednesdays; expandOpeningHours with a January-only rule
    // over April dates parses fine but is closed on every given date.
    const dates = ["2026-04-01", "2026-04-08"];
    const expansion = expandOpeningHours("Jan 10:00-12:00", dates);

    const proposal = deriveWeeklyProposal(expansion, dates);

    expect(proposal).not.toBeNull();
    expect(proposal!.weekly.wed).toEqual({ kind: "closed" });
    expect(proposal!.exceptions).toEqual({});
  });

  it("defaults weekdays absent from the trip's dates to closed", () => {
    // A 3-day trip covering only Mon/Tue/Wed.
    const dates = ["2026-04-06", "2026-04-07", "2026-04-08"];
    const expansion = {
      "2026-04-06": [{ start: "09:00", end: "17:00" }],
      "2026-04-07": [{ start: "09:00", end: "17:00" }],
      "2026-04-08": [{ start: "09:00", end: "17:00" }],
    };

    const proposal = deriveWeeklyProposal(expansion, dates);

    expect(proposal).not.toBeNull();
    for (const wd of ["thu", "fri", "sat", "sun"] as const) {
      expect(proposal!.weekly[wd]).toEqual({ kind: "closed" });
    }
    expect(proposal!.exceptions).toEqual({});
  });
});

import { describe, expect, it } from "vitest";
import { describeShareOpenError } from "./App";
import { ShareError } from "./share";

// Pure-logic coverage for the shared-trip-open error copy (P2 #6) — no
// component-render harness in this repo, see PlaceEditor.test.ts.

describe("describeShareOpenError", () => {
  it("maps each typed ShareError code to a plain-language, non-technical cause", () => {
    expect(describeShareOpenError(new ShareError("unsupported", "x"))).toBe(
      "Could not open shared trip: This browser can't open shared trip links.",
    );
    expect(describeShareOpenError(new ShareError("malformed", "x"))).toBe(
      "Could not open shared trip: This share link is incomplete or corrupted.",
    );
    expect(describeShareOpenError(new ShareError("inflate", "x"))).toBe(
      "Could not open shared trip: This share link's data is corrupted.",
    );
    expect(describeShareOpenError(new ShareError("not-json", "x"))).toBe(
      "Could not open shared trip: This share link doesn't contain valid trip data.",
    );
    expect(describeShareOpenError(new ShareError("oversize", "x"))).toBe(
      "Could not open shared trip: This share link looks corrupted (unexpectedly large).",
    );
    expect(describeShareOpenError(new ShareError("encode", "x"))).toBe(
      "Could not open shared trip: Something went wrong while opening this link.",
    );
  });

  it("never leaks a raw exception message for a typed ShareError", () => {
    const raw = "some internal stack trace detail";
    const msg = describeShareOpenError(new ShareError("malformed", raw));
    expect(msg).not.toContain(raw);
  });

  it("falls back to an honest generic message for an untyped error (e.g. schema validation downstream of decode)", () => {
    expect(describeShareOpenError(new Error("Zod validation failed: place[3].lat"))).toBe(
      "Could not open shared trip — the link may be corrupted or out of date.",
    );
  });

  it("handles a non-Error throw without crashing", () => {
    expect(describeShareOpenError("plain string throw")).toBe(
      "Could not open shared trip — the link may be corrupted or out of date.",
    );
  });
});

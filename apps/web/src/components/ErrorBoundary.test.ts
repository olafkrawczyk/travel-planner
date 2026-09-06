import { describe, expect, it } from "vitest";
import type { ErrorInfo } from "react";
import { formatCrashReport } from "./ErrorBoundary";

// Pure-logic coverage for the error-boundary fallback (release audit
// BLOCKER #2). `apps/web/src/components/**` has no component-render harness
// (no jsdom/testing-library in this repo) — see PlaceEditor.test.ts for the
// established pattern this follows: test the decision logic behind the
// component directly rather than rendering it.

describe("formatCrashReport", () => {
  it("includes the error message and the component stack when both are available", () => {
    const error = new Error("place.lat is undefined");
    const errorInfo: ErrorInfo = { componentStack: "\n    at MapView\n    at TripScreen" };
    const report = formatCrashReport(error, errorInfo);
    expect(report).toContain("place.lat is undefined");
    expect(report).toContain("Component stack:");
    expect(report).toContain("at MapView");
    expect(report).toContain("at TripScreen");
  });

  it("falls back to String(error) when the Error has no message", () => {
    const error = new Error("");
    const report = formatCrashReport(error, null);
    expect(report).toBe(String(error)); // "Error" — never an empty primary line
  });

  it("omits the component-stack section entirely when errorInfo is null (caught before commit info exists)", () => {
    const error = new Error("boom");
    const report = formatCrashReport(error, null);
    expect(report).toBe("boom");
    expect(report).not.toContain("Component stack");
  });

  it("omits the component-stack section when componentStack is blank/whitespace-only", () => {
    const error = new Error("boom");
    const report = formatCrashReport(error, { componentStack: "   " });
    expect(report).toBe("boom");
    expect(report).not.toContain("Component stack");
  });
});

import { describe, expect, it } from "vitest";
import {
  ERROR_TOAST_THROTTLE_MS,
  errorDedupKey,
  formatGlobalErrorToast,
  shouldSurfaceError,
  type CaughtError,
} from "./globalErrorHandler";

// Pure-logic coverage for the global error handler (async errors that escape
// React's error boundaries — see ErrorBoundary.tsx's "Known gap" doc
// comment). `registerGlobalErrorHandlers` itself is thin `window` listener
// glue and has no component-render harness to exercise it in (see
// PlaceEditor.test.ts for the established pattern: test the decision logic
// behind the wiring, not the wiring itself).

describe("formatGlobalErrorToast", () => {
  it("labels a window error and includes the word 'error' so classifyToast (store.ts) treats it as persisting", () => {
    const msg = formatGlobalErrorToast({ source: "window error", message: "place.lat is undefined" });
    expect(msg).toContain("place.lat is undefined");
    expect(msg.toLowerCase()).toContain("error");
    expect(msg.toLowerCase()).toContain("unexpected error");
  });

  it("labels an unhandled rejection distinctly from a plain window error", () => {
    const msg = formatGlobalErrorToast({ source: "unhandled rejection", message: "fetch failed" });
    expect(msg.toLowerCase()).toContain("unhandled promise rejection");
    expect(msg).toContain("fetch failed");
  });

  it("never shows an empty message — falls back to a plain phrase", () => {
    const msg = formatGlobalErrorToast({ source: "window error", message: "   " });
    expect(msg).toContain("no further details");
  });
});

describe("errorDedupKey", () => {
  it("is identical for the same source + message", () => {
    const a: CaughtError = { source: "window error", message: "boom" };
    const b: CaughtError = { source: "window error", message: "boom" };
    expect(errorDedupKey(a)).toBe(errorDedupKey(b));
  });

  it("differs when the source differs, even with the same message", () => {
    const a: CaughtError = { source: "window error", message: "boom" };
    const b: CaughtError = { source: "unhandled rejection", message: "boom" };
    expect(errorDedupKey(a)).not.toBe(errorDedupKey(b));
  });

  it("differs when the message differs", () => {
    const a: CaughtError = { source: "window error", message: "boom" };
    const b: CaughtError = { source: "window error", message: "bang" };
    expect(errorDedupKey(a)).not.toBe(errorDedupKey(b));
  });
});

describe("shouldSurfaceError", () => {
  const err: CaughtError = { source: "window error", message: "boom" };

  it("surfaces the first occurrence of a never-seen error", () => {
    const { surface, next } = shouldSurfaceError(err, new Map(), 1_000);
    expect(surface).toBe(true);
    expect(next.get(errorDedupKey(err))).toBe(1_000);
  });

  it("does not surface a repeat within the throttle window", () => {
    const seen = new Map([[errorDedupKey(err), 1_000]]);
    const { surface, next } = shouldSurfaceError(err, seen, 1_000 + ERROR_TOAST_THROTTLE_MS - 1);
    expect(surface).toBe(false);
    // The suppressed occurrence must not reset the window's start.
    expect(next.get(errorDedupKey(err))).toBe(1_000);
  });

  it("surfaces again once the throttle window has fully elapsed", () => {
    const seen = new Map([[errorDedupKey(err), 1_000]]);
    const now = 1_000 + ERROR_TOAST_THROTTLE_MS;
    const { surface, next } = shouldSurfaceError(err, seen, now);
    expect(surface).toBe(true);
    expect(next.get(errorDedupKey(err))).toBe(now);
  });

  it("a burst of repeats (a retry loop / a per-frame handler) collapses to exactly one surfaced occurrence", () => {
    let seen = new Map<string, number>();
    let surfacedCount = 0;
    for (let i = 0; i < 50; i++) {
      const now = 1_000 + i * 10; // 50 occurrences, 10ms apart — well inside the throttle window.
      const result = shouldSurfaceError(err, seen, now);
      seen = result.next;
      if (result.surface) surfacedCount++;
    }
    expect(surfacedCount).toBe(1);
  });

  it("tracks distinct errors independently — a different error is never throttled by an unrelated one", () => {
    const other: CaughtError = { source: "unhandled rejection", message: "different failure" };
    const seen = new Map([[errorDedupKey(err), 1_000]]);
    const { surface } = shouldSurfaceError(other, seen, 1_001);
    expect(surface).toBe(true);
  });

  it("respects a custom throttle window", () => {
    const seen = new Map([[errorDedupKey(err), 1_000]]);
    expect(shouldSurfaceError(err, seen, 1_500, 1_000).surface).toBe(false);
    expect(shouldSurfaceError(err, seen, 2_001, 1_000).surface).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";

describe("debounced input semantics (task 2.2)", () => {
  it("buffers intermediate keystrokes and fires onCommit once after pause", async () => {
    vi.useFakeTimers();
    try {
      const onCommit = vi.fn();
      let draft = "09:00";
      let timer: ReturnType<typeof setTimeout> | undefined;

      function simulateType(next: string, debounceMs = 400) {
        draft = next;
        clearTimeout(timer);
        timer = setTimeout(() => {
          onCommit(draft);
        }, debounceMs);
      }

      simulateType("0");
      simulateType("09");
      simulateType("09:");
      simulateType("09:3");
      simulateType("09:30");

      expect(onCommit).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(399);
      expect(onCommit).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith("09:30");
    } finally {
      vi.useRealTimers();
    }
  });
});

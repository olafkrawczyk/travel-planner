import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as Comlink from "comlink";
import type { Itinerary } from "@app/domain";

/**
 * `solverClient.ts` does `new Worker(...)` and registers a global Comlink
 * transfer handler at MODULE LOAD time, so it can't be statically imported
 * in a node test environment (no real `Worker` global) without first
 * stubbing one. We stand up a fake worker endpoint using a real
 * `MessageChannel` (Node has one natively) wired to a small fixture that
 * mirrors `solver.worker.ts`'s actual, relevant behavior — calling `onDone`
 * WITHOUT awaiting it, then returning — since that's the exact shape the
 * onDone-vs-settlement race depends on. `solver.worker.ts` itself is out of
 * scope and is not imported or modified here.
 */
let solverClientModule: typeof import("./solverClient");
let closeSpy: ReturnType<typeof vi.spyOn>;
/** Hoisted so the crash-handling tests below can dispatch "error"/
 *  "messageerror" events directly onto the same port solverClient.ts holds
 *  as its `worker`. */
let mainSidePort: MessagePort;

const sampleItinerary: Itinerary = {
  days: [],
  unscheduled: [],
  stats: { totalTravelMin: 0, totalWaitMin: 0, score: 0 },
};

beforeAll(async () => {
  const { port1, port2: workerSidePort } = new MessageChannel();
  mainSidePort = port1;
  mainSidePort.start();
  workerSidePort.start();

  class FakeWorker {
    constructor() {
      // `new Worker(url, opts)` in solverClient.ts — args are irrelevant to
      // the fake; returning an object from a constructor replaces `this`.
      return mainSidePort as unknown as FakeWorker;
    }
  }
  vi.stubGlobal("Worker", FakeWorker);

  // Fixture worker-side API — mirrors solver.worker.ts's `solve`, notably
  // its "fire onDone, don't await it, then return" shape.
  const fakeApi = {
    setLogging() {},
    solve(
      _trip: unknown,
      _req: unknown,
      onProgress?: (it: Itinerary) => void,
      onDone?: (it: Itinerary) => void,
    ) {
      onProgress?.(sampleItinerary);
      onDone?.(sampleItinerary);
      return sampleItinerary;
    },
  };
  Comlink.expose(fakeApi, workerSidePort);

  closeSpy = vi.spyOn(MessagePort.prototype, "close");

  solverClientModule = await import("./solverClient");
});

afterEach(() => {
  closeSpy.mockClear();
});

afterAll(() => {
  vi.unstubAllGlobals();
  closeSpy.mockRestore();
});

describe("solverClient.solve (real Comlink round trip via a fake worker)", () => {
  it("still resolves with the worker's result and delivers onProgress/onDone", async () => {
    const progressCalls: Itinerary[] = [];
    let doneItinerary: Itinerary | undefined;
    const result = await solverClientModule.solverClient.solve(
      {} as never,
      {},
      (it) => progressCalls.push(it),
      (it) => {
        doneItinerary = it;
      },
    );
    expect(result).toEqual(sampleItinerary);
    expect(progressCalls).toEqual([sampleItinerary]);
    expect(doneItinerary).toEqual(sampleItinerary);

    // Both callback proxy ports are released once onDone has genuinely run —
    // not asserting exact timing here (that's the unit tests below), just
    // that the real end-to-end path still cleans up rather than leaking.
    await vi.waitFor(() => {
      expect(closeSpy).toHaveBeenCalled();
    });
  });
});

describe("release-sequencing bookkeeping (the actual fix)", () => {
  // NOTE on scope: the real bug is a race between two independent
  // MessagePorts (the callback's own channel vs. the main SolveApi
  // channel), whose relative delivery order is governed by the JS engine's
  // task-queue implementation, not by anything a unit test can force
  // deterministically — Node and browsers don't expose a hook to reorder
  // already-posted MessagePort messages. So this does NOT attempt to
  // reproduce the cross-port race with real ports (the round-trip test
  // above shows the happy path still works, for what that's worth, but
  // proves nothing about the race). Instead, this exercises the actual
  // production `scheduleRelease`/`instrumentDone`/`freshCallback` functions
  // (via the module's `__testing` export) directly against controllable
  // fake promises/timers, which IS fully deterministic: it proves the
  // sequencing algorithm itself — release waits for the later of (outer
  // settled, onDone fired), with a bounded fallback — independent of real
  // port scheduling.

  function fakePort() {
    return { close: vi.fn() } as unknown as MessagePort;
  }

  it("does not release before onDone has fired, even once the outer call has settled", async () => {
    const { scheduleRelease, portsByCallbackProxy } = solverClientModule.__testing;
    const progressKey = (() => {}) as (it: Itinerary) => void;
    const doneKey = (() => {}) as (it: Itinerary) => void;
    const progressPort = fakePort();
    const donePort = fakePort();
    portsByCallbackProxy.set(progressKey, progressPort);
    portsByCallbackProxy.set(doneKey, donePort);

    let resolveOuter!: (v: unknown) => void;
    const outer = new Promise((resolve) => {
      resolveOuter = resolve;
    });
    let resolveDoneFired!: () => void;
    const doneFired = new Promise<void>((resolve) => {
      resolveDoneFired = resolve;
    });

    const releaseDone = scheduleRelease(outer, doneFired, progressKey, doneKey);

    resolveOuter(sampleItinerary);
    // Let the outer-settlement microtasks flush without onDone ever firing.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(donePort.close).not.toHaveBeenCalled();
    expect(progressPort.close).not.toHaveBeenCalled();

    resolveDoneFired();
    await releaseDone;
    expect(donePort.close).toHaveBeenCalledTimes(1);
    expect(progressPort.close).toHaveBeenCalledTimes(1);
  });

  it("falls back to releasing after RELEASE_FALLBACK_MS when the call rejects and onDone can never fire", async () => {
    vi.useFakeTimers();
    try {
      const { scheduleRelease, portsByCallbackProxy, RELEASE_FALLBACK_MS } = solverClientModule.__testing;
      const doneKey = (() => {}) as (it: Itinerary) => void;
      const donePort = fakePort();
      portsByCallbackProxy.set(doneKey, donePort);

      const outer = Promise.reject(new Error("worker blew up"));
      const doneFired = new Promise<void>(() => {}); // onDone genuinely never fires

      const releaseDone = scheduleRelease(outer, doneFired, undefined, doneKey);
      let released = false;
      void releaseDone.then(() => {
        released = true;
      });

      await vi.advanceTimersByTimeAsync(RELEASE_FALLBACK_MS - 1);
      expect(released).toBe(false);
      expect(donePort.close).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await releaseDone;
      expect(donePort.close).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases as soon as the call settles when no onDone was supplied at all", async () => {
    const { scheduleRelease, instrumentDone, portsByCallbackProxy } = solverClientModule.__testing;
    const progressKey = (() => {}) as (it: Itinerary) => void;
    const progressPort = fakePort();
    portsByCallbackProxy.set(progressKey, progressPort);

    const { fired: doneFired } = instrumentDone(undefined);
    await scheduleRelease(Promise.resolve(sampleItinerary), doneFired, progressKey, undefined);
    expect(progressPort.close).toHaveBeenCalledTimes(1);
  });

  it("instrumentDone's `fired` promise resolves only after the wrapped onDone actually runs, even if it throws", async () => {
    const { instrumentDone } = solverClientModule.__testing;
    const calls: Itinerary[] = [];
    const { proxied, fired } = instrumentDone((it) => {
      calls.push(it);
      throw new Error("caller's onDone blew up");
    });
    expect(proxied).toBeDefined();
    expect(() => proxied!(sampleItinerary)).toThrow("caller's onDone blew up");
    expect(calls).toEqual([sampleItinerary]);
    await expect(fired).resolves.toBeUndefined();
  });
});

describe("worker crash handling (onerror / onmessageerror) — item 5", () => {
  // Without the `onerror`/`onmessageerror` wiring, a worker that dies outright
  // (uncaught exception in worker global scope, OOM, ...) never causes the
  // outstanding remote.solve()/remote.resolve() promise to settle — the
  // worker's reply just never arrives. That's a real end-to-end shape
  // (unlike the release-sequencing race below, which needs fake ports to be
  // deterministic): dispatching a genuine "error"/"messageerror" `Event` on
  // the same port solverClient.ts holds as `worker` and asserting the
  // in-flight call's promise actually rejects proves the wiring is live, not
  // just that the underlying helper functions are individually correct.

  it("rejects an in-flight solve() call when the worker fires an 'error' event, instead of hanging forever", async () => {
    const pending = solverClientModule.solverClient.solve({} as never, {});
    mainSidePort.dispatchEvent(new Event("error"));
    await expect(pending).rejects.toThrow(/worker/i);
  });

  it("rejects an in-flight resolve() call when the worker fires a 'messageerror' event", async () => {
    const pending = solverClientModule.solverClient.resolve(
      {} as never,
      sampleItinerary,
      { type: "full" } as never,
      {},
    );
    mainSidePort.dispatchEvent(new Event("messageerror"));
    await expect(pending).rejects.toThrow();
  });

  it("failPendingCalls rejects every currently in-flight call and clears pendingRejects (deterministic unit check)", () => {
    const { failPendingCalls, pendingRejects } = solverClientModule.__testing;
    pendingRejects.clear();
    const seen: unknown[] = [];
    pendingRejects.add((e) => seen.push(e));
    pendingRejects.add((e) => seen.push(e));
    expect(pendingRejects.size).toBe(2);

    failPendingCalls(new Error("crashed"));

    expect(seen).toHaveLength(2);
    expect(seen.every((e) => e instanceof Error && e.message === "crashed")).toBe(true);
    expect(pendingRejects.size).toBe(0); // cleared, so a later crash doesn't double-reject
  });

  it("guardCall settles normally on the happy path and removes itself from pendingRejects either way", async () => {
    const { guardCall, pendingRejects } = solverClientModule.__testing;
    pendingRejects.clear();
    const result = await guardCall(Promise.resolve(sampleItinerary));
    expect(result).toEqual(sampleItinerary);
    expect(pendingRejects.size).toBe(0);

    await expect(guardCall(Promise.reject(new Error("nope")))).rejects.toThrow("nope");
    expect(pendingRejects.size).toBe(0);
  });
});

describe("worker construction failure at module load — item 5", () => {
  // `new Worker(...)` runs at MODULE SCOPE. Letting it throw would take down
  // app boot before React ever renders, with no fallback — this proves the
  // module itself still loads fine, and that solve()/resolve() reject
  // clearly (rather than throwing synchronously or hanging) when there is no
  // worker to talk to.
  it("does not throw at import time, and solve()/resolve() reject with a clear error instead of hanging", async () => {
    class ThrowingWorker {
      constructor() {
        throw new Error("failed to fetch worker chunk");
      }
    }
    vi.stubGlobal("Worker", ThrowingWorker);
    vi.resetModules();
    try {
      const freshModule = await import("./solverClient");
      await expect(freshModule.solverClient.solve({} as never, {})).rejects.toThrow(
        /failed to fetch worker chunk/,
      );
      await expect(
        freshModule.solverClient.resolve({} as never, sampleItinerary, { type: "full" } as never, {}),
      ).rejects.toThrow(/failed to fetch worker chunk/);
    } finally {
      // Restore the working fake worker in case anything else in this file
      // (or a future test appended after this one) re-imports the module.
      vi.stubGlobal("Worker", class {
        constructor() {
          return mainSidePort as unknown as object;
        }
      });
      vi.resetModules();
    }
  });
});

describe("callback identity safety (portsByCallbackProxy collision guard)", () => {
  it("freshCallback never returns the same object twice, even for the same underlying function", () => {
    const { freshCallback } = solverClientModule.__testing;
    const shared = (_it: Itinerary) => {};
    const a = freshCallback(shared);
    const b = freshCallback(shared);
    expect(a).not.toBe(b);
    expect(a).not.toBe(shared);
  });

  it("proxyCallbacks hands back fresh proxy identities even when given the identical onProgress/onDone across two calls", () => {
    const { proxyCallbacks } = solverClientModule.__testing;
    const sharedProgress = (_it: Itinerary) => {};
    const sharedDone = (_it: Itinerary) => {};
    const call1 = proxyCallbacks(sharedProgress, sharedDone);
    const call2 = proxyCallbacks(sharedProgress, sharedDone);
    expect(call1.progress).not.toBe(call2.progress);
    expect(call1.done).not.toBe(call2.done);
  });
});

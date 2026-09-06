import * as Comlink from "comlink";
import type { Itinerary, Trip } from "@app/domain";
import type { Edit } from "@app/solver";
import { bridgeLog, solverLogEnabled } from "./log";
import type { SolveApi, SolveRequest } from "./solver.worker";

/**
 * Worker client. The solver runs off the UI thread; progress callbacks swap
 * progressive itineraries into the store without ever blocking input.
 *
 * Comlink does NOT auto-proxy functions — plain callbacks throw
 * DataCloneError ("...could not be cloned") and the call never happens.
 * `onProgress`/`onDone` are therefore passed as TOP-LEVEL `Comlink.proxy()`-
 * wrapped arguments (never nested inside the request object, which stays
 * pure data): top-level proxy handling is Comlink's best-supported path and
 * does not depend on nested-object serialization.
 *
 * Stale-bundle note: Comlink marks proxies with a per-module Symbol. If two
 * copies of comlink end up in the bundle (e.g. an outdated Vite pre-bundle in
 * `node_modules/.vite`), the marker mismatches and Comlink silently falls
 * back to structured-cloning the raw function → DataCloneError again. If the
 * fix below ever appears to "not work", clear the stale pre-bundle and site
 * data: `rm -rf apps/web/node_modules/.vite` + devtools "Clear site data".
 *
 * Proxy lifetime: every `Comlink.proxy()`-marked argument opens a fresh
 * `MessageChannel` when Comlink serializes it for the outgoing call — one
 * channel each for `onProgress` and `onDone`, per `solve`/`resolve` call.
 * Comlink's own cleanup for this — calling `remoteFn[Comlink.releaseProxy]()`
 * — only exists on the RECEIVING end of a proxied callback (here, the
 * worker, once it deserializes the argument into a callable `Remote`).
 * `solver.worker.ts`'s `solve`/`resolve` just call `onProgress`/`onDone`
 * like ordinary functions and never call release — nor should they have to:
 * that transparency is the whole point of Comlink, and worker.ts is treated
 * as a boundary this client doesn't reach across. Left alone, that's two
 * `MessagePort`s leaked per call, held open on both sides for the life of the
 * page. `releasingProxyHandler` below fixes it from THIS side instead: it
 * reimplements Comlink's built-in "proxy" wire format field-for-field (the
 * worker's stock, unmodified handler keeps deserializing it exactly as
 * before) but additionally remembers the local half of the channel
 * (`port1`) it opens.
 *
 * WHEN to close those ports is its own trap. `solver.worker.ts` does
 * `onDone?.(result); return result;` WITHOUT awaiting `onDone` — so the
 * `onDone` call and the `return` travel on two different `MessagePort`s (the
 * callback's own channel vs. the main `SolveApi` channel), and the HTML spec
 * only orders messages within a single port's queue, not across two. So
 * "the outer `remote.solve()`/`remote.resolve()` promise has settled" is NOT
 * proof that `onDone` has actually fired yet — closing the done-callback's
 * port right then can discard an already-queued-but-not-yet-dispatched
 * `onDone` message. In practice both messages are posted in the same
 * synchronous turn and most engines dispatch them in posting order, which is
 * exactly what makes this race easy to miss: it usually works. Losing it
 * means the store's `onDone` never runs — `solving` stays true forever, the
 * itinerary freezes on the last progress snapshot, and Regenerate stays
 * disabled (the same stuck-spinner shape as the undo/redo bug fixed
 * elsewhere, just via a different route). `instrumentDone` below wraps the
 * caller's `onDone` so we can observe the moment it genuinely fires, and
 * `scheduleRelease` waits for the LATER of (outer call settled, onDone
 * fired) before releasing. A rejected call — or a call with no `onDone` at
 * all — never produces that second signal, so that side of the wait is
 * capped by `RELEASE_FALLBACK_MS` rather than hanging forever; the success
 * path never touches that timer, since `fired` resolves on its own.
 */
const worker = new Worker(new URL("./solver.worker.ts", import.meta.url), {
  type: "module",
});
const remote = Comlink.wrap<SolveApi>(worker);

/** Push the current logging flag to the worker (workers have no localStorage). */
export function syncWorkerLogging(): void {
  void remote.setLogging(solverLogEnabled());
}
syncWorkerLogging();

/**
 * The local half (`port1`) of each callback proxy's `MessageChannel`,
 * recorded by `releasingProxyHandler` at serialize time so it can be closed
 * once it's actually safe to (see `scheduleRelease`). Keyed by the exact
 * proxied function object. `Comlink.proxy()` marks and returns the SAME
 * object it's given rather than wrapping it, so this map would collide if
 * two concurrent in-flight calls were ever handed the identical callback
 * reference — one call's release would close the other's still-in-use port.
 * `freshCallback`/`instrumentDone` below always allocate a brand-new
 * function per call before proxying, specifically so that can't happen: this
 * map's keys are guaranteed fresh per call, not merely assumed to be.
 */
const portsByCallbackProxy = new WeakMap<object, MessagePort>();

/**
 * Drop-in replacement for Comlink's built-in "proxy" transfer handler (see
 * the module doc comment above for why this exists). Registered under the
 * same name, "proxy", so nothing on the worker side needs to change — it
 * still deserializes the exact same wire shape (a transferred `MessagePort`)
 * the same way it always has.
 */
const releasingProxyHandler: Comlink.TransferHandler<object, MessagePort> = {
  canHandle: (val): val is object =>
    (typeof val === "object" || typeof val === "function") &&
    val !== null &&
    (val as Record<PropertyKey, unknown>)[Comlink.proxyMarker] === true,
  serialize(obj) {
    const { port1, port2 } = new MessageChannel();
    Comlink.expose(obj, port1);
    portsByCallbackProxy.set(obj, port1);
    return [port2, [port2]];
  },
  deserialize(port) {
    port.start();
    return Comlink.wrap(port);
  },
};
Comlink.transferHandlers.set("proxy", releasingProxyHandler);

/**
 * Always allocate a new function identity, even when the caller passes the
 * same callback reference into two concurrent calls — see
 * `portsByCallbackProxy`'s doc comment for why that matters. Every call site
 * in this codebase already passes a fresh closure per call, but nothing
 * enforces that at the type level, so wrapping unconditionally here makes
 * the collision actually impossible rather than merely unobserved today.
 */
function freshCallback(
  fn: (itinerary: Itinerary) => void,
): (itinerary: Itinerary) => void {
  return (itinerary) => fn(itinerary);
}

/**
 * Wrap `onDone` (if supplied) so we can observe the moment it genuinely
 * fires — see the module doc comment for why that's a different moment than
 * "the outer promise settled". Returns the wrapped callback to proxy (also
 * satisfying `freshCallback`'s identity guarantee, since this always
 * allocates a new closure) plus a promise that resolves right after the real
 * `onDone` returns. With no `onDone` supplied there's nothing to wait for,
 * so `fired` resolves immediately.
 */
function instrumentDone(onDone: ((itinerary: Itinerary) => void) | undefined): {
  proxied: ((itinerary: Itinerary) => void) | undefined;
  fired: Promise<void>;
} {
  if (!onDone) return { proxied: undefined, fired: Promise.resolve() };
  let resolveFired!: () => void;
  const fired = new Promise<void>((resolve) => {
    resolveFired = resolve;
  });
  const proxied = (itinerary: Itinerary) => {
    try {
      onDone(itinerary);
    } finally {
      resolveFired();
    }
  };
  return { proxied, fired };
}

/**
 * Proxy callbacks at the TOP LEVEL of the remote call (never nested in the
 * request object) so delivery does not depend on nested-object serialization.
 */
function proxyCallbacks(
  onProgress: ((itinerary: Itinerary) => void) | undefined,
  onDone: ((itinerary: Itinerary) => void) | undefined,
): {
  progress: ((itinerary: Itinerary) => void) | undefined;
  done: ((itinerary: Itinerary) => void) | undefined;
  doneFired: Promise<void>;
} {
  const { proxied: instrumentedDone, fired: doneFired } = instrumentDone(onDone);
  return {
    progress: onProgress ? Comlink.proxy(freshCallback(onProgress)) : undefined,
    done: instrumentedDone ? Comlink.proxy(instrumentedDone) : undefined,
    doneFired,
  };
}

/** Close the MessageChannel half opened for one proxied callback, if any.
 *  Safe to call with undefined and safe to call more than once. */
function releaseCallbackProxy(fn: unknown): void {
  if (!fn || (typeof fn !== "object" && typeof fn !== "function")) return;
  const port = portsByCallbackProxy.get(fn);
  if (!port) return;
  port.close();
  portsByCallbackProxy.delete(fn);
}

/** Release both callback proxies from one solve/resolve call. Call only once
 *  it's actually safe to — see `scheduleRelease`. */
function releaseCallbacks(
  progress: ((itinerary: Itinerary) => void) | undefined,
  done: ((itinerary: Itinerary) => void) | undefined,
): void {
  releaseCallbackProxy(progress);
  releaseCallbackProxy(done);
}

/**
 * Safety-net wait used only when a supplied `onDone` will genuinely never
 * fire — the call rejected before the worker ever reached its
 * `onDone?.(result)` line, so there is no "fired" signal coming. Short on
 * purpose: this is not a guess at how long real work takes, just long enough
 * to let an already-in-flight message on the same task queue turn drain
 * before we give up on it. The success path never touches this timer — it
 * always resolves via the real `fired` signal instead, which is the
 * stronger guarantee (see module doc comment).
 */
const RELEASE_FALLBACK_MS = 50;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Release a call's callback proxies once it's actually finished with them:
 * after the outer `remote.solve()`/`remote.resolve()` call has settled AND
 * (when an `onDone` was supplied) `doneFired` confirms it has genuinely run.
 * `outer`'s resolution/rejection value is irrelevant here — only its timing
 * is. Runs detached from the promise handed back to callers, so it never
 * changes what `solve`/`resolve` resolve or reject with.
 */
async function scheduleRelease(
  outer: Promise<unknown>,
  doneFired: Promise<void>,
  progress: ((itinerary: Itinerary) => void) | undefined,
  done: ((itinerary: Itinerary) => void) | undefined,
): Promise<void> {
  await outer.catch(() => {});
  await Promise.race([doneFired, delay(RELEASE_FALLBACK_MS)]);
  releaseCallbacks(progress, done);
}

export const solverClient = {
  solve(
    trip: Trip,
    req: SolveRequest,
    onProgress?: (itinerary: Itinerary) => void,
    onDone?: (itinerary: Itinerary) => void,
  ): Promise<Itinerary> {
    if (solverLogEnabled()) {
      bridgeLog("main→worker solve request", {
        tripId: trip.id,
        places: trip.places.length,
        days: trip.days.length,
        budgetMs: req.budgetMs,
      });
    }
    const { progress, done, doneFired } = proxyCallbacks(onProgress, onDone);
    try {
      const call = remote.solve(trip, req, progress, done);
      void scheduleRelease(call, doneFired, progress, done);
      return call;
    } catch (e) {
      // Clone/send failures (e.g. DataCloneError) surface synchronously here,
      // before any message was ever sent — release whatever channel(s) got
      // opened before the failure straight away, nothing can be in flight.
      releaseCallbacks(progress, done);
      bridgeLog("main→worker solve FAILED", { error: String(e) });
      throw e;
    }
  },
  resolve(
    trip: Trip,
    previous: Itinerary,
    edit: Edit,
    req: SolveRequest,
    onProgress?: (itinerary: Itinerary) => void,
    onDone?: (itinerary: Itinerary) => void,
  ): Promise<Itinerary> {
    if (solverLogEnabled()) {
      bridgeLog("main→worker resolve request", {
        tripId: trip.id,
        edit: edit.type,
        places: trip.places.length,
        days: trip.days.length,
        budgetMs: req.budgetMs,
      });
    }
    const { progress, done, doneFired } = proxyCallbacks(onProgress, onDone);
    try {
      const call = remote.resolve(trip, previous, edit, req, progress, done);
      void scheduleRelease(call, doneFired, progress, done);
      return call;
    } catch (e) {
      releaseCallbacks(progress, done);
      bridgeLog("main→worker resolve FAILED", { error: String(e) });
      throw e;
    }
  },
};

export type { SolveRequest };

/**
 * Exported ONLY for `solverClient.test.ts` — not part of this module's
 * public API and not meant to be imported from application code. Lets the
 * test suite exercise the release-sequencing logic (the actual fix for the
 * onDone-vs-settlement race) directly, since forcing that exact cross-port
 * message reordering with real `MessagePort`s is not reliably reproducible
 * in a unit test (see the test file's own comments).
 */
export const __testing = {
  instrumentDone,
  scheduleRelease,
  freshCallback,
  proxyCallbacks,
  releaseCallbackProxy,
  portsByCallbackProxy,
  RELEASE_FALLBACK_MS,
};

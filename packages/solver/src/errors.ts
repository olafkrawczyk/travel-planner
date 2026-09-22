/**
 * Thrown when a solve's cancellation signal fires (see `SolveOptions.signal`
 * / `AlnsOptions.signal`). Cooperative cancellation: the search loop checks
 * the flag periodically and bails early by throwing this instead of running
 * to its full time budget — a superseded or deleted trip's solve is
 * abandoned promptly so the next requested solve can begin. Kept in its own
 * module (rather than `solve.ts`) so both `solve.ts` and `giantTour.ts` can
 * import it without an import cycle.
 */
export class CancelError extends Error {
  constructor(message = "Solve cancelled") {
    super(message);
    this.name = "CancelError";
  }
}

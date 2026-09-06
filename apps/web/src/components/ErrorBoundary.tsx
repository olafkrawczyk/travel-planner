import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Top-level and map-scoped crash recovery (release audit BLOCKER #2).
 * Nothing in this app previously caught a render-phase throw — `App.tsx`
 * rendered `TripScreen`/`TripList` directly under `React.StrictMode` with
 * nothing catching an unexpected exception, which blanks the whole page for
 * a user whose only copy of their trip data lives in this browser's
 * IndexedDB. Worse, if the throw originates from `currentTrip` state itself,
 * a reload just re-enters the same crash.
 *
 * Deliberately a class component: `componentDidCatch`/
 * `getDerivedStateFromError` are the only way to catch a render-phase throw
 * in React 18 — there is no hook equivalent.
 *
 * Known gap (by design, not an oversight): React error boundaries only catch
 * throws during render, in lifecycle methods, and — per React's commit-phase
 * handling — synchronous throws inside an effect body. They do NOT catch
 * errors from event handlers, timers, or code that throws inside a Promise
 * (e.g. a maplibre `map.on("load", ...)` callback throwing asynchronously).
 * Catching those needs a `window.onerror`/`unhandledrejection` listener,
 * which is a different, broader mechanism than "add an error boundary" —
 * see `globalErrorHandler.ts` (registered once at boot from `main.tsx`) for
 * that other mechanism.
 */

export interface CrashFallbackProps {
  error: Error;
  errorInfo: ErrorInfo | null;
  /** Clears the boundary's caught error and re-renders `children` — only
   *  useful once whatever caused the crash has actually been addressed
   *  (e.g. the crashing trip was closed), or it will just crash again. */
  retry: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Renders the crash UI once an error below this boundary is caught. A
   *  render prop (not a fixed fallback element) so the root boundary and the
   *  map-scoped one in MapView.tsx can offer different, scope-appropriate
   *  recovery actions while sharing the same catching/reset machinery. */
  fallback: (props: CrashFallbackProps) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Pick<ErrorBoundaryState, "error"> {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    // Best-effort console record for local/dev debugging. Wrapped so a
    // hostile environment (console overridden/throwing) can't turn this
    // catch handler into a second, unhandled crash.
    try {
      // eslint-disable-next-line no-console
      console.error("Unhandled render error:", error, errorInfo.componentStack);
    } catch {
      /* ignore */
    }
  }

  private retry = (): void => {
    this.setState({ error: null, errorInfo: null });
  };

  override render(): ReactNode {
    const { error, errorInfo } = this.state;
    if (error) {
      return this.props.fallback({ error, errorInfo, retry: this.retry });
    }
    return this.props.children;
  }
}

/**
 * Plain-text bug-report body for a caught render error: message + component
 * stack. Deliberately not the fallback's primary content (a raw stack dumped
 * up front is noise to a panicking user) — callers put this behind a
 * `<details>` disclosure instead. Pure and exported so it has direct unit
 * coverage — this repo has no component-render harness (no jsdom/
 * testing-library; see PlaceEditor.test.ts for the established pattern of
 * testing the logic behind a component rather than rendering it).
 */
export function formatCrashReport(error: Error, errorInfo: ErrorInfo | null): string {
  const message = error.message || String(error);
  const stack = errorInfo?.componentStack?.trim();
  return stack ? `${message}\n\nComponent stack:${stack}` : message;
}

export interface CrashFallbackShellProps {
  title: string;
  message: ReactNode;
  error: Error;
  errorInfo: ErrorInfo | null;
  /** Recovery actions (buttons), built by the caller — the set of sensible
   *  actions differs between the root boundary (reload / close trip / export)
   *  and the map-scoped one (retry only; the rest of the app still works). */
  actions: ReactNode;
}

/**
 * Shared visual shell for both boundaries' fallback UI: a heading, the
 * reassurance/explanation copy, the caller's action buttons, and a collapsed
 * bug-report disclosure. Uses only design tokens (apps/web/src/styles/
 * tokens.css) and plain semantic HTML (a `role="alert"` region, a native
 * `<details>`/`<summary>`, native `<button>`s) — no dependency on the store,
 * so it renders correctly even when the crash it's reporting originated
 * inside store-driven state.
 */
export function CrashFallbackShell({
  title,
  message,
  error,
  errorInfo,
  actions,
}: CrashFallbackShellProps): ReactNode {
  return (
    <div className="crash-fallback" role="alert">
      <h2>{title}</h2>
      <div className="crash-fallback-message">{message}</div>
      <div className="crash-fallback-actions">{actions}</div>
      <details className="crash-fallback-details">
        <summary>Technical details (for a bug report)</summary>
        <pre>{formatCrashReport(error, errorInfo)}</pre>
      </details>
    </div>
  );
}

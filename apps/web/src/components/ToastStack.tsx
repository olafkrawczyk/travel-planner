import { useEffect } from "react";
import { useStore, type ToastEntry } from "../store";

/** Informational toasts auto-dismiss after this long; error toasts don't
 *  auto-dismiss at all (P1 #5) — they wait for an explicit click. */
const INFO_AUTO_DISMISS_MS = 4000;

/** One toast row — its own component so the auto-dismiss timer is scoped to
 *  this entry's id/kind instead of one timer racing a whole shared list. */
function ToastRow({ id, message, kind }: ToastEntry) {
  const dismissToast = useStore((s) => s.dismissToast);

  useEffect(() => {
    if (kind !== "info") return; // errors persist until dismissed
    const t = setTimeout(() => dismissToast(id), INFO_AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [id, kind, dismissToast]);

  return (
    <div className={"toast" + (kind === "error" ? " toast-error" : "")}>
      <span className="toast-message">{message}</span>
      <button className="toast-dismiss" onClick={() => dismissToast(id)} aria-label="Dismiss message">
        ✕
      </button>
    </div>
  );
}

/**
 * Toast stack (P1 #5): the old surface was a single `toast: string | null`
 * field — a save-failure message could be silently clobbered by whatever
 * toast came after it, and everything auto-dismissed after 4s regardless of
 * severity. Every message now gets its own row and its own dismiss timer (or
 * none, for errors). Announcements are handled separately by LiveRegion, so
 * this component carries no `aria-live`/`role="status"` of its own — see the
 * "single mechanism" note there.
 */
export function ToastStack() {
  const toasts = useStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <ToastRow key={t.id} {...t} />
      ))}
    </div>
  );
}

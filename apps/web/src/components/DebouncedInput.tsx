import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

export interface DebouncedInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onCommit: (value: string) => void;
  debounceMs?: number;
}

/**
 * An `<input>` that buffers keystrokes locally and commits to `onCommit` only
 * on blur, Enter, or after `debounceMs` of inactivity (default 400ms).
 * Prevents undo-stack pollution from typing characters one-by-one (task 2.2 /
 * itinerary-view spec: "Time edits are debounced").
 */
export function DebouncedInput({
  value,
  onCommit,
  debounceMs = 400,
  onBlur,
  onKeyDown,
  ...rest
}: DebouncedInputProps) {
  const [draft, setDraft] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastCommittedRef = useRef(value);

  // Sync external value changes (e.g. undo/redo) into draft.
  useEffect(() => {
    setDraft(value);
    lastCommittedRef.current = value;
  }, [value]);

  function flush(next: string) {
    clearTimeout(timerRef.current);
    if (next !== lastCommittedRef.current) {
      lastCommittedRef.current = next;
      onCommit(next);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value;
    setDraft(next);
    clearTimeout(timerRef.current);
    if (debounceMs > 0) {
      timerRef.current = setTimeout(() => {
        flush(next);
      }, debounceMs);
    }
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    flush(draft);
    onBlur?.(e);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      flush(draft);
    }
    onKeyDown?.(e);
  }

  return (
    <input
      {...rest}
      value={draft}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  );
}

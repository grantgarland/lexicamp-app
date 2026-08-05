// useDebouncedValue — settle a fast-changing input before expensive work reads it.
//
// WHY (Casey, 2026-08-05): Word List search fed `query` straight into the
// deferred-render key, so EVERY KEYSTROKE flipped the list to a skeleton and
// back. Typing "mountain" flashed the skeleton eight times. Debouncing the value
// the LIST reads — while the input itself stays fully controlled and instant —
// turns that into one settle per pause in typing.
//
// The input must never wait on this. Bind the text field to the raw state and
// hand only the derived value to the filtering.
import { useEffect, useState } from 'react';

/** Default settle window. Long enough to swallow a fast typist's inter-key gap,
 *  short enough that a deliberate pause feels immediate. */
export const SEARCH_DEBOUNCE_MS = 220;

export function useDebouncedValue<T>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    // Already there (first mount, or a value that changed and changed back
    // inside the window) — don't arm a timer that would re-render for nothing.
    if (settled === value) return;
    const id = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs, settled]);

  return settled;
}

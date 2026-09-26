import { useSyncExternalStore } from 'react';

import { secondsUntil } from '@/data/lookupBusy';

// A shared wall clock that ticks only while something is subscribed. Built on
// useSyncExternalStore (React's sanctioned way to read a value that changes
// outside React) rather than setState-in-an-effect.
const TICK_MS = 250; // so the displayed second never lags the wall clock by most of a second
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer == null) {
    now = Date.now(); // React re-reads the snapshot after subscribing, so this lands at once
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer != null) {
      clearInterval(timer);
      timer = null;
    }
  };
}
const getNow = () => now;
const noSubscribe = () => () => {};

/**
 * Seconds remaining until `targetMs`, re-rendering while it runs; null when
 * there is no target. The clock reads `Date.now()` on every tick, so time spent
 * backgrounded (when timers pause) is still counted on return.
 */
export function useCountdown(targetMs: number | null): number | null {
  const current = useSyncExternalStore(targetMs == null ? noSubscribe : subscribe, getNow, getNow);
  return targetMs == null ? null : secondsUntil(targetMs, current);
}

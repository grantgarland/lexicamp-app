// useDeferredReady — paint-first tab traversal (18-session, Casey perf report).
// Returns false on first mount and for the frame(s) immediately after `key`
// changes, flipping true once the JS thread goes idle. Screens gate their
// HEAVY content on it and show the skeleton meanwhile, so a tab press paints
// its traversal instantly instead of blocking on a big synchronous mount.
//
// Uses requestIdleCallback per RN's InteractionManager deprecation guidance,
// with a 300ms timeout so a busy thread can never strand the skeleton.
import { useEffect, useState } from 'react';

export function useDeferredReady(key: unknown): boolean {
  const [ready, setReady] = useState(false);
  // Render-adjust (the codebase's Sheet/NotificationSheet pattern): a key change
  // must read as not-ready IN THIS RENDER, not one frame later. React's blessed
  // form stores the previous value in state, not a ref, so it re-renders
  // synchronously before paint.
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    if (ready) setReady(false);
  }
  useEffect(() => {
    if (ready) return;
    const id = requestIdleCallback(() => setReady(true), { timeout: 300 });
    return () => cancelIdleCallback(id);
  }, [ready]);
  return ready;
}

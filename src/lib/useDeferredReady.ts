// useDeferredReady — paint-first tab traversal (18-session, Casey perf report).
// Returns false on first mount and for the frame(s) immediately after `key`
// changes, flipping true once current interactions settle. Screens gate their
// HEAVY content on it and show the skeleton meanwhile, so a tab press paints
// its traversal instantly instead of blocking on a big synchronous mount.
import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';

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
    const task = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => task.cancel();
  }, [ready]);
  return ready;
}

// Portal — a tiny in-app portal so overlays (sheets, toasts) render at the ROOT, above
// everything including the persistent nav, WITHOUT React Native's `Modal`. RN `Modal`
// (a) leaves the underlying scene non-interactive after dismissal in this nav setup and
// (b) can't stack smoothly. Portal entries are plain views in the app tree: they stack
// (a second sheet slides over the first, which stays mounted behind it) and unmount
// cleanly. `PortalHost` is mounted once in the root layout, inside the app's providers +
// GestureHandlerRootView, so gestures/theme/i18n all work inside portalled content.
import { Fragment, type ReactNode, useEffect, useId } from 'react';
import { create } from 'zustand';

import { useAppliedScheme } from '@/theme/appearance';

interface PortalStore {
  items: { id: string; node: ReactNode }[];
  upsert: (id: string, node: ReactNode) => void;
  remove: (id: string) => void;
}

const usePortalStore = create<PortalStore>((set) => ({
  items: [],
  upsert: (id, node) =>
    set((s) => {
      const idx = s.items.findIndex((i) => i.id === id);
      if (idx === -1) return { items: [...s.items, { id, node }] };
      const items = s.items.slice();
      items[idx] = { id, node };
      return { items };
    }),
  remove: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

/** Renders `children` into the root PortalHost (on top of the app). */
export function Portal({ children }: { children: ReactNode }) {
  // Stable per-instance id (replaces the old module counter + lazy ref, which
  // violated react-hooks purity rules — refs/global writes during render).
  const id = useId();
  const upsert = usePortalStore((s) => s.upsert);
  const remove = usePortalStore((s) => s.remove);

  // Keep the portalled node in sync on every render; remove on unmount.
  useEffect(() => {
    upsert(id, children);
  }, [id, children, upsert]);
  useEffect(() => {
    return () => remove(id);
  }, [id, remove]);

  return null;
}

/**
 * Is any overlay (sheet / dialog) on screen right now?
 *
 * Read by the ROOT LAYOUT, which defers its light↔dark rebuild while this is
 * true. That rebuild remounts the whole tree, which resets the screen state
 * holding "which sheet is open" — so flipping appearance from inside Settings →
 * Edit Profile used to blink the sheet out of existence in a single frame and
 * dump the user back on the Settings hub, with no slide-down and the picker they
 * were using gone (reported 2026-08-08). Holding the rebuild keeps the sheet up:
 * the theme still switches instantly underneath it (Unistyles), the user sees
 * the result of their tap in place, and the deferred rebuild lands the moment
 * the sheet is dismissed normally — behind the closing animation.
 */
export function useOverlayOpen(): boolean {
  return usePortalStore((s) => s.items.length > 0);
}

/** Mount once at the app root (after the navigator, inside the providers). */
export function PortalHost() {
  const items = usePortalStore((s) => s.items);
  // Keyed by the applied scheme for the same reason the root layout keys the app
  // tree: Unistyles writes theme changes into native ShadowNodes and misses
  // some, so a switch leaves a mounted subtree half-repainted, and only a
  // remount registers every node afresh. While an overlay is open the root
  // rebuild is HELD (see `useOverlayOpen`), so overlays would otherwise be the
  // one subtree that never gets that treatment — exactly the subtree the user is
  // looking at when they flip appearance from Settings. This remount is
  // invisible: `Sheet` keeps its own mount/animation state (it lives in the
  // sheet, not in the portalled node), so an open sheet stays open, in place,
  // and un-animated.
  const scheme = useAppliedScheme();
  return (
    <>
      {items.map((i) => (
        <Fragment key={`${i.id}:${scheme}`}>{i.node}</Fragment>
      ))}
    </>
  );
}

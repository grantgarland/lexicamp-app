// Portal — a tiny in-app portal so overlays (sheets, toasts) render at the ROOT, above
// everything including the persistent nav, WITHOUT React Native's `Modal`. RN `Modal`
// (a) leaves the underlying scene non-interactive after dismissal in this nav setup and
// (b) can't stack smoothly. Portal entries are plain views in the app tree: they stack
// (a second sheet slides over the first, which stays mounted behind it) and unmount
// cleanly. `PortalHost` is mounted once in the root layout, inside the app's providers +
// GestureHandlerRootView, so gestures/theme/i18n all work inside portalled content.
import { Fragment, type ReactNode, useEffect, useId } from 'react';
import { create } from 'zustand';

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

/** Mount once at the app root (after the navigator, inside the providers). */
export function PortalHost() {
  const items = usePortalStore((s) => s.items);
  return (
    <>
      {items.map((i) => (
        <Fragment key={i.id}>{i.node}</Fragment>
      ))}
    </>
  );
}

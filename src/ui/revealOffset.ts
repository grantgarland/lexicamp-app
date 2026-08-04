// revealOffset — the scroll math behind `ScrollIntoView`, kept in its own module.
//
// Deliberately import-free: `ScrollIntoView.tsx` pulls in react-native and
// reanimated, neither of which resolves in a plain node test (reanimated needs a
// native binary). Splitting the pure function out means the part that can
// silently scroll to the wrong place stays testable with zero mocks.

/** Pure geometry, split out so the scroll math is unit-testable without a host
 *  tree. All values are in the scroll view's content coordinate space. */
export interface RevealGeometry {
  /** The box's top edge, as `measureLayout` reports it against the inner view. */
  y: number;
  height: number;
  /** Current scroll position. */
  offsetY: number;
  /** Visible height of the scroll view. */
  viewportH: number;
  /** Total scrollable content height. */
  contentH: number;
  /** Requested breathing room around the box. */
  insetTop: number;
  insetBottom: number;
  /** The scroll view's own `contentInset` — what the platform has reserved at
   *  each edge. On Search this is the keyboard: `automaticallyAdjustKeyboardInsets`
   *  pads the bottom by the keyboard's height, so the last `contentInsetBottom`
   *  points of the frame are covered and the scrollable range grows by the same
   *  amount. Ignoring it reveals things to a spot behind the keyboard, and clamps
   *  the scroll short of where the content can actually go. */
  contentInsetTop?: number;
  contentInsetBottom?: number;
}

/** The minimum scroll offset that brings [y, y + height] fully into view —
 *  `block: 'nearest'`. Returns `offsetY` unchanged when the box already fits. */
export function revealOffset(g: RevealGeometry): number {
  const ciTop = g.contentInsetTop ?? 0;
  const ciBottom = g.contentInsetBottom ?? 0;
  const top = g.y - g.insetTop;
  const bottom = g.y + g.height + g.insetBottom;
  // The unobscured slice of the frame, in content coordinates.
  const windowTop = g.offsetY + ciTop;
  const windowBottom = g.offsetY + g.viewportH - ciBottom;
  let delta = 0;
  // Hanging off the bottom → scroll by exactly the overhang, no further.
  if (bottom > windowBottom) delta = bottom - windowBottom;
  // …but never at the cost of the top edge. Also covers a box sitting ABOVE the
  // window (scroll up) and one taller than the window (align its top).
  if (top - delta < windowTop) delta = top - windowTop;
  const min = -ciTop;
  const max = Math.max(min, g.contentH + ciBottom - g.viewportH);
  // `+ 0` normalizes the -0 that a zero top inset produces. Harmless to
  // scrollTo, but -0 fails a `toBe(0)` assertion and reads as a bug.
  return Math.min(Math.max(g.offsetY + delta, min), max) + 0;
}

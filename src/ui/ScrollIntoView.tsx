// ScrollIntoView — reveal content that a disclosure just pushed below the fold.
//
// RN's ScrollView is inert when a child grows. Expand an accordion sitting near
// the bottom of the viewport and everything it reveals lands off-screen, with no
// cue that scrolling would show it (Casey, 2026-08-03 — Home's "How Lexicamp
// works" and Search's result senses; the Save button on an expanded sense was
// under the tab bar). The pattern the RN community settled on, and what
// `react-native-scroll-into-view` implements, is:
//
//   measure the child against the ScrollView's INNER content view
//     → compare that box against the currently visible window
//     → scrollTo the SMALLEST offset that brings the box fully into view.
//
// That last part is the web's `scrollIntoView({ block: 'nearest' })`: content
// that is already visible never moves, so opening a section at the TOP of the
// screen does not yank the page. Only content that would otherwise be hidden
// causes a scroll.
//
// Why inlined rather than `npm i react-native-scroll-into-view`: that package
// measures via numeric node handles, which Fabric no longer resolves. On RN 0.85
// `measureLayout` wants a host instance — see ScrollView's own
// `scrollResponderScrollNativeHandleToKeyboard`, which branches on exactly this.
// It is ~100 lines; a dependency that needs patching on the New Architecture is
// the more expensive of the two.
//
// Usage:
//   <ScrollIntoViewScrollView contentContainerStyle={…}>
//     …
//     <ScrollIntoView enabled={isOpen}>{…header + collapsible body…}</ScrollIntoView>
//   </ScrollIntoViewScrollView>
//
// `ScrollIntoView` must wrap a node that stays MOUNTED across the collapse, so it
// can observe the expansion — wrap the whole accordion item, not the body that
// mounts and unmounts inside it.
import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useRef } from 'react';
import type { ComponentProps, RefObject } from 'react';
import {
  Keyboard,
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type ViewProps,
} from 'react-native';
import Animated from 'react-native-reanimated';

import { revealOffset, type RevealGeometry } from './revealOffset';

export { revealOffset, type RevealGeometry };

export interface ScrollIntoViewOptions {
  /** Breathing room kept above the revealed box (pt). */
  insetTop?: number;
  /** Breathing room kept below it. Pass the height of anything painted OVER the
   *  scroll view's bottom edge — on the search overlay that is the absolute
   *  TabBar, which the scroll view runs underneath. */
  insetBottom?: number;
  animated?: boolean;
}

type RevealFn = (node: View | null, opts?: ScrollIntoViewOptions) => void;

const noop: RevealFn = () => {};
const ScrollIntoViewContext = createContext<RevealFn>(noop);

/** Imperative escape hatch for call sites that own their own trigger. Returns a
 *  no-op outside a `ScrollIntoViewScrollView`, so shared components (the
 *  educator accordion renders on Home AND inside a Settings sheet) can use it
 *  unconditionally. */
export function useScrollIntoView(): RevealFn {
  return useContext(ScrollIntoViewContext);
}

export interface ScrollIntoViewScrollViewProps extends ScrollViewProps {
  /** Default insets for every reveal from this scroll view. A `ScrollIntoView`
   *  may override them per-node. */
  revealInsetTop?: number;
  revealInsetBottom?: number;
}

/** Drop-in `ScrollView` that publishes a reveal function to its subtree. */
export const ScrollIntoViewScrollView = forwardRef<ScrollView, ScrollIntoViewScrollViewProps>(
  function ScrollIntoViewScrollView(
    {
      children,
      onScroll,
      onLayout,
      onContentSizeChange,
      revealInsetTop = 0,
      revealInsetBottom = 0,
      scrollEventThrottle = 16,
      ...rest
    },
    ref,
  ) {
    const scrollRef = useRef<ScrollView | null>(null);
    const innerRef = useRef<View | null>(null);
    // Geometry lives in refs, not state: it is read inside an async measure
    // callback and must never re-render the tree on scroll.
    const offsetY = useRef(0);
    const viewportH = useRef(0);
    const contentH = useRef(0);
    const contentInsetTop = useRef(0);
    const contentInsetBottom = useRef(0);

    useImperativeHandle(ref, () => scrollRef.current as ScrollView, []);

    const measureAndScroll = useCallback(
      (node: View, inner: View, opts: ScrollIntoViewOptions | undefined, ciBottom: number) => {
        node.measureLayout(
          inner,
          (_x, y, _w, height) => {
            const next = revealOffset({
              y,
              height,
              offsetY: offsetY.current,
              viewportH: viewportH.current,
              contentH: contentH.current,
              insetTop: opts?.insetTop ?? revealInsetTop,
              insetBottom: opts?.insetBottom ?? revealInsetBottom,
              contentInsetTop: contentInsetTop.current,
              contentInsetBottom: ciBottom,
            });
            // Sub-point deltas are noise; animating them just costs a frame.
            if (Math.abs(next - offsetY.current) < 1) return;
            scrollRef.current?.scrollTo({ y: next, animated: opts?.animated ?? true });
          },
          // measureLayout rejects if either node left the tree mid-flight
          // (collapse raced the frame). Nothing to reveal — stay put.
          () => {},
        );
      },
      [revealInsetTop, revealInsetBottom],
    );

    const reveal = useCallback<RevealFn>(
      (node, opts) => {
        const inner = innerRef.current;
        // viewportH is 0 until the first layout — measuring then would compute
        // against an empty window and scroll to the wrong place.
        if (node == null || inner == null || viewportH.current <= 0) return;

        // `contentInsetBottom` is only refreshed by onScroll, and the keyboard can
        // open WITHOUT producing one: `automaticallyAdjustKeyboardInsets` changes
        // the inset, but if the content is short enough that contentOffset does
        // not move, no scroll event fires. We would then reveal against a floor
        // that is behind the keyboard — and worse, clamp to `contentH - viewportH`,
        // which for short content is negative and makes the reveal a silent no-op,
        // exactly when half the screen is covered. So ask the keyboard directly.
        const kb = Keyboard.metrics();
        if (kb == null || kb.height <= 0) {
          measureAndScroll(node, inner, opts, contentInsetBottom.current);
          return;
        }
        // The inner content view's window position pins content coords to screen
        // coords: content point `c` sits at `innerY + c`. So the scroll view's own
        // bottom edge is at `innerY + offsetY + viewportH`.
        inner.measureInWindow((_x, innerY) => {
          const viewportBottom = innerY + offsetY.current + viewportH.current;
          const overlap = Math.max(0, viewportBottom - kb.screenY);
          // max(), never sum: when iOS HAS applied the keyboard inset both numbers
          // describe the same strip, and adding them would double it.
          measureAndScroll(node, inner, opts, Math.max(contentInsetBottom.current, overlap));
        });
      },
      [measureAndScroll],
    );

    const handleScroll = useCallback(
      (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, layoutMeasurement, contentSize, contentInset } = e.nativeEvent;
        offsetY.current = contentOffset.y;
        viewportH.current = layoutMeasurement.height;
        contentH.current = contentSize.height;
        // Android reports no contentInset; `?? 0` keeps the math platform-safe.
        contentInsetTop.current = contentInset?.top ?? 0;
        contentInsetBottom.current = contentInset?.bottom ?? 0;
        onScroll?.(e);
      },
      [onScroll],
    );

    // onLayout / onContentSizeChange seed the geometry that onScroll keeps
    // fresh — without them a reveal before the user's first scroll has nothing
    // to measure against.
    const handleLayout = useCallback(
      (e: LayoutChangeEvent) => {
        viewportH.current = e.nativeEvent.layout.height;
        onLayout?.(e);
      },
      [onLayout],
    );

    const handleContentSizeChange = useCallback(
      (w: number, h: number) => {
        contentH.current = h;
        onContentSizeChange?.(w, h);
      },
      [onContentSizeChange],
    );

    return (
      <ScrollIntoViewContext.Provider value={reveal}>
        <ScrollView
          {...rest}
          ref={scrollRef}
          innerViewRef={innerRef as RefObject<View>}
          scrollEventThrottle={scrollEventThrottle}
          onScroll={handleScroll}
          onLayout={handleLayout}
          onContentSizeChange={handleContentSizeChange}
        >
          {children}
        </ScrollView>
      </ScrollIntoViewContext.Provider>
    );
  },
);

export interface ScrollIntoViewProps extends ViewProps, ScrollIntoViewOptions {
  /** Reveal this box when the flag goes false → true (the disclosure opened).
   *  Collapsing never scrolls — pulling the viewport around after a "close" is
   *  disorienting, and the content the user was reading is still where it was. */
  enabled?: boolean;
  /** Keep revealing while `enabled`, every time the box GROWS. On by default so
   *  content that arrives after the open (Search's on-demand example sentence)
   *  is revealed too. Turn it OFF on an outer container that wraps its own
   *  `ScrollIntoView` children, or the parent's reveal will fight the child's:
   *  the parent grows whenever a child expands, and aligning the whole parent
   *  would scroll away from the section the user actually opened. */
  revealOnGrowth?: boolean;
  /** Also hand the measured host node to the caller. The wrapper is already the
   *  one non-collapsable box around an accordion item, so it is the natural
   *  anchor for anything else that needs to measure it — the walkthrough
   *  spotlights the open search result through this. */
  nodeRef?: (node: View | null) => void;
  /** A Reanimated layout transition for the WRAPPER.
   *
   *  ⚠️ Pass this whenever the node you are wrapping had one of its own. Slipping
   *  a plain View between an `Animated.View layout={…}` and its siblings kills the
   *  transition: the child no longer moves relative to its new parent, so it has
   *  nothing to animate, and the plain wrapper — which is what actually moves —
   *  cannot. TranslationCard is the case: expanding one row used to slide the rows
   *  below it, and wrapping the rows made them snap instead. */
  layout?: ComponentProps<typeof Animated.View>['layout'];
}

export function ScrollIntoView({
  enabled = true,
  revealOnGrowth = true,
  nodeRef,
  layout,
  insetTop,
  insetBottom,
  animated,
  onLayout,
  children,
  ...rest
}: ScrollIntoViewProps) {
  const reveal = useScrollIntoView();
  const viewRef = useRef<View | null>(null);
  // React detaches every changed ref before attaching any, so a `nodeRef` that
  // moves between siblings (the expanded item changes) sees null then the new
  // node, in that order — the last write wins and the anchor stays correct.
  const setNode = useCallback(
    (node: View | null) => {
      viewRef.current = node;
      nodeRef?.(node);
    },
    [nodeRef],
  );
  const height = useRef(0);
  const frame = useRef<number | null>(null);
  // The first layout after mount is not an expansion — a card that renders
  // open (Home's educator card on an empty deck) must not scroll on arrival.
  const settled = useRef(false);
  const wasEnabled = useRef(enabled);

  const schedule = useCallback(() => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    // One frame of slack. `onLayout` fires as this subtree is committed, but
    // siblings above it may still be settling in the same commit (the accordions
    // run Reanimated `LinearTransition`). Measuring next frame reads the final
    // content geometry instead of a half-applied one.
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      reveal(viewRef.current, { insetTop, insetBottom, animated });
    });
  }, [reveal, insetTop, insetBottom, animated]);

  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  // The open itself. Fires regardless of `revealOnGrowth` — that flag governs
  // follow-up growth, not the opening.
  useEffect(() => {
    if (enabled && !wasEnabled.current) schedule();
    // Re-baseline on close so the next open reads as growth again.
    else if (!enabled) height.current = 0;
    wasEnabled.current = enabled;
  }, [enabled, schedule]);

  const handleLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    const grew = h > height.current + 0.5;
    height.current = h;
    // Only chase growth: a collapse must never yank the viewport, and a
    // re-layout at the same height is not new content. This is also what catches
    // content that lands AFTER the open (Search fetching an example sentence) —
    // and, for a box that mounted already open, the only thing that catches it.
    if (settled.current && enabled && grew && revealOnGrowth) schedule();
    settled.current = true;
    onLayout?.(e);
  };

  // collapsable={false} on both: Android's view flattening drops a plain View
  // with no styling of its own, and measureLayout against a node that isn't in
  // the native tree fails silently (same trap as the walkthrough anchors).
  if (layout != null) {
    return (
      <Animated.View {...rest} ref={setNode} layout={layout} collapsable={false} onLayout={handleLayout}>
        {children}
      </Animated.View>
    );
  }
  return (
    <View {...rest} ref={setNode} collapsable={false} onLayout={handleLayout}>
      {children}
    </View>
  );
}

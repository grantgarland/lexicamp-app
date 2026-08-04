// Guards the scroll math behind ScrollIntoView. The measurement itself is a
// native round-trip (`measureLayout`) that jest cannot exercise, so the geometry
// lives in its own import-free module and is pinned here — the part that can
// silently scroll to the wrong place. Import from `../revealOffset`, NOT from
// `../ScrollIntoView`: the component pulls in reanimated, which needs a native
// binary and dies at import time under jest.
import { revealOffset, type RevealGeometry } from '../revealOffset';

// An 800pt window over 3000pt of content, scrolled to the top.
const base: RevealGeometry = {
  y: 0,
  height: 100,
  offsetY: 0,
  viewportH: 800,
  contentH: 3000,
  insetTop: 0,
  insetBottom: 0,
};
const at = (o: Partial<RevealGeometry>) => revealOffset({ ...base, ...o });

describe('revealOffset', () => {
  it('leaves a fully visible box alone', () => {
    // The whole point of `block: 'nearest'`: opening a section at the top of the
    // screen must not yank the page.
    expect(at({ y: 100, height: 200 })).toBe(0);
    expect(at({ y: 900, height: 200, offsetY: 800 })).toBe(800);
  });

  it('pulls a box hanging off the bottom up by the overhang, and no further', () => {
    // Bottom at 900 in an 800 window ⇒ exactly 100 of scroll.
    expect(at({ y: 700, height: 200 })).toBe(100);
  });

  it('counts insetBottom as part of the box', () => {
    // Already fits, but not once the tab bar's 83pt is reserved under it.
    expect(at({ y: 600, height: 200 })).toBe(0);
    expect(at({ y: 600, height: 200, insetBottom: 83 })).toBe(83);
  });

  it('scrolls up to a box that sits above the window', () => {
    expect(at({ y: 300, height: 200, offsetY: 800 })).toBe(300);
    expect(at({ y: 300, height: 200, offsetY: 800, insetTop: 12 })).toBe(288);
  });

  it('aligns the top of a box taller than the window rather than its bottom', () => {
    // Bottom-aligning a 2000pt box would scroll past its top and hide the
    // heading the user just tapped.
    expect(at({ y: 500, height: 2000 })).toBe(500);
  });

  it('never scrolls past the end of the content', () => {
    // Overhang says 1200, but only 2200 of scroll exists.
    expect(at({ y: 2900, height: 100, contentH: 3000 })).toBe(2200);
  });

  it('never scrolls above the top', () => {
    expect(at({ y: 10, height: 100, insetTop: 200 })).toBe(0);
  });

  it('is a no-op when the content is shorter than the window', () => {
    expect(at({ y: 100, height: 200, contentH: 400 })).toBe(0);
  });

  // `automaticallyAdjustKeyboardInsets` on Search: the keyboard covers the
  // bottom 300pt of the frame and the scrollable range grows by the same 300.
  describe('with a keyboard content inset', () => {
    const kb = { contentInsetBottom: 300 };

    it('treats the covered strip as off-screen', () => {
      // Fits the frame, but its bottom half is behind the keyboard.
      expect(at({ y: 600, height: 200 })).toBe(0);
      expect(at({ y: 600, height: 200, ...kb })).toBe(300);
    });

    it('can scroll into the range the inset opened up', () => {
      // Without the inset the content bottoms out at 2200; with it, at 2500.
      expect(at({ y: 2900, height: 100, ...kb })).toBe(2500);
    });

    it('leaves a box that clears the keyboard alone', () => {
      expect(at({ y: 100, height: 200, ...kb })).toBe(0);
    });
  });
});

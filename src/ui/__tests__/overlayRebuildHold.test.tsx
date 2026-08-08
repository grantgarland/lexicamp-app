// @ts-nocheck — jest mock-factory hoisting forbids identifiers inside the
// factories, so this file is excluded from tsc (see ConfirmDialog.test.tsx).
//
// A light↔dark switch rebuilds the whole app tree (app/_layout.tsx keys it on
// the applied scheme) because Unistyles misses nodes when it repaints. That
// rebuild also resets the screen state that says "this sheet is open" — so
// flipping appearance from inside Settings → Edit Profile, the ONE place the app
// invites a mid-sheet scheme change, blew the sheet away in a single frame with
// no slide-down and dropped the user back on the Settings hub (2026-08-08).
//
// The fix is a hold, the same shape as the quiz hold: while an overlay is up the
// rebuild key does not move. What this file pins down is the pair of properties
// that make the hold correct — the sheet SURVIVES the switch, and the rebuild
// still eventually happens, once the overlay has closed on its own animation.

jest.mock('react-native-unistyles', () => {
  const { lightTheme } = require('@/theme/theme');
  return {
    StyleSheet: {
      create: (styles) => (typeof styles === 'function' ? styles(lightTheme) : styles),
      configure: () => {},
    },
    createUnistylesElement: (c) => c,
    useUnistyles: () => ({ theme: lightTheme }),
    UnistylesRuntime: { themeName: 'light', setTheme: jest.fn(), setRootViewBackgroundColor: () => {} },
  };
});

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c) => c },
    Easing: { out: () => () => 0, in: () => () => 0, cubic: () => 0 },
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 0 } }),
    withTiming: (v, _cfg, cb) => {
      // Run the completion callback synchronously so a close actually unmounts
      // within the test, which is what releases the held rebuild.
      if (cb) cb(true);
      return v;
    },
    runOnJS: (fn) => fn,
    interpolate: () => 0,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: (props) => props.children,
}));

import { act, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Text as RNText } from 'react-native';

import { useAppearanceStore } from '@/store/appearanceStore';
import { PortalHost, useOverlayOpen } from '@/ui/Portal';
import { Sheet } from '@/ui/Sheet';
import { useAppliedScheme } from '@/theme/appearance';

/** The root layout's rebuild rule, reduced to the part under test: a key that
 *  tracks the applied scheme EXCEPT while an overlay is on screen. The body is
 *  keyed on it, so a rebuild is observable as a remount. */
let rebuilds = 0;
function Harness({ sheetVisible }) {
  const scheme = useAppliedScheme();
  const overlayOpen = useOverlayOpen();
  const [rebuildKey, setRebuildKey] = useState(scheme);
  if (!overlayOpen && rebuildKey !== scheme) setRebuildKey(scheme);
  return (
    <Body key={rebuildKey}>
      <Sheet visible={sheetVisible} onClose={() => {}} title="Edit Profile">
        <RNText>appearance picker</RNText>
      </Sheet>
      <PortalHost />
    </Body>
  );
}
function Body({ children }) {
  useState(() => {
    rebuilds += 1;
    return null;
  });
  return <>{children}</>;
}

/** What `applyScheme` publishes — the value the rebuild key reads. */
const applyScheme = (scheme) => {
  act(() => {
    useAppearanceStore.getState().setResolved(scheme);
  });
};

beforeEach(() => {
  rebuilds = 0;
  useAppearanceStore.setState({ mode: 'system', resolved: 'light' });
});

describe('a scheme change while an overlay is open', () => {
  it('leaves the sheet on screen instead of blinking it away', () => {
    render(<Harness sheetVisible />);
    expect(screen.getByText('appearance picker')).toBeTruthy();
    const before = rebuilds;

    applyScheme('dark');

    // The sheet is still up — the user stays where they were and sees the new
    // scheme applied under their thumb...
    expect(screen.getByText('appearance picker')).toBeTruthy();
    // ...because the rebuild that would have unmounted it was held.
    expect(rebuilds).toBe(before);
  });

  it('runs the held rebuild once the overlay has finished closing', () => {
    const view = render(<Harness sheetVisible />);
    applyScheme('dark');
    const heldAt = rebuilds;

    // Dismissing plays the close animation and unmounts on completion; the last
    // portal item leaving is what releases the hold.
    view.rerender(<Harness sheetVisible={false} />);

    expect(screen.queryByText('appearance picker')).toBeNull();
    expect(rebuilds).toBe(heldAt + 1);
  });

  it('rebuilds immediately when no overlay is open', () => {
    render(<Harness sheetVisible={false} />);
    const before = rebuilds;

    applyScheme('dark');

    expect(rebuilds).toBe(before + 1);
  });
});

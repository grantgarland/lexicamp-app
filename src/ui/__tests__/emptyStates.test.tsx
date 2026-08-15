// @ts-nocheck — jest mock factories forbid out-of-scope identifiers, which
// conflicts with TS annotations here. Tests run through babel (types stripped).
//
// The empty-state kit (EmptyStateCard / EmptyOverlay / GhostRows / InlineNote).
//
// What's worth guarding here is the SIGNAL, not the pixels. The kit exists to
// keep three claims distinct — "still loading", "confirmed empty", "one small
// thing is missing" — and each is carried by something a refactor can silently
// drop:
//
//   · a ghost pulses ONLY when animated. A static ghost that starts pulsing
//     tells the user to wait for rows that are never coming (ProgressScreen's
//     2026-07-24 leaderboard fix, generalised).
//   · the ghost layer never eats the card's taps, and never speaks to VoiceOver.
//   · EmptyStateCard renders the SAME column as EmptyState — it composes it, so
//     a title/body/CTA must survive the card wrapper.

jest.mock('react-native-unistyles', () => {
  const { lightTheme } = require('@/theme/theme');
  return {
    StyleSheet: {
      create: (styles) => (typeof styles === 'function' ? styles(lightTheme) : styles),
      configure: () => {},
    },
    createUnistylesElement: (c) => c,
    useUnistyles: () => ({ theme: lightTheme }),
    UnistylesRuntime: { setRootViewBackgroundColor: () => {} },
  };
});

// Records whether the pulse was ever scheduled, so a test can assert that a
// STATIC ghost never reaches reanimated at all.
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  const calls = { withRepeat: 0 };
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c) => c },
    View,
    Easing: { inOut: () => () => 0, quad: () => 0 },
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withTiming: (v) => v,
    withRepeat: (v) => {
      calls.withRepeat += 1;
      return v;
    },
    __calls: calls,
  };
});

import { fireEvent, render, screen } from '@testing-library/react-native';
import i18n from '@/i18n';
import { EmptyOverlay } from '@/ui/EmptyOverlay';
import { EmptyStateCard } from '@/ui/EmptyStateCard';
import { GhostRows } from '@/ui/Ghost';
import { InlineNote } from '@/ui/InlineNote';

const pulses = () => require('react-native-reanimated').__calls.withRepeat;

beforeEach(() => {
  require('react-native-reanimated').__calls.withRepeat = 0;
});

describe('GhostRows', () => {
  it('does NOT animate by default — a static ghost means "confirmed empty"', () => {
    render(<GhostRows variant="word" count={4} />);
    expect(pulses()).toBe(0);
  });

  it('animates only when asked — the loading signal', () => {
    render(<GhostRows variant="word" count={4} animated />);
    expect(pulses()).toBeGreaterThan(0);
  });

  it('renders every variant without a shape falling through to undefined', () => {
    for (const variant of ['word', 'deck', 'leader']) {
      const { toJSON, unmount } = render(<GhostRows variant={variant} count={3} />);
      expect(toJSON()).not.toBeNull();
      unmount();
    }
  });

  it('exposes no text to a screen reader — it is decoration, not content', () => {
    render(<GhostRows variant="leader" count={5} />);
    // An unlabeled View tree is not an accessibility element on iOS (see
    // src/test/a11yCollapse.ts); the guard is that nothing here is labelled.
    expect(screen.queryAllByRole('text')).toHaveLength(0);
    expect(screen.queryAllByLabelText(/./)).toHaveLength(0);
  });
});

describe('EmptyStateCard', () => {
  it('carries the title, body and CTA through the card wrapper', () => {
    const onCta = jest.fn();
    render(
      <EmptyStateCard
        title={i18n.t('wordList.emptyTitle')}
        body={i18n.t('wordList.emptyBody')}
        cta={i18n.t('quiz.backToHome')}
        onCta={onCta}
      />,
    );
    expect(screen.getByText(i18n.t('wordList.emptyTitle'))).toBeTruthy();
    expect(screen.getByText(i18n.t('wordList.emptyBody'))).toBeTruthy();

    fireEvent.press(screen.getByText(i18n.t('quiz.backToHome')));
    expect(onCta).toHaveBeenCalledTimes(1);
  });

  it('renders the illustration slot', () => {
    render(<EmptyStateCard illustration={<InlineNote testID="illo">x</InlineNote>} title="t" />);
    expect(screen.getByTestId('illo')).toBeTruthy();
  });
});

describe('EmptyOverlay', () => {
  it('renders the ghost layer and the message together', () => {
    render(
      <EmptyOverlay ghost={<GhostRows variant="word" count={3} />}>
        <EmptyStateCard title={i18n.t('wordList.emptyTitle')} />
      </EmptyOverlay>,
    );
    expect(screen.getByText(i18n.t('wordList.emptyTitle'))).toBeTruthy();
    expect(pulses()).toBe(0); // the overlay's ghost never pulses
  });

  it('keeps the card pressable through the overlay layer', () => {
    const onCta = jest.fn();
    render(
      <EmptyOverlay ghost={<GhostRows variant="deck" count={3} />}>
        <EmptyStateCard title="t" cta={i18n.t('quiz.backToHome')} onCta={onCta} />
      </EmptyOverlay>,
    );
    // Regression guard: the overlay fills its parent, so `pointerEvents` on that
    // layer must be box-none — 'auto' would swallow the press before it lands.
    fireEvent.press(screen.getByText(i18n.t('quiz.backToHome')));
    expect(onCta).toHaveBeenCalledTimes(1);
  });
});

describe('InlineNote', () => {
  it('keeps the testID callers select on', () => {
    render(
      <InlineNote align="center" testID="result-example-empty">
        {i18n.t('translationCard.noExample')}
      </InlineNote>,
    );
    expect(screen.getByTestId('result-example-empty')).toBeTruthy();
    expect(screen.getByText(i18n.t('translationCard.noExample'))).toBeTruthy();
  });
});

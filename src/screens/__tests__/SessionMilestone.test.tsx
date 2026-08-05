// @ts-nocheck — jest mock-factory hoisting forbids identifiers inside the
// factories, so this file is excluded from tsc (see QuizScreen.test.tsx).
//
// The post-quiz milestone screen, genericized 2026-08-04.
//
// It used to reduce the session to ONE tier — the highest any word reached —
// and frame everything around it: that tier's badge, and a headline that read
// either "You reached the Summit!" or "New camp reached!". A single session
// routinely promotes words into different camps, so the frame was wrong more
// often than right. The mixed-tier test below is the case it got wrong, and the
// one a future "simplification" is most likely to reintroduce.

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

jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  const builder = () => {
    const b = {};
    const chain = () => b;
    b.duration = chain;
    b.delay = chain;
    b.springify = chain;
    return b;
  };
  const entering = new Proxy({}, { get: () => builder });
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c) => c },
    FadeIn: builder(),
    FadeInDown: builder(),
    FadeOut: builder(),
    ZoomIn: builder(),
    Easing: { linear: (x) => x, out: () => (x) => x, in: () => (x) => x, cubic: (x) => x },
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: (fn) => fn(),
    withTiming: (to) => to,
    // Confetti stacks these on top of withTiming for its stagger.
    withDelay: (_ms, v) => v,
    cancelAnimation: () => {},
    runOnJS: (fn) => fn,
    ...entering,
  };
});

// Confetti is decoration and sizes itself off the window (0×0 under jest, which
// makes its animation math produce NaN styles). Not what's under test.
jest.mock('@/ui/Confetti', () => ({ Confetti: () => null }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: (props) => props.children,
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));

jest.mock('@/query/hooks', () => ({
  useDueCards: () => ({ cards: [], isLoading: false }),
  useHomeData: () => ({ streakDays: 3 }),
  useCommitQuizSession: () => ({ mutate: jest.fn() }),
  useEntitlement: () => ({ entitlement: undefined, isPaid: false, isLoading: false }),
}));

jest.mock('@/tour/walkthrough', () => ({
  useWalkthroughActive: () => false,
  WalkthroughOverlayHost: () => null,
  tourTargets: { quizGutter: { current: null } },
}));

import { render, screen } from '@testing-library/react-native';
import { SessionMilestoneScreen } from '@/screens/QuizScreen';
import { BRAND_MARK_KNOCKOUT_XML } from '@/ui/brandMark';
import { TIER_BADGE_XML } from '@/ui/tierBadges';
import i18n from '@/i18n';

const t = (k, o) => i18n.t(k, o);
const promo = (cardId, word, from, to) => ({ cardId, word, from, to });

const show = (promotions) => render(<SessionMilestoneScreen promotions={promotions} onContinue={jest.fn()} />);
const svgXml = () => screen.UNSAFE_getAllByType(require('react-native-svg').SvgXml).map((n) => n.props.xml);

describe('session milestone screen', () => {
  it('headlines the COUNT, not a tier', () => {
    show([promo('c1', 'coraje', 'sr', 'summit'), promo('c2', 'río', 'bc', 'abc'), promo('c3', 'nieve', 'hc', 'sr')]);
    expect(screen.getByText(t('quiz.milestoneHeadline', { count: 3 }))).toBeTruthy();
  });

  it('reads naturally for a single promoted word', () => {
    show([promo('c1', 'coraje', 'sr', 'summit')]);
    expect(screen.getByText(t('quiz.milestoneHeadline', { count: 1 }))).toBeTruthy();
    expect(screen.getByText(t('quiz.milestoneSub', { count: 1 }))).toBeTruthy();
  });

  it('shows the brand mark, never one tier’s badge', () => {
    // THE bug: a session with one summit word and two others drew the Summit
    // badge over all three, so every word on the list read as a summit.
    show([promo('c1', 'coraje', 'sr', 'summit'), promo('c2', 'río', 'bc', 'abc')]);
    const xml = svgXml();
    expect(xml).toContain(BRAND_MARK_KNOCKOUT_XML);
    for (const badge of Object.values(TIER_BADGE_XML)) {
      expect(xml).not.toContain(badge);
    }
  });

  it('keeps each word’s own camps on its own row', () => {
    // Tier language is not banned — it is relocated to where it is TRUE.
    show([promo('c1', 'coraje', 'sr', 'summit'), promo('c2', 'río', 'bc', 'abc')]);
    expect(screen.getByText('coraje')).toBeTruthy();
    expect(screen.getByText('río')).toBeTruthy();
    expect(screen.getByText(`${t('tier.sr.name')} → ${t('tier.summit.name')}`)).toBeTruthy();
    expect(screen.getByText(`${t('tier.bc.name')} → ${t('tier.abc.name')}`)).toBeTruthy();
  });

  it('claims nothing about the summit when no word reached it', () => {
    show([promo('c1', 'río', 'bc', 'abc')]);
    const summitName = t('tier.summit.name');
    expect(screen.queryByText(new RegExp(summitName))).toBeNull();
  });
});

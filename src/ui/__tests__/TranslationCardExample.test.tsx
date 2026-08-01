// @ts-nocheck — jest mock factories forbid out-of-scope identifiers.
//
// The "Show example sentence" affordance (16 §3). Azure cannot tell us in
// advance whether a (term, sense) pair has example sentences: numExamples
// UNDER-reports (measured 2026-07-30 — en→de tree→baum claims 0 and returns 15),
// so the button is optimistic and the ANSWER comes back as exampleStatus. Two
// failure modes are pinned here because both read to a user as a broken button:
//   1. offering the affordance on azure_mt entries, where the examples function
//      returns [] by contract and no amount of tapping can ever succeed;
//   2. re-rendering the untouched button after a resolved-but-empty fetch, which
//      is indistinguishable from the tap having done nothing at all.

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
    return b;
  };
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (c) => c },
    View,
    // These are VALUES, not factories: the component calls FadeIn.duration(180),
    // so each name must already be a built chainable (matching maestroSelectors).
    FadeIn: builder(),
    FadeOut: builder(),
    LinearTransition: builder(),
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: (fn) => (typeof fn === 'function' ? fn() : {}),
    withTiming: (v) => v,
    runOnJS: (fn) => fn,
    cancelAnimation: () => {},
  };
});

import { fireEvent, render, screen } from '@testing-library/react-native';
import { TranslationCard } from '@/ui/TranslationCard';
import i18n from '@/i18n';

const RESULT = {
  sourceText: 'tree',
  phonetic: '',
  pos: 'noun',
  translations: [{ id: 'tree:sor', word: 'Sor', pos: 'noun' }],
};

const renderCard = (opts = {}) =>
  render(
    <TranslationCard
      result={RESULT}
      currentIdx={0}
      onSetCurrent={() => {}}
      onSave={() => {}}
      onDelete={() => {}}
      onRequestExample={() => {}}
      sourceLang="EN"
      targetLang="TLH-LATN"
      {...opts}
    />,
  );

const texts = () =>
  screen
    .UNSAFE_getAllByType(require('react-native').Text)
    .map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children))
    .filter((c) => typeof c === 'string');

describe('TranslationCard — example-sentence affordance', () => {
  it('offers the button by default (dictionary-backed result)', () => {
    renderCard();
    expect(screen.queryByTestId('result-example')).not.toBeNull();
    expect(texts()).toContain(i18n.t('translationCard.showExample'));
  });

  it('hides the button entirely for azure_mt results', () => {
    // phrase_mt entries: supabase/functions/examples short-circuits to [] for
    // these, so the button could never resolve to anything.
    renderCard({ examplesSupported: false });
    expect(screen.queryByTestId('result-example')).toBeNull();
    expect(texts()).not.toContain(i18n.t('translationCard.showExample'));
  });

  it('replaces the button with a terminal note when the fetch returns empty', () => {
    renderCard({ exampleStatus: 'empty' });
    expect(screen.queryByTestId('result-example')).toBeNull();
    expect(screen.queryByTestId('result-example-empty')).not.toBeNull();
    expect(texts()).toContain(i18n.t('translationCard.noExample'));
  });

  it('offers a retry — not the original label — after a failed fetch', () => {
    const onRequestExample = jest.fn();
    renderCard({ exampleStatus: 'error', onRequestExample });
    expect(texts()).toContain(i18n.t('translationCard.exampleError'));
    expect(texts()).not.toContain(i18n.t('translationCard.showExample'));
    fireEvent.press(screen.getByTestId('result-example'));
    expect(onRequestExample).toHaveBeenCalledWith(0);
  });

  it('shows the loading label while in flight, with no pressable button', () => {
    renderCard({ exampleLoading: true });
    expect(screen.queryByTestId('result-example')).toBeNull();
    expect(texts()).toContain(i18n.t('translationCard.loadingExample'));
  });
});

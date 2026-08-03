// @ts-nocheck — jest's mock-factory hoisting forbids identifiers (incl. type
// annotations) inside jest.mock() factories. Runs through babel; excluded from tsc.
//
// Maestro SELECTOR guard (2026-07-28) — the layer maestroStrings.test.ts can't see.
//
// maestroStrings proves a flow's text selector matches SOME renderable string
// (an en.json leaf or a fixture field). That is necessary but not sufficient, and
// the gap cost three nightlies: `assertVisible: 'mosca'` matched the fixture's
// `displayTarget`, while the card composed `prefixWord + displayTarget` and printed
// "la mosca". Maestro matches the WHOLE element text (maestro.Filters.textMatches
// → Regex.matches), so the selector could never hit — and jest stayed green.
//
// This suite closes that gap for the COMPOSED surfaces: it drives the REAL mock
// DataSource through the exact lookups `.maestro/word-capture.yaml` performs, maps
// them with the REAL view-model (`toCardResult`), renders the REAL components, and
// then applies MAESTRO'S OWN matching rule to the text that actually came out.
//
// Scope, stated honestly:
//   COVERED — everything composed from fixture data + i18n templates: the
//     translation card (both senses, save/saved/unsaveable states), the word row,
//     the delete confirm dialog, the rejected/no-result empty states.
//   NOT COVERED — screen chrome asserted straight from en.json ('My Words',
//     '60 words', 'Word Mastery', 'You are here', 'Account', the delete toast):
//     those are single leaves with no composition step, and maestroStrings already
//     pins them. Also NOT covered: anything about LAYOUT — whether an element is
//     on-screen, scrolled into view, or behind the IME. This suite answers "would
//     Maestro's selector match this widget's text", never "can Maestro see it".
import { render, screen } from '@testing-library/react-native';
import * as fs from 'node:fs';
import * as path from 'node:path';

declare const __dirname: string;

// ── Native-module mocks (same shape as QuizScreen.test.tsx) ──────────────────
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
    FadeOut: builder(),
    FadeInDown: builder(),
    ZoomIn: builder(),
    LinearTransition: builder(),
    Easing: { out: () => () => 0, in: () => () => 0, cubic: () => 0, ease: () => 0, bezier: () => () => 0 },
    // Sheet (which ConfirmDialog composes) drives its open/close with the shared-
    // value API; a synchronous stand-in is enough to get a mounted, open tree.
    useSharedValue: (v) => ({ value: v }),
    useAnimatedStyle: (fn) => (typeof fn === 'function' ? fn() : {}),
    useDerivedValue: (fn) => ({ value: typeof fn === 'function' ? fn() : undefined }),
    withTiming: (v) => v,
    // Sheet lifts itself off the keyboard with useAnimatedKeyboard (2026-07-28);
    // a closed-keyboard stand-in keeps the mounted tree identical to before.
    useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 0 } }),
    withSpring: (v) => v,
    withDelay: (_, v) => v,
    runOnJS: (fn) => fn,
    interpolate: (x) => x,
    Extrapolation: { CLAMP: 'clamp' },
    ...entering,
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: (props) => props.children,
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));

// ReanimatedSwipeable needs the gesture-handler native side; the row's FACE is what
// carries the swipe anchor text, so a pass-through wrapper is faithful for this test.
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: (props) => <View>{props.children}</View> };
});

import i18n from '@/i18n';
import { mockDataSource, SMOKE_FIXTURES } from '@/data/mock';
import { toCardResult } from '@/screens/SearchScreen';
import { ConfirmDialog, EmptyState, PortalHost, TranslationCard, WordRow } from '@/ui';

import { maestroMatches } from './maestroMatch';

const t = (k, o) => i18n.t(k, o);

// Maestro's matcher now lives in ./maestroMatch so this suite and
// maestroScreens.test.tsx cannot drift apart on the one rule that matters.

/** Every string the rendered tree would expose to Maestro as an element `text`. */
function renderedTexts(): string[] {
  return screen.root == null
    ? []
    : screen
        .UNSAFE_getAllByType(require('react-native').Text)
        .map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : n.props.children))
        .filter((c) => typeof c === 'string' && c.length > 0);
}

function expectSelectorHits(selector: string, texts: string[]) {
  const hit = texts.find((x) => maestroMatches(selector, x));
  if (hit == null) {
    throw new Error(
      `Maestro selector ${JSON.stringify(selector)} matches NO rendered text.\n` +
        `Maestro matches the WHOLE element text — a substring needs explicit '.*'.\n` +
        `Rendered here: ${JSON.stringify(texts)}`,
    );
  }
  expect(hit).toBeTruthy();
}

/** The mock lookup, exactly as the app performs it (EN→ES, the flow's direction). */
async function lookup(q: string) {
  const outcome = await mockDataSource.lookup(q, 'native_to_target');
  expect(outcome.status).toBe('found');
  return toCardResult(outcome.result, t);
}

function renderCard(result: string, opts: Record<string, unknown> = {}) {
  return render(
    <TranslationCard
      result={result}
      currentIdx={0}
      onSetCurrent={() => {}}
      onSave={() => {}}
      onDelete={() => {}}
      onRequestExample={() => {}}
      sourceLang="EN"
      targetLang="ES"
      {...opts}
    />,
  );
}

// ── The flow's own selectors, read from the YAML (no hand-copied list) ───────
// Comments are stripped first: the header quotes strings like "la mosca" while
// explaining the bug, and a comment hit would let this suite pass on a flow that
// no longer contains the selector at all.
const FLOW = fs
  .readFileSync(path.resolve(__dirname, '../../.maestro/word-capture.yaml'), 'utf8')
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');
function flowHas(selector: string): boolean {
  return FLOW.includes(`'${selector}'`) || FLOW.includes(`"${selector}"`);
}

describe("Maestro word-capture selectors match what the components actually render", () => {
  it('the flow file still contains the selectors this suite pins', () => {
    for (const s of ['volar', 'la mosca', 'Save word', 'Saved!', "Can't save this", 'buenos dias·es', 'melancólico'])
      expect({ selector: s, present: flowHas(s) }).toEqual({ selector: s, present: true });
  });

  it("'fly' card: both senses render, and the noun keeps its determiner", async () => {
    const result = await lookup('fly');
    renderCard(result);
    const texts = renderedTexts();

    expectSelectorHits('volar', texts); // expanded primary sense
    expectSelectorHits('la mosca', texts); // collapsed second sense — WITH 'la'
    expectSelectorHits('Save word', texts);

    // The regression itself: the bare fixture field is NOT what the card prints,
    // so a selector built from it can never match. This is the assertion that
    // would have gone red on 2026-07-13, before the first nightly ever ran.
    const noun = SMOKE_FIXTURES.FLY_SENSES.find((s) => s.prefixWord);
    expect(texts.some((x) => maestroMatches(noun.displayTarget, x))).toBe(false);
    expect(flowHas(noun.displayTarget) && !flowHas(`la ${noun.displayTarget}`)).toBe(false);
  });

  it("'fly' card: the just-saved state renders the 'Saved!' the flow asserts", async () => {
    const result = await lookup('fly');
    const primary = result.translations[0];
    renderCard(result, { savedIds: new Set([primary.id]), justSavedId: primary.id });
    expectSelectorHits('Saved!', renderedTexts());
  });

  it("phrase path: 'buenos dias' renders the fabricated headword and a saveable action", async () => {
    const result = await lookup('buenos dias');
    renderCard(result);
    const texts = renderedTexts();
    expectSelectorHits('buenos dias·es', texts);
    expectSelectorHits('Save word', texts);
  });

  it('identity-echo: the card is unsaveable and says so', async () => {
    const result = await lookup(SMOKE_FIXTURES.MOCK_ECHO);
    renderCard(result);
    const texts = renderedTexts();
    expectSelectorHits("Can't save this", texts);
    // …and the Save affordance is gone, which is what makes the gate meaningful.
    expect(texts.some((x) => maestroMatches('Save word', x))).toBe(false);
  });

  it('Tier-0 rejection renders the empty state the flow asserts', () => {
    render(<EmptyState title={t('capture.rejectedTitle')} body={t('capture.reason.not_a_word', { lang: 'Spanish' })} />);
    expectSelectorHits("Hmm, that's not quite a card", renderedTexts());
  });

  it('not_found renders the empty state the flow asserts', () => {
    render(<EmptyState title={t('search.noResultsTitle')} body={t('search.noResultsBody')} />);
    expectSelectorHits("We couldn't find that one.", renderedTexts());
  });

  it('word row: the swipe anchor is a real, whole text node on the first fixture row', async () => {
    const words = await mockDataSource.getWords('es');
    // buildWords sorts newest-first and WORD_BANK[0] carries the newest createdAt,
    // so the flow's anchor is the FIRST row — no scrolling needed before the swipe.
    expect(words[0].native).toBe('melancólico');
    // 60 unique fixture words ⇒ the anchor is unambiguous (Maestro would otherwise
    // have to disambiguate between identical rows).
    expect(words.filter((w) => w.native === 'melancólico')).toHaveLength(1);
    render(<WordRow word={words[0]} />);
    expectSelectorHits('melancólico', renderedTexts());
  });

  it('delete confirm renders the exact interpolated title the flow asserts', () => {
    // ConfirmDialog → Sheet → Portal, so its content lands in the root PortalHost,
    // not inline (ui/Portal.tsx — RN Modal is banned in this app). Mount the host
    // alongside it, the same way the root layout does.
    render(
      <>
        <ConfirmDialog
          visible
          title={t('wordList.deleteTitle', { word: 'melancólico' })}
          body={t('wordList.deleteBody')}
          confirmLabel={t('wordList.deleteConfirm')}
          onConfirm={() => {}}
          onClose={() => {}}
        />
        <PortalHost />
      </>,
    );
    // The flow escapes the '?' (regex metachar) — verify the escaped selector too.
    const texts = renderedTexts();
    expectSelectorHits('Delete “melancólico”\\?', texts);
  });
});

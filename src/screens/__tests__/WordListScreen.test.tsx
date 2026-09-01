// @ts-nocheck — see QuizScreen.test.tsx: jest mock-factory hoisting forbids
// identifiers inside the factories, so this file is excluded from tsc.
//
// Word CRUD audit (2026-08-04). The reported symptoms were two — "deleting one
// word clears more words than the one deleted" and "the count says 1 when 2
// exist" — and they turned out to be ONE defect: the header counted
// `words.length - removed.length`, charging for the same delete twice as soon
// as the ['words'] refetch came back without the deleted row. At 3 words that
// read as 1 under a list of 2; at 2 words it read as 0, which tripped the
// `noneSaved` branch and swapped the entire list for the empty state.
//
// The delete WRITE was never wrong (`delete_card` is `where id = ? and user_id
// = ?`, no triggers, and study_events logs exactly one word_deleted per tap) —
// which is why these assertions are all on what the screen renders after the
// server truth lands.

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
    // SkeletonRows shimmers with withRepeat + Easing.inOut(Easing.quad); the
    // deferred-filtering tests actually render it, unlike the earlier suites.
    Easing: { out: () => () => 0, in: () => () => 0, inOut: () => () => 0, cubic: () => 0, quad: () => 0 },
    withRepeat: (v) => v,
    useSharedValue: (v) => ({ value: v }),
    // WordRow's swipe tray is a ReanimatedSwipeable — it reaches for these.
    useAnimatedRef: () => ({ current: null }),
    useDerivedValue: (fn) => ({ value: fn() }),
    measure: () => null,
    useAnimatedStyle: () => ({}),
    useAnimatedKeyboard: () => ({ height: { value: 0 }, state: { value: 0 } }),
    withTiming: (v) => v,
    withSpring: (v) => v,
    runOnJS: (fn) => fn,
    interpolate: () => 0,
    ...entering,
  };
});

// WordRow's swipe tray is a ReanimatedSwipeable, which pulls the whole
// gesture-handler ↔ reanimated worklet bridge into the renderer. The tray is not
// what's under test — both it and the detail sheet set the SAME `pendingDelete`
// — so render the row face and skip the gesture layer.
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const { View } = require('react-native');
  return { __esModule: true, default: (props) => <View>{props.children}</View> };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: (props) => props.children,
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));

// The heavy-mount gate would otherwise hold the list behind a skeleton for the
// whole test (requestIdleCallback never settles under fake timers).
// Controllable: the screen now keys this on the FILTER inputs, not just the
// sub-tab, so a test can hold the list in its skeleton the way a real device
// does for the frame after a filter change.
let mockReady = true;
jest.mock('@/lib/useDeferredReady', () => ({ useDeferredReady: () => mockReady }));

const DAY = 24 * 60 * 60 * 1000;
// Name MUST start with `mock`: babel-plugin-jest-hoist lifts jest.mock() above
// the imports and rejects any other out-of-scope reference from a factory.
const mockWord = (id, native, target) => ({
  id,
  translationId: `t-${id}`,
  senseTarget: target,
  native,
  target,
  originalTarget: target,
  targetOverride: null,
  pos: 'noun',
  example: '',
  exampleTranslation: '',
  provider: 'azure_dictionary',
  stability: 4,
  reps: 3,
  createdAt: new Date(Date.now() - DAY),
  dueAt: new Date(Date.now() + DAY),
  suspended: false,
});

// Server truth. `mockDeleteCard.mutate` mutates it the way the real delete does:
// the RPC succeeds and the invalidated ['words'] query comes back one row short.
// Reading it fresh on every render is what makes this a regression test rather
// than a snapshot — the double-count only appears AFTER the refetch lands.
let mockRows = [];
const mockDeleteCard = { mutate: jest.fn((id) => { mockRows = mockRows.filter((w) => w.id !== id); }) };
const mockNoopMutation = { mutate: jest.fn(), isPending: false };

// Pull-to-refresh reaches for the real QueryClient; this suite mocks the data
// layer wholesale and mounts no provider. Refresh has its own tests.
jest.mock('@/query/usePullToRefresh', () => ({
  usePullToRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }),
  REFRESH_THROTTLE_MS: 5000,
}));

jest.mock('@/query/hooks', () => ({
  useWords: () => ({ words: mockRows, isLoading: false }),
  useDeleteCard: () => mockDeleteCard,
  useSetCardSuspended: () => mockNoopMutation,
  useSetCardTargetOverride: () => mockNoopMutation,
  useDecks: () => ({ decks: [], isLoading: false }),
  useDeckWords: () => ({ words: [], isLoading: false }),
  useCardDeckIds: () => ({ deckIds: [], isLoading: false }),
  useCreateDeck: () => mockNoopMutation,
  useDeleteDeck: () => mockNoopMutation,
  useAddCardToDeck: () => mockNoopMutation,
  useRemoveCardFromDeck: () => mockNoopMutation,
  useEntitlement: () => ({ isPaid: true, isLoading: false }),
  useActiveLang: () => 'es',
  // The word-detail sheet's lazy example fetch (16 §3) — never requested here.
  useExamples: () => ({ examples: [], isLoading: false, isSettled: true, isError: false, refetch: jest.fn() }),
  // Pulled in by the header's LanguageIndicator, not by the list itself.
  useProfile: () => ({ nativeLang: 'en', targetLang: 'es' }),
  useLearningLanguages: () => ({ languages: ['es'], isLoading: false }),
  useAddLanguage: () => mockNoopMutation,
  useSwitchLanguage: () => mockNoopMutation,
  useRemoveLanguage: () => mockNoopMutation,
}));

// `useWalkthroughActive` normally reads a native TourGuideProvider context this
// suite never mounts — proxy it off the real `tourScene` store instead (same
// trick as QuizScreen.test.tsx), so a test can flip the tour on with
// `useTourScene.getState().setStepId(...)`. `tourTargets` stays REAL
// (requireActual): the screen writes `tourTargets.wordsToolbar.current = node`
// in a ref callback, and a hand-written stand-in throws the moment that ref
// doesn't exist on it.
jest.mock('@/tour/walkthrough', () => ({
  ...jest.requireActual('@/tour/walkthrough'),
  useWalkthroughActive: () => require('@/tour/tourScene').useTourScene.getState().stepId != null,
}));

import { fireEvent, render, screen } from '@testing-library/react-native';
import { WordListScreen } from '@/screens/WordListScreen';
import { PortalHost } from '@/ui/Portal';
import { useTourScene } from '@/tour/tourScene';
import i18n from '@/i18n';

const t = (k, o) => i18n.t(k, o);

// ConfirmDialog renders through the in-app Portal, so the host has to be mounted
// alongside the screen for the confirm button to exist.
const renderScreen = () =>
  render(
    <>
      <WordListScreen />
      <PortalHost />
    </>,
  );

/** Delete a word the way a user does: row → detail sheet → confirm. (The swipe
 *  tray is the other entry point; both land on the same `pendingDelete`.) */
const deleteWord = (target) => {
  fireEvent.press(screen.getByText(target));
  fireEvent.press(screen.getByText(t('wordList.deleteWord')));
  fireEvent.press(screen.getByText(t('wordList.deleteConfirm')));
};

beforeEach(() => {
  mockReady = true;
  mockRows = [mockWord('c1', 'the sugar', 'el azúcar'), mockWord('c2', 'the salt', 'la sal')];
  useTourScene.getState().setStepId(null);
});
afterAll(() => useTourScene.getState().setStepId(null));

describe('Word List — delete (CRUD audit 2026-08-04)', () => {
  it('deletes exactly the word asked for, server-side and on screen', () => {
    renderScreen();
    deleteWord('el azúcar');

    // One RPC call, for the row the user pressed — not its neighbour.
    expect(mockDeleteCard.mutate).toHaveBeenCalledTimes(1);
    expect(mockDeleteCard.mutate.mock.calls[0][0]).toBe('c1');
    expect(mockRows.map((w) => w.id)).toEqual(['c2']);

    // …and the survivor is still on screen.
    expect(screen.getByText('la sal')).toBeTruthy();
    expect(screen.queryByText('el azúcar')).toBeNull();
  });

  it('does not swap the list for the empty state when one of two words goes', () => {
    // The headline symptom: with 2 saved words, `2 - 1 - 1 = 0` tripped
    // `noneSaved` and rendered "No saved words yet" over a list that still had
    // a word in it — deleting one word looked like losing both.
    renderScreen();
    deleteWord('el azúcar');

    expect(screen.queryByText(t('wordList.emptyTitle'))).toBeNull();
    expect(screen.getByText('la sal')).toBeTruthy();
  });

  it('keeps the header count equal to the number of rows rendered', () => {
    mockRows = [mockWord('c1', 'the sugar', 'el azúcar'), mockWord('c2', 'the salt', 'la sal'), mockWord('c3', 'the bread', 'el pan')];
    renderScreen();
    expect(screen.getByText(t('wordList.count', { count: 3 }))).toBeTruthy();

    deleteWord('el azúcar');

    // Was "1 word" over a two-row list.
    expect(screen.getByText(t('wordList.count', { count: 2 }))).toBeTruthy();
    expect(screen.getByText('la sal')).toBeTruthy();
    expect(screen.getByText('el pan')).toBeTruthy();
  });

  it('survives deleting every word down to the empty state', () => {
    renderScreen();
    deleteWord('el azúcar');
    deleteWord('la sal');

    expect(mockRows).toEqual([]);
    // The count must land on 0 — not the -1 the double subtraction produced.
    expect(screen.getByText(t('wordList.count', { count: 0 }))).toBeTruthy();
    expect(screen.getByText(t('wordList.emptyTitle'))).toBeTruthy();
  });

  it('restores the row when the delete fails', () => {
    mockDeleteCard.mutate.mockImplementationOnce((_id, opts) => opts?.onError?.(new Error('offline')));
    renderScreen();
    deleteWord('el azúcar');

    expect(screen.getByText('el azúcar')).toBeTruthy();
    expect(screen.getByText(t('wordList.count', { count: 2 }))).toBeTruthy();
  });
});

describe('Word List — sort dimensions (rename 2026-08-04)', () => {
  it('sorts by next review, soonest first, when that dimension is picked', () => {
    // The dimension formerly labelled "Memory strength" (2026-08-04 rename). It
    // has always sorted on `dueAt`; only the label was wrong. Asserting the
    // ORDER here means a future rename can't quietly repoint it at `stability`,
    // which is the distinction the rename exists to make.
    const soon = mockWord('c1', 'the sugar', 'el azúcar');
    soon.dueAt = new Date(Date.now() + DAY);
    soon.stability = 90; // Summit-tier: durable memory, still due first
    const later = mockWord('c2', 'the salt', 'la sal');
    later.dueAt = new Date(Date.now() + 30 * DAY);
    later.stability = 2; // fragile, but not due for a month
    mockRows = [later, soon];

    renderScreen();
    fireEvent.press(screen.getByLabelText(t('common.filter')));
    fireEvent.press(screen.getByText(t('wordList.sortDimDue')));
    fireEvent.press(screen.getByText(t('wordList.apply')));

    const rows = screen.getAllByText(/el azúcar|la sal/);
    expect(rows.map((r) => r.props.children)).toEqual(['el azúcar', 'la sal']);
  });
});

// Filtering and sorting a 4,000-word library is real JS-thread work, and it used
// to run in the same commit as the tap that changed a filter — so Apply, and the
// traversal into this screen, froze until it finished (Casey, 2026-08-05). The
// list now computes from `applied` inputs that lag the controls by a frame, and
// the gap is the skeleton.
describe('Word List — deferred filtering (perf 2026-08-05)', () => {
  const tree = () => (
    <>
      <WordListScreen />
      <PortalHost />
    </>
  );

  it('holds the previous list behind the skeleton while a filter change settles', () => {
    mockRows = [mockWord('c1', 'the sugar', 'el azúcar'), mockWord('c2', 'the salt', 'la sal')];
    const { rerender } = renderScreen();
    expect(screen.getByText('el azúcar')).toBeTruthy();

    // Apply is pressed while the screen is idle...
    fireEvent.press(screen.getByLabelText(t('common.filter')));
    fireEvent.press(screen.getByText(t('wordList.sortDimDue')));
    fireEvent.press(screen.getByText(t('wordList.apply')));

    // ...and THAT is the frame where the filter key changes, so the gate closes.
    mockReady = false;
    rerender(tree());

    // The list is gone for that frame — which is the point: the heavy filter and
    // sort did not run in the commit that handled the tap.
    expect(screen.queryByText('el azúcar')).toBeNull();
  });

  it('adopts the new filter once the frame has painted', () => {
    mockRows = [mockWord('c1', 'the sugar', 'el azúcar'), mockWord('c2', 'the salt', 'la sal')];
    const { rerender } = renderScreen();

    fireEvent.press(screen.getByLabelText(t('common.filter')));
    fireEvent.press(screen.getByText(t('wordList.sortDimDue')));
    fireEvent.press(screen.getByText(t('wordList.apply')));

    mockReady = false;
    rerender(tree());
    mockReady = true;
    rerender(tree());

    // Back, computed from the newly applied inputs.
    expect(screen.getByText('el azúcar')).toBeTruthy();
    expect(screen.getByText('la sal')).toBeTruthy();
  });

  it('disables Apply while a previous apply is still settling', () => {
    // Queuing a second pass on top of the one already running only makes the
    // stall longer.
    mockReady = false;
    renderScreen();
    fireEvent.press(screen.getByLabelText(t('common.filter')));
    expect(screen.getByText(t('wordList.apply'))).toBeDisabled();
  });
});

// The Filter & Sort CTAs gate on the sheet's DRAFT (UX audit): Apply lights up
// when the draft differs from what's applied, Reset when it differs from the
// defaults. Both were previously always-live, so "Apply" on an untouched sheet
// re-ran the whole filter for nothing and "Reset" on a default filter looked
// like it should do something. The failure mode if this regresses is silent —
// the buttons still work, they just stop telling you whether they'd do anything.
describe('Word List — filter sheet CTA gating', () => {
  const openSheet = () => fireEvent.press(screen.getByTestId('words-filter'));
  const isDisabled = (testID) =>
    screen.getByTestId(testID).props.accessibilityState?.disabled === true;

  it('opens with both CTAs inert on an untouched default filter', () => {
    renderScreen();
    openSheet();

    // Nothing drafted yet → Apply has nothing to commit…
    expect(isDisabled('filter-apply')).toBe(true);
    // …and the filter is already the default → Reset has nothing to clear.
    expect(isDisabled('filter-reset')).toBe(true);
  });

  it('enables both once the draft moves off the default', () => {
    renderScreen();
    openSheet();
    fireEvent.press(screen.getByTestId('sort-alpha'));

    expect(isDisabled('filter-apply')).toBe(false);
    expect(isDisabled('filter-reset')).toBe(false);
  });

  it('re-inerts Apply when the draft is returned to what is already applied', () => {
    renderScreen();
    openSheet();
    // Off the default and back again: Apply must notice it has nothing to do,
    // rather than latching "dirty" on the first interaction.
    fireEvent.press(screen.getByTestId('sort-alpha'));
    fireEvent.press(screen.getByTestId('sort-added'));

    expect(isDisabled('filter-apply')).toBe(true);
    expect(isDisabled('filter-reset')).toBe(true);
  });

  it('Reset clears the draft in place, leaving Apply live to commit it', () => {
    renderScreen();
    openSheet();
    fireEvent.press(screen.getByTestId('tier-filter-bc'));
    fireEvent.press(screen.getByTestId('filter-apply'));

    // Re-open: the tier filter is now the APPLIED state, so the draft matches
    // it (Apply inert) but differs from the defaults (Reset live).
    openSheet();
    expect(isDisabled('filter-apply')).toBe(true);
    expect(isDisabled('filter-reset')).toBe(false);

    fireEvent.press(screen.getByTestId('filter-reset'));

    // Reset does NOT commit — the sheet stays open with a defaulted draft, and
    // Apply is what reaches the list. Flipped from the pre-audit behaviour,
    // where Reset applied and closed on its own (.maestro/word-list.yaml).
    expect(isDisabled('filter-reset')).toBe(true);
    expect(isDisabled('filter-apply')).toBe(false);
  });
});

// Bug: a user who had Custom Decks selected before the walkthrough ever ran
// stayed on it underneath the tour's search overlay (this screen stays mounted
// across tab traversal, so `subTab` is not reset by `router.navigate('/words')`).
// w4's anchor — the All Words search/filter toolbar — is gated on
// `subTab === 'words'`, so it never mounted, and the tour got stuck spotlighting
// nothing over a screen the backdrop had made inert. Fix mirrors HomeScreen's
// `tourActive` override for the study card: render the All Words tab while the
// tour is active, independent of what the user had actually selected.
describe('Word List — walkthrough forces All Words (root-cause fix)', () => {
  const rerenderScreen = (view) =>
    view.rerender(
      <>
        <WordListScreen />
        <PortalHost />
      </>,
    );

  it('snaps back to All Words once the tour starts, even from Custom Decks', () => {
    const view = renderScreen();
    fireEvent.press(screen.getByTestId('words-tab-decks'));
    expect(screen.getByTestId('words-tab-decks').props.accessibilityState.selected).toBe(true);
    expect(screen.getByText(t('wordList.decksEmptyTitle'))).toBeTruthy();

    // w3 pre-warms this screen (arriving underneath the search overlay); w4
    // spotlights the toolbar. Either way the tour is active by the time this
    // screen is revealed.
    useTourScene.getState().setStepId('w3b');
    rerenderScreen(view);

    expect(screen.getByTestId('words-tab-all').props.accessibilityState.selected).toBe(true);
    // The w4 anchor — this is exactly the element that used to never mount.
    expect(screen.getByTestId('words-search-input')).toBeTruthy();
    expect(screen.queryByText(t('wordList.decksEmptyTitle'))).toBeNull();
  });

  it('restores the user’s own Custom Decks selection once the tour ends', () => {
    const view = renderScreen();
    fireEvent.press(screen.getByTestId('words-tab-decks'));

    useTourScene.getState().setStepId('w3b');
    rerenderScreen(view);
    expect(screen.getByTestId('words-tab-all').props.accessibilityState.selected).toBe(true);

    useTourScene.getState().setStepId(null);
    rerenderScreen(view);

    // Overriding the RENDERED tab must not have clobbered the user's actual
    // selection underneath it.
    expect(screen.getByTestId('words-tab-decks').props.accessibilityState.selected).toBe(true);
    expect(screen.getByText(t('wordList.decksEmptyTitle'))).toBeTruthy();
  });
});

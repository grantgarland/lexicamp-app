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
    Easing: { out: () => () => 0, in: () => () => 0, cubic: () => 0 },
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
jest.mock('@/lib/useDeferredReady', () => ({ useDeferredReady: () => true }));

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

import { fireEvent, render, screen } from '@testing-library/react-native';
import { WordListScreen } from '@/screens/WordListScreen';
import { PortalHost } from '@/ui/Portal';
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
  mockRows = [mockWord('c1', 'the sugar', 'el azúcar'), mockWord('c2', 'the salt', 'la sal')];
});

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

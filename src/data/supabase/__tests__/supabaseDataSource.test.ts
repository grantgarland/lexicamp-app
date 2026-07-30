// SupabaseDataSource branching-logic tests. The real client is replaced with a
// scripted fake (FIFO response mockQueue + call recorder), so these exercise the
// source's OWN logic — the pieces a live backend can't cheaply regression-test:
//   · getDecks drops the hidden main deck 
//   · getDueCards two-pull fill composition + null-state row filtering
//   · commitQuizSession skips cards deleted mid-session and no-ops on empty
//   · updateProfile quiz-length ladder validation + display-name normalization
//   · logEvent allowlist (client can't shadow server-written event names)
import { QUIZ_LENGTHS } from '@/domain/quiz';

type Resp = { data: unknown; error: unknown };
interface RecordedCall {
  table: string;
  ops: [string, unknown[]][];
}

const mockQueue: Resp[] = [];
const mockCalls: RecordedCall[] = [];
const mockRpcCalls: [string, unknown][] = [];
const mockInvokeQueue: { data?: unknown; error?: unknown }[] = [];
const mockInvokeCalls: [string, unknown][] = [];

function mockNextResp(): Resp {
  const r = mockQueue.shift();
  if (r == null) throw new Error('fake supabase: no queued response for this query');
  return r;
}

function mockMakeChain(rec: RecordedCall) {
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      rec.ops.push([name, args]);
      return chain;
    };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gt', 'lte', 'in', 'order', 'limit', 'update', 'upsert', 'insert', 'delete']) {
    chain[m] = record(m);
  }
  chain.maybeSingle = () => {
    rec.ops.push(['maybeSingle', []]);
    return Promise.resolve(mockNextResp());
  };
  chain.single = () => Promise.resolve(mockNextResp());
  // PostgREST builders are thenables — awaiting the chain resolves the query.
  chain.then = (onOk: (r: Resp) => unknown, onErr?: (e: unknown) => unknown) =>
    Promise.resolve()
      .then(() => mockNextResp())
      .then(onOk, onErr);
  return chain;
}

jest.mock('../client', () => ({
  supabase: {
    from: (table: string) => {
      const rec: RecordedCall = { table, ops: [] };
      mockCalls.push(rec);
      return mockMakeChain(rec);
    },
    rpc: (name: string, args: unknown) => {
      mockRpcCalls.push([name, args]);
      return Promise.resolve(mockNextResp());
    },
    functions: {
      invoke: (name: string, opts: unknown) => {
        mockInvokeCalls.push([name, opts]);
        const r = mockInvokeQueue.shift();
        if (r == null) throw new Error('fake supabase: no queued invoke response');
        return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
      },
    },
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'user-1' } } } }),
    },
  },
}));

// Import AFTER the mock so the source binds the fake client.
import { supabaseDataSource } from '../SupabaseDataSource';

const ok = (data: unknown): Resp => ({ data, error: null });

beforeEach(() => {
  mockQueue.length = 0;
  mockCalls.length = 0;
  mockRpcCalls.length = 0;
  mockInvokeQueue.length = 0;
  mockInvokeCalls.length = 0;
});

const PROFILE_ROW = {
  id: 'user-1',
  display_name: 'Casey',
  native_lang: 'en',
  learning_lang: 'es',
  timezone: 'America/New_York',
  onboarding_complete: true,
  quiz_length: 20,
  created_at: '2026-07-01T00:00:00Z',
};

const FSRS_ROW = (cardId: string, dueAt: string) => ({
  card_id: cardId,
  user_id: 'user-1',
  stability: 5,
  difficulty: 4,
  due_at: dueAt,
  last_review_at: null,
  state: 2,
  reps: 3,
  lapses: 0,
  learning_steps: 0,
});

const CARD_ROW = (id: string) => ({
  id,
  deck_id: 'd1',
  user_id: 'user-1',
  translation_id: `tr-${id}`,
  user_note: null,
  custom_front: null,
  custom_back: null,
  suspended: false,
  created_at: '2026-07-01T00:00:00Z',
  translations_cache: {
    id: `tr-${id}`,
    display_source: `word-${id}`,
    translation: `palabra-${id}`,
    pos_tag: null,
    prefix_word: null,
    alt_translations: null,
    back_translations: null,
    examples: null,
  },
});

describe('getDecks', () => {
  it('drops the OLDEST deck (the hidden main deck, 18 §E1) and maps the rest', async () => {
    mockQueue.push(
      ok([
        { id: 'main', name: 'My words', created_at: '2026-06-01T00:00:00Z', deck_cards: [{ count: 42 }] },
        { id: 'travel', name: 'Travel', created_at: '2026-06-10T00:00:00Z', deck_cards: [{ count: 12 }] },
        { id: 'biz', name: 'Business', created_at: '2026-06-20T00:00:00Z', deck_cards: [] },
      ]),
    );
    const decks = await supabaseDataSource.getDecks('es');
    expect(decks.map((d) => d.id)).toEqual(['travel', 'biz']);
    expect(decks[0]!.wordCount).toBe(12);
    expect(decks[1]!.wordCount).toBe(0); // empty count array → 0, not a crash
    // 2026-07-30: the count MUST come from deck_cards (membership), never from
    // cards(count). Every card in a language points at that language's MAIN
    // deck, so cards(count) reported the whole library for one deck and 0 for
    // the rest — the bug that let "Food · 7 words" list unrelated verbs.
    const deckSelect = mockCalls.find((c) => c.table === 'decks')!.ops.find(([op]) => op === 'select')!;
    expect(String(deckSelect[1][0])).toContain('deck_cards(count)');
    expect(/(?:^|[\s,])cards\(count\)/.test(String(deckSelect[1][0]))).toBe(false);
    // Ordered oldest-first so slice(1) is exactly the main-deck rule.
    const deckCall = mockCalls.find((c) => c.table === 'decks')!;
    expect(deckCall.ops).toContainEqual(['order', ['created_at', { ascending: true }]]);
  });
});

describe('deck membership (2026-07-30)', () => {
  it('getDeckWords inner-joins deck_cards and scopes by BOTH deck and language', async () => {
    mockQueue.push(ok([{ ...CARD_ROW('c1'), card_fsrs_state: FSRS_ROW('c1', '2026-07-20T00:00:00Z') }]));
    const words = await supabaseDataSource.getDeckWords('travel', 'es');
    expect(words.map((w) => w.id)).toEqual(['c1']);
    const call = mockCalls.find((c) => c.table === 'cards')!;
    const select = String(call.ops.find(([op]) => op === 'select')![1][0]);
    // `!inner` is load-bearing: a plain embed filter NULLS the embed instead of
    // excluding the parent row, which would return the entire library as the
    // deck's contents — i.e. the prototype bug, re-created server-side.
    expect(select).toContain('deck_cards!inner ( deck_id )');
    expect(call.ops).toContainEqual(['eq', ['deck_cards.deck_id', 'travel']]);
    expect(call.ops).toContainEqual(['eq', ['decks.target_lang', 'es']]);
  });

  it('pins the cards→decks embed to the FK, or deck_cards makes it ambiguous (PGRST201)', async () => {
    // deck_cards has FKs to BOTH cards and decks with PK (deck_id, card_id) —
    // the shape PostgREST reads as a many-to-many junction. Without the
    // `!cards_deck_id_fkey` hint, `cards → decks` has two candidate
    // relationships and PostgREST 300s EVERY read on this projection: the Word
    // List, the home snapshot, Progress and the quiz queue. This test is the
    // regression guard — the failure mode is total and silent in a mocked suite.
    mockQueue.push(ok([]));
    await supabaseDataSource.getWords('es');
    const select = String(mockCalls.at(-1)!.ops.find(([op]) => op === 'select')![1][0]);
    expect(select).toContain('decks!cards_deck_id_fkey!inner ( target_lang )');
  });

  it('getCardDeckIds returns the deck ids a card belongs to', async () => {
    mockQueue.push(ok([{ deck_id: 'travel' }, { deck_id: 'favorites' }]));
    await expect(supabaseDataSource.getCardDeckIds('c1')).resolves.toEqual(['travel', 'favorites']);
    const call = mockCalls.find((c) => c.table === 'deck_cards')!;
    expect(call.ops).toContainEqual(['eq', ['card_id', 'c1']]);
  });

  it('createDeck passes the ACTIVE language through, so a deck can never be seeded cross-language', async () => {
    mockQueue.push(ok('new-deck-id'));
    await expect(supabaseDataSource.createDeck('Food', ['c1', 'c2'], 'ru')).resolves.toBe('new-deck-id');
    expect(mockRpcCalls).toContainEqual(['create_deck', { p_name: 'Food', p_target_lang: 'ru', p_card_ids: ['c1', 'c2'] }]);
  });

  it('add/remove membership go through the RPCs (never a direct table write)', async () => {
    mockQueue.push(ok(null));
    await supabaseDataSource.addCardToDeck('travel', 'c1');
    mockQueue.push(ok(null));
    await supabaseDataSource.removeCardFromDeck('travel', 'c1');
    expect(mockRpcCalls).toContainEqual(['add_card_to_deck', { p_deck_id: 'travel', p_card_id: 'c1' }]);
    expect(mockRpcCalls).toContainEqual(['remove_card_from_deck', { p_deck_id: 'travel', p_card_id: 'c1' }]);
  });
});

describe('getDueCards — deck-scoped session (2026-07-30)', () => {
  it('applies the deck filter to the FILL pull too, not just the due pull', async () => {
    // The subtle failure: scope the due pull but forget the top-up, and a
    // 7-word deck quietly borrows the rest of the library to reach the session
    // cap — the same "deck shows words that aren't in it" bug, one layer down.
    mockQueue.push(ok([{ ...CARD_ROW('m1'), card_fsrs_state: FSRS_ROW('m1', '2026-07-17T00:00:00Z') }]));
    mockQueue.push(ok([{ ...CARD_ROW('m2'), card_fsrs_state: FSRS_ROW('m2', '2026-07-25T00:00:00Z') }]));
    const items = await supabaseDataSource.getDueCards(5, 'es', 'travel');
    expect(items.map((i) => i.id)).toEqual(['m1', 'm2']);

    const cardCalls = mockCalls.filter((c) => c.table === 'cards');
    expect(cardCalls).toHaveLength(2); // due pull + fill pull
    cardCalls.forEach((call) => {
      expect(String(call.ops.find(([op]) => op === 'select')![1][0])).toContain('deck_cards!inner ( deck_id )');
      expect(call.ops).toContainEqual(['eq', ['deck_cards.deck_id', 'travel']]);
      expect(call.ops).toContainEqual(['eq', ['decks.target_lang', 'es']]);
    });
  });

  it('orders the PARENT by the embedded due_at, not within the to-one embed', async () => {
    // `{ referencedTable: 'card_fsrs_state' }` emits `card_fsrs_state.order=…`,
    // which sorts WITHIN the embed. card_fsrs_state is to-ONE (card_id is its
    // PK), so that sorts a one-element embed — a strict no-op, leaving the
    // parent rows unordered and `.limit()` slicing an arbitrary subset. A
    // six-week-overdue card could be dropped in favour of one due an hour ago,
    // every session. `embed(col)` is the form that orders the parent.
    mockQueue.push(ok([{ ...CARD_ROW('o1'), card_fsrs_state: FSRS_ROW('o1', '2026-07-17T00:00:00Z') }]));
    await supabaseDataSource.getDueCards(1, 'es');
    const ops = mockCalls.at(-1)!.ops;
    expect(ops).toContainEqual(['order', ['card_fsrs_state(due_at)', { ascending: true }]]);
    expect(ops.filter(([op]) => op === 'order').flatMap(([, a]) => a)).not.toContainEqual(
      expect.objectContaining({ referencedTable: 'card_fsrs_state' }),
    );
  });

  it('omits the deck join entirely when no deckId is passed (Home "Study now")', async () => {
    mockQueue.push(ok([{ ...CARD_ROW('a1'), card_fsrs_state: FSRS_ROW('a1', '2026-07-17T00:00:00Z') }]));
    await supabaseDataSource.getDueCards(1, 'es');
    const select = String(mockCalls.at(-1)!.ops.find(([op]) => op === 'select')![1][0]);
    expect(select).not.toContain('deck_cards');
  });
});

describe('getDueCards', () => {
  it('tops up with next-due cards when the due pull is under the cap, and filters rows without FSRS state', async () => {
    mockQueue.push(
      ok([
        { ...CARD_ROW('due1'), card_fsrs_state: FSRS_ROW('due1', '2026-07-17T00:00:00Z') },
        { ...CARD_ROW('ghost'), card_fsrs_state: null }, // join returned card w/o state — must not crash the mapper
      ]),
    );
    mockQueue.push(ok([{ ...CARD_ROW('next1'), card_fsrs_state: FSRS_ROW('next1', '2026-07-20T00:00:00Z') }]));
    const items = await supabaseDataSource.getDueCards(3, 'es');
    expect(items.map((i) => i.id)).toEqual(['due1', 'next1']);
    // The top-up pull asked only for the REMAINING slots (3 due-limit − 1 kept).
    const [, topUp] = mockCalls.filter((c) => c.table === 'cards');
    expect(topUp!.ops).toContainEqual(['limit', [2]]);
  });

  it('skips the top-up pull entirely when the due pull fills the cap', async () => {
    mockQueue.push(ok([{ ...CARD_ROW('a'), card_fsrs_state: FSRS_ROW('a', '2026-07-17T00:00:00Z') }]));
    const items = await supabaseDataSource.getDueCards(1, 'es');
    expect(items).toHaveLength(1);
    expect(mockCalls.filter((c) => c.table === 'cards')).toHaveLength(1);
  });
});

describe('commitQuizSession', () => {
  it('skips ratings for cards deleted mid-session instead of failing the batch', async () => {
    mockQueue.push(ok([FSRS_ROW('kept', '2026-07-17T00:00:00Z')])); // state re-read: only "kept" still exists
    mockQueue.push(ok(null)); // rpc response
    await supabaseDataSource.commitQuizSession({
      ratings: [
        { cardId: 'kept', rating: 'got_it' },
        { cardId: 'deleted', rating: 'again' },
      ],
    });
    expect(mockRpcCalls).toHaveLength(1);
    const [name, args] = mockRpcCalls[0]!;
    expect(name).toBe('commit_quiz_session');
    const reviews = (args as { p_reviews: { card_id: string }[] }).p_reviews;
    expect(reviews.map((r) => r.card_id)).toEqual(['kept']);
  });

  it('no-ops on an empty ratings batch (no reads, no RPC)', async () => {
    await supabaseDataSource.commitQuizSession({ ratings: [] });
    expect(mockCalls).toHaveLength(0);
    expect(mockRpcCalls).toHaveLength(0);
  });

  it('no-ops the RPC when every rated card was deleted', async () => {
    mockQueue.push(ok([])); // none of the rated cards still exist
    await supabaseDataSource.commitQuizSession({ ratings: [{ cardId: 'gone', rating: 'got_it' }] });
    expect(mockRpcCalls).toHaveLength(0);
  });
});

describe('updateProfile', () => {
  it('writes only ladder values for quizLength (shares QUIZ_LENGTHS with the prefs store)', async () => {
    mockQueue.push(ok(null));
    await supabaseDataSource.updateProfile({ quizLength: QUIZ_LENGTHS[2] }); // 40
    const upd = mockCalls.find((c) => c.table === 'profiles')!;
    expect(upd.ops).toContainEqual(['update', [{ quiz_length: 40 }]]);
  });

  it('drops an off-ladder quizLength and (with nothing else to write) skips the update entirely', async () => {
    await supabaseDataSource.updateProfile({ quizLength: 25 });
    expect(mockCalls).toHaveLength(0);
  });

  it('normalizes an all-whitespace display name to null', async () => {
    mockQueue.push(ok(null));
    await supabaseDataSource.updateProfile({ displayName: '   ' });
    const upd = mockCalls.find((c) => c.table === 'profiles')!;
    expect(upd.ops).toContainEqual(['update', [{ display_name: null }]]);
  });
});

describe('logEvent', () => {
  it('drops event names outside the client allowlist without touching the network', async () => {
    await supabaseDataSource.logEvent('quiz_completed'); // server-written name — client may not shadow it
    expect(mockCalls).toHaveLength(0);
  });

  it('inserts allowlisted events under the signed-in user', async () => {
    mockQueue.push(ok(null));
    await supabaseDataSource.logEvent('paywall_viewed', { source: 'settings' });
    const ins = mockCalls.find((c) => c.table === 'study_events')!;
    expect(ins.ops).toContainEqual(['insert', [{ user_id: 'user-1', event: 'paywall_viewed', props: { source: 'settings' } }]]);
  });
});

describe('lookup error mapping', () => {
  it("maps a 429 from the translate fn to 'lookup_busy' (UI shows try-again-shortly, query layer must not retry)", async () => {
    mockQueue.push(ok(PROFILE_ROW)); // getProfile single()
    mockInvokeQueue.push({ error: { message: 'Edge Function returned a non-2xx status code', context: { status: 429 } } });
    await expect(supabaseDataSource.lookup('hola', 'target_to_native')).rejects.toThrow('lookup_busy');
  });

  it("maps any other invoke failure to 'lookup_unavailable'", async () => {
    mockQueue.push(ok(PROFILE_ROW));
    mockInvokeQueue.push({ error: { message: 'Edge Function returned a non-2xx status code', context: { status: 503 } } });
    await expect(supabaseDataSource.lookup('hola', 'target_to_native')).rejects.toThrow('lookup_unavailable');
  });

  it('passes the resolved language pair to the translate fn on success', async () => {
    mockQueue.push(ok(PROFILE_ROW));
    mockInvokeQueue.push({ data: { status: 'not_found' } });
    const out = await supabaseDataSource.lookup('hola', 'target_to_native'); // learning→native = es→en
    expect(out).toEqual({ status: 'not_found' });
    expect(mockInvokeCalls[0]).toEqual(['translate', { body: { text: 'hola', from: 'es', to: 'en' } }]);
  });
});

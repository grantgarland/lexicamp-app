// The free-tier save cap, as the MOCK enforces it.
//
// The cap is server-side (02 / 3.2) — `save_card` raises P0004 'free_word_cap'
// and the client only reacts. That left mock mode with no cap at all, and the
// failure was silent in a way worth a regression test: SearchScreen sets its
// optimistic "Saved!" BEFORE the mutation and only rolls back in `onError`, and
// the paywall is routed to from that same handler. So one missing throw
// presented as three separate bugs — a word that says Saved but never appears
// in the deck, and a paywall that never opens for the user who has hit the wall.
//
// These tests assert the mock agrees with `freeTierUsage`, which is what the
// Settings meter renders. The number on screen and the refusal must not disagree.
import { freeTierUsage, homeSnapshot } from '@/domain/derive';
import { useDevStore } from '@/store/devStore';

import { mockDataSource } from '../mock';

const save = () => mockDataSource.saveCard('mock-t:fly', undefined);

/** What the Settings meter would show for the active scenario. */
const usage = async () => {
  const { cards, states } = await mockDataSource.getDeckCards('es');
  const snap = homeSnapshot(cards, states);
  return freeTierUsage(snap.wordsSaved, snap.addedToday);
};

afterEach(() => {
  useDevStore.setState({ userState: 'summit', plan: 'paid' });
});

describe('mock free-tier save cap', () => {
  it('refuses the save when the daily allowance is spent', async () => {
    // `sr` is the reported repro: 50 words saved, 5 of 5 used today — the exact
    // state the Settings screenshot showed while saves were still going through.
    useDevStore.setState({ userState: 'sr', plan: 'free' });
    expect(await usage()).toMatchObject({ phase: 'daily', usedToday: 5, limit: 5 });

    await expect(save()).rejects.toThrow('free_word_cap');
  });

  it('throws the message SearchScreen matches on, not just any error', async () => {
    // The handler does `e.message.includes('free_word_cap')` and routes to the
    // paywall. A differently-worded error would roll the optimistic state back
    // and then dead-end — visibly "nothing happened" rather than an upsell.
    useDevStore.setState({ userState: 'sr', plan: 'free' });
    await expect(save()).rejects.toThrow(/free_word_cap/);
  });

  it('allows exactly the remaining allowance, then refuses', async () => {
    // `veteran` is past the starter allotment with 0 used today, so the whole
    // daily allowance is available. Without the session counter the mock would
    // accept saves forever — the fixture's addedToday is static.
    useDevStore.setState({ userState: 'veteran', plan: 'free' });
    expect(await usage()).toMatchObject({ phase: 'daily', usedToday: 0, limit: 5 });

    for (let i = 0; i < 5; i++) await expect(save()).resolves.toBeNull();
    await expect(save()).rejects.toThrow('free_word_cap');
  });

  it('does not cap a paid plan', async () => {
    // Same scenario that refuses on free — the plan is the only difference.
    useDevStore.setState({ userState: 'sr', plan: 'paid' });
    for (let i = 0; i < 8; i++) await expect(save()).resolves.toBeNull();
  });

  it('does not cap a free user inside the starter allotment', async () => {
    // The 50-word starter phase has its own limit and must not be gated by the
    // daily one — `bc` sits at 12 saved with 2 added today.
    useDevStore.setState({ userState: 'bc', plan: 'free' });
    expect(await usage()).toMatchObject({ phase: 'starter' });

    await expect(save()).resolves.toBeNull();
  });

  it('resets the session counter when the dev scenario changes', async () => {
    // Spend the allowance, then switch user. The knob means "show me a
    // different user"; carrying a spent counter across would cap the wrong one.
    useDevStore.setState({ userState: 'veteran', plan: 'free' });
    for (let i = 0; i < 5; i++) await save();
    await expect(save()).rejects.toThrow('free_word_cap');

    useDevStore.setState({ userState: 'bc', plan: 'free' });
    await expect(save()).resolves.toBeNull();
  });
});

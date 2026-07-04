// Runs the DataSource contract against the mock, across every dev scenario —
// so the fixtures screens are built against always satisfy the same invariants
// the future SupabaseDataSource must. Scenario-specific expectations live here;
// implementation-agnostic invariants live in dataSourceContract.ts.
import { isPaid } from '@/domain/types';
import { useDevStore, type DevUserState } from '@/store/devStore';

import { mockDataSource } from '../mock';
import { describeDataSourceContract } from './dataSourceContract';

const SCENARIOS: DevUserState[] = ['empty', 'bc', 'abc', 'hc', 'sr', 'summit'];

// Contract invariants under the default scenario (summit/paid).
describeDataSourceContract('mock (summit/paid)', mockDataSource);

describe('mock scenarios', () => {
  afterEach(() => {
    useDevStore.setState({ userState: 'summit', plan: 'paid' });
  });

  it.each(SCENARIOS)('scenario %s: words/deck/decks stay consistent', async (userState) => {
    useDevStore.setState({ userState });
    const [{ cards, states }, words, decks] = await Promise.all([
      mockDataSource.getDeckCards(),
      mockDataSource.getWords(),
      mockDataSource.getDecks(),
    ]);
    expect(states.length).toBe(cards.length);
    expect(words.length).toBe(cards.length);
    if (userState === 'empty') {
      expect(cards.length).toBe(0);
      expect(decks).toEqual([]); // new-user decks empty state
    } else {
      expect(cards.length).toBeGreaterThan(0);
    }
  });

  it('plan knob flips the entitlement (free ↔ paid)', async () => {
    useDevStore.setState({ plan: 'free' });
    expect(isPaid(await mockDataSource.getEntitlement())).toBe(false);
    useDevStore.setState({ plan: 'paid' });
    const paid = await mockDataSource.getEntitlement();
    expect(isPaid(paid)).toBe(true);
    expect(paid.plan).not.toBeNull();
  });
});

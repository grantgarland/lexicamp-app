// Runs the DataSource contract against the mock, across every dev scenario —
// so the fixtures screens are built against always satisfy the same invariants
// the future SupabaseDataSource must. Scenario-specific expectations live here;
// implementation-agnostic invariants live in dataSourceContract.ts.
import { isPaid } from '@/domain/types';
import { generateUsernameCandidate } from '@/domain/username';
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

  it('free tier: exactly one lifetime username change (20 R5)', async () => {
    useDevStore.setState({ plan: 'free' });
    const TAKEN = ['alpine-elk', 'steady-ibex', 'quick-pika'];
    const fresh = async () => {
      const current = (await mockDataSource.getProfile()).username;
      let d = generateUsernameCandidate();
      while (TAKEN.includes(d) || d === current) d = generateUsernameCandidate();
      return d;
    };
    // Deterministic regardless of what earlier (paid) tests spent: if the
    // allowance is intact, the first change succeeds; every change after the
    // counter is non-zero rejects with the machine token.
    if ((await mockDataSource.getProfile()).usernameChanges === 0) {
      const first = await fresh();
      await expect(mockDataSource.setUsername(first)).resolves.toBe(first);
    }
    await expect(mockDataSource.setUsername(await fresh())).rejects.toThrow('username_change_limit');
    // …and the idempotent re-save of the CURRENT name still succeeds.
    const current = (await mockDataSource.getProfile()).username;
    await expect(mockDataSource.setUsername(current)).resolves.toBe(current);
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

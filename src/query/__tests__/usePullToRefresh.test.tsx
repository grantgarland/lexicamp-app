// Pull-to-refresh (2026-08-04). Before this there was no refresh anywhere in the
// app — the pull users were reaching for was the ScrollView's iOS bounce.
//
// The two things worth pinning: a pull refetches THIS screen's queries and
// nothing else (a global invalidate would drag the paid-for lookup/examples
// caches along with it), and the gesture is rate-limited, because a flick is
// cheap to repeat and would otherwise be an unbounded request loop.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { REFRESH_THROTTLE_MS, usePullToRefresh } from '@/query/usePullToRefresh';

const KEYS = ['words', 'decks'];

function setup(client: QueryClient) {
  return renderHook(() => usePullToRefresh(KEYS), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

let qc: QueryClient;
let refetchSpy: jest.SpyInstance;
let nowSpy: jest.SpyInstance;
let clock = 0;

// A controlled clock rather than fake timers: the throttle is a `Date.now()`
// comparison, and RNTL's `waitFor` drives fake timers itself — it would advance
// past the window before the test got to.
const advance = (ms: number) => { clock += ms; };

beforeEach(() => {
  clock = new Date('2026-08-04T12:00:00Z').getTime();
  nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  refetchSpy = jest.spyOn(qc, 'refetchQueries').mockResolvedValue(undefined);
});
afterEach(() => {
  nowSpy.mockRestore();
  refetchSpy.mockRestore();
});

const keysRefetched = () => refetchSpy.mock.calls.map((c) => c[0].queryKey[0]);

/** Make every refetch hang, and hand back a release for ALL of them — one per
 *  key, so releasing only the last would leave Promise.all pending forever. */
function pendingRefetches(): () => void {
  const resolvers: (() => void)[] = [];
  refetchSpy.mockImplementation(() => new Promise<void>((res) => resolvers.push(res)));
  return () => resolvers.forEach((r) => r());
}

describe('usePullToRefresh', () => {
  it('refetches exactly the screen’s own queries', async () => {
    const { result } = setup(qc);
    act(() => result.current.onRefresh());

    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(keysRefetched()).toEqual(KEYS);
  });

  it('holds the spinner until the refetch actually resolves', async () => {
    // `invalidateQueries` would return immediately and the spinner would stop
    // before any data arrived — making a broken refresh look instant.
    const release = pendingRefetches();

    const { result } = setup(qc);
    act(() => result.current.onRefresh());
    expect(result.current.refreshing).toBe(true);

    // Still spinning several microtasks in — only the resolution stops it.
    await act(async () => { await Promise.resolve(); });
    expect(result.current.refreshing).toBe(true);

    act(() => release());
    await waitFor(() => expect(result.current.refreshing).toBe(false));
  });

  it('drops a second pull inside the throttle window', async () => {
    const { result } = setup(qc);
    act(() => result.current.onRefresh());
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(keysRefetched()).toHaveLength(KEYS.length);

    advance(REFRESH_THROTTLE_MS - 1);
    act(() => result.current.onRefresh());

    // No new requests, and no spinner left hanging.
    expect(keysRefetched()).toHaveLength(KEYS.length);
    expect(result.current.refreshing).toBe(false);
  });

  it('allows the next pull once the window has passed', async () => {
    const { result } = setup(qc);
    act(() => result.current.onRefresh());
    await waitFor(() => expect(result.current.refreshing).toBe(false));

    advance(REFRESH_THROTTLE_MS);
    act(() => result.current.onRefresh());
    await waitFor(() => expect(result.current.refreshing).toBe(false));

    expect(keysRefetched()).toHaveLength(KEYS.length * 2);
  });

  it('ignores a pull that lands while one is still in flight', async () => {
    const release = pendingRefetches();

    const { result } = setup(qc);
    act(() => result.current.onRefresh());
    // Past the throttle, so only the in-flight guard can stop this one.
    advance(REFRESH_THROTTLE_MS);
    act(() => result.current.onRefresh());
    expect(keysRefetched()).toHaveLength(KEYS.length);

    act(() => release());
    await waitFor(() => expect(result.current.refreshing).toBe(false));
  });

  it('ends the spinner when the refetch fails', async () => {
    // A pull that spins forever because the network is down is worse than one
    // that stops — the error itself already renders on the query.
    refetchSpy.mockRejectedValue(new Error('offline'));
    const { result } = setup(qc);
    act(() => result.current.onRefresh());

    await waitFor(() => expect(result.current.refreshing).toBe(false));
  });
});

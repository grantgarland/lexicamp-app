// Outbox tests (2.4) — the offline-write guarantees: transport failures queue
// and replay FIFO; server verdicts never queue (they'd fail identically).
// NB: static import — jest-expo's CJS runtime can't execute dynamic import()
// without --experimental-vm-modules. AsyncStorage is the in-memory mock from
// src/test/setup.ts either way.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { commitWithOutbox, enqueueCommit, flushOutbox, isTransportError, readOutbox } from '../outbox';

const RATINGS = [{ cardId: 'c1', rating: 'got_it' as const }];
const netErr = () => new Error('Network request failed');
const serverErr = () => new Error('free_word_cap');

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('isTransportError', () => {
  it('classifies network failures vs server verdicts', () => {
    expect(isTransportError(netErr())).toBe(true);
    expect(isTransportError(new Error('fetch failed'))).toBe(true);
    expect(isTransportError(serverErr())).toBe(false);
    expect(isTransportError('nope')).toBe(false);
  });
});

describe('commitWithOutbox', () => {
  it('passes through when the commit succeeds (nothing queued)', async () => {
    const commit = jest.fn().mockResolvedValue(undefined);
    await commitWithOutbox(commit, { ratings: RATINGS });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(await readOutbox()).toHaveLength(0);
  });

  it('queues on transport failure and resolves (session UX proceeds)', async () => {
    const commit = jest.fn().mockRejectedValue(netErr());
    await expect(commitWithOutbox(commit, { ratings: RATINGS })).resolves.toBeUndefined();
    expect(await readOutbox()).toHaveLength(1);
  });

  it('rethrows server errors without queueing', async () => {
    const commit = jest.fn().mockRejectedValue(serverErr());
    await expect(commitWithOutbox(commit, { ratings: RATINGS })).rejects.toThrow('free_word_cap');
    expect(await readOutbox()).toHaveLength(0);
  });

  it('replays older queued sessions before the new commit', async () => {
    await enqueueCommit([{ cardId: 'old', rating: 'again' }]);
    const calls: string[] = [];
    const commit = jest.fn().mockImplementation(async (p: { ratings: { cardId: string }[] }) => {
      calls.push(p.ratings[0].cardId);
    });
    await commitWithOutbox(commit, { ratings: RATINGS });
    expect(calls).toEqual(['old', 'c1']);
    expect(await readOutbox()).toHaveLength(0);
  });
});

describe('flushOutbox', () => {
  it('stops on transport failure and keeps the remainder queued', async () => {
    await enqueueCommit([{ cardId: 'a', rating: 'got_it' }]);
    await enqueueCommit([{ cardId: 'b', rating: 'got_it' }]);
    const commit = jest
      .fn()
      .mockResolvedValueOnce(undefined) // a flushes
      .mockRejectedValueOnce(netErr()); // still offline at b
    const flushed = await flushOutbox(commit);
    expect(flushed).toBe(1);
    const left = await readOutbox();
    expect(left).toHaveLength(1);
    expect(left[0].ratings[0].cardId).toBe('b');
  });

  it('drops entries the server rejects (they will never succeed)', async () => {
    await enqueueCommit([{ cardId: 'bad', rating: 'got_it' }]);
    const commit = jest.fn().mockRejectedValue(serverErr());
    const flushed = await flushOutbox(commit);
    expect(flushed).toBe(0);
    expect(await readOutbox()).toHaveLength(0);
  });
});

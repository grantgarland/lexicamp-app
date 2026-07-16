// Outbox replay triggers (2.4): flush queued quiz commits on app start and on
// every return to foreground. Kept separate from outbox.ts so the queue logic
// itself has no react-native imports (plain-node testable).
//
// A successful replay MUST invalidate the same FSRS-derived reads as a live
// commit (words/deckCards/dueCards/progressStats/engagement) — the query cache
// persists to AsyncStorage, so without this a session replayed after an offline
// stretch would leave promoted words rendering their old tier across restarts
// (same class as the 2026-07-16 stale-tier bug).
import { AppState } from 'react-native';

import { queryClient } from '@/query/queryClient';

import { dataSource } from './index';
import { flushOutbox } from './outbox';

const FSRS_DERIVED_KEYS = ['deckCards', 'dueCards', 'words', 'progressStats', 'engagement'] as const;

async function flushAndRefresh(): Promise<void> {
  const flushed = await flushOutbox((p) => dataSource.commitQuizSession(p));
  if (flushed > 0) {
    for (const key of FSRS_DERIVED_KEYS) void queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function initOutbox(): void {
  void flushAndRefresh();
  AppState.addEventListener('change', (state) => {
    if (state === 'active') void flushAndRefresh();
  });
}

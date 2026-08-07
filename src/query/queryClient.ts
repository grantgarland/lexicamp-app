// TanStack Query client — manages server-state fetching/caching for the app. The
// query hooks read through the DataSource; query keys include the dev scenario so
// flipping the DevBadge auto-refetches the right fixtures.
//
// OFFLINE READS (2.4): the cache persists to AsyncStorage, so a cold offline
// launch renders last-known data (words, decks, home stats) instead of spinners.
// gcTime must exceed maxAge or entries are collected before they can restore.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient, defaultShouldDehydrateQuery } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';

import { reviveDatesInPlace } from './reviveDates';

const DAY = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 7 * DAY,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

/** Query roots deliberately kept OUT of the persisted cache (data-perf audit,
 *  2026-08-06). Everything else — notably `words` and `deckCards` — still persists, so
 *  the 2.4 offline-read guarantee is intact: a cold offline launch still renders the
 *  Word List and Home/Progress stats from last-known data.
 *
 *  What each exclusion buys, and why it costs nothing:
 *   - `lookup` / `examples`: per-search results that grow without bound as the user
 *     searches. They are the reason the blob had no ceiling. Re-fetching one is a single
 *     cheap Edge Function call the user already expects to wait for, and they stay cached
 *     in memory for the session — only the DISK copy goes.
 *   - `deckWords`: a full second copy of the library rows, keyed per custom deck. It was
 *     measured at ~1.9 MB of a 5.66 MB blob on its own. Deck contents are Premium and
 *     re-read on open.
 *   - `dueCards`: a server-ORDERED, server-LIMITED queue with fill semantics (18 §2c).
 *     staleTime is 30s and it refetches on mount anyway, so persisting it mostly banks a
 *     queue that is already wrong by the next launch.
 *
 *  Removing keys needs no `buster` bump — a missing entry simply doesn't hydrate and the
 *  query fetches normally. Persisting a NARROWED version of a retained key would be a
 *  shape change and WOULD need one. */
const NOT_PERSISTED = new Set(['lookup', 'examples', 'deckWords', 'dueCards']);

persistQueryClient({
  queryClient,
  persister: createAsyncStoragePersister({
    storage: AsyncStorage,
    key: 'lexicamp_query_cache_v1',
    // Revive domain Date fields the default JSON.parse would leave as strings — without
    // this a cold-launch rehydrate crashes the derivations. Parsed plain and walked
    // afterwards rather than via a JSON.parse reviver: same rule, ~7.6x cheaper on a
    // veteran-sized library. See reviveDatesInPlace.
    deserialize: (cached) => reviveDatesInPlace(JSON.parse(cached)),
  }),
  maxAge: 7 * DAY,
  // Bump when cached shapes change incompatibly (cheap invalidation lever).
  buster: 'v1',
  dehydrateOptions: {
    shouldDehydrateQuery: (q) =>
      // Keep the default's success-only rule — persisting an error or a pending query
      // would rehydrate a broken entry — and subtract the roots above.
      defaultShouldDehydrateQuery(q) && !NOT_PERSISTED.has(String(q.queryKey[0])),
  },
});

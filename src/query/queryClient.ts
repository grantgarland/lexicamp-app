// TanStack Query client — manages server-state fetching/caching for the app. The
// query hooks read through the DataSource; query keys include the dev scenario so
// flipping the DevBadge auto-refetches the right fixtures.
//
// OFFLINE READS (2.4): the cache persists to AsyncStorage, so a cold offline
// launch renders last-known data (words, decks, home stats) instead of spinners.
// gcTime must exceed maxAge or entries are collected before they can restore.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';

import { reviveDates } from './reviveDates';

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

persistQueryClient({
  queryClient,
  persister: createAsyncStoragePersister({
    storage: AsyncStorage,
    key: 'lexicamp_query_cache_v1',
    // Revive domain Date fields the default JSON.parse would leave as strings (see
    // reviveDates) — without this a cold-launch rehydrate crashes the derivations.
    deserialize: (cached) => JSON.parse(cached, reviveDates),
  }),
  maxAge: 7 * DAY,
  // Bump when cached shapes change incompatibly (cheap invalidation lever).
  buster: 'v1',
});

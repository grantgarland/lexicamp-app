// TanStack Query client — manages server-state fetching/caching for the app. The
// query hooks read through the DataSource; query keys include the dev scenario so
// flipping the DevBadge auto-refetches the right fixtures.
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

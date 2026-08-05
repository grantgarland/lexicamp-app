// Pull-to-refresh — one hook, so every pull-able screen refreshes the same way.
//
// There was no refresh before this (2026-08-04 audit): the pull gesture users
// were reaching for was just the ScrollView's iOS bounce, which does nothing at
// all. Nothing was broken — nothing was wired.
//
// What a pull means here: "re-read MY data from the server, now." It refetches
// the queries the screen actually renders, and nothing else — a global
// `invalidateQueries()` would drag every other tab's cache along with it,
// including the paid-for lookup/examples caches (cost discipline, CLAUDE.md #4).
//
// RATE LIMIT: one real refresh per screen per REFRESH_THROTTLE_MS. The gesture
// is trivially repeatable — it costs the user a flick — so without this a bored
// thumb is an unbounded request loop against PostgREST. Within the window the
// pull is acknowledged and dropped: the spinner snaps back, no request goes out.
// Per-screen rather than global, because refreshing Progress should not disarm
// the pull on Word List.
import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/** Minimum spacing between real refreshes on one screen.
 *
 *  5s: long enough that a repeated flick can't turn into a request per frame,
 *  short enough that a user who pulls, reads, and pulls again to check a change
 *  never hits it. Deliberately NOT tied to any query's staleTime — that governs
 *  automatic refetches, while this governs a deliberate user action. */
export const REFRESH_THROTTLE_MS = 5_000;

/**
 * @param keys Query-key PREFIXES this screen renders (e.g. `['home',
 *   'progressStats']`). Prefixes, not full keys: the real keys carry the dev
 *   scenario, active language and user id, and a screen must refresh its data
 *   for the CURRENT values of those without having to restate them.
 */
export function usePullToRefresh(keys: readonly string[]): { refreshing: boolean; onRefresh: () => void } {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const lastAt = useRef(0);
  // Guards against a second pull landing while the first is still in flight —
  // RefreshControl can fire again the moment the spinner starts retracting.
  const inFlight = useRef(false);

  const onRefresh = useCallback(() => {
    const now = Date.now();
    if (inFlight.current || now - lastAt.current < REFRESH_THROTTLE_MS) return;
    lastAt.current = now;
    inFlight.current = true;
    setRefreshing(true);
    // `refetchQueries`, not `invalidateQueries`: invalidate marks stale and
    // returns immediately, so the spinner would stop before any data arrived and
    // the refresh would look instant whether or not it worked. This resolves
    // when the network does.
    void Promise.all(keys.map((key) => qc.refetchQueries({ queryKey: [key] })))
      // A failed refetch leaves the error on the query itself, where the screen
      // already renders it. Swallowing here only ends the spinner — a pull that
      // spins forever because the network is down is the worse failure.
      .catch(() => {})
      .finally(() => {
        inFlight.current = false;
        setRefreshing(false);
      });
  }, [qc, keys]);

  return { refreshing, onRefresh };
}

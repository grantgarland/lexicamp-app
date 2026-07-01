// Typed query hooks — the app's read API. Screens call these (never the DataSource
// or derivations directly). Each keys on the dev scenario so DevBadge toggles
// invalidate + refetch automatically. Mutations (save word, commit quiz) land here
// as `useMutation` when those screens are built.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dataSource as ds } from '@/data';
import { type HomeSnapshot, homeSnapshot } from '@/domain/derive';
import type { BufferedRating } from '@/domain/quiz';
import { type Entitlement, isPaid } from '@/domain/types';
import { useDevStore } from '@/store/devStore';

export function useProfile() {
  return useQuery({ queryKey: ['profile'], queryFn: () => ds.getProfile() }).data;
}

export interface EntitlementResult {
  entitlement: Entitlement | undefined;
  isPaid: boolean;
  isLoading: boolean;
}
export function useEntitlement(): EntitlementResult {
  const plan = useDevStore((s) => s.plan); // dev knob → query key → refetch on toggle
  const q = useQuery({ queryKey: ['entitlement', plan], queryFn: () => ds.getEntitlement() });
  return { entitlement: q.data, isPaid: q.data != null ? isPaid(q.data) : false, isLoading: q.isLoading };
}

export interface HomeData {
  snapshot: HomeSnapshot | null;
  streakDays: number;
  isLoading: boolean;
}
export function useHomeData(): HomeData {
  const userState = useDevStore((s) => s.userState); // dev knob → query key
  const deck = useQuery({ queryKey: ['deckCards', userState], queryFn: () => ds.getDeckCards() });
  const eng = useQuery({ queryKey: ['engagement', userState], queryFn: () => ds.getEngagement() });
  const snapshot = deck.data != null ? homeSnapshot(deck.data.cards, deck.data.states) : null;
  return { snapshot, streakDays: eng.data?.streakDays ?? 0, isLoading: deck.isLoading || eng.isLoading };
}

/** The study-session due queue (read). */
export function useDueCards() {
  const userState = useDevStore((s) => s.userState);
  const q = useQuery({ queryKey: ['dueCards', userState], queryFn: () => ds.getDueCards() });
  return { cards: q.data ?? [], isLoading: q.isLoading };
}

/** The user's saved words for the Word List (read). */
export function useWords() {
  const userState = useDevStore((s) => s.userState); // dev knob → query key
  const q = useQuery({ queryKey: ['words', userState], queryFn: () => ds.getWords() });
  return { words: q.data ?? [], isLoading: q.isLoading };
}

/** Commit a completed quiz session (write) — invalidates home/due reads on success. */
export function useCommitQuizSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { ratings: BufferedRating[] }) => ds.commitQuizSession(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deckCards'] });
      qc.invalidateQueries({ queryKey: ['dueCards'] });
    },
  });
}

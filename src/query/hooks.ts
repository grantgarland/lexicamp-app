// Typed query hooks — the app's read API. Screens call these (never the DataSource
// or derivations directly). Each keys on the dev scenario so DevBadge toggles
// invalidate + refetch automatically. Mutations (save word, commit quiz) land here
// as `useMutation` when those screens are built.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dataSource as ds } from '@/data';
import { commitWithOutbox } from '@/data/outbox';
import { type HomeSnapshot, homeSnapshot } from '@/domain/derive';
import type { BufferedRating } from '@/domain/quiz';
import type { LookupOutcome } from '@/domain/translation';
import { type Entitlement, isPaid, type NotificationPrefs, type SearchDirection } from '@/domain/types';
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

/** The study-session queue (read) — due-now plus next-due fill to `limit`
 *  (18 §2c). The limit keys the query so a quiz-length change refetches. */
export function useDueCards(limit: number) {
  const userState = useDevStore((s) => s.userState);
  const q = useQuery({ queryKey: ['dueCards', userState, limit], queryFn: () => ds.getDueCards(limit) });
  return { cards: q.data ?? [], isLoading: q.isLoading };
}

export interface ProgressData {
  tierCounts: number[]; // words per tier [bc..summit]
  totalSaved: number;
  totalMastered: number;
  streakDays: number;
  sessionsTotal: number;
  avgAccuracy: number;
  bestStreak: number;
  daysActive: number;
  isLoading: boolean;
}
/** Aggregated Progress-screen read (tier distribution + all-time study stats). */
export function useProgressData(): ProgressData {
  const userState = useDevStore((s) => s.userState);
  const deck = useQuery({ queryKey: ['deckCards', userState], queryFn: () => ds.getDeckCards() });
  const eng = useQuery({ queryKey: ['engagement', userState], queryFn: () => ds.getEngagement() });
  const stats = useQuery({ queryKey: ['progressStats', userState], queryFn: () => ds.getProgressStats() });
  const snap = deck.data != null ? homeSnapshot(deck.data.cards, deck.data.states) : null;
  return {
    tierCounts: snap?.tierCounts ?? [0, 0, 0, 0, 0],
    totalSaved: snap?.wordsSaved ?? 0,
    totalMastered: snap?.masteredCount ?? 0,
    streakDays: eng.data?.streakDays ?? 0,
    sessionsTotal: stats.data?.sessionsTotal ?? 0,
    avgAccuracy: stats.data?.avgAccuracy ?? 0,
    bestStreak: stats.data?.bestStreak ?? 0,
    daysActive: stats.data?.daysActive ?? 0,
    isLoading: deck.isLoading || stats.isLoading,
  };
}

/** The user's saved words for the Word List (read). */
export function useWords() {
  const userState = useDevStore((s) => s.userState); // dev knob → query key
  const q = useQuery({ queryKey: ['words', userState], queryFn: () => ds.getWords() });
  return { words: q.data ?? [], isLoading: q.isLoading };
}

/** Custom decks (Premium). */
export function useDecks() {
  const userState = useDevStore((s) => s.userState);
  const q = useQuery({ queryKey: ['decks', userState], queryFn: () => ds.getDecks() });
  return { decks: q.data ?? [], isLoading: q.isLoading };
}

export interface LookupData {
  outcome: LookupOutcome | null;
  isLoading: boolean;
}
/** Search-capture lookup (2.1). Caller debounces + pre-gates (Tier-0) before
 *  enabling; the source re-gates authoritatively. Results are cached per
 *  (direction, query) — the server cache makes repeats free anyway. */
export function useLookup(query: string, direction: SearchDirection, enabled: boolean): LookupData {
  const userState = useDevStore((s) => s.userState); // mock reads scenario words
  const q = useQuery({
    queryKey: ['lookup', userState, direction, query],
    queryFn: () => ds.lookup(query, direction),
    enabled,
    staleTime: 5 * 60 * 1000,
  });
  return { outcome: enabled ? (q.data ?? null) : null, isLoading: enabled && q.isPending };
}

/** Lazy example sentences (16 §3) — fetched once per translation, cached
 *  server-side forever. Pass null to disable (nothing to fetch / already have). */
export function useExamples(translationId: string | null) {
  const q = useQuery({
    queryKey: ['examples', translationId],
    queryFn: () => ds.getExamples(translationId as string),
    enabled: translationId != null,
    staleTime: Infinity,
  });
  return { examples: q.data ?? null, isLoading: translationId != null && q.isPending };
}

/** Notification prefs (2.5) — read. Keys on the dev scenario so DevBadge
 *  account switches refetch, same as the other reads. */
export function useNotificationPrefs() {
  const userState = useDevStore((s) => s.userState);
  const q = useQuery({ queryKey: ['notificationPrefs', userState], queryFn: () => ds.getNotificationPrefs() });
  return { prefs: q.data, isLoading: q.isLoading };
}

/** Update notification prefs (write) — the server-side pg_cron scheduler reads
 *  these (enabled + windows ±30min + min_due), so a saved change takes effect
 *  on the next 15-min scheduler tick with no app-side scheduling. */
export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: Partial<NotificationPrefs>) => ds.updateNotificationPrefs(prefs),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notificationPrefs'] });
    },
  });
}

/** Save a gate-approved translation to the active deck (write → save_card path).
 *  Optional `custom` carries a chosen NON-primary sense (A12c). Resolves the new
 *  card id (null in mock mode). */
export function useSaveCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { translationId: string; custom?: { front?: string; back?: string } }) =>
      ds.saveCard(input.translationId, input.custom),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deckCards'] });
      qc.invalidateQueries({ queryKey: ['words'] });
      qc.invalidateQueries({ queryKey: ['dueCards'] });
    },
  });
}

/** Delete a saved card (write → delete_card RPC; A12b). Destructive — the
 *  word's FSRS history cascades away with it. */
export function useDeleteCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cardId: string) => ds.deleteCard(cardId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deckCards'] });
      qc.invalidateQueries({ queryKey: ['words'] });
      qc.invalidateQueries({ queryKey: ['dueCards'] });
    },
  });
}

/** Commit a completed quiz session (write) — invalidates EVERY read that
 *  derives from per-card FSRS state, not just the home/due pair: a session
 *  changes each rated word's stability (tier badges in the Word List + tier
 *  drawer via 'words'), the all-time stats ('progressStats'), and the streak
 *  ('engagement'). Missing any of these leaves promoted words rendering their
 *  old tier until an unrelated refetch (Casey bug, 2026-07-16).
 *  Offline-resilient: transport failures queue in the outbox and replay on
 *  reconnect (2.4); server errors still surface. */
export function useCommitQuizSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { ratings: BufferedRating[] }) =>
      commitWithOutbox((p) => ds.commitQuizSession(p), payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deckCards'] });
      qc.invalidateQueries({ queryKey: ['dueCards'] });
      qc.invalidateQueries({ queryKey: ['words'] });
      qc.invalidateQueries({ queryKey: ['progressStats'] });
      qc.invalidateQueries({ queryKey: ['engagement'] });
    },
  });
}

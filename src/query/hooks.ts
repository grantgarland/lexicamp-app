// Typed query hooks — the app's read API. Screens call these (never the DataSource
// or derivations directly). Each keys on the dev scenario so DevBadge toggles
// invalidate + refetch automatically. Mutations (save word, commit quiz) land here
// as `useMutation` when those screens are built.
import { useEffect } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dataSource as ds } from '@/data';
import { commitWithOutbox } from '@/data/outbox';
import { type HomeSnapshot, homeSnapshot } from '@/domain/derive';
import type { BufferedRating } from '@/domain/quiz';
import type { LookupOutcome } from '@/domain/translation';
import { type Card, type CardFsrsState, type Entitlement, isPaid, type NotificationPrefs, type SearchDirection } from '@/domain/types';
import { useSession } from '@/auth/session';
import { usePrefsStore } from '@/store/prefsStore';
import { useDevStore } from '@/store/devStore';

/** The authenticated user id ('anon' in mock mode / signed-out) — part of EVERY
 *  user-scoped query key. Root-cause fix for the stale-account bug (2026-07-16):
 *  the persisted cache + always-mounted observers meant data cached for one
 *  account could render for another (DevBadge switches; on shared devices,
 *  sign-out → different sign-in). With the uid in the key, cross-account reuse
 *  is structurally impossible — the old account's entries just age out. */
function useUserKey(): string {
  const { session } = useSession();
  return session?.user.id ?? 'anon';
}

export function useProfile() {
  const uid = useUserKey();
  return useQuery({ queryKey: ['profile', uid], queryFn: () => ds.getProfile() }).data;
}

/** Phase D (18 §2a.4): the ACTIVE learning language, read from the profile query.
 *  Every card/deck read keys on it — a language switch (optimistic profile
 *  update + write-behind RPC) changes the keys, and the whole app repaints from
 *  cache/refetch automatically. No manual invalidation choreography. */
export function useActiveLang(): string | undefined {
  return useProfile()?.targetLang;
}

/** Enrolled learning languages (oldest first). */
export function useLearningLanguages() {
  const uid = useUserKey();
  const q = useQuery({ queryKey: ['learningLanguages', uid], queryFn: () => ds.getLearningLanguages() });
  return { languages: q.data ?? [], isLoading: q.isLoading };
}

/** Switch the active language — OPTIMISTIC: the profile cache flips immediately
 *  (instant app-wide repaint via key change), the RPC writes behind, rollback on
 *  error. */
export function useSwitchLanguage() {
  const qc = useQueryClient();
  const uid = useUserKey();
  return useMutation({
    mutationFn: (lang: string) => ds.switchLearningLanguage(lang),
    onMutate: async (lang) => {
      await qc.cancelQueries({ queryKey: ['profile', uid] });
      const prev = qc.getQueryData(['profile', uid]);
      qc.setQueryData(['profile', uid], (p: unknown) => (p == null ? p : { ...(p as object), targetLang: lang }));
      return { prev };
    },
    onError: (_e, _lang, ctx) => {
      if (ctx?.prev != null) qc.setQueryData(['profile', uid], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      // Belt-and-braces (read-your-write): even though reads take the lang from
      // the query key now, refetch card/deck data once the server settles.
      qc.invalidateQueries({ queryKey: ['deckCards'] });
      qc.invalidateQueries({ queryKey: ['words'] });
      qc.invalidateQueries({ queryKey: ['dueCards'] });
      qc.invalidateQueries({ queryKey: ['decks'] });
    },
  });
}

/** Enroll a new language (server: premium past the first, cap 5, seeds the deck,
 *  switches to it). */
export function useAddLanguage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lang: string) => ds.addLearningLanguage(lang),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['learningLanguages'] });
      qc.invalidateQueries({ queryKey: ['profile'] }); // server switched to it
    },
  });
}

/** Un-enroll a non-active language (data kept server-side). */
export function useRemoveLanguage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lang: string) => ds.removeLearningLanguage(lang),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['learningLanguages'] });
    },
  });
}

// ── 20 §3: username identity ─────────────────────────────────────────────────
/** Read-only Account block (email + auth provider). Stable per session. */
export function useAccountIdentity() {
  const uid = useUserKey();
  return useQuery({ queryKey: ['accountIdentity', uid], queryFn: () => ds.getAccountIdentity(), staleTime: Infinity }).data;
}

// ── 20 §4: leaderboard (Progress → Leaders tab) ─────────────────────────────
/** `get_leaderboard` read — top-50 + the caller's own row(s). `staleTime` ~5
 *  min per 4.4 (a leaderboard doesn't need realtime). `lang` only matters for
 *  the 'language' scope — pass the caller's ACTIVE learning language. */
export function useLeaderboard(scope: 'global' | 'language', lang?: string) {
  const userState = useDevStore((s) => s.userState);
  const uid = useUserKey();
  const q = useQuery({
    queryKey: ['leaderboard', scope, lang, userState, uid],
    queryFn: () => ds.getLeaderboard(scope, lang),
    staleTime: 5 * 60 * 1000,
  });
  return { entries: q.data ?? [], isLoading: q.isLoading };
}

/** Claim a CYCLED username (20 §3 v2 — candidates are local drafts; this is
 *  the only write). Optimistic cache update incl. the change counter,
 *  rollback on error. Error messages carry the machine token
 *  (`UsernameSaveError`): username_taken (snapped up between cycle and save),
 *  username_change_limit (free single change spent), rate_limited (20/day),
 *  username_invalid (impossible via the cycle UI). */
export function useSetUsername() {
  const qc = useQueryClient();
  const uid = useUserKey();
  return useMutation({
    mutationFn: (name: string) => ds.setUsername(name),
    onMutate: async (name) => {
      await qc.cancelQueries({ queryKey: ['profile', uid] });
      const prev = qc.getQueryData(['profile', uid]);
      qc.setQueryData(['profile', uid], (p: unknown) =>
        p == null
          ? p
          : {
              ...(p as object),
              username: name.trim().toLowerCase(),
              usernameChanges: ((p as { usernameChanges?: number }).usernameChanges ?? 0) + 1,
            },
      );
      return { prev };
    },
    onError: (_e, _n, ctx) => {
      if (ctx?.prev != null) qc.setQueryData(['profile', uid], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

/** Update editable profile fields (D6 / UX-17e) — optimistic name update. */
export function useUpdateProfile() {
  const qc = useQueryClient();
  const uid = useUserKey();
  return useMutation({
    mutationFn: (patch: { displayName?: string; quizLength?: number }) => ds.updateProfile(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['profile', uid] });
      const prev = qc.getQueryData(['profile', uid]);
      qc.setQueryData(['profile', uid], (p: unknown) =>
        p == null
          ? p
          : {
              ...(p as object),
              ...(patch.displayName != null ? { displayName: patch.displayName } : {}),
              ...(patch.quizLength != null ? { quizLength: patch.quizLength } : {}),
            },
      );
      return { prev };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.prev != null) qc.setQueryData(['profile', uid], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

/** 3.4: fire-and-forget analytics emit (allowlisted client events). */
export function useLogEvent() {
  return (event: string, props?: Record<string, unknown>) => {
    void ds.logEvent(event, props);
  };
}

/** UX-17b: adopt the server quiz-length mirror on profile load (server wins —
 *  it's the cross-device source of truth; local edits write through to it via
 *  QuizLengthSheet). Mount once (tabs layout). */
export function useQuizLengthSync() {
  const profile = useProfile();
  const quizLength = usePrefsStore((s) => s.quizLength);
  const setQuizLength = usePrefsStore((s) => s.setQuizLength);
  const server = profile?.quizLength;
  useEffect(() => {
    if (server != null && server !== quizLength) setQuizLength(server);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);
}

export interface EntitlementResult {
  entitlement: Entitlement | undefined;
  isPaid: boolean;
  isLoading: boolean;
}
export function useEntitlement(): EntitlementResult {
  const plan = useDevStore((s) => s.plan); // dev knob → query key → refetch on toggle
  const uid = useUserKey();
  const q = useQuery({ queryKey: ['entitlement', plan, uid], queryFn: () => ds.getEntitlement() });
  return { entitlement: q.data, isPaid: q.data != null ? isPaid(q.data) : false, isLoading: q.isLoading };
}

export interface HomeData {
  snapshot: HomeSnapshot | null;
  streakDays: number;
  isLoading: boolean;
}
export function useHomeData(): HomeData {
  const userState = useDevStore((s) => s.userState); // dev knob → query key
  const activeLang = useActiveLang(); // Phase D: language switch → key change → repaint
  const uid = useUserKey();
  const deck = useQuery({
    queryKey: ['deckCards', userState, activeLang, uid],
    queryFn: () => ds.getDeckCards(activeLang),
    enabled: activeLang != null,
  });
  const eng = useQuery({ queryKey: ['engagement', userState, uid], queryFn: () => ds.getEngagement() });
  const snapshot = deck.data != null ? homeSnapshot(deck.data.cards, deck.data.states) : null;
  return { snapshot, streakDays: eng.data?.streakDays ?? 0, isLoading: deck.isLoading || eng.isLoading };
}

/** The study-session queue (read) — due-now plus next-due fill to `limit`
 *  (18 §2c). The limit keys the query so a quiz-length change refetches. */
export function useDueCards(limit: number, deckId?: string) {
  const userState = useDevStore((s) => s.userState);
  const activeLang = useActiveLang();
  const uid = useUserKey();
  // deckId is IN the key: a deck session and the all-language session are
  // different queues and must not share a cache entry (they'd overwrite each
  // other and "Study Deck" would serve whatever Home fetched last).
  const q = useQuery({
    queryKey: ['dueCards', userState, limit, activeLang, uid, deckId ?? null],
    queryFn: () => ds.getDueCards(limit, activeLang, deckId),
    enabled: activeLang != null,
  });
  return {
    cards: q.data ?? [],
    isLoading: activeLang == null || q.isLoading,
    // `isFetching` (not `isLoading`) is what tells a caller "this list may be a
    // cached list from a previous session, and a fresher one is on its way".
    // isLoading is false whenever ANY cached data exists, so a screen that
    // freezes the queue on first paint would freeze the stale one — see the
    // snapshot guard in QuizScreen (Casey, quiz-repeat bug 2026-08-04).
    isFetching: q.isFetching,
  };
}

// Stable empty fallbacks. `?? []` inline would allocate a fresh array on every
// render, which silently breaks the `useMemo` in ProjectionCard that keys on
// these — it would re-run the whole FSRS simulation on every render while the
// deck query is still loading.
const NO_CARDS: Card[] = [];
const NO_STATES: CardFsrsState[] = [];

export interface ProgressData {
  tierCounts: number[]; // words per tier [bc..summit]
  totalSaved: number;
  totalMastered: number;
  streakDays: number;
  sessionsTotal: number;
  avgAccuracy: number;
  bestStreak: number;
  daysActive: number;
  /** Raw cards + FSRS rows behind the aggregates above. The Progress
   *  projection (domain/projection.ts) forward-simulates these per card, which
   *  the aggregates cannot support. Already fetched for `homeSnapshot` — this
   *  just stops throwing them away, so there is no extra request or payload. */
  cards: Card[];
  states: CardFsrsState[];
  isLoading: boolean;
}
/** Aggregated Progress-screen read (tier distribution + all-time study stats). */
export function useProgressData(): ProgressData {
  const userState = useDevStore((s) => s.userState);
  const activeLang = useActiveLang();
  const uid = useUserKey();
  const deck = useQuery({
    queryKey: ['deckCards', userState, activeLang, uid],
    queryFn: () => ds.getDeckCards(activeLang),
    enabled: activeLang != null,
  });
  const eng = useQuery({ queryKey: ['engagement', userState, uid], queryFn: () => ds.getEngagement() });
  const stats = useQuery({ queryKey: ['progressStats', userState, uid], queryFn: () => ds.getProgressStats() });
  const snap = deck.data != null ? homeSnapshot(deck.data.cards, deck.data.states) : null;
  return {
    cards: deck.data?.cards ?? NO_CARDS,
    states: deck.data?.states ?? NO_STATES,
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

/** The user's saved words for the Word List (read).
 *
 *  ⚠️ This and every other language-scoped read are gated on `activeLang != null`.
 *  `activeLang` comes from the profile query, so it is UNDEFINED for the first
 *  frames after mount and briefly around a language switch. Ungated, the query
 *  fired with `undefined`, the DataSource fell back to resolving the language
 *  SERVER-side (`lang ?? (await this.getProfile()).targetLang`), and the result
 *  was cached under a `[…, undefined, …]` key. That slot outlives the switch and
 *  re-serves the PREVIOUS language's rows whenever activeLang is momentarily
 *  undefined — the stale Spanish-row-in-a-Russian-list flash (Casey 2026-08-02).
 *  `isLoading` stays true while the language is unresolved too, otherwise the
 *  screen paints its empty state for a frame before the real fetch begins. */
export function useWords() {
  const userState = useDevStore((s) => s.userState); // dev knob → query key
  const activeLang = useActiveLang();
  const uid = useUserKey();
  const q = useQuery({
    queryKey: ['words', userState, activeLang, uid],
    queryFn: () => ds.getWords(activeLang),
    enabled: activeLang != null,
  });
  return { words: q.data ?? [], isLoading: activeLang == null || q.isLoading };
}

/** Custom decks (Premium). */
export function useDecks() {
  const userState = useDevStore((s) => s.userState);
  const activeLang = useActiveLang();
  const uid = useUserKey();
  const q = useQuery({
    queryKey: ['decks', userState, activeLang, uid],
    queryFn: () => ds.getDecks(activeLang),
    enabled: activeLang != null,
  });
  return { decks: q.data ?? [], isLoading: activeLang == null || q.isLoading };
}

/** Words in ONE custom deck (2026-07-30). Disabled while `deckId` is null so the
 *  Deck detail sheet can mount before a deck is chosen. This REPLACES the
 *  positional `words.slice(0, deck.wordCount)` stand-in that shipped as deck
 *  contents — membership is now a server read like any other. */
export function useDeckWords(deckId: string | null) {
  const userState = useDevStore((s) => s.userState);
  const activeLang = useActiveLang();
  const uid = useUserKey();
  const q = useQuery({
    queryKey: ['deckWords', userState, activeLang, uid, deckId],
    queryFn: () => ds.getDeckWords(deckId as string, activeLang),
    enabled: deckId != null && activeLang != null,
  });
  return { words: q.data ?? [], isLoading: deckId != null && (activeLang == null || q.isLoading) };
}

/** Which custom decks a card is in — the honest source for Add-to-Deck's
 *  "Already added" (it used to be component state that survived nothing). */
export function useCardDeckIds(cardId: string | null) {
  const userState = useDevStore((s) => s.userState);
  const activeLang = useActiveLang();
  const uid = useUserKey();
  const q = useQuery({
    queryKey: ['cardDecks', userState, activeLang, uid, cardId],
    queryFn: () => ds.getCardDeckIds(cardId as string),
    enabled: cardId != null,
  });
  return { deckIds: q.data ?? [], isLoading: cardId != null && q.isLoading };
}

/** Every deck-membership write invalidates the same set: the deck LIST (its
 *  wordCount is derived from membership), the per-deck contents, the per-card
 *  membership behind "Already added", and — since deck-scoped study landed —
 *  the due QUEUE. Keyed loosely (prefix only) so one write refreshes every
 *  deck's cached contents and queue: a word can be in many decks.
 *
 *  'dueCards' is not optional. With staleTime 30s and a 7-day persisted cache,
 *  omitting it lets Study Deck render the PREVIOUS queue synchronously, and
 *  QuizScreen latches that into `sessionCards` before the background refetch
 *  lands — so a word you just removed from the deck still gets studied and
 *  rescheduled. */
function invalidateDeckReads(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: ['decks'] });
  qc.invalidateQueries({ queryKey: ['deckWords'] });
  qc.invalidateQueries({ queryKey: ['cardDecks'] });
  qc.invalidateQueries({ queryKey: ['dueCards'] });
}

/** Create a custom deck, optionally seeded with words (Premium). Rejects with
 *  Error(DeckWriteError) — the sheet surfaces `deck_name_taken` inline. */
export function useCreateDeck() {
  const qc = useQueryClient();
  const activeLang = useActiveLang();
  return useMutation({
    mutationFn: (input: { name: string; cardIds: string[] }) => ds.createDeck(input.name, input.cardIds, activeLang),
    onSuccess: () => invalidateDeckReads(qc),
  });
}

/** Delete a custom deck. The words survive — they live in the language's main
 *  deck — so 'words' deliberately is NOT invalidated here. */
export function useDeleteDeck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deckId: string) => ds.deleteDeck(deckId),
    onSuccess: () => invalidateDeckReads(qc),
  });
}

/** Add a saved word to a custom deck (Premium; idempotent server-side). */
export function useAddCardToDeck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { deckId: string; cardId: string }) => ds.addCardToDeck(input.deckId, input.cardId),
    onSuccess: () => invalidateDeckReads(qc),
  });
}

/** Remove a word from a custom deck (never premium-gated). */
export function useRemoveCardFromDeck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { deckId: string; cardId: string }) => ds.removeCardFromDeck(input.deckId, input.cardId),
    onSuccess: () => invalidateDeckReads(qc),
  });
}

export interface LookupData {
  outcome: LookupOutcome | null;
  isLoading: boolean;
  /** 429-hardening (2026-07-19): 'busy' = rate-limited/throttled (ours or
   *  Azure's, worth retrying shortly); 'unavailable' = service failure. */
  error: 'busy' | 'unavailable' | null;
}
/** Search-capture lookup (2.1). Caller debounces + pre-gates (Tier-0) before
 *  enabling; the source re-gates authoritatively. Results are cached per
 *  (direction, query) — the server cache makes repeats free anyway.
 *  retry: false ON PURPOSE — a failed lookup must never auto-retry into a
 *  rate limit or an Azure throttle (the user can retype to retry). */
export function useLookup(query: string, direction: SearchDirection, enabled: boolean): LookupData {
  const userState = useDevStore((s) => s.userState); // mock reads scenario words
  const activeLang = useActiveLang(); // pair changes → cached lookups must not leak across languages
  const q = useQuery({
    queryKey: ['lookup', userState, activeLang, direction, query],
    queryFn: () => ds.lookup(query, direction),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const error = enabled && q.isError ? ((q.error as Error).message === 'lookup_busy' ? ('busy' as const) : ('unavailable' as const)) : null;
  return { outcome: enabled ? (q.data ?? null) : null, isLoading: enabled && q.isPending && !q.isError, error };
}

/** Lazy example sentences (16 §3) — fetched once per (translation, sense),
 *  cached server-side forever. Pass null to disable (nothing to fetch /
 *  already have). `targetTerm` = the sense's normalized target (per-sense
 *  examples, 2026-07-17); omitted → the primary sense. */
export function useExamples(translationId: string | null, targetTerm?: string) {
  const q = useQuery({
    queryKey: ['examples', translationId, targetTerm ?? null],
    queryFn: () => ds.getExamples(translationId as string, targetTerm),
    enabled: translationId != null,
    staleTime: Infinity,
    retry: false, // examples are decorative — never retry into a rate limit
  });
  return {
    examples: q.data ?? null,
    isLoading: translationId != null && q.isPending,
    /** Fetch RESOLVED — the result is authoritative, so an empty array means this
     *  sense genuinely has no example sentences. That's terminal, not a retry
     *  prompt: nothing in the lookup response can predict it (see BackTranslation
     *  .numExamples), so the only way to learn it is to have asked. */
    isSettled: translationId != null && q.isSuccess,
    /** Fetch FAILED (503/429). `retry: false` above, so this is final until the
     *  user explicitly asks again — that's what `refetch` is for. */
    isError: translationId != null && q.isError,
    refetch: q.refetch,
  };
}

/** Notification prefs (2.5) — read. Keys on the dev scenario so DevBadge
 *  account switches refetch, same as the other reads. */
export function useNotificationPrefs() {
  const userState = useDevStore((s) => s.userState);
  const uid = useUserKey();
  const q = useQuery({ queryKey: ['notificationPrefs', userState, uid], queryFn: () => ds.getNotificationPrefs() });
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

/** Archive / unarchive a card (18 §E3) — the word keeps everything but leaves
 *  the review queue while archived. */
export function useSetCardSuspended() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { cardId: string; suspended: boolean }) => ds.setCardSuspended(input.cardId, input.suspended),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deckCards'] });
      qc.invalidateQueries({ queryKey: ['words'] });
      qc.invalidateQueries({ queryKey: ['dueCards'] });
      qc.invalidateQueries({ queryKey: ['deckWords'] }); // archived rows render in deck lists
    },
  });
}

/** Edit Translations (Premium, 2026-07-28) — set or clear the user's own target
 *  text for a card. Invalidates every read that renders a target: the Word List
 *  ('words'), the study queue ('dueCards', whose recall input is sized from it)
 *  and 'deckCards'. Rejects with Error('premium_required') when a free-tier user
 *  tries to SET one (server-enforced; the UI gates first). */
export function useSetCardTargetOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { cardId: string; target: string | null }) => ds.setCardTargetOverride(input.cardId, input.target),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deckCards'] });
      qc.invalidateQueries({ queryKey: ['words'] });
      qc.invalidateQueries({ queryKey: ['dueCards'] });
      // The edited text is rendered inside deck lists too (this is the read
      // path Casey's сахара → сахар report surfaced).
      qc.invalidateQueries({ queryKey: ['deckWords'] });
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
      // deck_cards cascades on the card — every deck that held it must refetch,
      // list AND count.
      invalidateDeckReads(qc);
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
/** Median seconds-per-card, or null when the server has too few timed sessions.
 *  Null MUST hide the estimate rather than render as 0 — see get_session_pace. */
export function useSessionPace(): number | null {
  const userState = useDevStore((s) => s.userState);
  const uid = useUserKey();
  const q = useQuery({ queryKey: ['sessionPace', userState, uid], queryFn: () => ds.getSessionPace() });
  return q.data ?? null;
}

export function useCommitQuizSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { ratings: BufferedRating[]; durationMs?: number }) =>
      commitWithOutbox((p) => ds.commitQuizSession(p), payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deckCards'] });
      qc.invalidateQueries({ queryKey: ['dueCards'] });
      qc.invalidateQueries({ queryKey: ['words'] });
      qc.invalidateQueries({ queryKey: ['progressStats'] });
      qc.invalidateQueries({ queryKey: ['engagement'] });
      qc.invalidateQueries({ queryKey: ['sessionPace'] });
      // Deck lists render stability/dueAt/reps AND sort by dueAt ascending, so
      // without this the words you just answered sit at the top as most-due for
      // the whole stale window.
      qc.invalidateQueries({ queryKey: ['deckWords'] });
    },
  });
}

// SupabaseDataSource — the real DataSource (15-app-state-architecture). Reads
// via PostgREST under RLS (the signed-in user only ever sees their rows);
// lookup/examples via the Edge Functions; saves via the save_card RPC (capture
// gate Tier 2, 16 §2). Pure row→domain mapping lives in mappers.ts.
//
import { applyReview } from '@/domain/fsrs';
import { QUIZ_LENGTHS, uiRatingToFsrs, type BufferedRating, type QuizCardItem } from '@/domain/quiz';
import type { LookupOutcome, UsageExample } from '@/domain/translation';
import type { Card, CardFsrsState, Deck, Entitlement, NotificationPrefs, Profile, SearchDirection } from '@/domain/types';
import { directionLangs } from '@/domain/derive';

import type { AccountIdentity, DataSource, DeckCards, DeckSummary, Engagement, LeaderboardEntry, ProgressStats, WordListItem } from '../DataSource';
import { supabase } from './client';
import {
  mapCard,
  mapDeck,
  mapEntitlement,
  mapFsrsState,
  mapProfile,
  mapQuizItem,
  mapWordListItem,
  toCommitRow,
  type CardRow,
  type DeckRowDb,
  type FsrsRow,
  type ProfileRow,
  type SubscriptionRow,
  type TranslationJoin,
} from './mappers';


async function uid(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('not signed in');
  return id;
}

function bail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/** 20 §3 v2: set_username errors carry the machine token in DETAIL (errcode
 *  P0004) — surface THAT, so callers match on the same contract as
 *  free_word_cap. Engine/transport errors pass through. */
function bailUsername(error: { message: string; details?: string | null } | null): void {
  if (!error) return;
  const detail = error.details ?? '';
  throw new Error(/^(username_taken|username_invalid|username_change_limit|rate_limited)$/.test(detail) ? detail : error.message);
}

/** cards joined to translation + fsrs — the projection words/due-cards share.
 *  Phase D: `decks!inner(target_lang)` scopes every card read to the ACTIVE
 *  learning language (filtered per query via .eq('decks.target_lang', …)). */
const CARD_JOIN =
  'id, deck_id, user_id, translation_id, user_note, custom_front, custom_back, suspended, created_at, ' +
  'decks!inner ( target_lang ), ' +
  'translations_cache ( id, display_source, translation, pos_tag, prefix_word, examples, alt_translations, back_translations ), ' +
  'card_fsrs_state ( card_id, user_id, stability, difficulty, due_at, last_review_at, state, reps, lapses, learning_steps )';

/** Due-queue variant: `!inner` makes the embedded filter actually EXCLUDE parent
 *  rows (a plain embed filter only nulls the embed — the cards would all return). */
const DUE_JOIN = CARD_JOIN.replace('card_fsrs_state (', 'card_fsrs_state!inner (');

interface JoinedCardRow extends CardRow {
  translations_cache: TranslationJoin;
  card_fsrs_state: FsrsRow;
}

export const supabaseDataSource: DataSource = {
  async completeOnboarding(input): Promise<void> {
    const { error } = await supabase.rpc('complete_onboarding', {
      p_native_lang: input.nativeLang,
      p_learning_lang: input.targetLang,
      p_timezone: input.timezone,
      p_display_name: input.displayName ?? null,
      p_notifications_enabled: input.notificationsEnabled,
    });
    bail(error);
  },

  async lookup(query: string, direction: SearchDirection): Promise<LookupOutcome> {
    const profile = await this.getProfile();
    const { sourceCode, targetCode } = directionLangs(profile, direction);
    const { data, error } = await supabase.functions.invoke('translate', {
      body: { text: query, from: sourceCode, to: targetCode },
    });
    if (error) {
      // 429-hardening (2026-07-19): distinguish "throttled" (our rate limits OR
      // Azure 429 relayed by the fn) from other failures so the UI can say
      // "busy — try again shortly" instead of a misleading "no results", and so
      // the query layer knows never to auto-retry into a throttle.
      const status = (error as { context?: { status?: number } }).context?.status;
      throw new Error(status === 429 ? 'lookup_busy' : 'lookup_unavailable');
    }
    return data as LookupOutcome;
  },

  async saveCard(translationId: string, custom?: { front?: string; back?: string }): Promise<string | null> {
    const deck = await this.getActiveDeck();
    // A12c: a non-primary sense rides in as custom_front/custom_back — the card
    // then renders the sense the user actually chose (mappers already prefer
    // the custom fields over the cache row's primary sense).
    const { data, error } = await supabase.rpc('save_card', {
      p_translation_id: translationId,
      p_deck_id: deck.id,
      p_custom_front: custom?.front ?? null,
      p_custom_back: custom?.back ?? null,
    });
    bail(error);
    return (data as string | null) ?? null;
  },

  async setCardSuspended(cardId: string, suspended: boolean): Promise<void> {
    // 18 §E3: archival — the RPC logs the analytics event alongside the flag.
    const { error } = await supabase.rpc('set_card_suspended', { p_card_id: cardId, p_suspended: suspended });
    bail(error);
  },

  async deleteCard(cardId: string): Promise<void> {
    // A12b: the real delete — cascades FSRS state server-side + logs word_deleted.
    const { error } = await supabase.rpc('delete_card', { p_card_id: cardId });
    bail(error);
  },

  async getLearningLanguages(): Promise<string[]> {
    const { data, error } = await supabase.from('profile_languages').select('lang, added_at').order('added_at', { ascending: true });
    bail(error);
    return ((data ?? []) as { lang: string }[]).map((r) => r.lang);
  },

  async addLearningLanguage(lang: string): Promise<void> {
    const { error } = await supabase.rpc('add_learning_language', { p_lang: lang });
    bail(error);
  },

  async switchLearningLanguage(lang: string): Promise<void> {
    const { error } = await supabase.rpc('switch_learning_language', { p_lang: lang });
    bail(error);
  },

  async removeLearningLanguage(lang: string): Promise<void> {
    const { error } = await supabase.rpc('remove_learning_language', { p_lang: lang });
    bail(error);
  },

  async updateProfile(patch: { displayName?: string; quizLength?: number }): Promise<void> {
    // D6 / UX-17e: direct PostgREST update under the own-profile-update policy.
    const row: Record<string, unknown> = {};
    if (patch.displayName != null) row.display_name = patch.displayName.trim() === '' ? null : patch.displayName.trim();
    // UX-17b: ladder-validated client-side too (the column CHECK is the backstop).
    if (patch.quizLength != null && (QUIZ_LENGTHS as readonly number[]).includes(patch.quizLength)) row.quiz_length = patch.quizLength;
    if (Object.keys(row).length === 0) return;
    const { error } = await supabase.from('profiles').update(row).eq('id', await uid());
    bail(error);
  },

  // ── 20 §3: username identity ──────────────────────────────────────────────
  async getAccountIdentity(): Promise<AccountIdentity> {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw new Error(error.message);
    const user = data.user;
    // app_metadata.provider = the FIRST provider the account was created with
    // (identities[] lists all linked); that's the "associated with" answer the
    // Account block promises (20 §3.1).
    const raw = (user.app_metadata?.provider ?? user.identities?.[0]?.provider ?? 'email') as string;
    const provider: AccountIdentity['provider'] = raw === 'apple' || raw === 'google' ? raw : 'email';
    return { email: user.email ?? null, provider };
  },

  async setUsername(name: string): Promise<string> {
    const { data, error } = await supabase.rpc('set_username', { p_username: name });
    bailUsername(error);
    return data as string;
  },

  async getLeaderboard(scope: 'global' | 'language', lang?: string, limit = 100): Promise<LeaderboardEntry[]> {
    const { data, error } = await supabase.rpc('get_leaderboard', { p_scope: scope, p_lang: lang ?? null, p_limit: limit });
    bail(error);
    return ((data ?? []) as { rank: number; username: string; lang_code: string; mastered: number; is_self: boolean }[]).map((r) => ({
      rank: r.rank,
      username: r.username,
      langCode: r.lang_code,
      mastered: r.mastered,
      isSelf: r.is_self,
    }));
  },

  async logEvent(event: string, props: Record<string, unknown> = {}): Promise<void> {
    // 3.4: direct insert under the own-events-insert RLS policy. Allowlisted so
    // client code can't shadow server-written event names; unknown names are
    // dropped loudly in dev, silently in prod (analytics must never crash UX).
    const CLIENT_EVENTS = ['paywall_viewed', 'onboarding_started', 'walkthrough_started', 'walkthrough_completed', 'walkthrough_skipped'];
    if (!CLIENT_EVENTS.includes(event)) {
      if (__DEV__) console.warn(`logEvent: "${event}" is not an allowlisted client event`);
      return;
    }
    try {
      const { error } = await supabase.from('study_events').insert({ user_id: await uid(), event, props });
      if (error != null && __DEV__) console.warn(`logEvent(${event}) failed: ${error.message}`);
    } catch {
      // fire-and-forget: offline/unauthenticated emits are dropped by design
    }
  },

  async getExamples(translationId: string, targetTerm?: string): Promise<UsageExample[]> {
    // targetTerm = the sense's normalized target (per-sense examples,
    // 2026-07-17); the fn defaults to the primary sense when omitted.
    const { data, error } = await supabase.functions.invoke('examples', {
      body: { translationId, ...(targetTerm != null && targetTerm !== '' ? { targetTerm } : {}) },
    });
    if (error) throw new Error(error.message);
    return (data as { examples: UsageExample[] }).examples ?? [];
  },

  async getProfile(): Promise<Profile> {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', await uid()).single();
    bail(error);
    return mapProfile(data as ProfileRow);
  },

  async getEntitlement(): Promise<Entitlement> {
    const { data, error } = await supabase.from('subscriptions').select('*').maybeSingle();
    bail(error);
    return mapEntitlement(data as SubscriptionRow | null);
  },

  async getActiveDeck(lang?: string): Promise<Deck> {
    // Phase D: the active deck is the oldest deck for the ACTIVE learning
    // language (the hidden per-language main deck; RPCs guarantee it exists).
    const target = lang ?? (await this.getProfile()).targetLang;
    const { data, error } = await supabase
      .from('decks')
      .select('*')
      .eq('target_lang', target)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    bail(error);
    return mapDeck(data as DeckRowDb);
  },

  async getDeckCards(lang?: string): Promise<DeckCards> {
    const target = lang ?? (await this.getProfile()).targetLang;
    // Archived (suspended) cards ARE included (07-17c ruling: archiving never
    // removes a word from earned counts — it was excluded here, which made
    // Home/Progress/Settings totals disagree with the Words header and the
    // server cap by the archived count). homeSnapshot excludes suspended from
    // the due-queue numbers only.
    const { data, error } = await supabase
      .from('cards')
      .select(CARD_JOIN)
      .eq('decks.target_lang', target);
    bail(error);
    const rows = (data ?? []) as unknown as JoinedCardRow[];
    const cards: Card[] = rows.map(mapCard);
    const states: CardFsrsState[] = rows.map((r) => mapFsrsState(r.card_fsrs_state));
    return { cards, states };
  },

  async getEngagement(): Promise<Engagement> {
    const { data, error } = await supabase.rpc('get_study_stats');
    bail(error);
    const s = data as { streak_days: number };
    return { streakDays: s.streak_days ?? 0 };
  },

  async getProgressStats(): Promise<ProgressStats> {
    const { data, error } = await supabase.rpc('get_study_stats');
    bail(error);
    const s = data as { sessions_total: number; avg_accuracy: number; best_streak: number; days_active: number };
    return {
      sessionsTotal: s.sessions_total ?? 0,
      avgAccuracy: Number(s.avg_accuracy ?? 0),
      bestStreak: s.best_streak ?? 0,
      daysActive: s.days_active ?? 0,
    };
  },

  async getDecks(lang?: string): Promise<DeckSummary[]> {
    const target = lang ?? (await this.getProfile()).targetLang;
    const { data, error } = await supabase
      .from('decks')
      .select('id, name, created_at, cards(count)')
      .eq('target_lang', target)
      .order('created_at', { ascending: true });
    bail(error);
    type Row = { id: string; name: string; created_at: string; cards: { count: number }[] };
    // 18 §E1: the OLDEST deck per language is the hidden main deck (same rule
    // getActiveDeck uses) — reachable only via Home "Study now". Custom Decks
    // lists user-created decks only.
    return ((data ?? []) as Row[]).slice(1).map((d) => ({
      id: d.id,
      name: d.name,
      wordCount: d.cards[0]?.count ?? 0,
      reviews: 0, // TODO(analytics): per-deck study counts
      createdAt: new Date(d.created_at),
      lastReviewedAt: null,
    }));
  },

  async getWords(lang?: string): Promise<WordListItem[]> {
    const target = lang ?? (await this.getProfile()).targetLang;
    const { data, error } = await supabase
      .from('cards')
      .select(CARD_JOIN)
      .eq('decks.target_lang', target)
      .order('created_at', { ascending: false });
    bail(error);
    const rows = (data ?? []) as unknown as JoinedCardRow[];
    return rows.map((r) => mapWordListItem(r, r.translations_cache, r.card_fsrs_state));
  },

  async getDueCards(limit: number, lang?: string): Promise<QuizCardItem[]> {
    // 18 §2c fill composition — two ordered pulls: (1) everything due now,
    // oldest overdue first; (2) if the due count is under the session cap,
    // top up with the NEXT-due upcoming cards (dueAt asc). Reviewing ahead is
    // FSRS-legitimate (ts-fsrs schedules from actual elapsed time), and the
    // ordering guarantees the fill is always the highest-priority words.
    const target = lang ?? (await this.getProfile()).targetLang;
    const nowIso = new Date().toISOString();
    const { data: dueData, error: dueErr } = await supabase
      .from('cards')
      .select(DUE_JOIN)
      .eq('suspended', false)
      .eq('decks.target_lang', target)
      .lte('card_fsrs_state.due_at', nowIso)
      .order('due_at', { referencedTable: 'card_fsrs_state', ascending: true })
      .limit(limit);
    bail(dueErr);
    const rows = ((dueData ?? []) as unknown as JoinedCardRow[]).filter((r) => r.card_fsrs_state != null);

    const remaining = limit - rows.length;
    if (remaining > 0) {
      const { data: nextData, error: nextErr } = await supabase
        .from('cards')
        .select(DUE_JOIN)
        .eq('suspended', false)
        .eq('decks.target_lang', target)
        .gt('card_fsrs_state.due_at', nowIso)
        .order('due_at', { referencedTable: 'card_fsrs_state', ascending: true })
        .limit(remaining);
      bail(nextErr);
      rows.push(...((nextData ?? []) as unknown as JoinedCardRow[]).filter((r) => r.card_fsrs_state != null));
    }
    return rows.map((r) => mapQuizItem(r, r.translations_cache, r.card_fsrs_state, target));
  },

  async getNotificationPrefs(): Promise<NotificationPrefs> {
    const { data, error } = await supabase.from('notification_prefs').select('*').maybeSingle();
    bail(error);
    if (data == null) return { enabled: false, frequency: 'daily', windows: [{ time: '09:00' }], minDueToNotify: 1, days: [0, 1, 2, 3, 4, 5, 6] };
    return {
      enabled: data.enabled,
      frequency: data.frequency,
      windows: data.windows ?? [{ time: '09:00' }],
      minDueToNotify: data.min_due_to_notify ?? 1,
      days: data.days ?? [0, 1, 2, 3, 4, 5, 6],
    };
  },

  async updateNotificationPrefs(prefs: Partial<NotificationPrefs>): Promise<void> {
    const userId = await uid();
    const row: Record<string, unknown> = { user_id: userId };
    if (prefs.enabled != null) row.enabled = prefs.enabled;
    if (prefs.frequency != null) row.frequency = prefs.frequency;
    if (prefs.windows != null) row.windows = prefs.windows;
    if (prefs.minDueToNotify != null) row.min_due_to_notify = prefs.minDueToNotify;
    if (prefs.days != null) row.days = prefs.days; // 18 §C1 (server rejects empty/invalid)
    const { error } = await supabase.from('notification_prefs').upsert(row, { onConflict: 'user_id' });
    bail(error);
  },

  async registerPushToken(token: string, platform: 'ios' | 'android'): Promise<void> {
    const userId = await uid();
    const { error } = await supabase
      .from('push_tokens')
      .upsert({ user_id: userId, token, platform, updated_at: new Date().toISOString() }, { onConflict: 'user_id,token' });
    bail(error);
  },

  async commitQuizSession({ ratings }: { ratings: BufferedRating[] }): Promise<void> {
    if (ratings.length === 0) return;
    // FSRS recompute is CLIENT-SIDE (02 locked decision; math in domain/fsrs).
    // Re-read the current states here (not trusted from the screen) so a stale
    // session can't clobber a fresher state from another device.
    const ids = ratings.map((r) => r.cardId);
    const { data: rows, error: stErr } = await supabase.from('card_fsrs_state').select('*').in('card_id', ids);
    bail(stErr);
    const stateOf = new Map(((rows ?? []) as FsrsRow[]).map((r) => [r.card_id, mapFsrsState(r)]));

    const now = new Date();
    const commits = ratings.flatMap((r) => {
      const current = stateOf.get(r.cardId);
      if (current == null) return []; // card deleted mid-session — skip, don't fail the batch
      return [toCommitRow(applyReview(current, uiRatingToFsrs(r.rating), now))];
    });
    if (commits.length === 0) return;

    // Atomic persist: states + logs + event in one transaction (RPC).
    const { error } = await supabase.rpc('commit_quiz_session', { p_reviews: commits });
    bail(error);
  },
};

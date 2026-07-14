// SupabaseDataSource — the real DataSource (15-app-state-architecture). Reads
// via PostgREST under RLS (the signed-in user only ever sees their rows);
// lookup/examples via the Edge Functions; saves via the save_card RPC (capture
// gate Tier 2, 16 §2). Pure row→domain mapping lives in mappers.ts.
//
// Session-scoped TODOs (tracked in 08):
// - streak / progress stats: no schema home yet (03 note) — zeros until the
//   study_events derivations land.
// - commitQuizSession: appends review_logs + quiz_completed event; FSRS state
//   recompute is 2.2 (ts-fsrs).
import { applyReview } from '@/domain/fsrs';
import { uiRatingToFsrs, type BufferedRating, type QuizCardItem } from '@/domain/quiz';
import type { LookupOutcome, UsageExample } from '@/domain/translation';
import type { Card, CardFsrsState, Deck, Entitlement, NotificationPrefs, Profile, SearchDirection } from '@/domain/types';
import { directionLangs } from '@/domain/derive';

import type { DataSource, DeckCards, DeckSummary, Engagement, ProgressStats, WordListItem } from '../DataSource';
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

const QUIZ_SESSION_CAP = 20;

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('not signed in');
  return id;
}

function bail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/** cards joined to translation + fsrs — the projection words/due-cards share. */
const CARD_JOIN =
  'id, deck_id, user_id, translation_id, user_note, custom_front, custom_back, suspended, created_at, ' +
  'translations_cache ( id, display_source, translation, pos_tag, prefix_word, examples ), ' +
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
    if (error) throw new Error(error.message);
    return data as LookupOutcome;
  },

  async saveCard(translationId: string): Promise<void> {
    const deck = await this.getActiveDeck();
    const { error } = await supabase.rpc('save_card', { p_translation_id: translationId, p_deck_id: deck.id });
    bail(error);
  },

  async getExamples(translationId: string): Promise<UsageExample[]> {
    const { data, error } = await supabase.functions.invoke('examples', { body: { translationId } });
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

  async getActiveDeck(): Promise<Deck> {
    // Free tier = 1 deck (00); the first deck is the active pair (03).
    const { data, error } = await supabase
      .from('decks')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    bail(error);
    return mapDeck(data as DeckRowDb);
  },

  async getDeckCards(): Promise<DeckCards> {
    const { data, error } = await supabase.from('cards').select(CARD_JOIN).eq('suspended', false);
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

  async getDecks(): Promise<DeckSummary[]> {
    const { data, error } = await supabase.from('decks').select('id, name, created_at, cards(count)');
    bail(error);
    type Row = { id: string; name: string; created_at: string; cards: { count: number }[] };
    return ((data ?? []) as Row[]).map((d) => ({
      id: d.id,
      name: d.name,
      wordCount: d.cards[0]?.count ?? 0,
      reviews: 0, // TODO(analytics): per-deck study counts
      createdAt: new Date(d.created_at),
      lastReviewedAt: null,
    }));
  },

  async getWords(): Promise<WordListItem[]> {
    const { data, error } = await supabase
      .from('cards')
      .select(CARD_JOIN)
      .order('created_at', { ascending: false });
    bail(error);
    const rows = (data ?? []) as unknown as JoinedCardRow[];
    return rows.map((r) => mapWordListItem(r, r.translations_cache, r.card_fsrs_state));
  },

  async getDueCards(): Promise<QuizCardItem[]> {
    const profile = await this.getProfile();
    const { data, error } = await supabase
      .from('cards')
      .select(DUE_JOIN)
      .eq('suspended', false)
      .lte('card_fsrs_state.due_at', new Date().toISOString())
      .order('due_at', { referencedTable: 'card_fsrs_state', ascending: true })
      .limit(QUIZ_SESSION_CAP);
    bail(error);
    const rows = (data ?? []) as unknown as JoinedCardRow[];
    return rows
      .filter((r) => r.card_fsrs_state != null)
      .map((r) => mapQuizItem(r, r.translations_cache, r.card_fsrs_state, profile.targetLang));
  },

  async getNotificationPrefs(): Promise<NotificationPrefs> {
    const { data, error } = await supabase.from('notification_prefs').select('*').maybeSingle();
    bail(error);
    if (data == null) return { enabled: false, frequency: 'daily', windows: [{ time: '19:00' }], minDueToNotify: 1 };
    return {
      enabled: data.enabled,
      frequency: data.frequency,
      windows: data.windows ?? [{ time: '19:00' }],
      minDueToNotify: data.min_due_to_notify ?? 1,
    };
  },

  async updateNotificationPrefs(prefs: Partial<NotificationPrefs>): Promise<void> {
    const userId = await uid();
    const row: Record<string, unknown> = { user_id: userId };
    if (prefs.enabled != null) row.enabled = prefs.enabled;
    if (prefs.frequency != null) row.frequency = prefs.frequency;
    if (prefs.windows != null) row.windows = prefs.windows;
    if (prefs.minDueToNotify != null) row.min_due_to_notify = prefs.minDueToNotify;
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

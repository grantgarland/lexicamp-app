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
  overrideText,
  toCommitRow,
  type CardRow,
  type DeckRowDb,
  type FsrsRow,
  type OverrideRow,
  type ProfileRow,
  type SubscriptionRow,
  type TranslationJoin,
} from './mappers';


/**
 * Client-emittable event names (3.4, extended by 3.1).
 *
 * ⚠️ ADD THE NAME HERE WHEN YOU ADD A `logEvent(...)` CALL. An unlisted name is
 * dropped by `logEvent` below and the emit is a silent no-op in production —
 * which is exactly how the 3.1 purchase events shipped emitting into nothing.
 * `clientEventParity.test.ts` fails CI on that drift, so this list and the call
 * sites cannot separate again.
 *
 * Server-written names (word_saved, quiz_completed, lookup_uncached…) stay off
 * this list on purpose: the allowlist is what stops client code shadowing an
 * event the RPCs own.
 */
const CLIENT_EVENTS = [
  // Conversion funnel: paywall_viewed → purchase_succeeded → trial_started.
  'paywall_viewed',
  'paywall_purchase_succeeded',
  'paywall_purchase_cancelled',
  'paywall_restore',
  'trial_started',
  // The webhook's only health signal — StoreKit says paid, our mirror never
  // agreed. Invisible from both dashboards, so it has to arrive from here.
  'entitlement_mirror_lag',
  // Onboarding / walkthrough funnel.
  'onboarding_started',
  'walkthrough_started',
  'walkthrough_completed',
  'walkthrough_skipped',
];

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('not signed in');
  return id;
}

function bail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

/** PostgREST caps every response at the project's `max-rows` (1000 by default),
 *  SILENTLY — a truncated page looks exactly like a complete one. A 4,000-card
 *  library therefore rendered as 1,000 saved / 100 mastered, with the tier
 *  counts summing to exactly 1000 (Casey, 2026-08-04). Any read that can return
 *  a whole library has to page. */
const PAGE_SIZE = 1000;
/** Runaway guard: 200 pages is 200k cards, far past any real library. */
const MAX_PAGES = 200;

/**
 * Fetch every row of a query, a page at a time.
 *
 * `page(from, to)` MUST apply a deterministic ORDER BY. Postgres gives no
 * ordering guarantee across separate LIMIT/OFFSET statements, so an unordered
 * paged read can hand back the same row twice and skip another — which is worse
 * than the truncation it replaces, because it looks plausible.
 */
async function fetchAllPages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const from = i * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    bail(error);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    // A short page is the last page. An exactly-full one may or may not be, so
    // it costs one more round trip to find out.
    if (rows.length < PAGE_SIZE) return out;
  }
  return out;
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
 *  learning language (filtered per query via .eq('decks.target_lang', …)).
 *
 *  The `!cards_deck_id_fkey` hint is LOAD-BEARING as of 2026-07-30. `deck_cards`
 *  has FKs to both `cards` and `decks` and a primary key of exactly
 *  (deck_id, card_id) — the shape PostgREST auto-detects as a many-to-many
 *  junction. That gives `cards → decks` two candidate relationships (direct via
 *  cards.deck_id, or M2M through deck_cards) and PostgREST refuses to guess:
 *  PGRST201, on EVERY read that uses this projection — the Word List, the home
 *  snapshot, Progress and the quiz queue. Naming the FK pins the direct one. */
const CARD_JOIN =
  'id, deck_id, user_id, translation_id, user_note, custom_front, custom_back, suspended, created_at, ' +
  'decks!cards_deck_id_fkey!inner ( target_lang ), ' +
  'card_target_overrides ( target_text ), ' +
  'translations_cache ( id, display_source, translation, source_lang, target_lang, pos_tag, prefix_word, examples, alt_translations, back_translations, provider ), ' +
  'card_fsrs_state ( card_id, user_id, stability, difficulty, due_at, last_review_at, state, reps, lapses, learning_steps )';

/** Due-queue variant: `!inner` makes the embedded filter actually EXCLUDE parent
 *  rows (a plain embed filter only nulls the embed — the cards would all return). */
const DUE_JOIN = CARD_JOIN.replace('card_fsrs_state (', 'card_fsrs_state!inner (');

/** Stats projection for `getDeckCards` (data-perf audit, 2026-08-06).
 *
 *  `getDeckCards` feeds Home and Progress through `homeSnapshot`, which reads only card
 *  identity/suspended/createdAt plus the FSRS state — it never touches a translation.
 *  It was nonetheless reusing CARD_JOIN, dragging `translations_cache.examples`,
 *  `alt_translations` and `back_translations` (jsonb blobs) plus the override row across
 *  the wire for EVERY card in the library, on every Home and Progress load.
 *
 *  These are exactly the columns `mapCard` + `mapFsrsState` consume and nothing else, so
 *  the domain output is byte-identical — same rows, same order, same types. Only the
 *  payload shrinks. `decks!…!inner` stays: it is what scopes the read to the active
 *  language, not a nicety. */
const CARD_STATS_JOIN =
  'id, deck_id, user_id, translation_id, user_note, custom_front, custom_back, suspended, created_at, ' +
  'decks!cards_deck_id_fkey!inner ( target_lang ), ' +
  'card_fsrs_state ( card_id, user_id, stability, difficulty, due_at, last_review_at, state, reps, lapses, learning_steps )';

/** Custom-deck-membership variant (2026-07-30): the same card projection, inner-
 *  joined through `deck_cards` so only the deck's members come back. `!inner` is
 *  load-bearing here for the same reason it is on DUE_JOIN — a plain embed filter
 *  nulls the embed instead of excluding the parent row, which would return the
 *  ENTIRE library as the deck's contents (i.e. exactly the prototype bug this
 *  replaces, just sourced from the server instead of a slice). */
const DECK_MEMBER_JOIN = CARD_JOIN + ', deck_cards!inner ( deck_id )';

/** How recently a card must have been reviewed to be DEMOTED in the study-ahead
 *  fill (see getDueCards). Long enough to cover "finish a session, immediately
 *  start another", short enough that a genuine later-in-the-day top-up session
 *  can still reach ahead.
 *
 *  Demoted, not excluded — that distinction is the whole feature (2026-08-09).
 *  As a hard exclusion this emptied the queue in exactly the state that makes
 *  "Study ahead" the CTA: being caught up MEANS having just reviewed everything,
 *  so a user who finished a session and wanted to keep going was handed "All
 *  caught up!" and a back button for half an hour. */
const FILL_COOLDOWN_MS = 30 * 60 * 1000;

/** Deck-scoped DUE variant — both `!inner`s matter, for different reasons:
 *  card_fsrs_state to exclude cards with no schedule, deck_cards to exclude
 *  non-members. */
const DECK_DUE_JOIN = DUE_JOIN + ', deck_cards!inner ( deck_id )';

interface JoinedCardRow extends CardRow {
  translations_cache: TranslationJoin;
  card_fsrs_state: FsrsRow;
  /** Edit Translations (Premium, 2026-07-28) — absent on untouched cards. */
  card_target_overrides?: OverrideRow | OverrideRow[] | null;
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

  async setCardTargetOverride(cardId: string, target: string | null): Promise<void> {
    // Edit Translations (Premium, 2026-07-28). The RPC owns ownership, the
    // premium gate (set only — clearing is always allowed), trimming, the
    // 120-char cap, and the analytics event. Nothing else is written: the card,
    // its FSRS state, its review history and the shared translations_cache row
    // are all untouched, which is exactly what the sheet's info tooltip promises.
    const { error } = await supabase.rpc('set_card_target_override', {
      p_card_id: cardId,
      p_target: target == null || target.trim() === '' ? null : target.trim(),
    });
    bail(error);
  },

  async deleteCard(cardId: string): Promise<void> {
    // A12b: the real delete — cascades FSRS state server-side + logs word_deleted.
    const { error } = await supabase.rpc('delete_card', { p_card_id: cardId });
    bail(error);
  },

  async getLearningLanguages(): Promise<string[]> {
    const { data, error } = await supabase.from('profile_languages').select('lang, added_at').is('archived_at', null).order('added_at', { ascending: true });
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

  async updateProfile(patch: { displayName?: string; quizLength?: number; timezone?: string }): Promise<void> {
    // D6 / UX-17e: direct PostgREST update under the own-profile-update policy.
    const row: Record<string, unknown> = {};
    if (patch.displayName != null) row.display_name = patch.displayName.trim() === '' ? null : patch.displayName.trim();
    // UX-17b: ladder-validated client-side too (the column CHECK is the backstop).
    if (patch.quizLength != null && (QUIZ_LENGTHS as readonly number[]).includes(patch.quizLength)) row.quiz_length = patch.quizLength;
    // Sent by the session-start sync, not by any screen (2026-08-12). Passed
    // through unvalidated ON PURPOSE: the client cannot know which zone names
    // this server's tzdata carries, so the `profiles_normalize_timezone`
    // trigger is the authority — it keeps the last good value rather than
    // rejecting, because one unknown zone in `profiles` would raise inside
    // run_push_scheduler() and kill reminders for every user at once.
    if (patch.timezone != null && patch.timezone.trim() !== '') row.timezone = patch.timezone.trim();
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
    // Google is intentionally excluded (product decision 2026-07-27: no Google
    // sign-in) — any non-Apple provider reads as 'email'.
    const provider: AccountIdentity['provider'] = raw === 'apple' ? raw : 'email';
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
    // 3.4: direct insert under the own-events-insert RLS policy. Allowlisted
    // (CLIENT_EVENTS, module scope) so client code can't shadow server-written
    // event names; unknown names are dropped loudly in dev, silently in prod
    // (analytics must never crash UX).
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
      .order('id', { ascending: true }) // tie-break, matching SQL is_main_deck
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
    // CARD_STATS_JOIN, not CARD_JOIN: homeSnapshot reads no translation fields, so the
    // jsonb example/alt/back-translation blobs in the full projection were pure waste on
    // every Home and Progress load. Same rows, same order, same mapped output.
    const rows = await fetchAllPages<JoinedCardRow>((from, to) =>
      supabase
        .from('cards')
        .select(CARD_STATS_JOIN)
        .eq('decks.target_lang', target)
        // Ordered ONLY so the paging is stable — nothing downstream depends on
        // it (Home/Progress derive from the whole set).
        .order('id', { ascending: true })
        .range(from, to),
    );
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

  async getProgressStats(lang?: string): Promise<ProgressStats> {
    // Language-scoped (2026-08-05): the grid used to aggregate every language,
    // so an untouched language still showed the account's whole history.
    const target = lang ?? (await this.getProfile()).targetLang;
    const { data, error } = await supabase.rpc('get_study_stats', { p_lang: target });
    bail(error);
    const s = data as {
      sessions_total: number; avg_accuracy: number; best_streak: number; days_active: number;
      reviews_total?: number; time_invested_ms?: number;
    };
    return {
      sessionsTotal: s.sessions_total ?? 0,
      avgAccuracy: Number(s.avg_accuracy ?? 0),
      bestStreak: s.best_streak ?? 0,
      daysActive: s.days_active ?? 0,
      // Optional-chained on purpose: a client can outrun the migration that adds
      // these (TestFlight builds don't upgrade in lockstep with the database),
      // and a missing key must degrade to an em-dash tile, not NaN.
      reviewsTotal: Number(s.reviews_total ?? 0),
      timeInvestedMs: Number(s.time_invested_ms ?? 0),
    };
  },

  async getDecks(lang?: string): Promise<DeckSummary[]> {
    const target = lang ?? (await this.getProfile()).targetLang;
    const { data, error } = await supabase
      .from('decks')
      // 2026-07-30: count MEMBERSHIP rows, not cards.deck_id. Every card in a
      // language points at that language's MAIN deck, so `cards(count)` reported
      // the whole library for one deck and 0 for the rest.
      .select('id, name, created_at, deck_cards(count)')
      .eq('target_lang', target)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }); // tie-break, so .slice(1) is deterministic
    bail(error);
    type Row = { id: string; name: string; created_at: string; deck_cards?: { count: number }[] };

    // Per-deck review counts (2026-08-05). These were hardcoded to 0/null behind
    // a TODO, so a studied deck reported "REVIEWS 0 / LAST REVIEWED Never" while
    // the word rows in the same sheet showed their real counts. One RPC for the
    // whole list, not one call per deck.
    //
    // Non-fatal on purpose: the deck list is useful without its stats, and a
    // failure here should degrade to the old zeros rather than blank the screen.
    const { data: statsData, error: statsErr } = await supabase.rpc('get_deck_stats');
    if (statsErr) console.warn('get_deck_stats failed; deck stats will read 0', statsErr.message);
    const stats = (statsData ?? {}) as Record<string, { reviews?: number; last_reviewed_at?: string | null }>;

    // 18 §E1: the OLDEST deck per language is the hidden main deck (same rule
    // getActiveDeck uses) — reachable only via Home "Study now". Custom Decks
    // lists user-created decks only.
    return ((data ?? []) as Row[]).slice(1).map((d) => {
      const st = stats[d.id];
      return {
        id: d.id,
        name: d.name,
        wordCount: d.deck_cards?.[0]?.count ?? 0,
        reviews: Number(st?.reviews ?? 0),
        createdAt: new Date(d.created_at),
        lastReviewedAt: st?.last_reviewed_at ? new Date(st.last_reviewed_at) : null,
      };
    });
  },

  async getDeckWords(deckId: string, lang?: string): Promise<WordListItem[]> {
    // Membership read (2026-07-30). Language-scoped as well as deck-scoped: the
    // deck already belongs to one language, but a stale deck id from a previous
    // language must resolve to empty rather than to another language's words.
    const target = lang ?? (await this.getProfile()).targetLang;
    // Paged for the same reason as the library reads: a deck can hold as many
    // words as the library does, and PostgREST truncates at max-rows silently.
    const rows = await fetchAllPages<JoinedCardRow>((from, to) =>
      supabase
        .from('cards')
        .select(DECK_MEMBER_JOIN)
        .eq('decks.target_lang', target)
        .eq('deck_cards.deck_id', deckId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map((r) => mapWordListItem(r, r.translations_cache, r.card_fsrs_state, overrideText(r.card_target_overrides), target));
  },

  async getCardDeckIds(cardId: string): Promise<string[]> {
    const { data, error } = await supabase.from('deck_cards').select('deck_id').eq('card_id', cardId);
    bail(error);
    return ((data ?? []) as { deck_id: string }[]).map((r) => r.deck_id);
  },

  async createDeck(name: string, cardIds: string[], lang?: string): Promise<string> {
    const target = lang ?? (await this.getProfile()).targetLang;
    // The RPC owns normalisation, the premium gate, per-language name uniqueness,
    // the deck cap, and filtering the seed ids down to this user's cards in this
    // language — so a stale client can't stitch another language's word in.
    const { data, error } = await supabase.rpc('create_deck', {
      p_name: name,
      p_target_lang: target,
      p_card_ids: cardIds,
    });
    bail(error);
    return data as string;
  },

  async deleteDeck(deckId: string): Promise<void> {
    const { error } = await supabase.rpc('delete_deck', { p_deck_id: deckId });
    bail(error);
  },

  async addCardToDeck(deckId: string, cardId: string): Promise<void> {
    const { error } = await supabase.rpc('add_card_to_deck', { p_deck_id: deckId, p_card_id: cardId });
    bail(error);
  },

  async removeCardFromDeck(deckId: string, cardId: string): Promise<void> {
    const { error } = await supabase.rpc('remove_card_from_deck', { p_deck_id: deckId, p_card_id: cardId });
    bail(error);
  },

  async getWords(lang?: string): Promise<WordListItem[]> {
    const target = lang ?? (await this.getProfile()).targetLang;
    const rows = await fetchAllPages<JoinedCardRow>((from, to) =>
      supabase
        .from('cards')
        .select(CARD_JOIN)
        .eq('decks.target_lang', target)
        .order('created_at', { ascending: false })
        // Tie-break: seeded rows share a created_at, and equal keys leave the
        // page boundary free to reshuffle between requests.
        .order('id', { ascending: true })
        .range(from, to),
    );
    return rows.map((r) => mapWordListItem(r, r.translations_cache, r.card_fsrs_state, overrideText(r.card_target_overrides), target));
  },

  async getDueCards(limit: number, lang?: string, deckId?: string): Promise<QuizCardItem[]> {
    // ⚠️ Ordering uses `card_fsrs_state(due_at)`, NOT
    // `{ referencedTable: 'card_fsrs_state' }`. The latter emits
    // `card_fsrs_state.order=…`, which orders WITHIN the embed — and since
    // card_fsrs_state is to-ONE (card_id is its primary key) that sorts a
    // one-element embed, i.e. does nothing. The parent rows came back unordered
    // and `.limit()` sliced an arbitrary subset, so a badly overdue card could
    // be skipped in favour of one due an hour ago. Only visible when the due (or
    // upcoming) count exceeds the session cap. Fixed 2026-07-30.
    //
    // 18 §2c fill composition — three ordered pulls, each topping up what the
    // previous left short, every one of them dueAt ASC so the queue is always
    // FSRS-prioritised no matter which tier a card comes from:
    //   (1) everything DUE now, oldest overdue first;
    //   (2) the next-due UPCOMING cards, minus anything reviewed inside the
    //       cooldown — the ordinary "study ahead";
    //   (3) last resort: the upcoming cards the cooldown just held back.
    // Reviewing ahead is FSRS-legitimate (ts-fsrs schedules from actual elapsed
    // time), and tier 3 is what makes the queue INEXHAUSTIBLE while the library
    // has unsuspended cards — continuous review is the product, so running out
    // of scheduled words must never be a dead end (2026-08-09).
    //
    // The three tiers are disjoint by construction, so the result never needs
    // de-duplicating: (1) is dueAt ≤ now, (2) and (3) are both dueAt > now and
    // split on the cooldown predicate and its exact complement.
    const target = lang ?? (await this.getProfile()).targetLang;
    const nowIso = new Date().toISOString();
    // 2026-07-30: `deckId` narrows the same two pulls to one custom deck's
    // membership. The fill semantics are unchanged — they just fill from the
    // deck instead of the language, which is what makes a 7-word deck produce a
    // 7-word session instead of quietly borrowing the rest of the library.
    const dueQuery = supabase
      .from('cards')
      .select(deckId != null ? DECK_DUE_JOIN : DUE_JOIN)
      .eq('suspended', false)
      .eq('decks.target_lang', target)
      .lte('card_fsrs_state.due_at', nowIso);
    if (deckId != null) dueQuery.eq('deck_cards.deck_id', deckId);
    const { data: dueData, error: dueErr } = await dueQuery
      .order('card_fsrs_state(due_at)', { ascending: true })
      .limit(limit);
    bail(dueErr);
    const rows = ((dueData ?? []) as unknown as JoinedCardRow[]).filter((r) => r.card_fsrs_state != null);

    // Shared shape of both fill pulls: not due yet, same scope as the due pull.
    // Only the cooldown predicate differs between them.
    const cooldownIso = new Date(Date.now() - FILL_COOLDOWN_MS).toISOString();
    const upcomingQuery = () => {
      const q = supabase
        .from('cards')
        .select(deckId != null ? DECK_DUE_JOIN : DUE_JOIN)
        .eq('suspended', false)
        .eq('decks.target_lang', target)
        .gt('card_fsrs_state.due_at', nowIso);
      if (deckId != null) q.eq('deck_cards.deck_id', deckId);
      return q;
    };
    const pushFill = async (query: ReturnType<typeof upcomingQuery>, take: number) => {
      const { data, error } = await query.order('card_fsrs_state(due_at)', { ascending: true }).limit(take);
      bail(error);
      rows.push(...((data ?? []) as unknown as JoinedCardRow[]).filter((r) => r.card_fsrs_state != null));
    };

    const remaining = limit - rows.length;
    if (remaining > 0) {
      // Tier 2. A word answered minutes ago is not "ahead" of anything: FSRS
      // schedules from ACTUAL elapsed time, so re-rating at elapsed ≈ 0 teaches
      // the model nothing and the user just sees the session they only just
      // finished. So the ordinary fill skips the cooldown window (Casey,
      // quiz-repeat bug 2026-08-04 — the other route into that symptom was a
      // stale snapshot in QuizScreen).
      //
      // Only the FILL is filtered. A lapsed card put into relearning is due
      // again in minutes BY DESIGN, and it comes back through the due pull
      // above, which this does not touch.
      await pushFill(
        upcomingQuery().or(`last_review_at.is.null,last_review_at.lt.${cooldownIso}`, { referencedTable: 'card_fsrs_state' }),
        remaining,
      );
    }

    const stillShort = limit - rows.length;
    if (stillShort > 0) {
      // Tier 3 — the cooldown's complement, and the reason a queue can no longer
      // come back empty. Skipping a just-reviewed word is only worth doing when
      // there is something better to study; when there is not, refusing to serve
      // it doesn't protect the schedule, it just ends the session. The user
      // asked to keep going, and a slightly early re-review is a far smaller
      // cost than a dead end (2026-08-09).
      //
      // Ordered by dueAt like every other tier, so what surfaces first is the
      // weakest material — the words closest to falling due — rather than
      // whatever happened to be answered longest ago.
      await pushFill(upcomingQuery().gte('card_fsrs_state.last_review_at', cooldownIso), stillShort);
    }
    return rows.map((r) => mapQuizItem(r, r.translations_cache, r.card_fsrs_state, target, overrideText(r.card_target_overrides)));
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
    // RPC, not an upsert: `push_tokens` is keyed by TOKEN (one device = one
    // account), so registering may have to take the row over from whichever
    // account held this phone before. The own-push-tokens RLS policy blocks
    // that by design — the pre-image row fails `using auth.uid() = user_id` —
    // so the transfer runs SECURITY DEFINER server-side. It still only ever
    // writes auth.uid(), so it cannot hand a device to anyone else.
    const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: platform });
    bail(error);
  },

  async unregisterPushToken(token: string): Promise<void> {
    // Scoped to the caller by user_id AND by RLS. Signing out of account A on a
    // shared phone must not disturb account B's registration for the same token.
    const userId = await uid();
    const { error } = await supabase.from('push_tokens').delete().eq('user_id', userId).eq('token', token);
    bail(error);
  },

  async getSessionPace(): Promise<number | null> {
    const { data, error } = await supabase.rpc('get_session_pace');
    bail(error);
    const secs = (data as { seconds_per_card: number | null } | null)?.seconds_per_card;
    return typeof secs === 'number' && secs > 0 ? secs : null;
  },

  async commitQuizSession({ ratings, durationMs }: { ratings: BufferedRating[]; durationMs?: number }): Promise<void> {
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
    // p_duration_ms is optional server-side and bounds-checked there, so a wild
    // client value is dropped rather than poisoning the pace median.
    const { error } = await supabase.rpc('commit_quiz_session', {
      p_reviews: commits,
      p_duration_ms: durationMs != null && Number.isFinite(durationMs) ? Math.round(durationMs) : null,
    });
    bail(error);
  },

  async deleteOwnAccount(): Promise<void> {
    // App Store 5.1.1(v). The RPC takes no arguments and derives the target from
    // auth.uid(), so there is no way to delete anyone else. auth.users cascades
    // through profiles to every owned row — no client-side cleanup needed.
    const { error } = await supabase.rpc('delete_own_account');
    bail(error);
  },
};

// Pure row→domain mappers for the Supabase source. Kept free of supabase-js so
// they unit-test like any domain code (mappers.test.ts) — the DataSource is a
// thin I/O shell around these.
import i18n from '@/i18n';
import { languageName } from '@/domain/derive';
import type { ReviewComputation } from '@/domain/fsrs';
import type { QuizCardItem, QuizMode } from '@/domain/quiz';
import type { Card, CardFsrsState, Deck, Entitlement, FsrsStateValue, Profile } from '@/domain/types';
import { getTierByStability } from '@/theme/tiers';

import type { WordListItem } from '../DataSource';

// ── Row shapes (the exact select() projections the source requests) ──────────
export interface ProfileRow {
  id: string;
  display_name: string | null;
  native_lang: string;
  learning_lang: string;
  timezone: string;
  onboarding_complete: boolean;
}

export interface SubscriptionRow {
  status: 'free' | 'trial' | 'active' | 'expired' | 'grace';
  plan: 'monthly' | 'annual' | null;
  platform: 'ios' | 'android' | null;
  current_period_end: string | null;
}

export interface DeckRowDb {
  id: string;
  user_id: string;
  name: string;
  source_lang: string;
  target_lang: string;
}

export interface CardRow {
  id: string;
  deck_id: string;
  user_id: string;
  translation_id: string;
  user_note: string | null;
  custom_front: string | null;
  custom_back: string | null;
  suspended: boolean;
  created_at: string;
}

export interface FsrsRow {
  card_id: string;
  user_id: string;
  stability: number;
  difficulty: number;
  due_at: string;
  last_review_at: string | null;
  state: number;
  reps: number;
  lapses: number;
  learning_steps: number;
}

interface BackTranslation {
  displayText: string;
}
interface AltSense {
  displayTarget: string;
  prefixWord?: string;
  backTranslations?: BackTranslation[];
}

export interface TranslationJoin {
  id: string;
  display_source: string;
  translation: string | null;
  pos_tag: string | null;
  prefix_word: string | null;
  /** Full Azure sense list (D10) — source of the quiz pre-flip sense hints. */
  alt_translations?: AltSense[] | null;
  /** The PRIMARY sense's back-translations. */
  back_translations?: BackTranslation[] | null;
  examples:
    | {
        sourcePrefix: string;
        sourceTerm: string;
        sourceSuffix: string;
        targetPrefix: string;
        targetTerm: string;
        targetSuffix: string;
      }[]
    | null;
}

// ── Mappers ───────────────────────────────────────────────────────────────────
export const mapProfile = (r: ProfileRow): Profile => ({
  id: r.id,
  displayName: r.display_name,
  nativeLang: r.native_lang,
  targetLang: r.learning_lang,
  timezone: r.timezone,
  onboardingComplete: r.onboarding_complete,
});

/** Absent subscriptions row = free tier (the row is created by the RevenueCat webhook). */
export const mapEntitlement = (r: SubscriptionRow | null): Entitlement =>
  r == null
    ? { status: 'free', plan: null, platform: null, currentPeriodEnd: null }
    : {
        status: r.status,
        plan: r.plan,
        platform: r.platform,
        currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end) : null,
      };

export const mapDeck = (r: DeckRowDb): Deck => ({
  id: r.id,
  userId: r.user_id,
  name: r.name,
  sourceLang: r.source_lang,
  targetLang: r.target_lang,
});

export const mapCard = (r: CardRow): Card => ({
  id: r.id,
  deckId: r.deck_id,
  userId: r.user_id,
  translationId: r.translation_id,
  userNote: r.user_note,
  customFront: r.custom_front,
  customBack: r.custom_back,
  suspended: r.suspended,
  createdAt: new Date(r.created_at),
});

export const mapFsrsState = (r: FsrsRow): CardFsrsState => ({
  cardId: r.card_id,
  userId: r.user_id,
  stability: r.stability,
  difficulty: r.difficulty,
  dueAt: new Date(r.due_at),
  lastReviewAt: r.last_review_at ? new Date(r.last_review_at) : null,
  state: (r.state >= 0 && r.state <= 3 ? r.state : 0) as FsrsStateValue,
  reps: r.reps,
  lapses: r.lapses,
  learningSteps: r.learning_steps,
});

/** cards ⋈ translations_cache ⋈ card_fsrs_state → Word List row. */
export function mapWordListItem(card: CardRow, tr: TranslationJoin, fsrs: FsrsRow): WordListItem {
  const ex = tr.examples?.[0];
  return {
    id: card.id,
    translationId: tr.id,
    native: card.custom_front ?? tr.display_source,
    target: card.custom_back ?? tr.translation ?? '',
    pos: tr.pos_tag ? i18n.t(`pos.${tr.pos_tag}`, { defaultValue: tr.pos_tag.toLowerCase() }) : '',
    example: ex ? `${ex.sourcePrefix}${ex.sourceTerm}${ex.sourceSuffix}` : '',
    exampleTranslation: ex ? `${ex.targetPrefix}${ex.targetTerm}${ex.targetSuffix}` : '',
    stability: fsrs.stability,
    reps: fsrs.reps,
    createdAt: new Date(card.created_at),
    dueAt: new Date(fsrs.due_at),
  };
}

/** D10 pre-flip sense hint: with multiple cards per headword ("to go" →
 *  ехать/идти…), the front must say WHICH variant is being asked without
 *  revealing the answer. Fallback chain (D10b — sparse rows, e.g. azure_mt
 *  fallback translations that carry no dictionary senses):
 *    1) the sense's back-translations minus the headword ("as in: ride, drive"),
 *    2) the SOURCE-language example sentence — context implies the sense, and
 *       the answer only ever lives on the target side, so nothing leaks.
 *  POS was considered and rejected: sibling senses usually share it. */
function senseHint(card: CardRow, tr: TranslationJoin): string | undefined {
  const back =
    card.custom_back != null
      ? (tr.alt_translations ?? []).find(
          (s) => s.displayTarget === card.custom_back || (s.prefixWord ? `${s.prefixWord} ${s.displayTarget}` : s.displayTarget) === card.custom_back,
        )?.backTranslations
      : tr.back_translations;
  if (back != null && back.length > 0) {
    const front = (card.custom_front ?? tr.display_source).toLowerCase();
    const hints = back
      .map((b) => b.displayText)
      .filter((t) => t.toLowerCase() !== front)
      .slice(0, 2);
    if (hints.length > 0) return i18n.t('quiz.senseHint', { hints: hints.join(', ') });
  }
  const ex = tr.examples?.[0];
  if (ex != null) return `“${ex.sourcePrefix}${ex.sourceTerm}${ex.sourceSuffix}”`;
  return undefined;
}

/** Due card → quiz view-model (mode mirrors the mock: lower tiers = recognition). */
export function mapQuizItem(card: CardRow, tr: TranslationJoin, fsrs: FsrsRow, targetLang: string): QuizCardItem {
  const tier = getTierByStability(fsrs.stability);
  const mode: QuizMode = tier.id === 'bc' || tier.id === 'abc' ? 'recognition' : 'recall';
  return {
    id: card.id,
    tierId: tier.id,
    mode,
    fsrs: mapFsrsState(fsrs),
    content: {
      frontWord: card.custom_front ?? tr.display_source,
      ...(senseHint(card, tr) != null ? { frontSub: senseHint(card, tr) } : {}),
      frontPrompt:
        mode === 'recognition'
          ? i18n.t('quiz.promptRecognition')
          : i18n.t('quiz.promptRecall', { lang: languageName(targetLang) }),
      backWord: card.custom_back ?? tr.translation ?? '',
      ...(tr.pos_tag ? { backPos: i18n.t(`pos.${tr.pos_tag}`, { defaultValue: tr.pos_tag.toLowerCase() }) } : {}),
      // Cached example only — display-side; the quiz never adds network calls.
      ...(tr.examples?.[0]
        ? { backExample: `${tr.examples[0].targetPrefix}${tr.examples[0].targetTerm}${tr.examples[0].targetSuffix}` }
        : {}),
    },
  };
}

/** ReviewComputation (domain/fsrs applyReview) → commit_quiz_session RPC row. */
export function toCommitRow(c: ReviewComputation) {
  return {
    card_id: c.next.cardId,
    stability: c.next.stability,
    difficulty: c.next.difficulty,
    due_at: c.next.dueAt.toISOString(),
    last_review_at: c.next.lastReviewAt?.toISOString() ?? null,
    state: c.next.state,
    reps: c.next.reps,
    lapses: c.next.lapses,
    learning_steps: c.next.learningSteps,
    rating: c.log.rating,
    elapsed_days: c.log.elapsedDays,
    scheduled_days: c.log.scheduledDays,
    state_before: c.log.stateBefore,
  };
}

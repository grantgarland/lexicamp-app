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
  username: string;
  username_changes: number;
  display_name: string | null;
  native_lang: string;
  learning_lang: string;
  timezone: string;
  onboarding_complete: boolean;
  quiz_length: number;
  created_at: string;
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
  /** Cache-key form — the per-sense examples map key (2026-07-17). */
  normalizedTarget?: string;
  displayTarget: string;
  prefixWord?: string;
  backTranslations?: BackTranslation[];
}

interface ExampleRow {
  sourcePrefix: string;
  sourceTerm: string;
  sourceSuffix: string;
  targetPrefix: string;
  targetTerm: string;
  targetSuffix: string;
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
  /** Per-sense examples map keyed by normalized target term (2026-07-17 fix:
   *  sibling sense cards were sharing the primary sense's examples). A legacy
   *  ARRAY (pre-migration rows) = the primary sense's examples. */
  examples: Record<string, ExampleRow[]> | ExampleRow[] | null;
}

/** The examples-map key for THIS card's sense: primary unless custom_back says
 *  the user saved a sibling sense (A12c) — then that sense's normalizedTarget.
 *  Matching mirrors senseHint's custom_back ↔ alt-sense resolution (with or
 *  without the gendered prefixWord). */
export function cardSenseKey(card: Pick<CardRow, 'custom_back'>, tr: TranslationJoin): string {
  const primary = (tr.translation ?? '').toLowerCase();
  if (card.custom_back == null || card.custom_back.toLowerCase() === primary) return primary;
  const alt = (tr.alt_translations ?? []).find(
    (s) => s.displayTarget === card.custom_back || (s.prefixWord ? `${s.prefixWord} ${s.displayTarget}` : s.displayTarget) === card.custom_back,
  );
  return (alt?.normalizedTarget ?? alt?.displayTarget ?? card.custom_back).toLowerCase();
}

/** First cached example for THIS card's sense (never a sibling's — the bug this
 *  replaces showed the primary sense's example on every sibling card). */
function senseExample(card: Pick<CardRow, 'custom_back'>, tr: TranslationJoin): ExampleRow | undefined {
  if (tr.examples == null) return undefined;
  const key = cardSenseKey(card, tr);
  if (Array.isArray(tr.examples)) {
    // Legacy shape: primary-sense examples only.
    return key === (tr.translation ?? '').toLowerCase() ? tr.examples[0] : undefined;
  }
  return tr.examples[key]?.[0];
}

// ── Mappers ───────────────────────────────────────────────────────────────────
export const mapProfile = (r: ProfileRow): Profile => ({
  id: r.id,
  username: r.username,
  usernameChanges: r.username_changes,
  displayName: r.display_name,
  nativeLang: r.native_lang,
  targetLang: r.learning_lang,
  timezone: r.timezone,
  onboardingComplete: r.onboarding_complete,
  quizLength: r.quiz_length,
  createdAt: new Date(r.created_at),
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

/** Edit Translations (2026-07-28): the embedded `card_target_overrides` row.
 *  PostgREST returns a 1-1 embed as an object, but a to-many-shaped one as an
 *  array — accept both so a projection change can't silently drop the override. */
export interface OverrideRow {
  target_text: string;
}
export function overrideText(o: OverrideRow | OverrideRow[] | null | undefined): string | null {
  if (o == null) return null;
  const row = Array.isArray(o) ? o[0] : o;
  const text = row?.target_text?.trim();
  return text != null && text !== '' ? text : null;
}

/** cards ⋈ translations_cache ⋈ card_fsrs_state → Word List row.
 *  `override` = the user's Edit-Translations text (Premium) — it replaces the
 *  RENDERED target only. Sense resolution (cardSenseKey / senseExample) stays on
 *  custom_back on purpose: the override is display text, not a sense choice, and
 *  routing it through cardSenseKey would break per-sense example lookup. */
export function mapWordListItem(card: CardRow, tr: TranslationJoin, fsrs: FsrsRow, override?: string | null): WordListItem {
  const ex = senseExample(card, tr);
  const originalTarget = card.custom_back ?? tr.translation ?? '';
  return {
    id: card.id,
    translationId: tr.id,
    senseTarget: cardSenseKey(card, tr),
    native: card.custom_front ?? tr.display_source,
    target: override ?? originalTarget,
    targetOverride: override ?? null,
    originalTarget,
    pos: tr.pos_tag ? i18n.t(`pos.${tr.pos_tag}`, { defaultValue: tr.pos_tag.toLowerCase() }) : '',
    example: ex ? `${ex.sourcePrefix}${ex.sourceTerm}${ex.sourceSuffix}` : '',
    exampleTranslation: ex ? `${ex.targetPrefix}${ex.targetTerm}${ex.targetSuffix}` : '',
    stability: fsrs.stability,
    reps: fsrs.reps,
    createdAt: new Date(card.created_at),
    dueAt: new Date(fsrs.due_at),
    suspended: card.suspended,
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
  // Per-sense (2026-07-17): the fallback example must be THIS sense's — a
  // sibling's sentence would hint the wrong meaning.
  const ex = senseExample(card, tr);
  if (ex != null) return `“${ex.sourcePrefix}${ex.sourceTerm}${ex.sourceSuffix}”`;
  return undefined;
}

/** Due card → quiz view-model (mode mirrors the mock: lower tiers = recognition). */
export function mapQuizItem(card: CardRow, tr: TranslationJoin, fsrs: FsrsRow, targetLang: string, override?: string | null): QuizCardItem {
  const tier = getTierByStability(fsrs.stability);
  const mode: QuizMode = tier.id === 'bc' || tier.id === 'abc' ? 'recognition' : 'recall';
  const hint = senseHint(card, tr);
  // Cached example only — display-side; the quiz never adds network calls.
  // Per-sense (2026-07-17): THIS card's sense, never a sibling's.
  const ex = senseExample(card, tr);
  return {
    id: card.id,
    tierId: tier.id,
    mode,
    fsrs: mapFsrsState(fsrs),
    content: {
      frontWord: card.custom_front ?? tr.display_source,
      ...(hint != null ? { frontSub: hint } : {}),
      frontPrompt:
        mode === 'recognition'
          ? i18n.t('quiz.promptRecognition')
          : i18n.t('quiz.promptRecall', { lang: languageName(targetLang) }),
      // Edit Translations: the user's own text IS the answer they're studying,
      // so it drives both the revealed back and the recall input's slot count.
      backWord: override ?? card.custom_back ?? tr.translation ?? '',
      ...(tr.pos_tag ? { backPos: i18n.t(`pos.${tr.pos_tag}`, { defaultValue: tr.pos_tag.toLowerCase() }) } : {}),
      ...(ex != null ? { backExample: `${ex.targetPrefix}${ex.targetTerm}${ex.targetSuffix}` } : {}),
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

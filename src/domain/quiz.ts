// Quiz domain — the study-session view-model + rating mapping. A QuizCardItem is a
// due card resolved to display content + its mastery tier + the recall mode. Per 03's
// quiz write pattern, ratings are buffered in-memory and committed as a batch on
// session completion (FSRS recompute happens client-side at commit — `ts-fsrs` later).
import type { TierId } from '@/theme/tiers';

import type { Rating } from './types';

export type QuizMode = 'recognition' | 'recall';
/** The 3-button self-grade shown in the UI. */
export type UiRating = 'again' | 'almost' | 'got_it';

/** Display content for one quiz card (front prompt + revealed back). */
export interface QuizCardContent {
  frontWord: string;
  frontSub?: string;
  frontPrompt: string;
  backWord: string;
  backPhonetic?: string;
  backPos?: string;
  backExample?: string;
}

export interface QuizCardItem {
  /** = card id. */
  id: string;
  tierId: TierId;
  mode: QuizMode;
  content: QuizCardContent;
}

/** One buffered rating during a session. */
export interface BufferedRating {
  cardId: string;
  rating: UiRating;
}

/** Map the 3-button UI grade → FSRS rating (03 review_logs: 1 again · 2 hard · 3 good · 4 easy). */
export function uiRatingToFsrs(r: UiRating): Rating {
  return r === 'again' ? 1 : r === 'almost' ? 2 : 3;
}

/** "Promoted" = graded got_it (advanced this session); "again" = needs review. */
export interface SessionStats {
  total: number;
  promoted: number; // got_it
  almost: number;
  again: number;
  accuracy: number; // % got_it
}

export function sessionStats(ratings: BufferedRating[]): SessionStats {
  const total = ratings.length;
  const promoted = ratings.filter((r) => r.rating === 'got_it').length;
  const almost = ratings.filter((r) => r.rating === 'almost').length;
  const again = ratings.filter((r) => r.rating === 'again').length;
  return { total, promoted, almost, again, accuracy: total > 0 ? Math.round((promoted / total) * 100) : 0 };
}

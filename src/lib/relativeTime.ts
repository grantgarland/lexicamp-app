// Relative-time labels for saved words (shared by the Word List rows + detail sheets).
// Keys live under `wordList.*` so the phrasing stays consistent everywhere.
import type { TFunction } from 'i18next';

const DAY = 24 * 60 * 60 * 1000;

/** "Today / Yesterday / N days · weeks · months ago". */
export function addedLabel(createdAt: Date, t: TFunction): string {
  const days = Math.floor((Date.now() - createdAt.getTime()) / DAY);
  if (days <= 0) return t('wordList.addedToday');
  if (days === 1) return t('wordList.addedYesterday');
  if (days < 14) return t('wordList.addedDaysAgo', { count: days });
  if (days < 60) return t('wordList.addedWeeksAgo', { count: Math.round(days / 7) });
  return t('wordList.addedMonthsAgo', { count: Math.round(days / 30) });
}

/** A word's review "health" from its next-due date: overdue/now → needs review,
 *  within 2 days → approaching, else healthy. Drives the due-label color in the
 *  shared WordRow (moved here from ProgressScreen for the 18-item-1 row
 *  consolidation — one definition, every list). */
export function wordHealth(dueAt: Date): 'due' | 'soon' | 'ok' {
  const ms = dueAt.getTime() - Date.now();
  if (ms <= 0) return 'due';
  if (ms <= 2 * DAY) return 'soon';
  return 'ok';
}

/** "Due now / Today / Tomorrow / in N days · weeks". */
export function dueLabel(dueAt: Date, t: TFunction): string {
  const ms = dueAt.getTime() - Date.now();
  if (ms <= 0) return t('wordList.dueNow');
  const days = Math.round(ms / DAY);
  if (days === 0) return t('wordList.dueToday');
  if (days === 1) return t('wordList.dueTomorrow');
  if (days < 14) return t('wordList.dueInDays', { count: days });
  return t('wordList.dueInWeeks', { count: Math.round(days / 7) });
}

/** Short absolute date, e.g. "Jun 24". */
export function shortDate(d: Date, t: TFunction): string {
  const months = t('date.months', { returnObjects: true }) as string[];
  return `${months[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
}

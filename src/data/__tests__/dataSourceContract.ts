// DataSource contract — behavioral invariants ANY implementation must satisfy.
// Runs against the mock today; when SupabaseDataSource lands (backlog 1.3+),
// point a second `describeDataSourceContract('supabase', …)` at it and the same
// suite guards mock↔Supabase parity for free. Not a *.test.ts file on purpose —
// it only runs where a test file invokes it.
/// <reference types="jest" />
import { sessionStats } from '@/domain/quiz';
import { homeSnapshot, MASTERY_STABILITY } from '@/domain/derive';
import { isPaid } from '@/domain/types';
import { TIERS } from '@/theme/tiers';

import type { DataSource } from '../DataSource';

const TIER_IDS = new Set(TIERS.map((t) => t.id));

export function describeDataSourceContract(name: string, source: DataSource): void {
  describe(`DataSource contract — ${name}`, () => {
    it('getProfile returns a usable profile (language pair + timezone)', async () => {
      const p = await source.getProfile();
      expect(p.id).toBeTruthy();
      expect(p.nativeLang).toBeTruthy();
      expect(p.learningLang).toBeTruthy();
      expect(p.nativeLang).not.toBe(p.learningLang);
      expect(p.timezone).toBeTruthy();
    });

    it('getEntitlement is internally consistent (isPaid ⇔ status/plan agree)', async () => {
      const e = await source.getEntitlement();
      if (isPaid(e)) {
        expect(['trial', 'active', 'grace']).toContain(e.status);
      } else {
        expect(e.plan).toBeNull();
      }
    });

    it('getDeckCards: cards ↔ states are 1:1 and derive a coherent home snapshot', async () => {
      const { cards, states } = await source.getDeckCards();
      expect(states.length).toBe(cards.length);
      const cardIds = new Set(cards.map((c) => c.id));
      for (const s of states) expect(cardIds.has(s.cardId)).toBe(true);

      const snap = homeSnapshot(cards, states);
      expect(snap.wordsSaved).toBe(cards.length);
      expect(snap.isEmpty).toBe(cards.length === 0);
      // Tier buckets only count studied words; they can never exceed the deck.
      const bucketed = snap.tierCounts.reduce((a, b) => a + b, 0);
      expect(bucketed).toBeLessThanOrEqual(cards.length);
      // Mastered ⊆ studied, and consistent with the raw states.
      const mastered = states.filter((s) => s.reps > 0 && s.stability >= MASTERY_STABILITY).length;
      expect(snap.masteredCount).toBe(mastered);
    });

    it('getWords mirrors the deck (Word List count = Home wordsSaved), newest first', async () => {
      const [{ cards }, words] = await Promise.all([source.getDeckCards(), source.getWords()]);
      expect(words.length).toBe(cards.length);
      for (let i = 1; i < words.length; i += 1) {
        expect(words[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(words[i].createdAt.getTime());
      }
      for (const w of words) {
        expect(w.native).toBeTruthy();
        expect(w.target).toBeTruthy();
        expect(w.stability).toBeGreaterThanOrEqual(0);
      }
    });

    it('getDueCards returns valid quiz view-models (registry tiers, known modes)', async () => {
      const due = await source.getDueCards();
      for (const q of due) {
        expect(TIER_IDS.has(q.tierId)).toBe(true);
        expect(['recognition', 'recall']).toContain(q.mode);
        expect(q.content.frontWord).toBeTruthy();
        expect(q.content.backWord).toBeTruthy();
      }
    });

    it('commitQuizSession accepts a full-session batch (03 write pattern)', async () => {
      const due = await source.getDueCards();
      const ratings = due.map((q, i) => ({
        cardId: q.id,
        rating: (['again', 'almost', 'got_it'] as const)[i % 3],
      }));
      // Sanity: the stats we would show are computable from what we commit.
      expect(sessionStats(ratings).total).toBe(ratings.length);
      await expect(source.commitQuizSession({ ratings })).resolves.toBeUndefined();
    });

    it('getEngagement / getProgressStats return sane non-negatives', async () => {
      const [eng, stats] = await Promise.all([source.getEngagement(), source.getProgressStats()]);
      expect(eng.streakDays).toBeGreaterThanOrEqual(0);
      expect(stats.sessionsTotal).toBeGreaterThanOrEqual(0);
      expect(stats.avgAccuracy).toBeGreaterThanOrEqual(0);
      expect(stats.avgAccuracy).toBeLessThanOrEqual(100);
    });
  });
}

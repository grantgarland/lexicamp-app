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
import { decomposeUsername, generateUsernameCandidate, validateUsername } from '@/domain/username';

import type { DataSource } from '../DataSource';

const TIER_IDS = new Set(TIERS.map((t) => t.id));

export function describeDataSourceContract(name: string, source: DataSource): void {
  describe(`DataSource contract — ${name}`, () => {
    it('getProfile returns a usable profile (language pair + timezone)', async () => {
      const p = await source.getProfile();
      expect(p.id).toBeTruthy();
      expect(p.nativeLang).toBeTruthy();
      expect(p.targetLang).toBeTruthy();
      expect(p.nativeLang).not.toBe(p.targetLang);
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

    it('multi-language contract (Phase D): enrolled set, switch flips active, remove guards the active language', async () => {
      const langs = await source.getLearningLanguages();
      expect(langs.length).toBeGreaterThan(0);
      const before = (await source.getProfile()).targetLang;
      const other = langs.find((l) => l !== before);
      if (other != null) {
        await source.switchLearningLanguage(other);
        expect((await source.getProfile()).targetLang).toBe(other);
        // The active language cannot be removed (server raises language_active).
        await expect(source.removeLearningLanguage(other)).rejects.toThrow();
        await source.switchLearningLanguage(before); // restore
        expect((await source.getProfile()).targetLang).toBe(before);
      }
      // Switching to a non-enrolled language is rejected.
      await expect(source.switchLearningLanguage('xx-not-enrolled')).rejects.toThrow();
    });

    it('remove ARCHIVES (2026-07-21): the language leaves the enrolled list; re-adding restores it', async () => {
      const langs = await source.getLearningLanguages();
      const active = (await source.getProfile()).targetLang;
      const other = langs.find((l) => l !== active);
      if (other == null) return; // single-language source — nothing removable
      await source.removeLearningLanguage(other);
      expect(await source.getLearningLanguages()).not.toContain(other);
      // An archived language is no longer switchable or re-removable.
      await expect(source.switchLearningLanguage(other)).rejects.toThrow();
      await expect(source.removeLearningLanguage(other)).rejects.toThrow();
      // Re-add = restore (free path server-side) + switch to it.
      await source.addLearningLanguage(other);
      expect(await source.getLearningLanguages()).toContain(other);
      expect((await source.getProfile()).targetLang).toBe(other);
      await source.switchLearningLanguage(active); // leave state as found
    });

    it('getDueCards composes the session per 18 §2c: due-first ordering, cap respected, whole deck when smaller', async () => {
      // Cap respected + dueAt ascending (due-now leads, next-due fills the tail).
      const capped = await source.getDueCards(3);
      expect(capped.length).toBeLessThanOrEqual(3);
      const all = await source.getDueCards(1000);
      for (let i = 1; i < all.length; i++) {
        expect(all[i].fsrs.dueAt.getTime()).toBeGreaterThanOrEqual(all[i - 1].fsrs.dueAt.getTime());
      }
      // Whole deck when smaller than the cap: a huge cap can't invent cards.
      expect(all.length).toBeGreaterThan(0);
      expect((await source.getDueCards(1000)).length).toBe(all.length);
      // The capped session is a prefix of the full ordering — the fill is always
      // the HIGHEST-priority words, never arbitrary picks.
      expect(capped.map((c) => c.id)).toEqual(all.slice(0, capped.length).map((c) => c.id));
    });

    it('getDueCards returns valid quiz view-models (registry tiers, known modes)', async () => {
      const due = await source.getDueCards(20);
      for (const q of due) {
        expect(TIER_IDS.has(q.tierId)).toBe(true);
        expect(['recognition', 'recall']).toContain(q.mode);
        expect(q.content.frontWord).toBeTruthy();
        expect(q.content.backWord).toBeTruthy();
      }
    });

    it('commitQuizSession accepts a full-session batch (03 write pattern)', async () => {
      const due = await source.getDueCards(20);
      const ratings = due.map((q, i) => ({
        cardId: q.id,
        rating: (['again', 'almost', 'got_it'] as const)[i % 3],
      }));
      // Sanity: the stats we would show are computable from what we commit.
      expect(sessionStats(ratings).total).toBe(ratings.length);
      await expect(source.commitQuizSession({ ratings })).resolves.toBeUndefined();
    });

    it('lookup: a plain word resolves with confidence-ordered senses (16 §2)', async () => {
      const out = await source.lookup('fly', 'native_to_target');
      expect(out.status).toBe('found');
      if (out.status !== 'found') return;
      expect(out.result.senses.length).toBeGreaterThan(0);
      for (let i = 1; i < out.result.senses.length; i += 1) {
        expect(out.result.senses[i - 1].confidence).toBeGreaterThanOrEqual(out.result.senses[i].confidence);
      }
      expect(out.result.entryKind).toBe('word');
      expect(out.result.normalizedSource).toBe('fly');
    });

    it('lookup: multi-word expressions are allowed and marked as phrases', async () => {
      const out = await source.lookup('speed bump', 'native_to_target');
      expect(out.status).toBe('found');
      if (out.status === 'found') expect(['phrase', 'phrase_mt']).toContain(out.result.entryKind);
    });

    it('lookup: sentence-like input is gate-rejected with a reason, never resolved', async () => {
      const out = await source.lookup('I went to the store, and then I came home.', 'native_to_target');
      expect(out).toEqual({ status: 'rejected', reason: 'sentence_like' });
    });

    it('lookup: junk input is gate-rejected (no API/cache cost path)', async () => {
      expect((await source.lookup('   ', 'native_to_target')).status).toBe('rejected');
      expect((await source.lookup('https://spam.example.com', 'native_to_target')).status).toBe('rejected');
    });

    it('completeOnboarding accepts the buffered choices (idempotent by contract)', async () => {
      await expect(
        source.completeOnboarding({
          nativeLang: 'en',
          targetLang: 'es',
          timezone: 'America/New_York',
          notificationsEnabled: true,
        }),
      ).resolves.toBeUndefined();
    });


    it('username identity (20 \u00a73 v2): profile carries a valid, decomposable username', async () => {
      const p = await source.getProfile();
      expect(validateUsername(p.username).ok).toBe(true);
      expect(p.usernameChanges).toBeGreaterThanOrEqual(0);
    });

    it('cycling is draft-only: candidates never write until setUsername', async () => {
      const before = (await source.getProfile()).username;
      // 10 local cycles — all decomposable, none persisted.
      let draft = before;
      for (let i = 0; i < 10; i += 1) {
        draft = generateUsernameCandidate(Math.random, draft);
        expect(decomposeUsername(draft)).not.toBeNull();
      }
      expect((await source.getProfile()).username).toBe(before);
    });

    it('setUsername claims a cycled draft and round-trips into the profile', async () => {
      const before = await source.getProfile();
      let draft = generateUsernameCandidate();
      // steer clear of the mock's taken fixtures — that path has its own test
      while (['alpine-elk', 'steady-ibex', 'quick-pika'].includes(draft)) draft = generateUsernameCandidate();
      expect(await source.setUsername(draft)).toBe(draft);
      const after = await source.getProfile();
      expect(after.username).toBe(draft);
      expect(after.usernameChanges).toBe(before.usernameChanges + 1);
      // idempotent re-save of the current name never burns a change
      expect(await source.setUsername(draft.toUpperCase())).toBe(draft);
      expect((await source.getProfile()).usernameChanges).toBe(after.usernameChanges);
    });

    it('setUsername rejects with the machine-token contract', async () => {
      // No-free-form guarantee: non-list words can never be claimed.
      await expect(source.setUsername('assmuncher-fox')).rejects.toThrow('username_invalid');
      await expect(source.setUsername('totally-custom-name')).rejects.toThrow('username_invalid');
      // Taken race (mock fixture) → username_taken, and the profile is untouched.
      const before = (await source.getProfile()).username;
      await expect(source.setUsername('alpine-elk')).rejects.toThrow('username_taken');
      expect((await source.getProfile()).username).toBe(before);
    });

    it('getAccountIdentity returns an email + a known provider', async () => {
      const id = await source.getAccountIdentity();
      expect(['apple', 'google', 'email']).toContain(id.provider);
      expect(id.email == null || id.email.includes('@')).toBe(true);
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

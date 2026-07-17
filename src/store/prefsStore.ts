// Per-device preferences (03 "Client-side state, not stored in DB"): last-used
// search direction + recent searches + UI locale + quiz length + one-time UI
// dismissals. Persisted across restarts via zustand/persist over AsyncStorage
// (03's intent).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { SearchDirection } from '@/domain/types';
import i18n, { type AppLocale } from '@/i18n';

// Storage-sanity bound only — NOT a UX gate (Casey, 2026-07-16: recents must not
// cap at 5; the fading list can hold a long history).
const RECENTS_CAP = 100;

/** The quiz-length ladder (Casey, 2026-07-16): a doubling set. 20 = Standard =
 *  the recommended default AND the free-tier pin. */
export const QUIZ_LENGTHS = [10, 20, 40, 80] as const;
export const QUIZ_LENGTH_FREE = 20;
export const QUIZ_LENGTH_DEFAULT = 20;

/** Snap an arbitrary persisted value onto the ladder (nearest; ties round down). */
export function snapQuizLength(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return QUIZ_LENGTH_DEFAULT;
  let best: number = QUIZ_LENGTH_DEFAULT;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const v of QUIZ_LENGTHS) {
    const d = Math.abs(v - n);
    if (d < bestDist) {
      best = v;
      bestDist = d;
    }
  }
  return best;
}

interface PrefsState {
  searchDirection: SearchDirection;
  /** Recent searches PER USER (18-session: only words the active account actually
   *  searched — no seeds, no cross-account bleed on a shared device). */
  recentsByUser: Record<string, string[]>;
  /** Active UI locale (app chrome language) — follows the OS; not persisted (D3). */
  locale: AppLocale;
  /** Cards per study session (premium-selectable; free tier pinned to QUIZ_LENGTH_FREE). */
  quizLength: number;
  /** Home "How Lexicamp works" card dismissed (17 §H3). Content stays reachable in Settings. */
  eduCardDismissed: boolean;
  /** First-run walkthrough completed or skipped (18 §F2) — the tour never auto-fires twice. */
  walkthroughDone: boolean;
  setSearchDirection: (d: SearchDirection) => void;
  addRecent: (userId: string, word: string) => void;
  removeRecent: (userId: string, word: string) => void;
  /** Switch the UI language at runtime; drives react-i18next re-renders. */
  setLocale: (locale: AppLocale) => void;
  setQuizLength: (n: number) => void;
  setEduCardDismissed: (v: boolean) => void;
  setWalkthroughDone: (v: boolean) => void;
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      // 03 default: native_to_target.
      searchDirection: 'native_to_target',
      recentsByUser: {},
      locale: i18n.language as AppLocale,
      quizLength: QUIZ_LENGTH_DEFAULT,
      eduCardDismissed: false,
      walkthroughDone: false,
      setSearchDirection: (searchDirection) => set({ searchDirection }),
      setLocale: (locale) => {
        i18n.changeLanguage(locale);
        set({ locale });
      },
      setQuizLength: (quizLength) => set({ quizLength }),
      setEduCardDismissed: (eduCardDismissed) => set({ eduCardDismissed }),
      setWalkthroughDone: (walkthroughDone) => set({ walkthroughDone }),
      addRecent: (userId, word) =>
        set((s) => {
          const cur = s.recentsByUser[userId] ?? [];
          const next = [word, ...cur.filter((w) => w !== word)].slice(0, RECENTS_CAP);
          return { recentsByUser: { ...s.recentsByUser, [userId]: next } };
        }),
      removeRecent: (userId, word) =>
        set((s) => ({
          recentsByUser: { ...s.recentsByUser, [userId]: (s.recentsByUser[userId] ?? []).filter((w) => w !== word) },
        })),
    }),
    {
      name: 'lexicamp-prefs',
      storage: createJSONStorage(() => AsyncStorage),
      version: 2,
      // v0 → v1: recents moved from a device-global seeded array to per-user maps.
      // The old array (incl. the demo seeds montaña/recordar/fluidez) is DROPPED —
      // seeds must never surface as a user's history.
      // v1 → v2: quiz-length ladder changed to 10/20/40/80 — persisted 60/100
      // values snap to the nearest rung (60→40, 100→80).
      migrate: (persisted) => {
        const p = persisted as Record<string, unknown>;
        delete p.recents;
        if (p.recentsByUser == null) p.recentsByUser = {};
        p.quizLength = snapQuizLength(p.quizLength);
        return p;
      },
      // 18 §A8 (D3): the UI locale is NOT persisted — it follows the OS/per-app
      // language setting on every launch.
      partialize: (s) => ({
        searchDirection: s.searchDirection,
        recentsByUser: s.recentsByUser,
        quizLength: s.quizLength,
        eduCardDismissed: s.eduCardDismissed,
        walkthroughDone: s.walkthroughDone,
      }),
    },
  ),
);

// Per-device preferences (03 "Client-side state, not stored in DB"): last-used
// search direction + recent searches + UI locale + quiz length + one-time UI
// dismissals. Persisted across restarts via zustand/persist over AsyncStorage
// (03's intent). The locale side-effect re-applies on rehydrate so a cold start
// honors the stored language before first render settles.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { SearchDirection } from '@/domain/types';
import i18n, { type AppLocale } from '@/i18n';

const MAX_RECENTS = 5;

/** Free users study fixed 20-card sessions; premium may pick 20–100 (17 §S2). */
export const QUIZ_LENGTH_FREE = 20;
export const QUIZ_LENGTH_DEFAULT = 20;

interface PrefsState {
  searchDirection: SearchDirection;
  recents: string[];
  /** Active UI locale (app chrome language) — initialized from the device, overridable. */
  locale: AppLocale;
  /** Cards per study session (premium-selectable; free tier pinned to QUIZ_LENGTH_FREE). */
  quizLength: number;
  /** Home "How Lexicamp works" card dismissed (17 §H3). Content stays reachable in Settings. */
  eduCardDismissed: boolean;
  setSearchDirection: (d: SearchDirection) => void;
  addRecent: (word: string) => void;
  removeRecent: (word: string) => void;
  /** Switch the UI language at runtime; drives react-i18next re-renders. */
  setLocale: (locale: AppLocale) => void;
  setQuizLength: (n: number) => void;
  setEduCardDismissed: (v: boolean) => void;
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      // 03 defaults: native_to_target, []. Seeded with a few recents for demoing.
      searchDirection: 'native_to_target',
      recents: ['montaña', 'recordar', 'fluidez'],
      locale: i18n.language as AppLocale,
      quizLength: QUIZ_LENGTH_DEFAULT,
      eduCardDismissed: false,
      setSearchDirection: (searchDirection) => set({ searchDirection }),
      setLocale: (locale) => {
        i18n.changeLanguage(locale);
        set({ locale });
      },
      setQuizLength: (quizLength) => set({ quizLength }),
      setEduCardDismissed: (eduCardDismissed) => set({ eduCardDismissed }),
      addRecent: (word) =>
        set((s) => (s.recents.includes(word) ? s : { recents: [word, ...s.recents].slice(0, MAX_RECENTS) })),
      removeRecent: (word) => set((s) => ({ recents: s.recents.filter((w) => w !== word) })),
    }),
    {
      name: 'lexicamp-prefs',
      storage: createJSONStorage(() => AsyncStorage),
      // 18 §A8 (D3): the UI locale is NOT persisted — it follows the OS/per-app
      // language setting on every launch (i18n init reads the device locale).
      // Persisting it would pin a stale override after the user changes their
      // system language.
      partialize: (s) => ({
        searchDirection: s.searchDirection,
        recents: s.recents,
        quizLength: s.quizLength,
        eduCardDismissed: s.eduCardDismissed,
      }),
    },
  ),
);

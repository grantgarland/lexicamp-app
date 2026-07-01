// Transient per-device preferences (03 "Client-side state, not stored in DB"):
// last-used search direction + recent searches. A plain in-memory Zustand slice
// today. To persist across app restarts (03's intent), wrap `create` in the
// `persist` middleware backed by AsyncStorage — that's the only change needed; the
// store API below stays identical.
import { create } from 'zustand';

import type { SearchDirection } from '@/domain/types';
import i18n, { type AppLocale } from '@/i18n';

const MAX_RECENTS = 5;

interface PrefsState {
  searchDirection: SearchDirection;
  recents: string[];
  /** Active UI locale (app chrome language) — initialized from the device, overridable. */
  locale: AppLocale;
  setSearchDirection: (d: SearchDirection) => void;
  addRecent: (word: string) => void;
  removeRecent: (word: string) => void;
  /** Switch the UI language at runtime; drives react-i18next re-renders. */
  setLocale: (locale: AppLocale) => void;
}

export const usePrefsStore = create<PrefsState>((set) => ({
  // 03 defaults: native_to_target, []. Seeded with a few recents for demoing.
  searchDirection: 'native_to_target',
  recents: ['montaña', 'recordar', 'fluidez'],
  locale: i18n.language as AppLocale,
  setSearchDirection: (searchDirection) => set({ searchDirection }),
  setLocale: (locale) => {
    i18n.changeLanguage(locale);
    set({ locale });
  },
  addRecent: (word) =>
    set((s) => (s.recents.includes(word) ? s : { recents: [word, ...s.recents].slice(0, MAX_RECENTS) })),
  removeRecent: (word) => set((s) => ({ recents: s.recents.filter((w) => w !== word) })),
}));

// Onboarding buffer (03 "Onboarding data flow") — O-05 language pair + O-06
// notification choice are collected BEFORE the account exists, held here, and
// written transactionally by complete_onboarding after auth succeeds. In-memory
// on purpose: abandoning onboarding should leave nothing behind, and the buffer
// is consumed within the same app session.
import { create } from 'zustand';

interface OnboardingBuffer {
  /** Chosen on O-05 from the LOCALIZED set (the locales whose UI we ship). Defaults
   *  to 'en': dictionary pairs are X↔en (16 §1), so an English side keeps capture on
   *  the rich dictionary path — a non-en native falls back to plain MT (no senses). */
  nativeLang: string;
  targetLang: string | null;
  notificationsEnabled: boolean;
  setNativeLang: (code: string) => void;
  setTargetLang: (code: string) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingBuffer>((set) => ({
  nativeLang: 'en',
  targetLang: null,
  notificationsEnabled: false,
  setNativeLang: (nativeLang) => set({ nativeLang }),
  setTargetLang: (targetLang) => set({ targetLang }),
  setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
  reset: () => set({ nativeLang: 'en', targetLang: null, notificationsEnabled: false }),
}));

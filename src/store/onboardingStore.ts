// Onboarding buffer (03 "Onboarding data flow") — O-05 language pair + O-06
// notification choice are collected BEFORE the account exists, held here, and
// written transactionally by complete_onboarding after auth succeeds. In-memory
// on purpose: abandoning onboarding should leave nothing behind, and the buffer
// is consumed within the same app session.
import { create } from 'zustand';

interface OnboardingBuffer {
  /** Fixed to 'en' at launch (US-first, dictionary pairs are X↔en — 16 §1). */
  nativeLang: string;
  targetLang: string | null;
  notificationsEnabled: boolean;
  setTargetLang: (code: string) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingBuffer>((set) => ({
  nativeLang: 'en',
  targetLang: null,
  notificationsEnabled: false,
  setTargetLang: (targetLang) => set({ targetLang }),
  setNotificationsEnabled: (notificationsEnabled) => set({ notificationsEnabled }),
  reset: () => set({ targetLang: null, notificationsEnabled: false }),
}));

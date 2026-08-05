// Appearance preference — System / Light / Dark, and the scheme actually applied.
//
// Two separate things, deliberately:
//   `mode`     what the USER asked for. Persisted. 'system' means "follow the OS".
//   `resolved` what is ON SCREEN right now — the OS scheme when mode is 'system',
//              otherwise the chosen one. Never persisted: it is derived, and a
//              stored copy could contradict the device on the next launch.
//
// `resolved` is the app's single source of truth for "is it dark", and it is
// written by exactly one place — `applyScheme` in theme/appearance.ts, which owns
// the Unistyles switch. Anything that needs to react to a theme change subscribes
// HERE rather than to Unistyles, because a store subscription is a plain React
// re-render we control, while Unistyles' own updates go straight to native
// ShadowNodes and skip React entirely (see Screen.tsx).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type AppearanceMode = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

interface AppearanceState {
  mode: AppearanceMode;
  resolved: Scheme;
  setMode: (mode: AppearanceMode) => void;
  /** Called by theme/appearance.ts once a scheme has actually been applied. */
  setResolved: (resolved: Scheme) => void;
}

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      mode: 'system',
      // Overwritten on the first `applyScheme` (and by the OS scheme at startup);
      // 'light' is only the pre-hydration placeholder.
      resolved: 'light',
      setMode: (mode) => set({ mode }),
      setResolved: (resolved) => set({ resolved }),
    }),
    {
      name: 'lexicamp-appearance',
      storage: createJSONStorage(() => AsyncStorage),
      // ONLY the user's choice survives a launch. `resolved` is recomputed from
      // the device on every start.
      partialize: (s) => ({ mode: s.mode }),
    },
  ),
);

export const APPEARANCE_MODES: AppearanceMode[] = ['system', 'light', 'dark'];

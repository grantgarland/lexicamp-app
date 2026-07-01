// UI store — ephemeral, cross-screen view state that isn't server/domain data. Today:
// the search overlay open flag, so the persistent tab layout can render the search sheet
// ABOVE the tab scenes while the bottom nav (a later sibling) still paints on top.
import { create } from 'zustand';

export interface ToastState {
  id: number;
  message: string;
}

interface UiState {
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  toggleSearch: () => void;
  /** Transient confirmation toast (e.g. "Added to Travel words"). */
  toast: ToastState | null;
  showToast: (message: string) => void;
  hideToast: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  searchOpen: false,
  setSearchOpen: (v) => set({ searchOpen: v }),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
  toast: null,
  showToast: (message) => set({ toast: { id: Date.now(), message } }),
  hideToast: () => set({ toast: null }),
}));

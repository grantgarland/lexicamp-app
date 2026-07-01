// UI store — ephemeral, cross-screen view state that isn't server/domain data. Today:
// the search overlay open flag, so the persistent tab layout can render the search sheet
// ABOVE the tab scenes while the bottom nav (a later sibling) still paints on top.
import { create } from 'zustand';

interface UiState {
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  toggleSearch: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  searchOpen: false,
  setSearchOpen: (v) => set({ searchOpen: v }),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
}));

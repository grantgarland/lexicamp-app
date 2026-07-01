// UI store — ephemeral, cross-screen view state that isn't server/domain data:
// the search overlay flag + the app-wide toast.
import { create } from 'zustand';

export type ToastVariant = 'info' | 'success' | 'warning' | 'destructive';

export interface ToastConfig {
  variant?: ToastVariant;
  /** Bold header line (optional). */
  title?: string;
  /** Body line. */
  message: string;
  /** Optional action (e.g. Undo). */
  action?: { label: string; onPress: () => void };
  /** Stay until dismissed (auto-set true for destructive). */
  persistent?: boolean;
}

export interface ToastState extends ToastConfig {
  id: number;
}

interface UiState {
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  toggleSearch: () => void;
  toast: ToastState | null;
  /** Show a toast. Pass a string for a plain info toast, or a config object. */
  showToast: (config: string | ToastConfig) => void;
  hideToast: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  searchOpen: false,
  setSearchOpen: (v) => set({ searchOpen: v }),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
  toast: null,
  showToast: (config) => {
    const c: ToastConfig = typeof config === 'string' ? { message: config } : config;
    const persistent = c.persistent ?? c.variant === 'destructive';
    set({ toast: { id: Date.now(), ...c, persistent } });
  },
  hideToast: () => set({ toast: null }),
}));

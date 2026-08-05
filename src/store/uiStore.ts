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
  /** Settings → Replay walkthrough handshake (18 §F2): Settings sets it, the
   *  WalkthroughController (tabs layout) consumes it after navigating Home. */
  walkthroughRequested: boolean;
  /** A quiz session holds UNSAVED ratings right now. Read by the root layout,
   *  which defers its light↔dark rebuild while this is true: that rebuild
   *  unmounts the navigator, and doing so mid-session ejects the user to Home
   *  and silently discards the batch (ratings only persist on completion).
   *  iOS "Automatic" appearance flips at sunset, so this is an evening-study
   *  bug, not an edge case (verified on the simulator, 2026-08-04). */
  quizInProgress: boolean;
  setQuizInProgress: (v: boolean) => void;
  setSearchOpen: (v: boolean) => void;
  setWalkthroughRequested: (v: boolean) => void;
  toggleSearch: () => void;
  toast: ToastState | null;
  /** Show a toast. Pass a string for a plain info toast, or a config object. */
  showToast: (config: string | ToastConfig) => void;
  hideToast: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  searchOpen: false,
  walkthroughRequested: false,
  quizInProgress: false,
  setQuizInProgress: (v) => set({ quizInProgress: v }),
  setSearchOpen: (v) => set({ searchOpen: v }),
  setWalkthroughRequested: (v) => set({ walkthroughRequested: v }),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
  toast: null,
  showToast: (config) => {
    const c: ToastConfig = typeof config === 'string' ? { message: config } : config;
    // 18-session: destructive toasts auto-dismiss like the rest — deletes no
    // longer offer Undo (the confirm dialog is the safety), so there's nothing
    // to wait around for. Pass `persistent: true` explicitly if ever needed.
    const persistent = c.persistent ?? false;
    set({ toast: { id: Date.now(), ...c, persistent } });
  },
  hideToast: () => set({ toast: null }),
}));

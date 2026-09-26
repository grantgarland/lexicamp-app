// Search cool-down (`26` B15) — the deadline after which lookups may run again,
// set by the lookup itself the moment a 429 arrives (see `useLookup`), so no
// component has to copy query state into React state inside an effect.
//
// A module-level store also means the cool-down survives closing and reopening
// the search overlay: reopening mid-cool-down shows the same countdown instead of
// firing a lookup that is bound to fail.
import { create } from 'zustand';

import type { LookupBusyReason } from '@/data/lookupBusy';

interface LookupCooldownState {
  cooldown: { until: number; reason: LookupBusyReason } | null;
  /** Start (or extend) a cool-down. Never SHORTENS one already running: a later
   *  429 with a nearer deadline would otherwise let lookups resume early. */
  start: (reason: LookupBusyReason, until: number) => void;
}

export const useLookupCooldown = create<LookupCooldownState>((set, get) => ({
  cooldown: null,
  start: (reason, until) => {
    const current = get().cooldown;
    if (current != null && current.until >= until) return;
    set({ cooldown: { until, reason } });
  },
}));

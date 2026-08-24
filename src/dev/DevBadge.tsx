// DevBadge — a small floating "DEV" pill (overlaid above the whole app) that opens
// a panel to flip core app states (plan, user tier) for testing screen variants.
// NOT part of the app UI: dark, system-font styled, and gated to __DEV__ by the caller.
//
// MODE-AWARE (Casey-approved design 2026-07-06):
// - Mock mode: the original behavior — devStore knobs drive synthetic fixtures.
// - Live mode (USE_SUPABASE): scenario chips SIGN INTO real seeded accounts
//   (dev-<scenario>@lexicamp.app — each with a different target language:
//   ru/zh-Hans/ar/ko/hi/ru), so every state is real data through the real
//   pipeline. Plan chips call set_dev_plan; Reset calls reset_dev_scenario
//   (both is_dev-guarded RPCs). Password from EXPO_PUBLIC_DEV_SCENARIO_PASSWORD
//   in .env.local — keep it OUT of EAS env so it never reaches store builds.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { signInWithEmail } from '@/auth/session';
import { USE_SUPABASE } from '@/data';
import { supabase } from '@/data/supabase/client';
import { queryClient } from '@/query/queryClient';
import { usePrefsStore } from '@/store/prefsStore';
import { type DevPlan, type DevUserState, useDevStore } from '@/store/devStore';

// Scenario chips. These live HERE, not in devStore, because devStore is
// reachable from the production module graph (mock.ts / query hooks import it)
// while this file is swapped for a stub in any non-dev bundle — so exporting
// them from the store shipped the scenario vocabulary to the App Store even
// though nothing there could render it. See metro/excludedModules.js.
//
// Every scenario has BOTH a mock fixture and a live `dev-<scenario>@lexicamp.app`
// account, so the chips behave identically in either mode. `veteran` was
// mock-only until 2026-08-05 — a live one looked to need 4,300 gate-approved
// translations_cache rows in production, which is not a trade worth making for a
// fixture. It is live now because the cards carry their own mocked pair in
// custom_front/custom_back (see the dev_veteran_4k_library migration), so the
// shared dictionary stays untouched.
const USER_STATE_LABELS: { value: DevUserState; label: string }[] = [
  { value: 'empty', label: 'New' },
  { value: 'bc', label: 'Base Camp' },
  { value: 'abc', label: 'Adv. Base' },
  { value: 'hc', label: 'High Camp' },
  { value: 'sr', label: 'Summit Ridge' },
  { value: 'summit', label: 'Summit' },
  { value: 'veteran', label: 'Veteran 4k' },
];

const PLANS: { value: DevPlan; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
];

const DEV_PASSWORD = process.env.EXPO_PUBLIC_DEV_SCENARIO_PASSWORD ?? '';

export function DevBadge() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const plan = useDevStore((s) => s.plan);
  const userState = useDevStore((s) => s.userState);
  const setPlan = useDevStore((s) => s.setPlan);
  const setUserState = useDevStore((s) => s.setUserState);
  const badgeHidden = useDevStore((s) => s.badgeHidden);
  const setBadgeHidden = useDevStore((s) => s.setBadgeHidden);
  const top = insets.top + 6;

  // Live mode: swap the whole session to a seeded scenario account, then drop
  // every cached read so the app rehydrates as that user.
  const switchScenario = async (scenario: string) => {
    setBusy(scenario);
    setError(null);
    try {
      await signInWithEmail(`dev-${scenario}@lexicamp.app`, DEV_PASSWORD);
      setUserState(scenario as (typeof USER_STATE_LABELS)[number]['value']); // keeps query keys/chip state in sync
      queryClient.clear();
      router.replace('/');
    } catch (e) {
      // A missing/renamed seed account used to reject into nothing: the chip
      // stopped spinning and the app sat on the previous user with no clue why.
      // Say which account failed — that IS the fix instruction.
      setError(`dev-${scenario}@lexicamp.app — ${e instanceof Error ? e.message : 'sign-in failed'}`);
    } finally {
      setBusy(null);
    }
  };
  const switchPlan = async (p: DevPlan) => {
    setBusy(p);
    try {
      const { error } = await supabase.rpc('set_dev_plan', { p_status: p === 'paid' ? 'active' : 'free' });
      if (!error) {
        setPlan(p);
        queryClient.clear();
      }
    } finally {
      setBusy(null);
    }
  };
  // Rebuild the signed-in dev account's library from the dev_seed_words fixture
  // (4,000 mocked ru pairs). Casey's ask: after exercising the delete-account
  // flow, or whenever a scenario's data has drifted, get back to a known library
  // without leaving the app. The RPC seeds auth.uid() and is is_dev-gated
  // server-side, so this only ever touches the account you are signed into.
  const reseedLibrary = async () => {
    setBusy('reseed');
    try {
      const { error } = await supabase.rpc('seed_dev_veteran');
      if (!error) {
        queryClient.clear();
        router.replace('/');
      }
    } finally {
      setBusy(null);
    }
  };
  const resetScenario = async () => {
    setBusy('reset');
    try {
      await supabase.rpc('reset_dev_scenario');
      queryClient.clear();
    } finally {
      setBusy(null);
    }
  };

  // ⚠️ RESET ONBOARDING — deletes this account's profile row, which CASCADES to
  // every card, deck, review log, event, push token and the subscription mirror.
  // The login survives (`profiles.id → auth.users` cascades one way only), so you
  // land on the pair screen signed in as the same user.
  //
  // ⚠️ The RPC is deliberately NOT `is_dev`-gated (migration 20260820200000). It
  // was, for one day, and the gate blocked exactly the throwaway signups this
  // exists to reset — `is_dev` cannot be self-served since the P0-1 lockdown, so
  // only the seeded `dev-*` scenario accounts passed, and those are the ones that
  // must NOT be wiped. It is self-scoped and strictly weaker than the already
  // ungated `delete_own_account()`, so the control that matters is this file
  // being stripped from shipped bundles — which `verify:bundle` enforces.
  //
  // BOTH HALVES MATTER, and the local half is the one that silently ruins a test:
  // a server-only reset leaves `notifPromptSeen` and `walkthroughDone` persisted
  // in AsyncStorage, so the post-first-save reminders prompt and the walkthrough
  // simply never fire and the feature looks broken. Clearing them here is what
  // makes this a real first-run rather than a half one.
  const resetOnboarding = async () => {
    setBusy('onboarding');
    try {
      const { error: rpcError } = await supabase.rpc('reset_own_onboarding');
      if (rpcError != null) {
        setError(rpcError.message);
        return;
      }
      // The one-time UI latches, or the next run is not a first run.
      usePrefsStore.getState().setNotifPromptSeen(false);
      usePrefsStore.getState().setWalkthroughDone(false);
      // Drop every cached query — a stale `profile` entry would let the first-run
      // gate read a settled non-null answer and skip the flow entirely.
      queryClient.clear();
      setOpen(false);
      router.replace('/');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {open && (
        <>
          <Pressable style={styles.scrim} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Dismiss dev panel" />
          <View style={[styles.panel, { top: top + 34 }]}>
            <Text style={styles.heading} allowFontScaling={false}>
              Dev · app state {USE_SUPABASE ? '· LIVE' : '· mock'}
            </Text>

            <Text style={styles.label} allowFontScaling={false}>
              Plan
            </Text>
            <View style={styles.row}>
              {PLANS.map((o) => (
                <Chip
                  key={o.value}
                  label={busy === o.value ? '…' : o.label}
                  active={plan === o.value}
                  onPress={() => (USE_SUPABASE ? void switchPlan(o.value) : setPlan(o.value))}
                />
              ))}
            </View>

            <Text style={styles.label} allowFontScaling={false}>
              {USE_SUPABASE ? 'Scenario account' : 'User'}
            </Text>
            <View style={styles.rowWrap}>
              {/* No filtering: every scenario now has BOTH a mock fixture and a
                  seeded dev-<scenario>@lexicamp.app account, so each chip works
                  in either mode. `veteran` was the lone exception until
                  2026-08-05 — see USER_STATE_LABELS for why it stopped being one. */}
              {USER_STATE_LABELS.map((o) => (
                <Chip
                  key={o.value}
                  label={busy === o.value ? '…' : o.label}
                  active={userState === o.value}
                  onPress={() => (USE_SUPABASE ? void switchScenario(o.value) : setUserState(o.value))}
                />
              ))}
            </View>
            {error != null && (
              <Text style={styles.error} allowFontScaling={false}>
                {error}
              </Text>
            )}
            {USE_SUPABASE && (
              <View style={styles.rowWrap}>
                <Chip label={busy === 'reset' ? '…' : '↺ Reset scenario'} active={false} onPress={() => void resetScenario()} />
                <Chip label={busy === 'reseed' ? '…' : '⛰ Reseed 4k library'} active={false} onPress={() => void reseedLibrary()} />
                <Chip
                  label={busy === 'onboarding' ? '…' : '🧭 Reset onboarding'}
                  active={false}
                  onPress={() => void resetOnboarding()}
                />
              </View>
            )}

            <Text style={styles.label} allowFontScaling={false}>
              Flows
            </Text>
            <View style={styles.rowWrap}>
              <Chip label="Onboarding" active={false} onPress={() => { setOpen(false); router.push('/onboarding'); }} />
              <Chip label="Auth" active={false} onPress={() => { setOpen(false); router.push('/auth'); }} />
              <Chip label="Paywall" active={false} onPress={() => { setOpen(false); router.push('/paywall'); }} />
            </View>

            <Text style={styles.label} allowFontScaling={false}>
              Screenshots
            </Text>
            <View style={styles.rowWrap}>
              {/* The pill overlaps the Home header date, so it lands in every
                  instructional screenshot taken for onboarding art. Hiding it
                  PERSISTS across relaunches (devStore), so it survives a rebuild
                  mid-session. The invisible hit target below brings it back. */}
              <Chip
                label={badgeHidden ? '◉ Badge hidden' : '◎ Hide badge'}
                active={badgeHidden}
                onPress={() => {
                  setBadgeHidden(!badgeHidden);
                  setOpen(false);
                }}
              />
            </View>
          </View>
        </>
      )}

      {/* Badge — rendered last so it stays on top + tappable to toggle.
          When hidden it paints nothing but keeps its frame AND its alpha, so
          tapping the same corner still opens the panel — "Hide badge" can never
          strand you in a dev build with no way back to the scenario switcher.
          See `badgeHidden` in the stylesheet for why alpha is load-bearing.
          The target is the size of the pill it replaces, so what it can
          intercept is unchanged (top-left overlaps header text only). */}
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={[styles.badge, { top }, badgeHidden && styles.badgeHidden]}
        accessibilityRole="button"
        accessibilityLabel="Dev state toggle"
      >
        <Text style={[styles.badgeText, badgeHidden && styles.badgeTextHidden]} allowFontScaling={false}>
          ⚙ DEV
        </Text>
      </Pressable>
    </>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]} allowFontScaling={false}>
        {label}
      </Text>
    </Pressable>
  );
}

const DARK = '#1b2329';
const styles = StyleSheet.create({
  // Hidden = DRAWS NOTHING, but keeps alpha 1. Do NOT reach for `opacity: 0`
  // here (it was the first attempt and it did not work): UIKit's
  // `-[UIView hitTest:withEvent:]` skips any view with `alpha < 0.01`, so an
  // opacity-0 pill is still in the view hierarchy — an element inspector finds
  // it — and is completely untappable. That strands a dev build with no route
  // back to the scenario switcher. Transparent colors keep the view hit-testable
  // while painting nothing. `display: 'none'` is wrong for the same reason,
  // harder: it removes the layout box entirely.
  badgeHidden: { backgroundColor: 'transparent', borderColor: 'transparent' },
  badgeTextHidden: { color: 'transparent' },
  badge: {
    position: 'absolute',
    // Left-anchored: the top-right corner holds real controls (quiz close ×, toast dismiss),
    // and this zIndex:9999 pill was intercepting their taps. Top-left only overlaps
    // non-interactive header text.
    left: 8,
    zIndex: 9999,
    backgroundColor: 'rgba(20, 28, 34, 0.92)',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 },
  panel: {
    position: 'absolute',
    left: 8,
    width: 250,
    zIndex: 9999,
    backgroundColor: DARK,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    gap: 6,
    // shadow
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  heading: { color: '#fff', fontSize: 12, fontWeight: '700', marginBottom: 2 },
  label: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 4 },
  error: { color: '#ffb4b4', fontSize: 10, marginTop: 6, lineHeight: 14 },
  row: { flexDirection: 'row', gap: 6 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  chipActive: { backgroundColor: '#e87722' },
  chipText: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
});

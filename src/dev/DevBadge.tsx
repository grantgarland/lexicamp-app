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
import { type DevPlan, USER_STATE_LABELS, useDevStore } from '@/store/devStore';

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
                  instructional screenshot `.maestro/capture-onboarding-shots.yaml`
                  takes. Hiding it PERSISTS across relaunches (devStore) — which is
                  the only reason it is useful, since the capture flow relaunches
                  the app. The invisible hit target below brings it back. */}
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

// DevBadge — a small floating "DEV" pill (overlaid above the whole app) that opens
// a panel to flip core app states (plan, user tier) for testing screen variants.
// NOT part of the app UI: dark, system-font styled, and gated to __DEV__ by the caller.
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type DevPlan, USER_STATE_LABELS, useDevStore } from '@/store/devStore';

const PLANS: { value: DevPlan; label: string }[] = [
  { value: 'free', label: 'Free' },
  { value: 'paid', label: 'Paid' },
];

export function DevBadge() {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const plan = useDevStore((s) => s.plan);
  const userState = useDevStore((s) => s.userState);
  const setPlan = useDevStore((s) => s.setPlan);
  const setUserState = useDevStore((s) => s.setUserState);
  const top = insets.top + 6;

  return (
    <>
      {open && (
        <>
          <Pressable style={styles.scrim} onPress={() => setOpen(false)} />
          <View style={[styles.panel, { top: top + 34 }]}>
            <Text style={styles.heading} allowFontScaling={false}>
              Dev · app state
            </Text>

            <Text style={styles.label} allowFontScaling={false}>
              Plan
            </Text>
            <View style={styles.row}>
              {PLANS.map((o) => (
                <Chip key={o.value} label={o.label} active={plan === o.value} onPress={() => setPlan(o.value)} />
              ))}
            </View>

            <Text style={styles.label} allowFontScaling={false}>
              User
            </Text>
            <View style={styles.rowWrap}>
              {USER_STATE_LABELS.map((o) => (
                <Chip
                  key={o.value}
                  label={o.label}
                  active={userState === o.value}
                  onPress={() => setUserState(o.value)}
                />
              ))}
            </View>
          </View>
        </>
      )}

      {/* Badge — rendered last so it stays on top + tappable to toggle. */}
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={[styles.badge, { top }]}
        accessibilityRole="button"
        accessibilityLabel="Dev state toggle"
      >
        <Text style={styles.badgeText} allowFontScaling={false}>
          ⚙ DEV
        </Text>
      </Pressable>
    </>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]} allowFontScaling={false}>
        {label}
      </Text>
    </Pressable>
  );
}

const DARK = '#1b2329';
const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    right: 8,
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
    right: 8,
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

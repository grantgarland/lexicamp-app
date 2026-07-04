// PaywallScreen (PW-01 / PW-03) — the subscription upsell, assembled against
// paywall/Paywall.html. Presented as a modal route (`/paywall`) from every Upgrade/
// Unlock CTA. Annual/monthly plan selector, feature list, trial CTA, restore, and a
// post-purchase success state. Entitlement writes land with RevenueCat later; the CTA
// currently just shows the success confirmation.
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { Button, IconChart, IconCheck, IconFolderPlus, IconGlobe, IconInfinity, IconStar, IconX, RawText, Screen } from '@/ui';

type Plan = 'annual' | 'monthly';

export function PaywallScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const router = useRouter();
  const [plan, setPlan] = useState<Plan>('annual');
  const [purchased, setPurchased] = useState(false);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const features = [
    { Icon: IconInfinity, label: t('paywall.featureUnlimited') },
    { Icon: IconFolderPlus, label: t('paywall.featureDecks') },
    { Icon: IconGlobe, label: t('paywall.featureLanguages') },
    { Icon: IconChart, label: t('paywall.featureOffline') },
  ];

  if (purchased) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.successWrap}>
          <View style={styles.successBadge}>
            <IconStar size={40} color={theme.color.textOnAccent} />
          </View>
          <RawText style={styles.successTitle}>{t('paywall.successTitle')}</RawText>
          <RawText style={styles.successBody}>{t('paywall.successBody')}</RawText>
          <View style={styles.successCta}>
            <Button title={t('paywall.continue')} variant="primary" onPress={close} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={close} hitSlop={10} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={t('common.dismiss')}>
          <IconX size={18} color={theme.color.textMuted} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.crest}>
          <IconStar size={30} color={theme.color.textOnAccent} />
        </View>
        <RawText style={styles.heading}>{t('paywall.heading')}</RawText>
        <RawText style={styles.sub}>{t('paywall.sub')}</RawText>

        <View style={styles.featureList}>
          {features.map(({ Icon, label }) => (
            <View key={label} style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Icon size={16} color={theme.color.brand} />
              </View>
              <RawText style={styles.featureText}>{label}</RawText>
              <IconCheck size={16} color={theme.color.evergreen} />
            </View>
          ))}
        </View>

        {/* Plan selector */}
        <PlanCard
          selected={plan === 'annual'}
          onPress={() => setPlan('annual')}
          title={t('paywall.annual')}
          price={t('paywall.annualPrice')}
          sub={t('paywall.annualSub')}
          badge={t('paywall.bestValue')}
          note={t('paywall.trialNote')}
        />
        <PlanCard
          selected={plan === 'monthly'}
          onPress={() => setPlan('monthly')}
          title={t('paywall.monthly')}
          price={t('paywall.monthlyPrice')}
          sub={t('paywall.monthlySub')}
        />
      </ScrollView>

      <View style={styles.footer}>
        <Button title={plan === 'annual' ? t('paywall.ctaTrial') : t('paywall.ctaSubscribe')} variant="primary" onPress={() => setPurchased(true)} />
        <Pressable onPress={() => {}} hitSlop={8} style={({ pressed }) => [styles.restore, pressed && { opacity: 0.6 }]} accessibilityRole="button">
          <RawText style={styles.restoreText}>{t('paywall.restore')}</RawText>
        </Pressable>
        <RawText style={styles.legal}>{t('paywall.legal')}</RawText>
      </View>
    </Screen>
  );
}

function PlanCard({ selected, onPress, title, price, sub, badge, note }: { selected: boolean; onPress: () => void; title: string; price: string; sub: string; badge?: string; note?: string }) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={[styles.plan, { borderColor: selected ? theme.color.brand : theme.color.border, backgroundColor: selected ? theme.color.brandSoft : theme.color.surfaceCard }]}
    >
      <View style={[styles.radio, { borderColor: selected ? theme.color.brand : theme.palette.slate[300], borderWidth: selected ? 6 : 2 }]} />
      <View style={styles.planBody}>
        <View style={styles.planTitleRow}>
          <RawText style={styles.planTitle}>{title}</RawText>
          {badge != null && (
            <View style={styles.planBadge}>
              <RawText style={styles.planBadgeText}>{badge}</RawText>
            </View>
          )}
        </View>
        <RawText style={styles.planSub}>{sub}</RawText>
        {note != null && <RawText style={styles.planNote}>{note}</RawText>}
      </View>
      <RawText style={styles.planPrice}>{price}</RawText>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts, radius } = theme;
  return {
    header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 6 },
    closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surfaceSunken },
    scroll: { paddingHorizontal: 24, paddingBottom: 16, alignItems: 'stretch' },

    crest: { alignSelf: 'center', width: 64, height: 64, borderRadius: 20, backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center', marginTop: 4, marginBottom: 16, boxShadow: theme.shadow.accent },
    heading: { fontFamily: fonts.sans.extra, fontSize: 24, lineHeight: 30, letterSpacing: -0.4, color: color.textStrong, textAlign: 'center' },
    sub: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 21, color: color.textMuted, textAlign: 'center', marginTop: 8, marginBottom: 22 },

    featureList: { gap: 12, marginBottom: 22 },
    featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    featureIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: color.brandSoft, alignItems: 'center', justifyContent: 'center' },
    featureText: { flex: 1, fontFamily: fonts.sans.medium, fontSize: 15, color: color.textStrong },

    plan: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 16, marginBottom: 10 },
    radio: { width: 20, height: 20, borderRadius: 10 },
    planBody: { flex: 1 },
    planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    planTitle: { fontFamily: fonts.sans.bold, fontSize: 16, color: color.textStrong },
    planBadge: { backgroundColor: color.accent, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
    planBadgeText: { fontFamily: fonts.sans.bold, fontSize: 10, letterSpacing: 0.3, color: color.textOnAccent },
    planSub: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, marginTop: 2 },
    planNote: { fontFamily: fonts.sans.semibold, fontSize: 11, color: color.brand, marginTop: 4 },
    planPrice: { fontFamily: fonts.sans.bold, fontSize: 16, color: color.textStrong },

    footer: { paddingHorizontal: 24, paddingTop: 8, gap: 10 },
    restore: { alignSelf: 'center', paddingVertical: 4 },
    restoreText: { fontFamily: fonts.sans.semibold, fontSize: 13, color: color.brand },
    legal: { fontFamily: fonts.sans.regular, fontSize: 11, lineHeight: 16, color: color.textFaint, textAlign: 'center' },

    successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    successBadge: { width: 84, height: 84, borderRadius: 28, backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 20, boxShadow: theme.shadow.accent },
    successTitle: { fontFamily: fonts.sans.extra, fontSize: 24, letterSpacing: -0.4, color: color.textStrong, textAlign: 'center', marginBottom: 10 },
    successBody: { fontFamily: fonts.sans.regular, fontSize: 15, lineHeight: 22, color: color.textMuted, textAlign: 'center' },
    successCta: { alignSelf: 'stretch', marginTop: 28 },
  };
});

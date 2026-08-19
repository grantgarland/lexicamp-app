// PaywallScreen (PW-01 / PW-03) — the subscription upsell, assembled against
// paywall/Paywall.html. Presented as a modal route (`/paywall`) from every Upgrade/
// Unlock CTA. Annual/monthly plan selector, feature list, trial CTA, restore, and a
// post-purchase success state.
//
// 3.1: the CTA and Restore are now real StoreKit calls through
// `src/purchases/`. Three things here are not obvious:
//
//   1. PRICES COME FROM THE OFFERING, never from the locale files. `priceString`
//      is storefront-localized by StoreKit; the `paywall.annualPrice` strings are
//      demo values used ONLY when the SDK is not configured (mock/smoke builds).
//      In a live build with no offering we show no price and disable the CTA —
//      selling at a price we cannot confirm is worse than not selling.
//   2. TRIAL COPY IS CONDITIONAL. Only the annual product carries the 7-day trial
//      and returning subscribers are ineligible, so the CTA reads "Start free
//      trial" only when RevenueCat says this user actually qualifies.
//   3. A CANCELLED PURCHASE IS NOT AN ERROR. It leaves the screen exactly as it
//      was, with no message.
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FREE_DAILY_SAVES } from '@/domain/derive';
import { useTranslation } from '@/i18n';
import { useLogEvent } from '@/query/hooks';
import { BRAND_MARK_KNOCKOUT_XML } from '@/ui/brandMark';
import { purchasesReady, type PaywallPlan } from '@/purchases/purchases';
import { usePaywallOffering, usePurchaseController } from '@/purchases/usePurchases';
import { Button, IconChart, IconCheck, IconFolderPlus, IconGlobe, IconInfinity, IconX, RawText, Screen } from '@/ui';

type Plan = 'annual' | 'monthly';

export function PaywallScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const router = useRouter();
  const [plan, setPlan] = useState<Plan>('annual');
  const [purchased, setPurchased] = useState(false);
  // ⚠️ Captured AT PURCHASE TIME, and false for a restore. The success copy
  // claimed a 7-day trial unconditionally, so a returning subscriber who was
  // charged immediately was told they were not. That is a false statement about
  // money on a purchase confirmation, which is both a support ticket and a
  // review risk. Only the annual product carries the trial, and only for a user
  // StoreKit says is still intro-eligible.
  const [boughtTrial, setBoughtTrial] = useState(false);
  // DF-9 v2 (19 rev §5): `trigger=word_pace` = arrived by spending today's
  // daily saves (or the starter allotment) → pace-framed heading instead of
  // the generic upsell.
  const { trigger } = useLocalSearchParams<{ trigger?: string }>();
  const isPace = trigger === 'word_pace';
  // 3.4: conversion-funnel top — one emit per paywall presentation. The trigger
  // prop segments DF-9's pace paywall against the old flat-cap funnel.
  const logEvent = useLogEvent();
  useEffect(() => {
    logEvent('paywall_viewed', trigger != null ? { trigger } : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { offering, isLoading: pricesLoading, isError: pricesFailed } = usePaywallOffering();
  const { buy, restore, isBusy, mirrorLagged } = usePurchaseController(logEvent);
  const [error, setError] = useState<string | null>(null);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // `live` = the SDK is configured, so StoreKit is the price authority. When it
  // is not (mock/smoke builds) the demo strings keep the paywall renderable for
  // the Maestro suite without inventing a price for a real shopper.
  const live = purchasesReady();
  // ⚠️ Diagnostic only, no UI effect. A FAILED eligibility check and a genuine
  // "offer already used" both render as no-trial-copy, so without this emit we
  // could quietly stop advertising the trial to every eligible user and never
  // find out. Fires once per paywall view, and only in a live build.
  const eligibilityUnknown = live && offering != null && !offering.trialEligibilityKnown;
  useEffect(() => {
    if (eligibilityUnknown) logEvent('trial_eligibility_unknown');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibilityUnknown]);
  const selected: PaywallPlan | null = live ? (offering?.[plan] ?? null) : null;
  const canBuy = !isBusy && (!live || selected != null);
  const trialOffered = live ? (offering?.annual?.trialEligible ?? false) : true;

  const priceFor = (id: Plan, demo: string): string => {
    if (!live) return demo;
    return offering?.[id]?.priceString ?? '—';
  };

  const handleBuy = async () => {
    setError(null);
    if (!live) {
      // Mock/smoke build: keep the old demo behaviour so the flow stays walkable.
      setPurchased(true);
      return;
    }
    if (selected == null) return;
    try {
      const trial = selected.trialEligible;
      const outcome = await buy(selected);
      if (outcome === 'purchased') {
        setBoughtTrial(trial);
        setPurchased(true);
      }
      // 'cancelled' falls through deliberately: no state change, no message.
    } catch {
      setError(t('paywall.purchaseFailed'));
    }
  };

  const handleRestore = async () => {
    setError(null);
    if (!live) return;
    try {
      const { restored } = await restore();
      // The success screen distinguishes mirrored from pending itself, via
      // `mirrorLagged` — by then it has re-rendered, so that state is current.
      if (restored) setPurchased(true);
      else setError(t('paywall.restoreNone'));
    } catch {
      setError(t('paywall.restoreFailed'));
    }
  };

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
            <SvgXml xml={BRAND_MARK_KNOCKOUT_XML} width={44} height={44} />
          </View>
          <RawText style={styles.successTitle}>{t('paywall.successTitle')}</RawText>
          <RawText style={styles.successBody}>
            {mirrorLagged
              ? t('paywall.successPending')
              : boughtTrial
                ? t('paywall.successBody')
                : t('paywall.successBodyPaid')}
          </RawText>
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
        {/* The Lexicamp mark, knocked out on the accent crest. A generic star
            said "premium" in the abstract; the brand says whose premium it is,
            and it is the same mark the session-milestone screen now wears. */}
        <View style={styles.crest}>
          <SvgXml xml={BRAND_MARK_KNOCKOUT_XML} width={34} height={34} />
        </View>
        <RawText style={styles.heading}>{t(isPace ? 'paywall.paceHeading' : 'paywall.heading')}</RawText>
        <RawText style={styles.sub}>
          {isPace ? t('paywall.paceSub', { daily: FREE_DAILY_SAVES }) : t('paywall.sub')}
        </RawText>

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
          price={priceFor('annual', t('paywall.annualPrice'))}
          sub={live ? t('paywall.billedAnnually') : t('paywall.annualSub')}
          badge={t('paywall.bestValue')}
          note={trialOffered ? t('paywall.trialNote') : undefined}
        />
        <PlanCard
          selected={plan === 'monthly'}
          onPress={() => setPlan('monthly')}
          title={t('paywall.monthly')}
          price={priceFor('monthly', t('paywall.monthlyPrice'))}
          sub={live ? t('paywall.billedMonthly') : t('paywall.monthlySub')}
        />
      </ScrollView>

      <View style={styles.footer}>
        {live && pricesFailed && <RawText style={styles.error}>{t('paywall.priceUnavailable')}</RawText>}
        {error != null && <RawText style={styles.error}>{error}</RawText>}
        <Button
          title={
            isBusy || pricesLoading
              ? t('paywall.working')
              : plan === 'annual' && trialOffered
                ? t('paywall.ctaTrial')
                : t('paywall.ctaSubscribe')
          }
          variant="primary"
          disabled={!canBuy}
          onPress={() => void handleBuy()}
        />
        <Pressable
          onPress={() => void handleRestore()}
          disabled={isBusy}
          hitSlop={8}
          style={({ pressed }) => [styles.restore, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
        >
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
      <View style={[styles.radio, { borderColor: selected ? theme.color.brand : theme.color.borderStrong, borderWidth: selected ? 6 : 2 }]} />
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
    planBadgeText: { fontFamily: fonts.sans.bold, fontSize: 10, letterSpacing: 0.3, color: color.textOnAccentCta },
    planSub: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, marginTop: 2 },
    planNote: { fontFamily: fonts.sans.semibold, fontSize: 11, color: color.brand, marginTop: 4 },
    planPrice: { fontFamily: fonts.sans.bold, fontSize: 16, color: color.textStrong },

    footer: { paddingHorizontal: 24, paddingTop: 8, gap: 10 },
    error: { fontFamily: fonts.sans.medium, fontSize: 13, lineHeight: 18, color: color.danger, textAlign: 'center' },
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

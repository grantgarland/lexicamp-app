// SettingsScreen (SE-01) — the settings hub, assembled against settings/Settings.html
// as refined by 17-ux-refinement: reminders row reads real pref state (no premium
// badge on the row — the gate is inside, on the custom-time field only, §S1/X5);
// quiz length reads the one persisted pref (§S2); Clear-all-data was cut (§S3);
// App-language and Restore-purchases rows added (§S4/S5); "How Lexicamp works"
// lives in Help & Support (§H3). Rows compose the shared ListItem with a colored
// icon tile; destructive Sign-out confirms via sheet.
import { useRouter } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { FREE_DAILY_SAVES, FREE_WORD_BASE, freeTierUsage } from '@/domain/derive';
import { useTranslation } from '@/i18n';
import { useEntitlement, useHomeData, useLearningLanguages, useLogEvent, useNotificationPrefs, useProfile } from '@/query/hooks';
import { openManageSubscriptions, purchasesReady } from '@/purchases/purchases';
import { usePurchaseController } from '@/purchases/usePurchases';
import { shortDate } from '@/lib/relativeTime';
import { QUIZ_LENGTH_FREE, usePrefsStore } from '@/store/prefsStore';
import { useUiStore } from '@/store/uiStore';
import { findLanguage } from '@/constants';
import { LanguageSwitcherSheet } from '@/screens/shared/LanguageSwitcher';
import { AboutSheet, EditProfileSheet, formatReminderTime, HowItWorksSheet, NotificationSheet, QuizLengthSheet, SupportSheet } from './settings/sheets';
import {
  Button,
  ConfirmDialog,
  IconBell,
  IconBook,
  IconChevronRight,
  IconCheck,
  IconGlobe,
  IconInfo,
  IconMail,
  IconMountain,
  IconStar,
  IconUser,
  ListItem,
  PremiumBadge,
  RawText,
  Screen,
  TAB_BAR_CORE_HEIGHT,
  TAB_BAR_FAB_OVERHANG,
} from '@/ui';

/** Static part of the scroll's bottom gutter — see `styles.scroll`. The bottom
 *  safe-area inset is the remaining term and is added at the call site. */
const SCROLL_GUTTER = 24 + TAB_BAR_CORE_HEIGHT + TAB_BAR_FAB_OVERHANG;

const FREE_FEATURES = ['featureUnlimited', 'featureDecks', 'featureLanguages'] as const;
type SheetId = 'about' | 'signout' | 'editProfile' | 'notifications' | 'quizLength' | 'support' | 'howItWorks' | 'languages' | null;

export function SettingsScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const setWalkthroughRequested = useUiStore((s) => s.setWalkthroughRequested);
  const profile = useProfile();
  const { entitlement, isPaid } = useEntitlement();
  const { snapshot } = useHomeData();
  const { prefs: notifPrefs } = useNotificationPrefs();
  const quizLength = usePrefsStore((s) => s.quizLength);
  const wordsSaved = snapshot?.wordsSaved ?? 0;

  const [sheet, setSheet] = useState<SheetId>(null);
  const openPaywall = () => router.push('/paywall');

  // UX-17a: the Settings Restore row is a REAL restore, same controller as the
  // paywall's. Feedback goes through the app-wide Toast because this row sits in
  // a scrolling list with no space of its own for an error line.
  const showToast = useUiStore((s) => s.showToast);
  const logEvent = useLogEvent();
  const { restore, isBusy } = usePurchaseController(logEvent);
  const handleRestore = async () => {
    // Mock/smoke builds have no StoreKit at all. Saying so plainly beats a
    // press that does nothing, which is the exact thing 3.1.1 fails us for.
    if (!purchasesReady()) {
      showToast({ variant: 'info', message: t('paywall.restoreNone') });
      return;
    }
    // Captured BEFORE the call: "restored" and "you were already premium" are
    // different events, and telling someone their subscription came back when it
    // never left is a small lie that erodes the message's meaning when it matters.
    const wasPaid = isPaid;
    try {
      const { restored, mirrored } = await restore();
      if (!restored) {
        showToast({ variant: 'info', message: t('paywall.restoreNone') });
      } else if (mirrored) {
        showToast({
          variant: 'success',
          message: wasPaid ? t('settings.restoreAlreadyActive') : t('settings.restoreDone'),
        });
      } else {
        // StoreKit restored it; our mirror has not caught up. Telling the user
        // it failed would be false, and `entitlement_mirror_lag` has already
        // been emitted by the controller.
        showToast({ variant: 'warning', message: t('paywall.successPending') });
      }
    } catch {
      showToast({ variant: 'destructive', message: t('paywall.restoreFailed') });
    }
  };

  // Hands off to the store's own management sheet — see openManageSubscriptions.
  // ⚠️ Never route this to the paywall: the tap usually means "I want to cancel".
  const handleManage = async () => {
    try {
      await openManageSubscriptions();
    } catch {
      showToast({ variant: 'destructive', message: t('settings.manageUnavailable') });
    }
  };

  // 20 §8 R1 revised (Casey 2026-07-22k): the username moved into the User
  // Info sheet itself — this row is a static entry point (icon + "User Info"),
  // same as every other Settings row, not a profile card.
  const profileSub = t('settings.profileNative', { lang: t(`languages.${profile?.nativeLang ?? 'en'}`) });
  // DF-9 v2 (spec 19 rev): two-phase meter — the 50-word starter allotment,
  // then the 5-a-day counter (resets daily, never banks). addedToday comes from
  // homeSnapshot (device-local day; server enforces with the profile timezone).
  // Note: snapshot is active-language-scoped, but free users have exactly one
  // language (multi-language is premium), so per-language == total here.
  const usage = freeTierUsage(wordsSaved, snapshot?.addedToday ?? 0);
  const usagePct =
    usage.phase === 'starter'
      ? Math.min(100, Math.round((usage.saved / usage.limit) * 100))
      : Math.min(100, Math.round((usage.usedToday / usage.limit) * 100));
  // Honest row state (17 §S1): the subtitle reflects the user's actual reminder
  // prefs; free users are NOT shown a premium badge here — the toggle is free,
  // only the custom time is gated (inside the sheet).
  // D12: free users see the EFFECTIVE schedule (default time, every day) — their
  // stored premium-era settings are preserved but not honored while unentitled.
  const effectiveTime = isPaid ? (notifPrefs?.windows[0]?.time ?? '09:00') : '09:00';
  const remindersSubtitle =
    notifPrefs == null
      ? '…'
      : notifPrefs.enabled
        ? isPaid && notifPrefs.days.length < 7
          ? t('settings.remindersOnAtDays', { time: formatReminderTime(effectiveTime), count: notifPrefs.days.length })
          : t('settings.remindersOnAt', { time: formatReminderTime(effectiveTime) })
        : t('settings.remindersOff');
  // D6: enrolled languages summary — active first, endonyms.
  const { languages: learningLangs } = useLearningLanguages();
  const learningLangsSubtitle =
    learningLangs.length === 0
      ? '…'
      : learningLangs
          .map((l) => findLanguage(l)?.nativeName ?? l)
          .join(' · ');

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <RawText style={styles.title}>{t('settings.title')}</RawText>
      </View>
      {/* The bottom safe area is the device-dependent third term of the gutter
          (see `styles.scroll`) — it can only be read from the inset hook, so it
          is added here rather than baked into the stylesheet. */}
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: SCROLL_GUTTER + insets.bottom }]} showsVerticalScrollIndicator={false}>
        {/* Account */}
        <Section label={t('settings.account')}>
          <ListItem
            leading={<IconTile><IconUser size={16} color={theme.color.brand} /></IconTile>}
            testID="settings-profile"
            title={t('settings.editProfileTitle')}
            subtitle={profileSub}
            trailing={<Chevron />}
            onPress={() => setSheet('editProfile')}
          />
          {/* Phase D (D6): Learning Languages is the PRIMARY language flow — add,
              switch, upgrade — one sheet shared with the global indicator. */}
          <ListItem
            leading={<IconTile><IconGlobe size={16} color={theme.color.brand} /></IconTile>}
            testID="settings-languages"
            title={t('settings.learningLanguages')}
            subtitle={learningLangsSubtitle}
            trailing={<Chevron />}
            onPress={() => setSheet('languages')}
            last
          />
          {/* 18 §A8 (D3): no in-app UI-language switcher — the app follows the OS
              (per-app language in iOS/Android settings). Native language (content)
              stays an explicit onboarding choice; the two are deliberately separate. */}
        </Section>

        {/* Study Preferences */}
        <Section label={t('settings.studyPreferences')}>
          <ListItem
            leading={<IconTile><IconBell size={16} color={theme.color.brand} /></IconTile>}
            testID="settings-reminders"
            title={t('settings.studyReminders')}
            subtitle={remindersSubtitle}
            trailing={<Chevron />}
            onPress={() => setSheet('notifications')}
          />
          <ListItem
            leading={<IconTile><IconBook size={16} color={theme.color.brand} /></IconTile>}
            testID="settings-quiz-length"
            title={t('settings.quizLength')}
            subtitle={t('settings.cardsPerSession', { count: isPaid ? quizLength : QUIZ_LENGTH_FREE })}
            trailing={<Chevron />}
            onPress={() => setSheet('quizLength')}
            last
          />
        </Section>

        {/* Subscription */}
        <Section label={t('settings.subscription')}>
          {isPaid ? (
            <>
              <View style={styles.planCard}>
                <View style={styles.planTop}>
                  <RawText style={styles.planName}>{t('settings.premiumPlan')}</RawText>
                  <PremiumBadge small />
                </View>
                {/* ⚠️ "Active until", not "Renews". After a CANCELLATION the mirror
                    keeps status='active' with nothing recording that auto-renew is
                    off, so we cannot tell "renews on the 24th" from "ends on the
                    24th". "Active until" is true either way; promising a renewal
                    that will not happen is a support ticket. Say "renews" only once
                    an auto_renew/cancelled_at column exists to back it. */}
                {entitlement?.currentPeriodEnd != null && (
                  <RawText style={styles.planSub}>
                    {t('settings.activeUntil', { date: shortDate(entitlement.currentPeriodEnd, t) })}
                  </RawText>
                )}
              </View>
              <ListItem
                leading={<IconTile><IconStar size={15} color={theme.color.brand} /></IconTile>}
                title={t('settings.manageSubscription')}
                subtitle={t('settings.viewInStore')}
                trailing={<Chevron />}
                testID="settings-manage-subscription"
                onPress={() => void handleManage()}
                last
              />
            </>
          ) : (
            <>
              <View style={styles.planCard}>
                <RawText style={styles.freePlanName}>{t('settings.freePlan')}</RawText>
                {usage.phase === 'starter' ? (
                  <>
                    <RawText style={styles.usageText}>{t('settings.wordsSavedOf', { count: usage.saved, limit: usage.limit })}</RawText>
                    <RawText style={styles.usageGrows}>{t('settings.starterHint', { base: FREE_WORD_BASE, daily: FREE_DAILY_SAVES })}</RawText>
                  </>
                ) : (
                  <>
                    <RawText style={styles.usageText}>{t('settings.dailySavesUsed', { used: usage.usedToday, limit: usage.limit })}</RawText>
                    <RawText style={styles.usageGrows}>{t('settings.dailyHint', { count: usage.saved })}</RawText>
                  </>
                )}
                <View style={styles.usageTrack}>
                  <View style={[styles.usageFill, { width: `${usagePct}%`, backgroundColor: usagePct > 90 ? theme.color.danger : theme.color.brand }]} />
                </View>
              </View>
              <View style={styles.upgradeBlock}>
                <View style={styles.featureList}>
                  {FREE_FEATURES.map((key) => (
                    <View key={key} style={styles.featureRow}>
                      <IconCheck size={14} color={theme.color.evergreen} />
                      <RawText style={styles.featureText}>{t(`settings.${key}`)}</RawText>
                    </View>
                  ))}
                </View>
                <Button title={t('settings.upgrade')} variant="primary" onPress={openPaywall} />
                <RawText style={styles.pricing}>{t('settings.pricing')}</RawText>
              </View>
            </>
          )}
          {/* Restore purchases (17 §S5, wired UX-17a) — store-compliance
              affordance reachable outside the paywall. ⚠️ An inert Restore is a
              guideline 3.1.1 rejection on its own, so this must stay a real
              StoreKit call, not a navigation to the paywall. */}
          <Pressable
            onPress={() => void handleRestore()}
            disabled={isBusy}
            accessibilityRole="button"
            accessibilityState={{ disabled: isBusy }}
            testID="settings-restore-purchases"
            style={({ pressed }) => [styles.restoreRow, (pressed || isBusy) && { opacity: 0.6 }]}
          >
            <RawText style={styles.restoreText}>
              {isBusy ? t('paywall.working') : t('settings.restorePurchases')}
            </RawText>
          </Pressable>
        </Section>

        {/* Help & Support (17 §S3: Clear-all-data cut — redundant with Delete
            Account and destructive; §H3: the Home educator lives here permanently) */}
        <Section label={t('settings.dataSupport')}>
          <ListItem
            leading={<IconTile><IconMountain size={15} color={theme.color.brand} /></IconTile>}
            testID="settings-how-it-works"
            title={t('home.edu.title')}
            trailing={<Chevron />}
            onPress={() => setSheet('howItWorks')}
          />
          <ListItem
            leading={<IconTile><IconMail size={15} color={theme.color.brand} /></IconTile>}
            testID="settings-support"
            title={t('settings.contactSupport')}
            trailing={<Chevron />}
            onPress={() => setSheet('support')}
          />
          <ListItem
            leading={<IconTile><IconInfo size={15} color={theme.color.brand} /></IconTile>}
            testID="settings-about"
            title={t('settings.about')}
            subtitle={t('settings.version', { version: '1.0.0' })}
            trailing={<Chevron />}
            onPress={() => setSheet('about')}
            last
          />
        </Section>

        <View style={styles.signOutWrap}>
          <Pressable testID="settings-signout" style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.7 }]} onPress={() => setSheet('signout')} accessibilityRole="button">
            <RawText style={styles.signOutText}>{t('settings.signOut')}</RawText>
          </Pressable>
        </View>
      </ScrollView>

      {/* Deep-editor sheets */}
      <EditProfileSheet visible={sheet === 'editProfile'} profile={profile} isPaid={isPaid} onClose={() => setSheet(null)} onUpgrade={openPaywall} />
      <NotificationSheet visible={sheet === 'notifications'} isPaid={isPaid} onClose={() => setSheet(null)} onUpgrade={openPaywall} />
      <QuizLengthSheet visible={sheet === 'quizLength'} isPaid={isPaid} onClose={() => setSheet(null)} onUpgrade={openPaywall} />
      <SupportSheet visible={sheet === 'support'} onClose={() => setSheet(null)} />
      <AboutSheet visible={sheet === 'about'} onClose={() => setSheet(null)} />
      {/* 18 §F2: the guided-tour CTA lives INSIDE the How-it-works accordion
          (Casey). Close the sheet, flag the replay, return Home — the
          WalkthroughController picks it up there. */}
      <HowItWorksSheet
        visible={sheet === 'howItWorks'}
        onClose={() => setSheet(null)}
        onStartTour={() => {
          setSheet(null);
          setWalkthroughRequested(true);
          router.navigate('/');
        }}
      />
      <LanguageSwitcherSheet visible={sheet === 'languages'} manage onClose={() => setSheet(null)} />

      <ConfirmDialog
        visible={sheet === 'signout'}
        title={t('settings.signOutTitle')}
        body={t('settings.signOutBody')}
        confirmLabel={t('settings.signOut')}
        cancelLabel={t('settings.cancel')}
        destructive
        onConfirm={() => { setSheet(null); router.replace('/auth'); }}
        onClose={() => setSheet(null)}
      />
    </Screen>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <RawText style={styles.sectionLabel}>{label}</RawText>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

// 30×30 rounded icon tile — brand-soft (or danger-soft) background, per the prototype.
function IconTile({ children, tone = 'brand' }: { children: ReactNode; tone?: 'brand' | 'danger' }) {
  const { theme } = useUnistyles();
  return <View style={[styles.iconTile, { backgroundColor: tone === 'danger' ? theme.color.dangerSoft : theme.color.brandSoft }]}>{children}</View>;
}

function Chevron() {
  const { theme } = useUnistyles();
  return <IconChevronRight size={15} color={theme.color.textFaint} />;
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts, radius } = theme;
  return {
    header: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 },
    title: { fontFamily: fonts.sans.extra, fontSize: 22, letterSpacing: -0.3, color: color.textStrong },
    // Bottom gutter — MEASURED, not assumed (2026-08-06).
    //
    // This used to be `24 + TAB_BAR_FAB_OVERHANG`, on the stated assumption that
    // "the nav's height is spacer-reserved, the FAB is not". The spacer does not
    // reserve it here: with the list scrolled fully to rest, a device hierarchy
    // dump put the Sign Out row at y 868–916 while the FAB occupies 845–903 and
    // the nav's own rows sit at 874–922 (390×844pt @2x → 956pt tall viewport).
    // Sign Out was underneath BOTH — its centre, which is where a tap lands, was
    // inside the FAB, so tapping Sign Out opened search instead.
    //
    // So reserve the whole nav explicitly: its core height, the FAB that floats
    // above it, and the bottom safe area it sits in — the same three terms the
    // tabs layout already sums for the search overlay's `bottomInset`. The safe
    // area is device-dependent, so it is added at the call site (styles here are
    // built without inset context); this constant is the static part.
    scroll: { paddingHorizontal: 16, paddingBottom: SCROLL_GUTTER },

    section: { marginBottom: 24 },
    sectionLabel: { fontFamily: fonts.sans.bold, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: color.textMuted, marginBottom: 6, marginLeft: 4 },
    sectionCard: { backgroundColor: color.surfaceCard, borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: radius.lg, overflow: 'hidden' },

    iconTile: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

    planCard: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.divider },
    planTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    planName: { fontFamily: fonts.sans.bold, fontSize: 15, color: color.textStrong },
    freePlanName: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.textStrong, marginBottom: 4 },
    planSub: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted },

    usageText: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted, marginBottom: 2 },
    usageGrows: { fontFamily: fonts.sans.regular, fontSize: 11, color: color.textFaint, marginBottom: 8 },
    usageTrack: { height: 4, backgroundColor: color.surfaceSunken, borderRadius: 2, overflow: 'hidden' },
    usageFill: { height: '100%', borderRadius: 2 },

    upgradeBlock: { paddingHorizontal: 16, paddingVertical: 14 },
    featureList: { gap: 5, marginBottom: 12 },
    featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    featureText: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted },
    pricing: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textFaint, textAlign: 'center', marginTop: 8 },
    restoreRow: { borderTopWidth: theme.borderWidth.thin, borderTopColor: color.divider, paddingVertical: 11, alignItems: 'center' },
    restoreText: { fontFamily: fonts.sans.semibold, fontSize: 13, color: color.brand },

    signOutWrap: { paddingBottom: 12 },
    signOut: { borderWidth: 1.5, borderColor: color.border, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center' },
    signOutText: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.danger },

    // sheets
    sheetBody: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 21, color: color.textMuted, marginBottom: 18 },
    aboutTagline: { fontFamily: fonts.serif.semibold, fontSize: 16, lineHeight: 24, color: color.textStrong, marginBottom: 8 },
    aboutMeta: { fontFamily: fonts.mono.regular, fontSize: 12, color: color.textMuted },
  };
});

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
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { useEntitlement, useHomeData, useNotificationPrefs, useProfile } from '@/query/hooks';
import { QUIZ_LENGTH_FREE, usePrefsStore } from '@/store/prefsStore';
import { findLanguage } from '@/constants';
import { useLearningLanguages } from '@/query/hooks';
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
  ListItem,
  PremiumBadge,
  RawText,
  Screen,
} from '@/ui';

const FREE_WORD_LIMIT = 50;
const FREE_FEATURES = ['featureUnlimited', 'featureDecks', 'featureLanguages'] as const;
type SheetId = 'about' | 'signout' | 'editProfile' | 'notifications' | 'quizLength' | 'support' | 'howItWorks' | 'languages' | null;

export function SettingsScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const router = useRouter();
  const profile = useProfile();
  const { isPaid } = useEntitlement();
  const { snapshot } = useHomeData();
  const { prefs: notifPrefs } = useNotificationPrefs();
  const quizLength = usePrefsStore((s) => s.quizLength);
  const wordsSaved = snapshot?.wordsSaved ?? 0;

  const [sheet, setSheet] = useState<SheetId>(null);
  const openPaywall = () => router.push('/paywall');

  const initial = (profile?.displayName ?? 'L').charAt(0).toUpperCase();
  const profileSub = t('settings.profileNative', { lang: t(`languages.${profile?.nativeLang ?? 'en'}`) });
  const usagePct = Math.min(100, Math.round((wordsSaved / FREE_WORD_LIMIT) * 100));
  // Honest row state (17 §S1): the subtitle reflects the user's actual reminder
  // prefs; free users are NOT shown a premium badge here — the toggle is free,
  // only the custom time is gated (inside the sheet).
  // D12: free users see the EFFECTIVE schedule (default time, every day) — their
  // stored premium-era settings are preserved but not honored while unentitled.
  const effectiveTime = isPaid ? (notifPrefs?.windows[0]?.time ?? '19:00') : '19:00';
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
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Account */}
        <Section label={t('settings.account')}>
          <Pressable style={({ pressed }) => [styles.profileRow, pressed && styles.rowPressed]} onPress={() => setSheet('editProfile')} accessibilityRole="button">
            <View style={styles.avatar}>
              <RawText style={styles.avatarText}>{initial}</RawText>
            </View>
            <View style={styles.profileBody}>
              <RawText style={styles.profileName} numberOfLines={1}>{profile?.displayName ?? '—'}</RawText>
              <RawText style={styles.profileSub} numberOfLines={1}>{profileSub}</RawText>
            </View>
            <IconChevronRight size={16} color={theme.color.textFaint} />
          </Pressable>
          {/* Phase D (D6): Learning Languages is the PRIMARY language flow — add,
              switch, upgrade — one sheet shared with the global indicator. */}
          <ListItem
            leading={<IconTile><IconGlobe size={16} color={theme.color.brand} /></IconTile>}
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
            title={t('settings.studyReminders')}
            subtitle={remindersSubtitle}
            trailing={<Chevron />}
            onPress={() => setSheet('notifications')}
          />
          <ListItem
            leading={<IconTile><IconBook size={16} color={theme.color.brand} /></IconTile>}
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
                <RawText style={styles.planSub}>{t('settings.renews', { date: t('settings.renewDatePlaceholder') })}</RawText>
              </View>
              <ListItem
                leading={<IconTile><IconStar size={15} color={theme.color.brand} /></IconTile>}
                title={t('settings.manageSubscription')}
                subtitle={t('settings.viewInStore')}
                trailing={<Chevron />}
                onPress={openPaywall}
                last
              />
            </>
          ) : (
            <>
              <View style={styles.planCard}>
                <RawText style={styles.freePlanName}>{t('settings.freePlan')}</RawText>
                <RawText style={styles.usageText}>{t('settings.wordsSavedOf', { count: wordsSaved, limit: FREE_WORD_LIMIT })}</RawText>
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
          {/* Restore purchases (17 §S5) — store-compliance affordance reachable
              outside the paywall. RevenueCat wiring pending (same stub as PW-01). */}
          <Pressable onPress={() => {}} accessibilityRole="button" style={({ pressed }) => [styles.restoreRow, pressed && { opacity: 0.6 }]}>
            <RawText style={styles.restoreText}>{t('settings.restorePurchases')}</RawText>
          </Pressable>
        </Section>

        {/* Help & Support (17 §S3: Clear-all-data cut — redundant with Delete
            Account and destructive; §H3: the Home educator lives here permanently) */}
        <Section label={t('settings.dataSupport')}>
          <ListItem
            leading={<IconTile><IconMountain size={15} color={theme.color.brand} /></IconTile>}
            title={t('home.edu.title')}
            trailing={<Chevron />}
            onPress={() => setSheet('howItWorks')}
          />
          <ListItem
            leading={<IconTile><IconMail size={15} color={theme.color.brand} /></IconTile>}
            title={t('settings.contactSupport')}
            trailing={<Chevron />}
            onPress={() => setSheet('support')}
          />
          <ListItem
            leading={<IconTile><IconInfo size={15} color={theme.color.brand} /></IconTile>}
            title={t('settings.about')}
            subtitle={t('settings.version', { version: '1.0.0' })}
            trailing={<Chevron />}
            onPress={() => setSheet('about')}
            last
          />
        </Section>

        <View style={styles.signOutWrap}>
          <Pressable style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.7 }]} onPress={() => setSheet('signout')} accessibilityRole="button">
            <RawText style={styles.signOutText}>{t('settings.signOut')}</RawText>
          </Pressable>
        </View>
      </ScrollView>

      {/* Deep-editor sheets */}
      <EditProfileSheet visible={sheet === 'editProfile'} profile={profile} onClose={() => setSheet(null)} />
      <NotificationSheet visible={sheet === 'notifications'} isPaid={isPaid} onClose={() => setSheet(null)} onUpgrade={openPaywall} />
      <QuizLengthSheet visible={sheet === 'quizLength'} isPaid={isPaid} onClose={() => setSheet(null)} onUpgrade={openPaywall} />
      <SupportSheet visible={sheet === 'support'} onClose={() => setSheet(null)} />
      <AboutSheet visible={sheet === 'about'} onClose={() => setSheet(null)} />
      <HowItWorksSheet visible={sheet === 'howItWorks'} onClose={() => setSheet(null)} />
      <LanguageSwitcherSheet visible={sheet === 'languages'} onClose={() => setSheet(null)} />

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
    scroll: { paddingHorizontal: 16, paddingBottom: 24 },

    section: { marginBottom: 24 },
    sectionLabel: { fontFamily: fonts.sans.bold, fontSize: 11, letterSpacing: 0.9, textTransform: 'uppercase', color: color.textMuted, marginBottom: 6, marginLeft: 4 },
    sectionCard: { backgroundColor: color.surfaceCard, borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: radius.lg, overflow: 'hidden' },

    rowPressed: { backgroundColor: color.surfaceSunken },
    iconTile: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

    profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: color.surfaceCard },
    avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.brandSoft, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontFamily: fonts.sans.bold, fontSize: 18, color: color.brand },
    profileBody: { flex: 1, minWidth: 0 },
    profileName: { fontFamily: fonts.sans.bold, fontSize: 16, color: color.textStrong },
    profileSub: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted, marginTop: 2 },

    planCard: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.divider },
    planTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    planName: { fontFamily: fonts.sans.bold, fontSize: 15, color: color.textStrong },
    freePlanName: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.textStrong, marginBottom: 4 },
    planSub: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted },

    usageText: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted, marginBottom: 8 },
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

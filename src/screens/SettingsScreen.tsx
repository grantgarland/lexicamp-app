// SettingsScreen (SE-01) — the settings hub, assembled against settings/Settings.html.
// Account · Study Preferences · Subscription · Data & Support, over real profile +
// entitlement state. Rows compose the shared ListItem with a colored icon tile;
// PremiumBadge is the shared amber pill. Destructive Clear-data / Sign-out and About
// open confirm sheets; the deeper editors open a placeholder sheet for now.
import { useRouter } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { useEntitlement, useHomeData, useProfile } from '@/query/hooks';
import { AboutSheet, EditProfileSheet, NotificationSheet, QuizLengthSheet, SupportSheet } from './settings/sheets';
import {
  Button,
  ConfirmDialog,
  IconBell,
  IconBook,
  IconChevronRight,
  IconCheck,
  IconInfo,
  IconMail,
  IconStar,
  IconTrash,
  ListItem,
  PremiumBadge,
  RawText,
  Screen,
} from '@/ui';

const FREE_WORD_LIMIT = 50;
const FREE_FEATURES = ['featureUnlimited', 'featureDecks', 'featureLanguages'] as const;
type SheetId = 'about' | 'clear' | 'signout' | 'editProfile' | 'notifications' | 'quizLength' | 'support' | null;

export function SettingsScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const router = useRouter();
  const profile = useProfile();
  const { isPaid } = useEntitlement();
  const { snapshot } = useHomeData();
  const wordsSaved = snapshot?.wordsSaved ?? 0;

  const [sheet, setSheet] = useState<SheetId>(null);
  const openPaywall = () => router.push('/paywall');

  const initial = (profile?.displayName ?? 'L').charAt(0).toUpperCase();
  const direction = `${t(`languages.${profile?.nativeLang ?? 'en'}`)} → ${t(`languages.${profile?.learningLang ?? 'es'}`)}`;
  const usagePct = Math.min(100, Math.round((wordsSaved / FREE_WORD_LIMIT) * 100));

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
              <RawText style={styles.profileSub} numberOfLines={1}>{direction}</RawText>
            </View>
            <IconChevronRight size={16} color={theme.color.textFaint} />
          </Pressable>
        </Section>

        {/* Study Preferences */}
        <Section label={t('settings.studyPreferences')}>
          <ListItem
            leading={<IconTile><IconBell size={16} color={theme.color.brand} /></IconTile>}
            title={t('settings.studyReminders')}
            subtitle={isPaid ? t('settings.remindersOn') : t('settings.remindersLocked')}
            trailing={isPaid ? <Chevron /> : <PremiumBadge small />}
            onPress={() => setSheet('notifications')}
          />
          <ListItem
            leading={<IconTile><IconBook size={16} color={theme.color.brand} /></IconTile>}
            title={t('settings.quizLength')}
            subtitle={t('settings.cardsPerSession', { count: 20 })}
            trailing={isPaid ? <Chevron /> : <PremiumBadge small />}
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
        </Section>

        {/* Data & Support */}
        <Section label={t('settings.dataSupport')}>
          <ListItem
            leading={<IconTile tone="danger"><IconTrash size={15} color={theme.color.danger} /></IconTile>}
            title={t('settings.clearData')}
            titleColor={theme.color.danger}
            trailing={<Chevron />}
            onPress={() => setSheet('clear')}
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
      <EditProfileSheet visible={sheet === 'editProfile'} profile={profile} isPaid={isPaid} onClose={() => setSheet(null)} onUpgrade={openPaywall} />
      <NotificationSheet visible={sheet === 'notifications'} isPaid={isPaid} onClose={() => setSheet(null)} onUpgrade={openPaywall} />
      <QuizLengthSheet visible={sheet === 'quizLength'} isPaid={isPaid} onClose={() => setSheet(null)} onUpgrade={openPaywall} />
      <SupportSheet visible={sheet === 'support'} onClose={() => setSheet(null)} />
      <AboutSheet visible={sheet === 'about'} onClose={() => setSheet(null)} />

      <ConfirmDialog
        visible={sheet === 'clear'}
        icon={<IconTrash size={22} color={theme.color.danger} />}
        title={t('settings.clearTitle')}
        body={t('settings.clearBody')}
        confirmLabel={t('settings.clearConfirm')}
        cancelLabel={t('settings.cancel')}
        destructive
        onConfirm={() => setSheet(null)}
        onClose={() => setSheet(null)}
      />

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

    signOutWrap: { paddingBottom: 12 },
    signOut: { borderWidth: 1.5, borderColor: color.border, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center' },
    signOutText: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.danger },

    // sheets
    sheetBody: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 21, color: color.textMuted, marginBottom: 18 },
    aboutTagline: { fontFamily: fonts.serif.semibold, fontSize: 16, lineHeight: 24, color: color.textStrong, marginBottom: 8 },
    aboutMeta: { fontFamily: fonts.mono.regular, fontSize: 12, color: color.textMuted },
  };
});

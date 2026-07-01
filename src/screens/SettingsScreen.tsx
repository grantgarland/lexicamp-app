// SettingsScreen (SE-01) — the settings hub, assembled against settings/Settings.html.
// Account · Study Preferences · Subscription · Data & Support, over real profile +
// entitlement state. Destructive Clear-data / Sign-out and About open confirm sheets;
// the deeper editors (profile, reminders, quiz length, language) open a placeholder
// sheet for now. Bottom nav is the persistent tab layout.
import { type ReactNode, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { useEntitlement, useHomeData, useProfile } from '@/query/hooks';
import { Button, ConfirmDialog, IconBook, IconChevronRight, IconClock, IconInfo, IconMountain, IconTrash, RawText, Screen, Sheet } from '@/ui';

const FREE_WORD_LIMIT = 50;
type SheetId = 'about' | 'clear' | 'signout' | 'soon' | null;

export function SettingsScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const profile = useProfile();
  const { isPaid } = useEntitlement();
  const { snapshot } = useHomeData();
  const wordsSaved = snapshot?.wordsSaved ?? 0;

  const [sheet, setSheet] = useState<SheetId>(null);
  const [soonLabel, setSoonLabel] = useState('');
  const openSoon = (label: string) => {
    setSoonLabel(label);
    setSheet('soon');
  };

  const initial = (profile?.displayName ?? 'L').charAt(0).toUpperCase();
  const direction = `${t(`languages.${profile?.nativeLang ?? 'en'}`)} → ${t(`languages.${profile?.learningLang ?? 'es'}`)}`;

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <RawText style={styles.title}>{t('settings.title')}</RawText>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Account */}
        <Section label={t('settings.account')}>
          <Pressable style={styles.profileRow} onPress={() => openSoon(t('settings.editProfile'))} accessibilityRole="button">
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
          <Row icon={<IconClock size={16} color={theme.color.textMuted} />} label={t('settings.studyReminders')} value={isPaid ? t('settings.remindersOn') : t('settings.remindersLocked')} pro={!isPaid} onPress={() => openSoon(t('settings.studyReminders'))} />
          <Row icon={<IconBook size={16} color={theme.color.textMuted} />} label={t('settings.quizLength')} value={t('settings.cardsPerSession', { count: 20 })} pro={!isPaid} onPress={() => openSoon(t('settings.quizLength'))} last />
        </Section>

        {/* Subscription */}
        <Section label={t('settings.subscription')}>
          {isPaid ? (
            <>
              <View style={styles.planCard}>
                <View style={styles.planTop}>
                  <RawText style={styles.planName}>{t('settings.premiumPlan')}</RawText>
                  <View style={styles.proBadge}>
                    <RawText style={styles.proBadgeText}>PRO</RawText>
                  </View>
                </View>
                <RawText style={styles.planSub}>{t('settings.renews', { date: t('settings.renewDatePlaceholder') })}</RawText>
              </View>
              <Row icon={<IconMountain size={15} color={theme.color.accent} />} label={t('settings.manageSubscription')} value={t('settings.viewInStore')} onPress={() => openSoon(t('settings.manageSubscription'))} last />
            </>
          ) : (
            <View style={styles.freeBlock}>
              <RawText style={styles.planName}>{t('settings.freePlan')}</RawText>
              <RawText style={styles.usageText}>{t('settings.wordsSavedOf', { count: wordsSaved, limit: FREE_WORD_LIMIT })}</RawText>
              <View style={styles.usageTrack}>
                <View style={[styles.usageFill, { width: `${Math.min(100, Math.round((wordsSaved / FREE_WORD_LIMIT) * 100))}%`, backgroundColor: wordsSaved / FREE_WORD_LIMIT > 0.9 ? theme.color.danger : theme.color.brand }]} />
              </View>
              <View style={styles.upgradeCta}>
                <Button title={t('settings.upgrade')} variant="primary" onPress={() => openSoon(t('settings.upgrade'))} />
              </View>
              <RawText style={styles.pricing}>{t('settings.pricing')}</RawText>
            </View>
          )}
        </Section>

        {/* Data & Support */}
        <Section label={t('settings.dataSupport')}>
          <Row icon={<IconTrash size={15} color={theme.color.danger} />} label={t('settings.clearData')} destructive onPress={() => setSheet('clear')} />
          <Row icon={<IconInfo size={15} color={theme.color.textMuted} />} label={t('settings.contactSupport')} onPress={() => openSoon(t('settings.contactSupport'))} />
          <Row icon={<IconMountain size={15} color={theme.color.textMuted} />} label={t('settings.about')} value={t('settings.version', { version: '1.0.0' })} onPress={() => setSheet('about')} last />
        </Section>

        <View style={styles.signOutWrap}>
          <Pressable style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.7 }]} onPress={() => setSheet('signout')} accessibilityRole="button">
            <RawText style={styles.signOutText}>{t('settings.signOut')}</RawText>
          </Pressable>
        </View>
      </ScrollView>

      {/* Sheets */}
      <Sheet visible={sheet === 'about'} onClose={() => setSheet(null)} title={t('settings.aboutTitle')}>
        <RawText style={styles.aboutTagline}>{t('settings.aboutTagline')}</RawText>
        <RawText style={styles.aboutMeta}>{t('settings.version', { version: '1.0.0' })}</RawText>
      </Sheet>

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
        onConfirm={() => setSheet(null)}
        onClose={() => setSheet(null)}
      />

      <Sheet visible={sheet === 'soon'} onClose={() => setSheet(null)} title={soonLabel}>
        <RawText style={styles.sheetBody}>{t('settings.comingSoon')}</RawText>
      </Sheet>
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

function Row({
  icon,
  label,
  value,
  pro,
  destructive,
  last,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  pro?: boolean;
  destructive?: boolean;
  last?: boolean;
  onPress: () => void;
}) {
  const { theme } = useUnistyles();
  return (
    <Pressable style={({ pressed }) => [styles.row, !last && styles.rowBorder, pressed && { opacity: 0.6 }]} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowIcon}>{icon}</View>
      <RawText style={[styles.rowLabel, destructive && { color: theme.color.danger }]}>{label}</RawText>
      {pro && (
        <View style={styles.proBadgeSmall}>
          <RawText style={styles.proBadgeText}>PRO</RawText>
        </View>
      )}
      {value != null && <RawText style={styles.rowValue}>{value}</RawText>}
      <IconChevronRight size={15} color={theme.color.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, palette, fonts, radius } = theme;
  return {
    header: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 },
    title: { fontFamily: fonts.sans.extra, fontSize: 22, letterSpacing: -0.3, color: color.textStrong },
    scroll: { paddingHorizontal: 16, paddingBottom: 24 },

    section: { marginBottom: 22 },
    sectionLabel: { fontFamily: fonts.sans.bold, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', color: color.textMuted, marginBottom: 8, marginLeft: 2 },
    sectionCard: { backgroundColor: color.surfaceCard, borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: radius.lg, overflow: 'hidden' },

    profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
    avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.blue[50], alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontFamily: fonts.sans.bold, fontSize: 18, color: color.brand },
    profileBody: { flex: 1, minWidth: 0 },
    profileName: { fontFamily: fonts.sans.bold, fontSize: 16, color: color.textStrong },
    profileSub: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted, marginTop: 2 },

    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
    rowBorder: { borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.divider },
    rowIcon: { width: 20, alignItems: 'center' },
    rowLabel: { flex: 1, fontFamily: fonts.sans.medium, fontSize: 15, color: color.textStrong },
    rowValue: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted },
    proBadgeSmall: { backgroundColor: palette.amber[100], borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 },

    planCard: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: theme.borderWidth.thin, borderBottomColor: color.divider },
    planTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    planName: { fontFamily: fonts.sans.bold, fontSize: 15, color: color.textStrong },
    planSub: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted },
    proBadge: { backgroundColor: palette.amber[100], borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
    proBadgeText: { fontFamily: fonts.sans.bold, fontSize: 9, letterSpacing: 0.3, color: palette.amber[800] },

    freeBlock: { paddingHorizontal: 16, paddingVertical: 14 },
    usageText: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted, marginTop: 4, marginBottom: 8 },
    usageTrack: { height: 4, backgroundColor: palette.slate[100], borderRadius: 2, overflow: 'hidden', marginBottom: 14 },
    usageFill: { height: '100%', borderRadius: 2 },
    upgradeCta: {},
    pricing: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textFaint, textAlign: 'center', marginTop: 8 },

    signOutWrap: { paddingBottom: 12 },
    signOut: { borderWidth: 1.5, borderColor: color.border, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center' },
    signOutText: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.danger },

    // sheets
    sheetBody: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 21, color: color.textMuted, marginBottom: 18 },
    sheetCancel: { marginTop: 10 },
    aboutTagline: { fontFamily: fonts.serif.semibold, fontSize: 16, lineHeight: 24, color: color.textStrong, marginBottom: 8 },
    aboutMeta: { fontFamily: fonts.mono.regular, fontSize: 12, color: color.textMuted },
  };
});

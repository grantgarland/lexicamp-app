// LanguageSwitcher (Phase D, 18 §2a.5/§D5) — the GLOBAL active-language surface.
//
// `LanguageIndicator`: a compact pill (ISO code, deliberately NOT a flag — flags
// ≠ languages: es spans Spain/Mexico/…) placed in the Home/Search/Words headers.
// Pressing it opens `LanguageSwitcherSheet`: the enrolled list (switch = one
// tap, optimistic app-wide repaint), the per-language data reassurance line
// (item 4.1), and "+ Add language" (premium, ≤5; free sees the upgrade gate).
// The Settings → Learning Languages row opens the same sheet (D6) — one flow,
// every entry point. Removal (2026-07-21, Casey): SETTINGS-ONLY via the `manage`
// prop — non-active rows gain a left-swipe Delete tray (WordRow pattern) that
// confirms via ConfirmDialog, then ARCHIVES server-side (remove_learning_language
// sets archived_at; words/progress survive and re-adding restores them free).
// The header-pill entry points stay swipe-free: switching surfaces shouldn't
// carry destructive affordances.
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { findLanguage, languageShortLabel, TRANSLATABLE_LANGUAGES } from '@/constants';
import { languageName } from '@/domain/derive';
import type { LanguageCode } from '@/domain/types';
import { useTranslation } from '@/i18n';
import { useActiveLang, useAddLanguage, useEntitlement, useLearningLanguages, useProfile, useRemoveLanguage, useSwitchLanguage } from '@/query/hooks';
import { useUiStore } from '@/store/uiStore';
import { ConfirmDialog, IconCheck, IconChevronDown, IconChevronLeft, IconGlobe, IconPlus, IconTrash, LanguagePickerSheet, ListItem, RawText, Sheet } from '@/ui';

const LANGUAGE_CAP = 5;

/** The global indicator pill. Self-contained: owns its sheet. */
export function LanguageIndicator({ compact = false }: { compact?: boolean }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const activeLang = useActiveLang();
  const [open, setOpen] = useState(false);
  if (activeLang == null) return null;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('langSwitcher.indicatorA11y', { lang: languageName(activeLang as LanguageCode) })}
        style={({ pressed }) => [styles.pill, compact && styles.pillCompact, pressed && { opacity: 0.7 }]}
      >
        <IconGlobe size={compact ? 11 : 12} color={theme.color.brand} />
        <RawText numberOfLines={1} style={[styles.pillText, compact && styles.pillTextCompact]}>
          {languageShortLabel(activeLang as LanguageCode)}
        </RawText>
        <IconChevronDown size={compact ? 9 : 10} color={theme.color.brand} />
      </Pressable>
      <LanguageSwitcherSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** The switcher sheet — also opened directly from Settings → Learning Languages.
 *  `manage` (Settings entry only): non-active rows swipe open a Delete tray →
 *  destructive confirm → archive. Other entry points omit it and stay pure
 *  switch/add surfaces. */
export function LanguageSwitcherSheet({ visible, onClose, manage = false }: { visible: boolean; onClose: () => void; manage?: boolean }) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const router = useRouter();
  const showToast = useUiStore((s) => s.showToast);
  const profile = useProfile();
  const activeLang = useActiveLang();
  const { isPaid } = useEntitlement();
  const { languages } = useLearningLanguages();
  const switchLang = useSwitchLanguage();
  const addLang = useAddLanguage();
  const removeLang = useRemoveLanguage();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Language pending delete-confirmation (manage mode). Holding the code (not a
  // boolean) keys the dialog copy to the swiped row.
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  // Add-language choices: translatable, minus native, minus already-enrolled.
  const addable = useMemo(() => {
    const native = profile?.nativeLang?.toLowerCase();
    const enrolled = new Set(languages.map((l) => l.toLowerCase()));
    return TRANSLATABLE_LANGUAGES.filter((l) => l.code.toLowerCase() !== native && !enrolled.has(l.code.toLowerCase()));
  }, [profile, languages]);

  const doSwitch = (lang: string) => {
    if (lang === activeLang) return;
    // D12 REVISED (Casey, 2026-07-17): switching between ENROLLED languages is
    // free for everyone — a free user with multiple languages got them via
    // premium, and demotion never takes away access to what they earned.
    // Only ADDING a language stays premium (the doAdd path).
    switchLang.mutate(lang, {
      onSuccess: () => showToast({ variant: 'success', message: t('langSwitcher.switched', { lang: languageName(lang as LanguageCode) }) }),
    });
    onClose(); // optimistic repaint is already underway — close immediately
  };

  const doRemove = (lang: string) => {
    setConfirmRemove(null);
    removeLang.mutate(lang, {
      onSuccess: () => showToast({ variant: 'success', message: t('langSwitcher.removed', { lang: languageName(lang as LanguageCode) }) }),
      onError: () => showToast({ variant: 'warning', message: t('langSwitcher.removeFailed') }),
    });
  };

  const doAdd = (lang: string) => {
    setPickerOpen(false);
    addLang.mutate(lang, {
      onSuccess: () => showToast({ variant: 'success', message: t('langSwitcher.added', { lang: languageName(lang as LanguageCode) }) }),
      onError: (e) => {
        if (e instanceof Error && e.message.includes('premium_required')) router.push('/paywall');
        else showToast({ variant: 'warning', message: t('langSwitcher.addFailed') });
      },
    });
    onClose();
  };

  return (
    <>
      <Sheet visible={visible && !pickerOpen} onClose={onClose} title={t('langSwitcher.title')}>
        {/* Item 4.1: the reassurance is PERSISTENT sheet copy, not a one-time dialog. */}
        <RawText style={styles.reassure}>{t('langSwitcher.reassure')}</RawText>

        <View style={styles.list}>
          {languages.map((lang, i) => (
            <EnrolledLanguageRow
              key={lang}
              lang={lang}
              active={lang === activeLang}
              last={i === languages.length - 1}
              // Manage mode (Settings): swipeable delete on NON-ACTIVE rows only —
              // the server refuses to archive the active language (language_active),
              // so the active (and thus any last-remaining) row simply doesn't swipe.
              swipeable={manage && lang !== activeLang}
              onPress={() => doSwitch(lang)}
              onDelete={() => setConfirmRemove(lang)}
            />
          ))}
        </View>

        {isPaid ? (
          languages.length < LANGUAGE_CAP ? (
            <Pressable
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.7 }]}
            >
              <IconPlus size={15} color={theme.color.brand} />
              <RawText style={styles.addText}>{t('langSwitcher.add')}</RawText>
            </Pressable>
          ) : (
            <RawText style={styles.capNote}>{t('langSwitcher.capReached', { cap: LANGUAGE_CAP })}</RawText>
          )
        ) : (
          <View style={styles.gate}>
            <View style={styles.gateText}>
              <RawText style={styles.gateTitle}>{t('settings.langMultiTitle')}</RawText>
              <RawText style={styles.gateBody}>{t('settings.langMultiBody')}</RawText>
            </View>
            <Pressable onPress={() => { onClose(); router.push('/paywall'); }} style={({ pressed }) => [styles.gateBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button">
              <RawText style={styles.gateBtnText}>{t('settings.upgrade')}</RawText>
            </Pressable>
          </View>
        )}
      </Sheet>

      <LanguagePickerSheet
        visible={visible && pickerOpen}
        current=""
        languages={addable}
        title={t('langSwitcher.pickerTitle')}
        searchPlaceholder={t('settings.searchLanguages')}
        onSelect={doAdd}
        onClose={() => setPickerOpen(false)}
      />

      {/* Shared destructive-confirm flow (same as delete word / delete deck /
          sign out). Copy is honest about the archive semantics: nothing is
          deleted, re-adding restores everything. */}
      <ConfirmDialog
        visible={confirmRemove != null}
        title={t('langSwitcher.removeTitle', { lang: confirmRemove != null ? languageName(confirmRemove as LanguageCode) : '' })}
        body={t('langSwitcher.removeBody', { lang: confirmRemove != null ? languageName(confirmRemove as LanguageCode) : '' })}
        confirmLabel={t('langSwitcher.removeConfirm')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => { if (confirmRemove != null) doRemove(confirmRemove); }}
        onClose={() => setConfirmRemove(null)}
      />
    </>
  );
}

/** One enrolled-language row. In manage mode non-active rows wrap in the shared
 *  left-swipe tray (ReanimatedSwipeable, WordRow pattern) with a single Delete
 *  action; otherwise a plain ListItem. Own component so each swipeable row keeps
 *  its own ref (closed before the confirm opens). */
function EnrolledLanguageRow({
  lang,
  active,
  last,
  swipeable,
  onPress,
  onDelete,
}: {
  lang: string;
  active: boolean;
  last: boolean;
  swipeable: boolean;
  onPress: () => void;
  onDelete: () => void;
}) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const ref = useRef<SwipeableMethods>(null);
  const info = findLanguage(lang);

  const face = (
    <ListItem
      leading={
        <View style={[styles.codeBadge, active && { backgroundColor: theme.color.brand }]}>
          {/* Short label keeps every badge the same width, so the list's titles
              stay on one left edge instead of stepping in for long codes. */}
          <RawText numberOfLines={1} style={[styles.codeBadgeText, active && { color: '#fff' }]}>
            {languageShortLabel(lang as LanguageCode)}
          </RawText>
        </View>
      }
      title={info?.nativeName ?? languageName(lang as LanguageCode)}
      subtitle={info?.name ?? undefined}
      // Swipeable rows carry a LEFT chevron affordance (Casey, 2026-07-21):
      // the row content slides left to reveal the delete tray, so the hint
      // points the way. Active row keeps its checkmark; plain mode unchanged.
      trailing={
        active ? (
          <IconCheck size={16} color={theme.color.brand} />
        ) : swipeable ? (
          <IconChevronLeft size={14} color={theme.color.textFaint} />
        ) : undefined
      }
      onPress={onPress}
      last={last}
    />
  );

  if (!swipeable) return face;

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      containerStyle={styles.swipeRow}
      renderRightActions={() => (
        <View style={styles.tray}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('langSwitcher.removeA11y', { lang: languageName(lang as LanguageCode) })}
            // Maestro tap target — trays only mount while swiped open, so at
            // most one row's action exists at a time and the id stays unique.
            testID="lang-row-delete"
            style={[styles.trayAction, { backgroundColor: theme.color.danger }]}
            onPress={() => {
              ref.current?.close();
              onDelete();
            }}
          >
            <IconTrash size={18} color={theme.color.textOnDanger} />
            <RawText style={[styles.trayLabel, { color: theme.color.textOnDanger }]}>{t('langSwitcher.removeAction')}</RawText>
          </Pressable>
        </View>
      )}
    >
      {face}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts, radius } = theme;
  return {
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: color.brandSoft,
      borderWidth: theme.borderWidth.thin,
      borderColor: color.brandSoft,
      borderRadius: 999,
      paddingVertical: 5,
      paddingHorizontal: 10,
    },
    pillCompact: { paddingVertical: 3, paddingHorizontal: 8 },
    pillText: { fontFamily: fonts.mono.bold, fontSize: 12, color: color.brand, letterSpacing: 0.5 },
    pillTextCompact: { fontSize: 11 },

    reassure: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 19, color: color.textMuted, marginBottom: 12 },
    list: { borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: radius.lg, overflow: 'hidden', marginBottom: 12 },
    codeBadge: { minWidth: 34, borderRadius: 8, backgroundColor: color.surfaceSunken, paddingVertical: 5, paddingHorizontal: 6, alignItems: 'center' },
    codeBadgeText: { fontFamily: fonts.mono.bold, fontSize: 11, color: color.textMuted, letterSpacing: 0.4 },

    addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.brandSoft, borderStyle: 'dashed' },
    addText: { fontFamily: fonts.sans.semibold, fontSize: 14, color: color.brand },
    capNote: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, textAlign: 'center', paddingVertical: 6 },

    gate: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: color.accentTint, borderWidth: theme.borderWidth.thin, borderColor: color.accentSoft, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 14 },
    gateText: { flex: 1 },
    gateTitle: { fontFamily: fonts.sans.semibold, fontSize: 13, color: color.textStrong, marginBottom: 1 },
    gateBody: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted },
    gateBtn: { backgroundColor: color.accentCta, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
    gateBtnText: { fontFamily: fonts.sans.bold, fontSize: 12, color: color.textOnAccentCta },

    // manage-mode swipe tray (mirrors WordRow's action anatomy)
    swipeRow: { backgroundColor: color.surfaceCard },
    tray: { flexDirection: 'row' },
    trayAction: { width: 76, alignItems: 'center', justifyContent: 'center', gap: 4 },
    trayLabel: { color: '#fff', fontSize: 9, letterSpacing: 0.3, fontFamily: fonts.sans.semibold },
  };
});

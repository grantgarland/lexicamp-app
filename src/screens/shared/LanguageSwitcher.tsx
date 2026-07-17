// LanguageSwitcher (Phase D, 18 §2a.5/§D5) — the GLOBAL active-language surface.
//
// `LanguageIndicator`: a compact pill (ISO code, deliberately NOT a flag — flags
// ≠ languages: es spans Spain/Mexico/…) placed in the Home/Search/Words headers.
// Pressing it opens `LanguageSwitcherSheet`: the enrolled list (switch = one
// tap, optimistic app-wide repaint), the per-language data reassurance line
// (item 4.1), and "+ Add language" (premium, ≤5; free sees the upgrade gate).
// The Settings → Learning Languages row opens the same sheet (D6) — one flow,
// every entry point. Removal is deliberately NOT in this v1 sheet (RPC exists;
// low-frequency op, revisit if requested).
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { findLanguage, TRANSLATABLE_LANGUAGES } from '@/constants';
import { languageName } from '@/domain/derive';
import type { LanguageCode } from '@/domain/types';
import { useTranslation } from '@/i18n';
import { useActiveLang, useAddLanguage, useEntitlement, useLearningLanguages, useProfile, useSwitchLanguage } from '@/query/hooks';
import { useUiStore } from '@/store/uiStore';
import { IconCheck, IconChevronDown, IconGlobe, IconPlus, LanguagePickerSheet, ListItem, RawText, Sheet } from '@/ui';

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
        <RawText style={[styles.pillText, compact && styles.pillTextCompact]}>{activeLang.toUpperCase()}</RawText>
        <IconChevronDown size={compact ? 9 : 10} color={theme.color.brand} />
      </Pressable>
      <LanguageSwitcherSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** The switcher sheet — also opened directly from Settings → Learning Languages. */
export function LanguageSwitcherSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
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
  const [pickerOpen, setPickerOpen] = useState(false);

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
          {languages.map((lang, i) => {
            const info = findLanguage(lang);
            const active = lang === activeLang;
            return (
              <ListItem
                key={lang}
                leading={
                  <View style={[styles.codeBadge, active && { backgroundColor: theme.color.brand }]}>
                    <RawText style={[styles.codeBadgeText, active && { color: '#fff' }]}>{lang.toUpperCase()}</RawText>
                  </View>
                }
                title={info?.nativeName ?? languageName(lang as LanguageCode)}
                subtitle={info?.name ?? undefined}
                trailing={active ? <IconCheck size={16} color={theme.color.brand} /> : undefined}
                onPress={() => doSwitch(lang)}
                last={i === languages.length - 1}
              />
            );
          })}
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
    </>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts, radius, palette } = theme;
  return {
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: color.brandSoft,
      borderWidth: theme.borderWidth.thin,
      borderColor: palette.blue[200],
      borderRadius: 999,
      paddingVertical: 5,
      paddingHorizontal: 10,
    },
    pillCompact: { paddingVertical: 3, paddingHorizontal: 8 },
    pillText: { fontFamily: fonts.mono.bold, fontSize: 12, color: color.brand, letterSpacing: 0.5 },
    pillTextCompact: { fontSize: 11 },

    reassure: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 19, color: color.textMuted, marginBottom: 12 },
    list: { borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: radius.lg, overflow: 'hidden', marginBottom: 12 },
    codeBadge: { minWidth: 34, borderRadius: 8, backgroundColor: palette.slate[100], paddingVertical: 5, paddingHorizontal: 6, alignItems: 'center' },
    codeBadgeText: { fontFamily: fonts.mono.bold, fontSize: 11, color: color.textMuted, letterSpacing: 0.4 },

    addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1.5, borderColor: palette.blue[200], borderStyle: 'dashed' },
    addText: { fontFamily: fonts.sans.semibold, fontSize: 14, color: color.brand },
    capNote: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted, textAlign: 'center', paddingVertical: 6 },

    gate: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.amber[50], borderWidth: theme.borderWidth.thin, borderColor: palette.amber[200], borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 14 },
    gateText: { flex: 1 },
    gateTitle: { fontFamily: fonts.sans.semibold, fontSize: 13, color: color.textStrong, marginBottom: 1 },
    gateBody: { fontFamily: fonts.sans.regular, fontSize: 12, color: color.textMuted },
    gateBtn: { backgroundColor: color.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
    gateBtnText: { fontFamily: fonts.sans.bold, fontSize: 12, color: color.textOnAccent },
  };
});

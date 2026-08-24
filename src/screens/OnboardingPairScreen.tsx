// OnboardingPairScreen — step 3 of 3.5's register-first flow (spec `24`).
//
// The language pair, collected AFTER auth. It is the ONLY thing
// `complete_onboarding` genuinely needs from the user: the pair drives capture
// (dictionary pairs are X↔en, `16` §1) and every query key.
//
// Everything else the RPC accepts is derived or obsolete, which is the whole
// reason the pre-auth form is now empty:
//   • timezone         — from `Intl`, never typed. `profiles_normalize_timezone`
//                        is the authority.
//   • display_name     — ⚠️ obsolete as a FIELD (`20 §8 R1` replaced it with the
//                        generated username, filled by `set_default_username`).
//                        Still passed as a derived value so an Apple-supplied
//                        real name is not thrown away, but never asked for.
//   • notifications    — deferred to a post-first-save prompt.
//
// ⚠️ WHY THE DISPLAY NAME IS RE-DERIVED HERE rather than carried from AuthScreen:
// the old flow buffered onboarding answers in an in-memory zustand store across
// the auth boundary. That cannot survive an app restart — and "sign up, kill the
// app, reopen" now lands the user right back on THIS screen, because the routing
// gate keys on the absence of a `profiles` row, not on a session flag. Reading
// the name back from Supabase user metadata (where `signInWithApple` persists it,
// since Apple sends it exactly once) makes the step restart-safe with no buffer.
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { useQueryClient } from '@tanstack/react-query';

import { signOut } from '@/auth/session';
import { findLanguage, LOCALIZED_LANGUAGES, TRANSLATABLE_LANGUAGES } from '@/constants';
import { dataSource, USE_SUPABASE } from '@/data';
import { supabase } from '@/data/supabase/client';
import { defaultDisplayName } from '@/domain/derive';
import { useTranslation } from '@/i18n';
import {
  Button,
  IconChevronRight,
  LanguagePickerSheet,
  RawText,
  Screen,
} from '@/ui';

// Native side defaults to English: dictionary pairs are X↔en (`16` §1), so an
// English side keeps capture on the rich dictionary path — a non-en native falls
// back to plain MT with no senses.
const NATIVE_LANG = 'en';

/** The name to seed the profile with. Apple supplies a real one on the FIRST
 *  sign-in only, and `signInWithApple` persists it to user metadata precisely so
 *  it survives past that moment; email falls back to a prettified local-part. */
async function derivedDisplayName(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const fromApple = data.user?.user_metadata?.full_name;
  return defaultDisplayName(data.user?.email ?? '', typeof fromApple === 'string' ? fromApple : null);
}

export function OnboardingPairScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [native, setNative] = useState<string>(NATIVE_LANG);
  const [target, setTarget] = useState<string | null>(null);
  const [picker, setPicker] = useState<'native' | 'target' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetLanguages = useMemo(
    () => TRANSLATABLE_LANGUAGES.filter((l) => l.code.toLowerCase() !== native.toLowerCase()),
    [native],
  );
  const nativeLang = findLanguage(native);
  const targetLang = target != null ? findLanguage(target) : undefined;

  // The pair must stay distinct (`complete_onboarding` raises 22023 on
  // native = learning), so picking a native that matches the target clears it.
  const chooseNative = (code: string) => {
    setNative(code);
    if (target != null && target.toLowerCase() === code.toLowerCase()) setTarget(null);
    setPicker(null);
  };

  const submit = async () => {
    if (target == null) return;
    setBusy(true);
    setError(null);
    try {
      await dataSource.completeOnboarding({
        nativeLang: native,
        targetLang: target,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
        // Deferred to the post-first-save prompt — see the screen header.
        notificationsEnabled: false,
        displayName: USE_SUPABASE ? await derivedDisplayName() : '',
      });
      // ⚠️ `refetchQueries` with `type: 'all'`, NOT `invalidateQueries` — this
      // was a real bug, seen on device as this screen rendering twice.
      //
      // While the user is here, the tabs layout is unmounted, so the profile
      // query is INACTIVE. `invalidateQueries` does not refetch an inactive
      // query: it marks it stale and resolves immediately. Navigation then
      // remounted the gate, which read the still-cached `null` — `isPending` is
      // false once anything is cached — as a settled "not onboarded" answer and
      // redirected straight back here.
      //
      // `type: 'all'` reaches inactive queries, and awaiting it means the cache
      // holds the real profile BEFORE we navigate. The gate carries a matching
      // guard so this cannot regress if the navigation changes.
      await queryClient.refetchQueries({ queryKey: ['profile'], type: 'all' });
      router.replace('/');
    } catch {
      setError(t('onboarding.pairError'));
    } finally {
      setBusy(false);
    }
  };

  // ⚠️ An escape hatch is NOT optional here. This screen is a mandatory gate on
  // an authenticated session: without a way out, anyone who hits a persistent
  // failure is trapped in a redirect loop with no route to Settings. The same
  // class of bug shipped once already on the DF-3 reset-password screen.
  const abandon = async () => {
    await signOut().catch(() => {});
    router.replace('/onboarding');
  };

  return (
    <>
      <Screen edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.pad} showsVerticalScrollIndicator={false}>
          <RawText style={styles.stepTitle}>{t('onboarding.langTitle')}</RawText>
          <RawText style={styles.stepSub}>{t('onboarding.langSub')}</RawText>

          <RawText style={styles.fieldLabel}>{t('onboarding.nativeLabel')}</RawText>
          <Pressable
            onPress={() => setPicker('native')}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.nativeLabel')}
            testID="onboardingNativePicker"
            style={({ pressed }) => [styles.targetRow, pressed && { opacity: 0.7 }]}
          >
            {nativeLang != null ? (
              <View style={styles.targetValueWrap}>
                <RawText style={styles.targetValue}>{nativeLang.name}</RawText>
                <RawText style={styles.targetNative}>{nativeLang.nativeName}</RawText>
              </View>
            ) : (
              <RawText style={styles.targetPlaceholder}>{t('onboarding.nativePlaceholder')}</RawText>
            )}
            <IconChevronRight size={16} color={theme.color.brand} />
          </Pressable>
          <View style={styles.note}>
            <RawText style={styles.noteText}>{t('onboarding.nativeNote')}</RawText>
          </View>

          <RawText style={styles.fieldLabel}>{t('onboarding.targetLabel')}</RawText>
          <Pressable
            onPress={() => setPicker('target')}
            accessibilityRole="button"
            accessibilityLabel={t('onboarding.targetLabel')}
            testID="onboardingTargetPicker"
            style={({ pressed }) => [styles.targetRow, pressed && { opacity: 0.7 }]}
          >
            {targetLang != null ? (
              <View style={styles.targetValueWrap}>
                <RawText style={styles.targetValue}>{targetLang.name}</RawText>
                <RawText style={styles.targetNative}>{targetLang.nativeName}</RawText>
              </View>
            ) : (
              <RawText style={styles.targetPlaceholder}>{t('onboarding.targetPlaceholder')}</RawText>
            )}
            <IconChevronRight size={16} color={theme.color.brand} />
          </Pressable>

          <View style={styles.premiumNote}>
            <RawText style={styles.premiumNoteText}>{t('onboarding.langPremiumNote')}</RawText>
          </View>

          {error != null && <RawText style={styles.error}>{error}</RawText>}
        </ScrollView>
        <View style={styles.footer}>
          <Button
            testID="onboardingPairContinue"
            title={t('onboarding.continue')}
            variant="primary"
            onPress={() => void submit()}
            disabled={target == null || busy}
          />
          <Pressable
            onPress={() => void abandon()}
            accessibilityRole="button"
            testID="onboardingPairSignOut"
            style={({ pressed }) => [styles.abandon, pressed && { opacity: 0.6 }]}
          >
            <RawText style={styles.abandonText}>{t('onboarding.pairSignOut')}</RawText>
          </Pressable>
        </View>
      </Screen>

      {/* One sheet, two fields — a second copy would mean two Portals fighting
          over the same layer. `languages` swaps with the mode: the native side
          offers only the locales the app ships a UI for. */}
      <LanguagePickerSheet
        visible={picker != null}
        current={(picker === 'native' ? native : target) ?? ''}
        languages={picker === 'native' ? LOCALIZED_LANGUAGES : targetLanguages}
        title={picker === 'native' ? t('onboarding.nativePickerTitle') : t('onboarding.langPickerTitle')}
        searchPlaceholder={t('onboarding.searchLanguages')}
        onSelect={(c) => {
          if (picker === 'native') chooseNative(c);
          else {
            setTarget(c);
            setPicker(null);
          }
        }}
        onClose={() => setPicker(null)}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts, radius } = theme;
  return {
    pad: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 16 },
    stepTitle: { fontFamily: fonts.serif.semibold, fontSize: 27, letterSpacing: -0.5, color: color.brandStrong, marginBottom: 6 },
    stepSub: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 21, color: color.textMuted, marginBottom: 24 },
    fieldLabel: { fontFamily: fonts.sans.semibold, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', color: color.textMuted, marginBottom: 8, marginTop: 8 },
    targetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.border, backgroundColor: color.surfaceCard },
    targetValueWrap: { flex: 1 },
    targetValue: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.textStrong },
    targetNative: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted, marginTop: 1 },
    targetPlaceholder: { flex: 1, fontFamily: fonts.sans.medium, fontSize: 15, color: color.textMuted },
    note: { flexDirection: 'row', gap: 8, backgroundColor: color.surfaceSunken, borderWidth: theme.borderWidth.thin, borderColor: color.border, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12, marginTop: 8 },
    noteText: { flex: 1, fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 19, color: color.textMuted },
    premiumNote: { flexDirection: 'row', gap: 8, backgroundColor: theme.color.brandTint, borderWidth: theme.borderWidth.thin, borderColor: theme.color.brandSoft, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12, marginTop: 20 },
    premiumNoteText: { flex: 1, fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 19, color: color.brand },
    error: { fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 19, color: color.danger, marginTop: 16 },
    footer: { paddingHorizontal: 28, paddingTop: 8, paddingBottom: 8, gap: 4 },
    abandon: { alignSelf: 'center', paddingVertical: 10 },
    abandonText: { fontFamily: fonts.sans.semibold, fontSize: 14, color: color.textMuted },
  };
});

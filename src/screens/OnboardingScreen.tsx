// OnboardingScreen (O-01…O-09) — the first-run narrative arc, assembled against
// onboarding/Onboarding.html. One paged flow: welcome → 6 story beats → language
// selection → notification opt-in, then hands off to the auth screen (O-10/O-11).
// Uses the shared illustrations, ProgressDots, Button, and ButtonRow.
import { useRouter } from 'expo-router';
import { type ComponentType, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { findLanguage, TRANSLATABLE_LANGUAGES } from '@/constants';
import { useTranslation } from '@/i18n';
import { useOnboardingStore } from '@/store/onboardingStore';
import {
  Button,
  ButtonRow,
  CardSorter,
  DailyPractice,
  ForgettingCurve,
  IconBell,
  IconChevronRight,
  IconMountain,
  IntervalTrack,
  LanguagePickerSheet,
  ProgressDots,
  RawText,
  Screen,
  SummitScene,
} from '@/ui';

// Native language is fixed to English at launch (only en/es UI locales exist);
// the target can be any translatable language except the native one.
const NATIVE_LANG = 'en';

// Story beats O-02…O-07 → (title, two paragraphs, illustration).
const STORY: { titleKey: string; aKey: string; bKey: string; Illustration: ComponentType }[] = [
  { titleKey: 's1Title', aKey: 's1a', bKey: 's1b', Illustration: DailyPractice },
  { titleKey: 's2Title', aKey: 's2a', bKey: 's2b', Illustration: ForgettingCurve },
  { titleKey: 's3Title', aKey: 's3a', bKey: 's3b', Illustration: IntervalTrack },
  { titleKey: 's4Title', aKey: 's4a', bKey: 's4b', Illustration: SummitScene },
  { titleKey: 's5Title', aKey: 's5a', bKey: 's5b', Illustration: CardSorter },
  { titleKey: 's6Title', aKey: 's6a', bKey: 's6b', Illustration: SummitScene },
];

const WELCOME = 0;
const STORY_START = 1; // steps 1..6
const LANG = 7;
const NOTIF = 8;

export function OnboardingScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const targetLanguages = useMemo(() => TRANSLATABLE_LANGUAGES.filter((l) => l.code.toLowerCase() !== NATIVE_LANG), []);
  const targetLang = target != null ? findLanguage(target) : undefined;
  const setLearningLang = useOnboardingStore((s) => s.setLearningLang);
  const setNotificationsEnabled = useOnboardingStore((s) => s.setNotificationsEnabled);

  const next = () => setStep((s) => Math.min(s + 1, NOTIF));
  const back = () => setStep((s) => Math.max(s - 1, 0));
  // O-06 choice → buffer (with the O-05 pair) → written transactionally by
  // complete_onboarding after auth succeeds (03 onboarding data flow).
  const finish = (notificationsEnabled: boolean) => {
    if (target != null) setLearningLang(target);
    setNotificationsEnabled(notificationsEnabled);
    router.replace('/auth');
  };

  if (step === WELCOME) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.welcome}>
          <View style={styles.welcomeHero}>
            <IconMountain size={64} color={theme.color.textOnAccent} />
          </View>
          <RawText style={styles.wordmark}>Lexicamp</RawText>
          <RawText style={styles.welcomeTitle}>{t('onboarding.welcomeTitle')}</RawText>
          <RawText style={styles.welcomeSub}>{t('onboarding.welcomeSub')}</RawText>
          <View style={styles.welcomeCta}>
            <Button title={t('onboarding.getStarted')} variant="primary" onPress={next} />
          </View>
        </View>
      </Screen>
    );
  }

  if (step >= STORY_START && step <= STORY_START + STORY.length - 1) {
    const i = step - STORY_START;
    const beat = STORY[i];
    const isLast = i === STORY.length - 1;
    const Illustration = beat.Illustration;
    return (
      <Screen edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.storyScroll} showsVerticalScrollIndicator={false}>
          <ProgressDots count={STORY.length} index={i} style={styles.dots} />
          <RawText style={styles.storyTitle}>{t(`onboarding.${beat.titleKey}`)}</RawText>
          <View style={styles.storyArt}><Illustration /></View>
          <RawText style={styles.storyPara}>{t(`onboarding.${beat.aKey}`)}</RawText>
          <RawText style={styles.storyPara}>{t(`onboarding.${beat.bKey}`)}</RawText>
        </ScrollView>
        <View style={styles.footer}>
          <ButtonRow
            left={{ title: t('onboarding.back'), onPress: back }}
            right={{ title: isLast ? t('onboarding.letsBegin') : t('onboarding.next'), onPress: next }}
          />
        </View>
      </Screen>
    );
  }

  if (step === LANG) {
    return (
      <>
        <Screen edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.pad} showsVerticalScrollIndicator={false}>
            <RawText style={styles.stepTitle}>{t('onboarding.langTitle')}</RawText>
            <RawText style={styles.stepSub}>{t('onboarding.langSub')}</RawText>

            <RawText style={styles.fieldLabel}>{t('onboarding.nativeLabel')}</RawText>
            <View style={styles.nativeRow}>
              <RawText style={styles.nativeText}>{t('languages.en')}</RawText>
            </View>

            <RawText style={styles.fieldLabel}>{t('onboarding.targetLabel')}</RawText>
            <Pressable
              onPress={() => setPicker(true)}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.targetLabel')}
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
          </ScrollView>
          <View style={styles.footer}>
            <ButtonRow
              left={{ title: t('onboarding.back'), onPress: back }}
              right={{ title: t('onboarding.continue'), onPress: next, disabled: target == null }}
            />
          </View>
        </Screen>

        <LanguagePickerSheet
          visible={picker}
          current={target ?? ''}
          languages={targetLanguages}
          title={t('onboarding.langPickerTitle')}
          searchPlaceholder={t('onboarding.searchLanguages')}
          onSelect={(c) => { setTarget(c); setPicker(false); }}
          onClose={() => setPicker(false)}
        />
      </>
    );
  }

  // NOTIF
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.notif}>
        <View style={styles.notifHero}>
          <IconBell size={48} color={theme.color.brand} />
        </View>
        <RawText style={styles.stepTitleCentered}>{t('onboarding.notifTitle')}</RawText>
        <RawText style={styles.notifBody}>{t('onboarding.notifBody')}</RawText>
      </View>
      <View style={styles.footer}>
        <Button title={t('onboarding.enableNotif')} variant="primary" onPress={() => finish(true)} />
        <Pressable onPress={() => finish(false)} style={({ pressed }) => [styles.maybeLater, pressed && { opacity: 0.6 }]} accessibilityRole="button">
          <RawText style={styles.maybeLaterText}>{t('onboarding.maybeLater')}</RawText>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts, radius } = theme;
  return {
    welcome: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    welcomeHero: { width: 96, height: 96, borderRadius: 30, backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 24, boxShadow: theme.shadow.accent },
    wordmark: { fontFamily: fonts.sans.extra, fontSize: 30, letterSpacing: -0.6, color: color.brandStrong, marginBottom: 20 },
    welcomeTitle: { fontFamily: fonts.serif.semibold, fontSize: 26, lineHeight: 33, color: color.brandStrong, textAlign: 'center' },
    welcomeSub: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 21, color: color.textMuted, textAlign: 'center', marginTop: 12 },
    welcomeCta: { alignSelf: 'stretch', position: 'absolute', bottom: 24, left: 32, right: 32 },

    storyScroll: { paddingHorizontal: 28, paddingTop: 24, paddingBottom: 16 },
    dots: { marginBottom: 24 },
    storyTitle: { fontFamily: fonts.serif.semibold, fontSize: 27, lineHeight: 33, letterSpacing: -0.5, color: color.brandStrong, marginBottom: 20 },
    storyArt: { alignItems: 'center', marginBottom: 22 },
    storyPara: { fontFamily: fonts.sans.regular, fontSize: 15, lineHeight: 25, color: color.textBody, marginBottom: 12 },

    footer: { paddingHorizontal: 28, paddingTop: 8, paddingBottom: 8, gap: 8 },

    pad: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 16 },
    stepTitle: { fontFamily: fonts.serif.semibold, fontSize: 27, letterSpacing: -0.5, color: color.brandStrong, marginBottom: 6 },
    stepTitleCentered: { fontFamily: fonts.serif.semibold, fontSize: 26, lineHeight: 32, letterSpacing: -0.5, color: color.brandStrong, textAlign: 'center', marginBottom: 12 },
    stepSub: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 21, color: color.textMuted, marginBottom: 24 },
    fieldLabel: { fontFamily: fonts.sans.semibold, fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase', color: color.textMuted, marginBottom: 8, marginTop: 8 },
    nativeRow: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.border, backgroundColor: color.surfaceSunken },
    nativeText: { fontFamily: fonts.sans.medium, fontSize: 15, color: color.textMuted },
    targetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1.5, borderColor: color.border, backgroundColor: color.surfaceCard },
    targetValueWrap: { flex: 1 },
    targetValue: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.textStrong },
    targetNative: { fontFamily: fonts.sans.regular, fontSize: 13, color: color.textMuted, marginTop: 1 },
    targetPlaceholder: { flex: 1, fontFamily: fonts.sans.medium, fontSize: 15, color: color.textMuted },
    premiumNote: { flexDirection: 'row', gap: 8, backgroundColor: theme.palette.blue[50], borderWidth: theme.borderWidth.thin, borderColor: theme.palette.blue[100], borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12, marginTop: 20 },
    premiumNoteText: { flex: 1, fontFamily: fonts.sans.regular, fontSize: 13, lineHeight: 19, color: color.brand },

    notif: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    notifHero: { width: 96, height: 96, borderRadius: 48, backgroundColor: color.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
    notifBody: { fontFamily: fonts.sans.regular, fontSize: 15, lineHeight: 24, color: color.textBody, textAlign: 'center' },
    maybeLater: { alignSelf: 'center', paddingVertical: 10 },
    maybeLaterText: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.textMuted },
  };
});

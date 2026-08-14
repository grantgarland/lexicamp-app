// OnboardingScreen (O-01…O-09) — the first-run narrative arc, assembled against
// onboarding/Onboarding.html. One paged flow: welcome → 5 story beats → language
// selection → notification opt-in, then hands off to the auth screen (O-10/O-11).
// Uses the shared illustrations, ProgressDots, Button, and ButtonRow.
import { useRouter } from 'expo-router';
import { type ComponentType, useMemo, useState, useEffect } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { findLanguage, LOCALIZED_LANGUAGES, TRANSLATABLE_LANGUAGES } from '@/constants';
import { useTranslation } from '@/i18n';
import { useLogEvent } from '@/query/hooks';
import { requestPushPermission } from '@/notifications/push';
import { useOnboardingStore } from '@/store/onboardingStore';
import {
  Button,
  ButtonRow,
  CardSorter,
  ForgettingCurveInfo,
  IconBell,
  IconChevronRight,
  IntervalTrack,
  MountainRoute,
  ReminderPreview,
  OnboardingShot,
  type OnboardingShotName,
  Wordmark,
  LanguagePickerSheet,
  ProgressDots,
  RawText,
  RouteSummary,
  Screen,
  SCREEN_MAX_WIDTH,
  SummitScene,
} from '@/ui';

// Native language is fixed to English at launch (only en/es UI locales exist);
// the target can be any translatable language except the native one.
const NATIVE_LANG = 'en';

// Story beats O-02…O-06 → (title, ONE supporting line, optional footnote, art).
//
// Visual-first (Casey 2026-08-05): the beats used to carry two paragraphs each,
// which nobody reads on a first run. Now the art IS the argument and the copy is
// a caption under it. The old "catch it before it slips" beat is gone — beat 1
// now names the forgetting curve outright, which is the same claim.
//
// `shot` names a captured in-app screenshot shown INSTEAD of the vector
// illustration; `Illustration` stays as the fallback the shot degrades to
// (OnboardingShot renders `children` for any name it has no asset for).
// `OnboardingShotName` is derived from the files that actually exist, so naming
// an uncaptured one is a TYPE ERROR rather than a broken bundle — deliberate,
// because Metro resolves `require()` at bundle time and a missing asset fails
// the BUILD, not the render (see the note atop ui/OnboardingShot.tsx).
//
// `noteKey` is the footnote the body's `*` points at — the two beats that
// introduce a term of art (memory strength, FSRS) and the one that makes a
// research claim have to say where it comes from, quietly.
/** `Illustration` is a zero-prop ComponentType, but RouteSummary renders LABELS
 *  and those have to be translated. Wrapping it here keeps the copy in i18n
 *  (where the en/es parity test can see it) instead of baking English into the
 *  art — and keeps STORY's shape uniform. */
function RouteSummaryArt() {
  const { t } = useTranslation();
  return (
    <RouteSummary
      stages={[t('onboarding.s6Stage1'), t('onboarding.s6Stage2'), t('onboarding.s6Stage3')]}
      summit={t('onboarding.s6Summit')}
    />
  );
}

// ORDER (Casey 2026-08-08): the summit claim opens the arc. "3,000 words is 95%
// of everyday speech" is the only beat that states a DESTINATION, and it earns
// the rest — a forgetting curve is a problem worth solving only once you know
// what you are climbing toward. The three method beats then answer it in turn,
// and s6 closes by naming the whole loop.
const STORY: {
  titleKey: string;
  bodyKey: string;
  noteKey?: string;
  Illustration: ComponentType;
  shot?: OnboardingShotName;
}[] = [
  { titleKey: 's5Title', bodyKey: 's5Body', Illustration: SummitScene, shot: 'projection' },
  { titleKey: 's1Title', bodyKey: 's1Body', noteKey: 's1Note', Illustration: ForgettingCurveInfo },
  { titleKey: 's2Title', bodyKey: 's2Body', noteKey: 's2Note', Illustration: CardSorter, shot: 'wordlist' },
  { titleKey: 's3Title', bodyKey: 's3Body', Illustration: IntervalTrack, shot: 'quiz' },
  { titleKey: 's4Title', bodyKey: 's4Body', noteKey: 's4Note', Illustration: SummitScene, shot: 'results' },
  // Closing beat: what the app IS, after four beats of why. Vector art rather
  // than a shot on purpose — there is no single screen that shows the whole
  // loop, and a screenshot of one of them would under-claim it.
  { titleKey: 's6Title', bodyKey: 's6Body', Illustration: RouteSummaryArt },
];

const WELCOME = 0;
const STORY_START = 1; // steps 1..5
const LANG = STORY_START + STORY.length; // 6
const NOTIF = LANG + 1; // 7

export function OnboardingScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  // O-01 hero: 75% of the device width (Casey 2026-08-05), clamped to the
  // centred content column so a tablet doesn't get a billboard.
  const wordmarkWidth = Math.min(windowWidth, SCREEN_MAX_WIDTH) * 0.75;
  const [step, setStep] = useState(0);
  // 3.4: activation-funnel start — completion is logged server-side by
  // complete_onboarding's word/deck writes; this bookends the funnel.
  const logEvent = useLogEvent();
  useEffect(() => {
    logEvent('onboarding_started');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // O-05 pair. Native defaults to English — the one side that keeps capture on
  // Azure's dictionary path (pairs are X↔en, 16 §1) — but is now selectable
  // across the locales whose UI we actually ship.
  const [native, setNative] = useState<string>(NATIVE_LANG);
  const [target, setTarget] = useState<string | null>(null);
  // Which field the shared picker sheet is currently editing (null = closed).
  const [picker, setPicker] = useState<'native' | 'target' | null>(null);
  const targetLanguages = useMemo(
    () => TRANSLATABLE_LANGUAGES.filter((l) => l.code.toLowerCase() !== native.toLowerCase()),
    [native],
  );
  const nativeLang = findLanguage(native);
  const targetLang = target != null ? findLanguage(target) : undefined;
  const setNativeLang = useOnboardingStore((s) => s.setNativeLang);
  const setTargetLang = useOnboardingStore((s) => s.setTargetLang);
  const setNotificationsEnabled = useOnboardingStore((s) => s.setNotificationsEnabled);

  const next = () => setStep((s) => Math.min(s + 1, NOTIF));
  const back = () => setStep((s) => Math.max(s - 1, 0));
  // Skip jumps the story act — the beats are the pitch, not a gate. It lands on
  // LANG (the first step that collects something) rather than finishing, so a
  // skipper still leaves with a language pair.
  const skip = () => setStep(LANG);
  // The pair must stay distinct (complete_onboarding rejects native = learning),
  // so picking a native that matches the target clears the target.
  const chooseNative = (code: string) => {
    setNative(code);
    if (target != null && target.toLowerCase() === code.toLowerCase()) setTarget(null);
    setPicker(null);
  };
  // O-06 choice → buffer (with the O-05 pair) → written transactionally by
  // complete_onboarding after auth succeeds (03 onboarding data flow).
  const finish = async (notificationsEnabled: boolean) => {
    setNativeLang(native);
    if (target != null) setTargetLang(target);
    // Raise the OS prompt HERE, in the screen that explains why — not silently
    // after auth on the Home screen. The buffered flag still drives token
    // registration post-auth; a denied prompt just means no token later.
    if (notificationsEnabled) {
      const granted = await requestPushPermission().catch(() => false);
      setNotificationsEnabled(granted);
    } else {
      setNotificationsEnabled(false);
    }
    router.replace('/auth');
  };

  if (step === WELCOME) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.welcome}>
          {/* The official lockup IS the hero (Casey 2026-08-05) — the accent tile
              above it was a second, lower-fidelity logo competing with it — and
              it is sized from the VIEWPORT (75%), not a fixed pt value, so it
              lands the same on an SE as on a Pro Max. */}
          <View style={styles.wordmarkWrap}>
            <Wordmark width={wordmarkWidth} />
          </View>
          <RawText style={styles.welcomeTitle}>{t('onboarding.welcomeTitle')}</RawText>
          <RawText style={styles.welcomeSub}>{t('onboarding.welcomeSub')}</RawText>
          {/* The route up the mountain, drawn faintly under the pitch: five
              camps, summit in accent. Ambient, not illustrative — it should
              register as texture, not as a diagram to read. */}
          <View style={styles.welcomeArt} pointerEvents="none">
            <MountainRoute maxWidth={wordmarkWidth} />
          </View>
          <View style={styles.welcomeCta}>
            <Button testID="onboardingGetStarted" title={t('onboarding.getStarted')} variant="primary" onPress={next} />
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
        <View style={styles.storyHeader}>
          <ProgressDots count={STORY.length} index={i} />
          <Pressable
            onPress={skip}
            accessibilityRole="button"
            testID="onboardingSkip"
            hitSlop={12}
            style={({ pressed }) => [styles.skip, pressed && { opacity: 0.6 }]}
          >
            <RawText style={styles.skipText}>{t('onboarding.skip')}</RawText>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.storyScroll} showsVerticalScrollIndicator={false}>
          <RawText style={styles.storyTitle}>{t(`onboarding.${beat.titleKey}`)}</RawText>
          <RawText style={styles.storyBody}>{t(`onboarding.${beat.bodyKey}`)}</RawText>
          <View style={styles.storyArt}>
            {beat.shot != null ? (
              <OnboardingShot name={beat.shot}>
                <Illustration />
              </OnboardingShot>
            ) : (
              <Illustration />
            )}
          </View>
          {beat.noteKey != null && (
            <RawText style={styles.storyNote}>{t(`onboarding.${beat.noteKey}`)}</RawText>
          )}
        </ScrollView>
        <View style={styles.footer}>
          <ButtonRow
            left={{ title: t('onboarding.back'), onPress: back, testID: 'onboardingBack' }}
            right={{ title: isLast ? t('onboarding.letsBegin') : t('onboarding.next'), onPress: next, testID: 'onboardingNext' }}
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

            {/* Both fields are the SAME control (Casey 2026-08-05) — native used to
                be a flat read-only row, which read as "broken dropdown" sitting
                above a real one. */}
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
            {/* Two locales is a short list, and a short list reads as a bug
                unless you say it's temporary. Same card shape as the Premium
                note below, in the neutral palette — this is information, not an
                upsell. */}
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
          </ScrollView>
          <View style={styles.footer}>
            <ButtonRow
              left={{ title: t('onboarding.back'), onPress: back }}
              right={{ title: t('onboarding.continue'), onPress: next, disabled: target == null }}
            />
          </View>
        </Screen>

        {/* One sheet, two fields — mounting a second copy would mean two Portals
            fighting over the same layer. `languages` swaps with the mode: the
            native side offers only the locales the app ships a UI for. */}
        <LanguagePickerSheet
          visible={picker != null}
          current={(picker === 'native' ? native : target) ?? ''}
          languages={picker === 'native' ? LOCALIZED_LANGUAGES : targetLanguages}
          title={picker === 'native' ? t('onboarding.nativePickerTitle') : t('onboarding.langPickerTitle')}
          searchPlaceholder={t('onboarding.searchLanguages')}
          onSelect={(c) => {
            if (picker === 'native') chooseNative(c);
            else { setTarget(c); setPicker(null); }
          }}
          onClose={() => setPicker(null)}
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
        {/* Show the thing being asked for. The card is drawn, not captured —
            see ReminderPreview for why a simulator can't produce a real banner. */}
        <View style={styles.notifPreview}>
          <ReminderPreview
            title={t('onboarding.notifPreviewTitle')}
            body={t('onboarding.notifPreviewBody')}
            now={t('onboarding.notifPreviewNow')}
          />
        </View>
      </View>
      <View style={styles.footer}>
        <Button title={t('onboarding.enableNotif')} variant="primary" onPress={() => void finish(true)} />
        <Pressable onPress={() => void finish(false)} style={({ pressed }) => [styles.maybeLater, pressed && { opacity: 0.6 }]} accessibilityRole="button">
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
    wordmarkWrap: { marginBottom: 28 },
    welcomeArt: { marginTop: 36, opacity: 0.8 },
    welcomeTitle: { fontFamily: fonts.serif.semibold, fontSize: 26, lineHeight: 33, color: color.brandStrong, textAlign: 'center' },
    welcomeSub: { fontFamily: fonts.sans.regular, fontSize: 14, lineHeight: 21, color: color.textMuted, textAlign: 'center', marginTop: 12 },
    welcomeCta: { alignSelf: 'stretch', position: 'absolute', bottom: 24, left: 32, right: 32 },

    // Dots and Skip share a row so Skip sits on the status-bar line, clear of the
    // scrolling content underneath it.
    storyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28, paddingTop: 20, paddingBottom: 4 },
    skip: { paddingVertical: 6, paddingLeft: 12 },
    skipText: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.textMuted },
    // flexGrow + a flexing art block centres the screenshot in whatever space is
    // left under the copy, instead of stranding it against a tall bottom gap.
    storyScroll: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 16, paddingBottom: 8, alignItems: 'center' },
    // LEFT, not centred (Casey 2026-08-08). These are instructional headers on
    // the skippable beats: they wrap to two or three lines in en and longer in
    // es, and a centred multi-line serif header gives every beat a different
    // ragged silhouette. Flush-left they start at the same x as the dots above
    // and the buttons below, so the eye lands in one place across all six.
    storyTitle: { alignSelf: 'stretch', fontFamily: fonts.serif.semibold, fontSize: 27, lineHeight: 33, letterSpacing: -0.5, color: color.brandStrong, textAlign: 'left', marginBottom: 10 },
    // Left too, for the same reason as the title above it — and because a
    // flush-left header over centred body copy reads as a layout bug rather
    // than a choice. Title, body and note now share one left edge.
    storyBody: { alignSelf: 'stretch', fontFamily: fonts.sans.regular, fontSize: 15, lineHeight: 23, color: color.textBody, textAlign: 'left', marginBottom: 20 },
    storyArt: { alignSelf: 'stretch', flex: 1, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
    // The `*` in the body points here. Faint on purpose: it is a citation, not a
    // second sentence competing with the caption above the art.
    storyNote: { alignSelf: 'stretch', fontFamily: fonts.sans.regular, fontSize: 11.5, lineHeight: 16, color: color.textFaint, textAlign: 'center', marginTop: 4 },

    footer: { paddingHorizontal: 28, paddingTop: 8, paddingBottom: 8, gap: 8 },

    pad: { paddingHorizontal: 24, paddingTop: 32, paddingBottom: 16 },
    stepTitle: { fontFamily: fonts.serif.semibold, fontSize: 27, letterSpacing: -0.5, color: color.brandStrong, marginBottom: 6 },
    stepTitleCentered: { fontFamily: fonts.serif.semibold, fontSize: 26, lineHeight: 32, letterSpacing: -0.5, color: color.brandStrong, textAlign: 'center', marginBottom: 12 },
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

    notif: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    notifHero: { width: 96, height: 96, borderRadius: 48, backgroundColor: color.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
    notifBody: { fontFamily: fonts.sans.regular, fontSize: 15, lineHeight: 24, color: color.textBody, textAlign: 'center' },
    notifPreview: { alignSelf: 'stretch', marginTop: 28 },
    maybeLater: { alignSelf: 'center', paddingVertical: 10 },
    maybeLaterText: { fontFamily: fonts.sans.semibold, fontSize: 15, color: color.textMuted },
  };
});

// OnboardingScreen — step 1 of 3.5's register-first flow (spec `24`).
//
// ONE screen: wordmark, a one-line promise, and the two auth CTAs. That is the
// whole pre-auth surface now.
//
// WHAT THIS REPLACED, and why (DF-1, Casey 2026-07-20; ratified 2026-08-20):
// this screen used to run EIGHT steps before the user could register — a welcome,
// five story beats, the language pair, and a notification opt-in. The ruling is
// register FIRST, as fast as possible: minimal critical data is the
// initial-investment hook, and users skip multi-step text walkthroughs.
//
// ⚠️ NOT zero screens. A cold sign-up wall with no promise converts worse than a
// one-liner, and someone arriving from a link has nothing else telling them what
// this is. Hence one value screen, then auth.
//
// WHERE THE FIVE BEATS WENT: their copy is deliberately still in i18n
// (`onboarding.s1*`…`s6*`). Spec `24` recycles them as the SCRIPT for the
// post-auth problem→solution module (step 4 of the target flow), which is not
// built yet because its GIF/video assets do not exist (`24` → Open, item 1).
// ⚠️ Do not delete those keys as "unused" — they are the module's script.
//
// The language pair moved AFTER auth to `OnboardingPairScreen`; the notification
// opt-in moved out of onboarding entirely, to a post-first-save prompt. Asking
// for push before the user owns a single word is asking to be denied, and iOS
// allows exactly one permission prompt per install.
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useTranslation } from '@/i18n';
import { useLogEvent } from '@/query/hooks';
import { Button, MountainRoute, RawText, Screen, SCREEN_MAX_WIDTH, Wordmark } from '@/ui';

export function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  // Hero sized from the VIEWPORT (75%), not a fixed pt value, so it lands the
  // same on an SE as on a Pro Max — clamped to the centred content column so a
  // tablet doesn't get a billboard.
  const wordmarkWidth = Math.min(windowWidth, SCREEN_MAX_WIDTH) * 0.75;

  // 3.4: opens the activation funnel. Unchanged by the reorder — spec `24`
  // measures this redesign with the events that already exist, and the number
  // that matters is first launch → first `word_saved`.
  const logEvent = useLogEvent();
  useEffect(() => {
    logEvent('onboarding_started');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.root}>
        <View style={styles.wordmarkWrap}>
          <Wordmark width={wordmarkWidth} />
        </View>
        <RawText style={styles.title}>{t('onboarding.welcomeTitle')}</RawText>
        {/* The promise. One line, because the next tap is the sign-up wall and
            anything longer competes with it. */}
        <RawText style={styles.promise}>{t('onboarding.valuePromise')}</RawText>
        {/* The route up the mountain, faint. Ambient texture, not a diagram. */}
        <View style={styles.art} pointerEvents="none">
          <MountainRoute maxWidth={wordmarkWidth} />
        </View>
      </View>
      <View style={styles.footer}>
        <Button
          testID="onboardingCreateAccount"
          title={t('auth.createAccount')}
          variant="primary"
          onPress={() => router.push('/auth')}
        />
        {/* Sign-in is the returning user's door and must not be buried — a
            reinstalling subscriber who cannot find it looks like a lost
            subscription. `mode=signin` opens AuthScreen already switched. */}
        <Button
          testID="onboardingSignIn"
          title={t('auth.signIn')}
          variant="secondary"
          onPress={() => router.push('/auth?mode=signin')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts } = theme;
  return {
    root: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
    wordmarkWrap: { marginBottom: 28 },
    title: {
      fontFamily: fonts.serif.semibold,
      fontSize: 26,
      lineHeight: 33,
      color: color.brandStrong,
      textAlign: 'center',
    },
    promise: {
      fontFamily: fonts.sans.regular,
      fontSize: 15,
      lineHeight: 23,
      color: color.textBody,
      textAlign: 'center',
      marginTop: 12,
    },
    art: { marginTop: 36, opacity: 0.8 },
    footer: { paddingHorizontal: 28, paddingTop: 8, paddingBottom: 8, gap: 8 },
  };
});

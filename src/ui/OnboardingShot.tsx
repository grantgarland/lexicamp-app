// OnboardingShot — an in-app screenshot presented as instructional art in the
// onboarding story beats (Casey 2026-08-02: "instructional graphics of the app
// in-use").
//
// Shots are captured by .maestro/capture-onboarding-shots.yaml, not by hand, so
// the set can be re-cut whenever the UI moves. A stale onboarding graphic is
// worse than none: it teaches a screen that no longer exists.
//
// ⚠️ METRO RESOLVES `require()` AT BUNDLE TIME. A `require` naming a file that
// isn't committed fails the BUILD — no try/catch can rescue it, because nothing
// runs. (Learned the hard way 2026-08-04: the first version wrapped the requires
// in try/catch expecting a runtime fallback and simply broke the bundler.)
// So SHOTS may only ever name files that exist on disk. Until a capture is
// committed, the beat keeps its vector illustration — which is why SHOTS starts
// empty rather than pre-declaring the four planned names.
//
// ── Adding a shot (all three steps, or the build breaks) ────────────────────
//   1. Commit the PNG to assets/images/onboarding/ (e.g. onboarding-home.png).
//   2. Add its line to SHOTS below, with a STATIC literal path.
//   3. Add `shot: 'home'` to the matching beat in STORY (OnboardingScreen.tsx).
// Skipping 1 breaks the bundle. Skipping 2 or 3 just leaves the vector art.
import type { ReactNode } from 'react';
import { Image, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

/** Captured shots that EXIST on disk. Static literals only — Metro cannot
 *  resolve a computed path, and an absent file is a build failure. */
const SHOTS = {
  // home: require('../../assets/images/onboarding/onboarding-home.png'),
  // search: require('../../assets/images/onboarding/onboarding-search.png'),
  // quiz: require('../../assets/images/onboarding/onboarding-quiz.png'),
  // progress: require('../../assets/images/onboarding/onboarding-progress.png'),
  // projection: require('../../assets/images/onboarding/onboarding-projection.png'),
} as const;

export type OnboardingShotName = keyof typeof SHOTS;

/** Renders the captured shot in a soft device frame so it reads as "this is the
 *  app" rather than as a full-bleed illustration. Falls back to `children` (the
 *  beat's vector illustration) whenever the name isn't in SHOTS yet, so a
 *  partial set never leaves a hole in onboarding. */
export function OnboardingShot({ name, children }: { name: OnboardingShotName; children?: ReactNode }) {
  const source = (SHOTS as Record<string, number | undefined>)[name as string];
  if (source == null) return <>{children}</>;
  return (
    <View style={styles.frame}>
      <Image source={source} style={styles.shot} resizeMode="contain" accessibilityIgnoresInvertColors />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    alignSelf: 'center',
    borderRadius: 22,
    borderWidth: theme.borderWidth.base,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceCard,
    padding: 6,
    overflow: 'hidden',
  },
  shot: { width: 208, height: 420, borderRadius: 16 },
}));

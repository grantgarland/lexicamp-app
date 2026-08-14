// OnboardingShot — an in-app screenshot presented as instructional art in the
// onboarding story beats (Casey 2026-08-02: "instructional graphics of the app
// in-use"). The beats are visual-first: one short line of copy under a real
// screen, rather than two paragraphs describing it.
//
// EVERY SHOT IS A CROP (Casey 2026-08-05). A whole-device screenshot proves
// "this is the app", but a phone screen rendered inside a phone screen is ~6×
// down — on a real device nobody could read the quiz card or the projection
// figure, which are the whole point of those beats. So each shot is cut down to
// the UI that carries the argument and blown up to the content column instead.
//
// APPEARANCE-AWARE: each shot is a PAIR (light + dark). A light screenshot on
// the dark canvas reads as a photo of somebody else's phone, so the dark
// capture is what makes this look native rather than pasted in.
//
// Shots are captured BY HAND, once per appearance (light + dark). There used to
// be a Maestro flow that cut the whole set automatically; it was retired on
// 2026-08-06 — `.maestro/` is a test suite, and a flow that asserts nothing and
// only takes screenshots does not belong in a nightly. A stale onboarding
// graphic is still worse than none (it teaches a screen that no longer exists),
// so re-cut the affected shots whenever the UI they show moves.
//
// ⚠️ METRO RESOLVES `require()` AT BUNDLE TIME. A `require` naming a file that
// isn't committed fails the BUILD — no try/catch can rescue it, because nothing
// runs. (Learned the hard way 2026-08-04: the first version wrapped the requires
// in try/catch expecting a runtime fallback and simply broke the bundler.)
// So SHOTS may only ever name files that exist on disk.
//
// ── Adding a shot (all three steps, or the build breaks) ────────────────────
//   1. Commit BOTH PNGs to assets/images/onboarding/ (…-name.png + …-name-dark.png).
//   2. Add its line to SHOTS below, with STATIC literal paths, and set `ratio`
//      to the committed pixel ratio (w/h) — the frame is sized from it, so a
//      wrong number letterboxes the art inside its own card.
//   3. Add `shot: 'name'` to the matching beat in STORY (OnboardingScreen.tsx).
// Skipping 1 breaks the bundle. Skipping 2 or 3 just leaves the vector art.
import type { ReactNode } from 'react';
import { Image, useWindowDimensions, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { useIsDark } from '@/theme/appearance';

import { SCREEN_MAX_WIDTH } from './Screen';

interface Shot {
  light: number;
  dark: number;
  /** Committed pixel width ÷ height. The frame is sized from this. */
  ratio: number;
  /** Draw the card shell around the crop? FALSE when the captured UI already
   *  brings its own container (the quiz card, the projection cards) — a card
   *  inside a card is a double border and reads as a screenshot pasted onto the
   *  screen. TRUE for flat content like the word list, where the shell is the
   *  only thing separating rows from the canvas. */
  frame: boolean;
}

/** Captured shots that EXIST on disk. Static literals only — Metro cannot
 *  resolve a computed path, and an absent file is a build failure. */
const SHOTS = {
  wordlist: {
    light: require('../../assets/images/onboarding/onboarding-wordlist.png'),
    dark: require('../../assets/images/onboarding/onboarding-wordlist-dark.png'),
    ratio: 900 / 755,
    frame: true,
  },
  quiz: {
    light: require('../../assets/images/onboarding/onboarding-quiz.png'),
    dark: require('../../assets/images/onboarding/onboarding-quiz-dark.png'),
    ratio: 900 / 1347,
    frame: false,
  },
  results: {
    light: require('../../assets/images/onboarding/onboarding-results.png'),
    dark: require('../../assets/images/onboarding/onboarding-results-dark.png'),
    ratio: 900 / 559,
    frame: true,
  },
  // Re-cut from the Projection tab's **Summit** pill (it was the "Next camp"
  // view, which showed a 100-word A2 threshold). The beat it serves opens the
  // arc with "3,000 words is 95% of everyday speech", so the shot has to show
  // the 3,000-word summit line — a next-camp crop argued for a different number
  // than the sentence above it.
  //
  // Re-cut a second time after `MOCK_CAPTURE_PER_DAY` went to 17 (data/mock.ts).
  // At the old 1.0-word/day fixture the same view read **8.3 years**, which is a
  // deterrent to open an onboarding arc with; it now reads **7 months**. If that
  // constant moves again, this pair is stale — re-cut it.
  projection: {
    light: require('../../assets/images/onboarding/onboarding-projection.png'),
    dark: require('../../assets/images/onboarding/onboarding-projection-dark.png'),
    ratio: 900 / 1056,
    frame: false,
  },
} as const satisfies Record<string, Shot>;

export type OnboardingShotName = keyof typeof SHOTS;

/** Horizontal padding the story beats use (OnboardingScreen `storyScroll`). */
const GUTTER = 28;
/** Ceiling on how much of the viewport a shot may eat. Tall crops (the quiz
 *  card + its rating gutter) hit this and get narrowed; wide ones never do. */
const MAX_VIEWPORT_HEIGHT = 0.5;

/** Renders the captured shot for the current appearance. Falls back to
 *  `children` (the beat's vector illustration) whenever the name isn't in SHOTS
 *  yet, so a partial set never leaves a hole in onboarding. */
export function OnboardingShot({ name, children }: { name: OnboardingShotName; children?: ReactNode }) {
  const isDark = useIsDark();
  const { width: winW, height: winH } = useWindowDimensions();
  const shot = (SHOTS as Record<string, Shot | undefined>)[name as string];
  if (shot == null) return <>{children}</>;
  const source = isDark ? shot.dark : shot.light;

  // Full content width, unless that would make a tall crop swallow the screen.
  let width = Math.min(winW, SCREEN_MAX_WIDTH) - GUTTER * 2;
  let height = width / shot.ratio;
  const cap = winH * MAX_VIEWPORT_HEIGHT;
  if (height > cap) {
    height = cap;
    width = height * shot.ratio;
  }

  const image = (
    <Image source={source} style={[styles.shot, { width, height }]} resizeMode="contain" accessibilityIgnoresInvertColors />
  );
  // Frameless crops sit straight on the canvas — their own capture background
  // is the same canvas colour in the same appearance, so the seam is invisible.
  if (!shot.frame) return image;
  return <View style={styles.frame}>{image}</View>;
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    alignSelf: 'center',
    borderRadius: 16,
    borderWidth: theme.borderWidth.base,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceCard,
    overflow: 'hidden',
  },
  shot: { borderRadius: 14 },
}));

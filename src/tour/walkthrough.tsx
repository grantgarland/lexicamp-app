// First-run walkthrough (18 §Phase F / §2d) — an 8-step spotlight tour over the
// core loop, built on @wrack/react-native-tour-guide (F1 decision, 2026-07-17).
//
// Design decisions:
// - GUIDED TRAVERSAL in USER-JOURNEY ORDER (Casey rulings, 2026-07-17): the
//   tour walks the path a real user takes — Home → capture (Search overlay) →
//   Word List → Home → INSIDE the quiz → Progress — opening each real screen
//   and spotlighting where the action happens. The user acts AFTER the tour
//   (ratified: "guided traversal, act after" — no pause/resume state machine).
//   Orchestration is central in `onStepChange` (fires for Next, Back, AND
//   backdrop advances); arriving steps carry delayBefore so anchors measure
//   after navigation/animation settles.
// - QUIZ MODAL LAYERING: the quiz is a native fullScreenModal that paints
//   ABOVE a Modal presented from the tabs tree. The overlay is therefore
//   mounted through scoped hosts — `WalkthroughOverlayHost scope="main"` in
//   the tabs layout, scope="quiz" INSIDE the quiz screen — exactly one host
//   renders the overlay at a time, chosen by the current step's scope.
// - Targets are module-level refs (`tourTargets`) attached at render sites;
//   a single app instance makes createRef fine and avoids prop-drilling.
// - AUTO-START is live-mode only (`USE_SUPABASE`): the smoke EAS profile builds
//   mock mode, so the Maestro boot flow can never be blocked by the overlay
//   (F-verify contract). Mock/dev previews the tour via the "See how Lexicamp
//   works" CTA inside the How-it-works accordion (Home educator card +
//   Settings sheet), which also lets any user re-watch it.
// - Completion/skip both persist `walkthroughDone` (prefsStore) — the tour
//   never auto-fires twice.
import { createContext, createRef, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import type { View } from 'react-native';
import {
  TourGuideProvider,
  TourGuideOverlay,
  useTourGuide,
  type TourGuideConfig,
  type TourStep,
} from '@wrack/react-native-tour-guide';

import { USE_SUPABASE } from '@/data';
import { useTranslation } from '@/i18n';
import { useLogEvent, useProfile } from '@/query/hooks';
import { usePrefsStore } from '@/store/prefsStore';
import { useUiStore } from '@/store/uiStore';
import { lightTheme as appTheme } from '@/theme/theme';

// Marker context: lets tour components no-op when rendered WITHOUT the
// provider (component tests mount screens bare; the lib's hook throws).
const InsideWalkthrough = createContext(false);

export function WalkthroughProvider({ children }: { children: ReactNode }) {
  return (
    <TourGuideProvider>
      <InsideWalkthrough.Provider value>{children}</InsideWalkthrough.Provider>
    </TourGuideProvider>
  );
}

/** Spotlight targets, attached at render sites across the journey. */
export const tourTargets = {
  studyCard: createRef<View>(), // Home hero (w1 + w5)
  fab: createRef<View>(), // TabBar capture FAB (w2)
  searchInput: createRef<View>(), // Search overlay input (w3)
  wordsToolbar: createRef<View>(), // Word List search/filter bar (w4)
  quizGutter: createRef<View>(), // Quiz reveal/rating gutter (w6)
  progressTab: createRef<View>(), // TabBar Progress button (w8)
};

/** Steps whose overlay must render INSIDE the quiz fullScreenModal. */
const QUIZ_SCOPE = new Set(['w6', 'w7']);

/** Is the walkthrough currently running? (Home forces its "Today's review"
 *  card variant while true — w1/w5 must never point at a missing element.)
 *  Safe outside the provider (tests): reports false. */
export function useWalkthroughActive(): boolean {
  const inside = useContext(InsideWalkthrough);
  // Hook order is stable: `inside` never changes for a mounted tree.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return inside ? useTourGuide().isActive : false;
}

// Tooltip/backdrop skinned to the kit — rides the tour CONFIG (the lib's
// theming surface is color-config, not components).
const TOOLTIP_STYLES = {
  backgroundColor: appTheme.color.surfaceCard,
  borderRadius: 12,
  titleColor: appTheme.color.textStrong,
  descriptionColor: appTheme.color.textBody,
  primaryButtonColor: appTheme.color.accent,
  buttonTextColor: '#ffffff',
  skipButtonColor: appTheme.color.textMuted,
};
const SPOTLIGHT_STYLES = { overlayOpacity: 0.62, overlayColor: '#0e1624', enablePulse: false };

// Delay before auto-start: lets the Home scroll view settle so first-measure
// hits final layout (the lib retries measures, this just avoids visible jumps).
const AUTO_START_DELAY_MS = 900;
// Post-navigation settle before measuring a traversal step's anchor.
const NAV_SETTLE_MS = 350;
// The quiz fullScreenModal takes longer to present than an in-tab switch.
const QUIZ_SETTLE_MS = 700;

/**
 * Mount ONCE inside the provider (tabs layout). Auto-starts the tour on the
 * first authenticated, onboarded Home mount when `walkthroughDone` is false
 * (live mode only — see header); also serves Settings → Replay requests.
 */
export function WalkthroughController({ activeTab }: { activeTab: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { startTour, isActive } = useTourGuide();
  const profile = useProfile();
  const walkthroughDone = usePrefsStore((s) => s.walkthroughDone);
  const setWalkthroughDone = usePrefsStore((s) => s.setWalkthroughDone);
  const replayRequested = useUiStore((s) => s.walkthroughRequested);
  const setReplayRequested = useUiStore((s) => s.setWalkthroughRequested);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);
  const logEvent = useLogEvent(); // 3.4 funnel emits
  // Tracks where the tour IS, for end-of-tour cleanup (skip can fire mid-quiz).
  const lastStepIdRef = useRef('w1');

  // 8 steps in user-journey order (Casey, 2026-07-17). Keys w1–w8.
  const steps: TourStep[] = [
    // w1 — Home base. The Home screen FORCES the "Today's review" card variant
    //      while the tour is active (see HomeScreen) — most new users are
    //      caught-up/empty, and the step must not point at a card that isn't there.
    { id: 'w1', targetRef: tourTargets.studyCard, title: t('walkthrough.w1Title'), description: t('walkthrough.w1Body') },
    // w2 — the capture FAB; advancing OPENS the search overlay.
    { id: 'w2', targetRef: tourTargets.fab, title: t('walkthrough.w2Title'), description: t('walkthrough.w2Body'), spotlightBorderRadius: 29 },
    // w3 — ON the Search screen: where to search + one-tap save (act after).
    { id: 'w3', targetRef: tourTargets.searchInput, title: t('walkthrough.w3Title'), description: t('walkthrough.w3Body'), delayBefore: NAV_SETTLE_MS },
    // w4 — ON the Word List: search/filter/details toolbar.
    // w4's scene is pre-warmed during w3 (see applyStepScene) — the lib's ref
    // validation is synchronous at step change, so the anchor must pre-exist.
    { id: 'w4', targetRef: tourTargets.wordsToolbar, title: t('walkthrough.w4Title'), description: t('walkthrough.w4Body'), delayBefore: NAV_SETTLE_MS },
    // w5 — back Home: Study now starts the session; advancing opens the quiz.
    { id: 'w5', targetRef: tourTargets.studyCard, title: t('walkthrough.w5Title'), description: t('walkthrough.w5Body'), delayBefore: NAV_SETTLE_MS },
    // w6 — INSIDE the quiz: the reveal/rate gutter + honest-rating advice.
    //      (Fresh accounts see the quiz empty state — no anchor mounts and the
    //      tooltip centers; the copy still lands.)
    { id: 'w6', targetRef: tourTargets.quizGutter, title: t('walkthrough.w6Title'), description: t('walkthrough.w6Body'), delayBefore: QUIZ_SETTLE_MS },
    // w7 — still in the quiz, centered: session results explained.
    { id: 'w7', title: t('walkthrough.w7Title'), description: t('walkthrough.w7Body') },
    // w8 — Progress, with the screen open behind the highlighted tab.
    { id: 'w8', targetRef: tourTargets.progressTab, title: t('walkthrough.w8Title'), description: t('walkthrough.w8Body'), delayBefore: NAV_SETTLE_MS },
  ];

  // Journey orchestration: what the app must LOOK like at each step. Applied on
  // every step change in either direction (Next, Back, backdrop advances).
  const applyStepScene = (fromId: string | undefined, toId: string) => {
    // Quiz modal boundary first (present/dismiss before in-tab navigation).
    const fromQuiz = fromId != null && QUIZ_SCOPE.has(fromId);
    const toQuiz = QUIZ_SCOPE.has(toId);
    if (!fromQuiz && toQuiz) router.push('/quiz');
    if (fromQuiz && !toQuiz) router.back();
    switch (toId) {
      case 'w1':
      case 'w2':
      case 'w5':
        setSearchOpen(false);
        router.navigate('/');
        break;
      case 'w3':
        // Open the search overlay AND switch the tab UNDERNEATH it to Words.
        // The overlay covers the scenes, so the switch is invisible — but it
        // forces expo-router to mount the lazy Words scene NOW. The lib
        // validates w4's targetRef synchronously at step change (delayBefore
        // only postpones measurement), so the toolbar must already be mounted
        // when w4 begins; this pre-warm is what guarantees it.
        router.navigate('/words');
        setSearchOpen(true);
        break;
      case 'w4':
        setSearchOpen(false);
        router.navigate('/words');
        break;
      case 'w8':
        router.navigate('/progress');
        break;
      // w6/w7: inside the quiz — the modal boundary above did the work.
    }
  };

  const config: TourGuideConfig = {
    tooltipStyles: TOOLTIP_STYLES,
    spotlightStyles: SPOTLIGHT_STYLES,
    showProgressDots: true,
    showStepCounter: false,
    nextButtonText: t('walkthrough.next'),
    prevButtonText: t('walkthrough.back'),
    skipButtonText: t('walkthrough.skip'),
    doneButtonText: t('walkthrough.done'),
    enableAccessibility: true,
    // Backdrop taps advance (never dismiss silently — the Skip button is the
    // explicit exit, so a stray tap can't kill the tour and mark it done).
    defaultBackdropBehavior: 'next',
    // Traversal driver — see applyStepScene above.
    onStepChange: (from, to) => {
      applyStepScene(steps[from]?.id, steps[to]?.id ?? '');
      lastStepIdRef.current = steps[to]?.id ?? '';
    },
    // Completed OR skipped → done either way; the tour must never auto-fire
    // twice. Cleanup: close whatever the traversal opened. A completed tour
    // ends on Progress (w8); an early skip returns Home.
    onTourEnd: (completed) => {
      logEvent(completed ? 'walkthrough_completed' : 'walkthrough_skipped', { lastStep: lastStepIdRef.current });
      setWalkthroughDone(true);
      setSearchOpen(false);
      if (QUIZ_SCOPE.has(lastStepIdRef.current)) router.back(); // skip mid-quiz → dismiss it
      if (!completed) router.navigate('/');
    },
  };

  const onboarded = profile?.onboardingComplete === true;
  const shouldAutoStart = USE_SUPABASE && onboarded && !walkthroughDone && activeTab === 'home' && !isActive;

  useEffect(() => {
    if (!shouldAutoStart) return;
    const id = setTimeout(() => {
      logEvent('walkthrough_started', { trigger: 'auto' });
      startTour(steps, config);
    }, AUTO_START_DELAY_MS);
    return () => clearTimeout(id);
    // steps/config are rebuilt per render (i18n) but only the gate matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoStart]);

  // Replay requests (works in every mode, incl. mock/dev). BUG FIX (Casey,
  // 2026-07-17): resetting the flag BEFORE the timer re-ran this effect and its
  // cleanup cleared the pending timeout — startTour never fired. The flag now
  // resets inside the timer, in the same tick the tour starts.
  useEffect(() => {
    if (!replayRequested || isActive) return;
    const id = setTimeout(() => {
      setReplayRequested(false);
      logEvent('walkthrough_started', { trigger: 'replay' });
      startTour(steps, config);
    }, 350); // let the sheet close + nav-to-Home settle
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayRequested, isActive]);

  return null;
}

/**
 * Scoped overlay host. The quiz is a native fullScreenModal that paints ABOVE
 * a Modal presented from the tabs tree, so the overlay must be re-homed while
 * the tour is on quiz steps: the tabs layout mounts scope="main", the quiz
 * screen mounts scope="quiz", and exactly one renders the real overlay.
 */
export function WalkthroughOverlayHost({ scope }: { scope: 'main' | 'quiz' }) {
  const inside = useContext(InsideWalkthrough);
  if (!inside) return null; // bare-mounted in tests → no-op
  return <OverlayHostInner scope={scope} />;
}
// iOS refuses to present an RN Modal while a native-stack modal transition is
// in flight — presenting the tour Modal during the quiz push/dismiss animation
// silently dropped it on-device (overlay gone, tour untraversable). Each host
// therefore waits out the transition before (re)presenting its Modal whenever
// it BECOMES the active host.
const HOST_PRESENT_DELAY_MS = { quiz: 650, main: 450 } as const;
function OverlayHostInner({ scope }: { scope: 'main' | 'quiz' }) {
  const { isActive, currentStep, activeSteps } = useTourGuide();
  const onQuizStep = isActive && QUIZ_SCOPE.has(activeSteps[currentStep]?.id ?? '');
  const shouldShow = isActive && (scope === 'quiz') === onQuizStep;
  const [presented, setPresented] = useState(false);
  const everShownRef = useRef(false);
  // Drop the presentation the moment this host stops being active (render-adjust,
  // not an effect — resetting state in an effect triggers cascading renders).
  if (!shouldShow && presented) setPresented(false);
  useEffect(() => {
    if (!shouldShow) {
      everShownRef.current = false;
      return;
    }
    // Delay only the hand-off presentations; once presented, step changes
    // within the same scope keep the Modal up (no flicker).
    const id = setTimeout(() => {
      everShownRef.current = true;
      setPresented(true);
    }, everShownRef.current ? 0 : HOST_PRESENT_DELAY_MS[scope]);
    return () => clearTimeout(id);
  }, [shouldShow, scope]);
  if (!shouldShow || !presented) return null;
  return <TourGuideOverlay />;
}

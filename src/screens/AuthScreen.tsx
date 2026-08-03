// AuthScreen (O-10 / O-11) — account creation + sign-in, assembled against the auth
// beats in onboarding/Onboarding.html. One screen with a sign-up ↔ sign-in toggle:
// an Apple continue button, email/password, and the mode switch. Email auth is REAL
// when the Supabase source is active (USE_SUPABASE); mock mode keeps the old
// route-straight-in behavior so dev flows need no network. The Apple button stays
// decorative until native OAuth config lands (see src/auth/session.ts). Google
// sign-in will not be supported (product decision 2026-07-27).
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Linking, Pressable, ScrollView, useColorScheme, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { authErrorKey, localAuthErrorKey } from '@/auth/errorMessages';
import { LEGAL_URLS } from '@/constants/legal';
import {
  AppleSignInCancelled,
  isAppleSignInAvailable,
  requestPasswordReset,
  signInWithApple,
  signInWithEmail,
  signUpWithEmail,
} from '@/auth/session';
import { dataSource, USE_SUPABASE } from '@/data';
import { supabase } from '@/data/supabase/client';
import { defaultDisplayName } from '@/domain/derive';
import { useTranslation } from '@/i18n';
import { registerForPush } from '@/notifications/push';
import { useOnboardingStore } from '@/store/onboardingStore';
import { Button, IconStar, Input, RawText, Screen, Wordmark } from '@/ui';

// 'forgot' (DF-3): request a password-reset email. The emailed link deep-links
// back into /reset-password (see auth/useRecoveryLink) — this mode only sends.
type Mode = 'signup' | 'signin' | 'forgot';

export function AuthScreen() {
  const { theme } = useUnistyles();
  const isDark = useColorScheme() === 'dark';
  const { t } = useTranslation();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signup');
  // Apple's sheet only exists on iOS 13+; hide the button anywhere it can't run
  // rather than showing a control that throws on press.
  const [appleAvailable, setAppleAvailable] = useState(false);
  // Apple is the advertised happy path; the email form stays collapsed behind a
  // secondary CTA until asked for (Casey 2026-08-01). Auto-open when Apple is
  // unavailable so email is never hidden behind a button that isn't there.
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Forgot flow: the address the reset link was sent to (null = not sent yet).
  const [resetSentTo, setResetSentTo] = useState<string | null>(null);

  const isSignup = mode === 'signup';
  const isForgot = mode === 'forgot';
  // Email is the secondary path: visible once requested, or unconditionally when
  // Apple isn't an option (Android/older iOS) or we're mid password-reset.
  const showEmailForm = emailOpen || !appleAvailable || isForgot;
  const enter = () => router.replace('/');

  useEffect(() => {
    let alive = true;
    void isAppleSignInAvailable().then((ok) => {
      if (alive) setAppleAvailable(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setResetSentTo(null);
  };

  // DF-3: the old handler just routed into the app ("forgot password logged me
  // in" — prod dogfood 2026-07-20). Now it actually sends the recovery email.
  const sendReset = async () => {
    const addr = email.trim();
    const localKey = localAuthErrorKey({ email, requirePassword: false });
    if (localKey != null) return setError(t(localKey));
    if (!USE_SUPABASE) return setResetSentTo(addr); // mock: pretend-send
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(addr);
      setResetSentTo(addr);
    } catch (e) {
      setError(t(authErrorKey(e instanceof Error ? e.message : null)));
    } finally {
      setBusy(false);
    }
  };

  // Shared tail for BOTH auth paths (email + Apple): materialize the onboarding
  // buffer (03 flow), arm push, then enter. The RPC is idempotent and never
  // overwrites, so calling after sign-IN is safe too — it only fills the gap for
  // accounts that somehow lack a profile.
  const finishAuth = async (displayName: string) => {
    const ob = useOnboardingStore.getState();
    await dataSource.completeOnboarding({
      nativeLang: ob.nativeLang,
      targetLang: ob.targetLang ?? 'es', // O-05 default if the buffer is cold (direct sign-in path)
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
      notificationsEnabled: ob.notificationsEnabled,
      // 18 §A7 (D1): never leave a profile blank — Apple supplies a real name on
      // first sign-in, email falls back to a prettified local-part.
      displayName,
    });
    // O-06 opt-in → OS permission prompt + device token registration (2.5).
    // Fire-and-forget: a denied prompt must not block entry into the app.
    if (ob.notificationsEnabled) void registerForPush().catch(() => {});
    ob.reset();
    enter();
  };

  const submit = async () => {
    if (!USE_SUPABASE) return enter(); // mock mode: no network
    // Catch the obvious cases locally — an empty form used to reach GoTrue and
    // come back as "Anonymous sign-ins are disabled".
    const localKey = localAuthErrorKey({ email, password, requirePassword: true });
    if (localKey != null) return setError(t(localKey));
    setBusy(true);
    setError(null);
    try {
      if (isSignup) await signUpWithEmail(email.trim(), password);
      else await signInWithEmail(email.trim(), password);
      await finishAuth(defaultDisplayName(email.trim()));
    } catch (e) {
      setError(t(authErrorKey(e instanceof Error ? e.message : null)));
    } finally {
      setBusy(false);
    }
  };

  // Native Sign in with Apple. Apple returns the user's name ONLY on the very
  // first sign-in for an Apple ID, so seed the profile with it when present and
  // fall back to the relay/private email's local-part otherwise.
  const submitApple = async () => {
    if (!USE_SUPABASE) return enter(); // mock mode: no network
    setBusy(true);
    setError(null);
    try {
      const { displayName } = await signInWithApple();
      const { data } = await supabase.auth.getUser();
      await finishAuth(displayName ?? defaultDisplayName(data.user?.email ?? ''));
    } catch (e) {
      if (e instanceof AppleSignInCancelled) return; // user backed out — no error UI
      setError(t(authErrorKey(e instanceof Error ? e.message : null)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.wordmarkWrap}>
          <Wordmark width={196} />
        </View>
        <RawText style={styles.title}>
          {t(isForgot ? 'auth.forgotTitle' : isSignup ? 'auth.createTitle' : 'auth.welcomeBack')}
        </RawText>
        <RawText style={styles.sub}>
          {isForgot
            ? resetSentTo != null
              ? t('auth.forgotSent', { email: resetSentTo })
              : t('auth.forgotSub')
            : t(isSignup ? 'auth.createSub' : 'auth.welcomeBackSub')}
        </RawText>

        {!isForgot && (
          <>
            {appleAvailable && (
              <>
                {/* Apple's OWN button component — guarantees the mark, wordmark,
                    corner radius and localized label match the HIG. A custom
                    look-alike is a review risk and loses instant recognition. */}
                <View style={styles.social}>
                  <AppleAuthentication.AppleAuthenticationButton
                    buttonType={
                      isSignup
                        ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
                        : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
                    }
                    buttonStyle={
                      isDark
                        ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                        : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                    }
                    cornerRadius={theme.radius.md}
                    style={styles.appleButton}
                    onPress={() => {
                      // Apple's native button requires a non-optional handler,
                      // so gate inside rather than passing undefined.
                      if (!busy) void submitApple();
                    }}
                  />
                </View>

                {/* The divider stays put whether the email path is still
                    collapsed or expanded — dropping it on expand let the Apple
                    button collide with the Email label (reported 2026-08-02). */}
                <View style={styles.divider}>
                  <View style={styles.line} />
                  <RawText style={styles.or}>{t('auth.or')}</RawText>
                  <View style={styles.line} />
                </View>
                {!emailOpen && (
                  <Button
                    title={t('auth.continueEmail')}
                    variant="secondary"
                    onPress={() => setEmailOpen(true)}
                  />
                )}
              </>
            )}
          </>
        )}

        {showEmailForm && !(isForgot && resetSentTo != null) && (
          <Input label={t('auth.email')} placeholder={t('auth.emailPlaceholder')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        )}
        {showEmailForm && !isForgot && (
          <>
            <View style={styles.gap} />
            <Input label={t('auth.password')} placeholder={t(isSignup ? 'auth.passwordCreate' : 'auth.passwordEnter')} value={password} onChangeText={setPassword} secureTextEntry />
          </>
        )}

        {showEmailForm && mode === 'signin' && (
          <Pressable onPress={() => switchMode('forgot')} hitSlop={8} style={({ pressed }) => [styles.forgot, pressed && { opacity: 0.6 }]} accessibilityRole="button">
            <RawText style={styles.forgotText}>{t('auth.forgot')}</RawText>
          </Pressable>
        )}

        {error != null && <RawText style={styles.error}>{error}</RawText>}

        <View style={styles.cta}>
          {isForgot ? (
            resetSentTo != null ? (
              <Button title={t('auth.backToSignIn')} variant="primary" onPress={() => switchMode('signin')} />
            ) : (
              <Button title={busy ? t('auth.working') : t('auth.forgotSend')} variant="primary" onPress={busy ? undefined : sendReset} />
            )
          ) : showEmailForm ? (
            <Button
              title={busy ? t('auth.working') : t(isSignup ? 'auth.createAccount' : 'auth.signIn')}
              variant="primary"
              onPress={busy ? undefined : submit}
            />
          ) : null}
        </View>

        <View style={styles.switchRow}>
          {isForgot ? (
            resetSentTo == null && (
              <Pressable onPress={() => switchMode('signin')} hitSlop={6} accessibilityRole="button">
                <RawText style={styles.switchLink}>{t('auth.backToSignIn')}</RawText>
              </Pressable>
            )
          ) : (
            <>
              <RawText style={styles.switchLabel}>{t(isSignup ? 'auth.haveAccount' : 'auth.noAccount')} </RawText>
              <Pressable onPress={() => switchMode(isSignup ? 'signin' : 'signup')} hitSlop={6} accessibilityRole="button">
                <RawText style={styles.switchLink}>{t(isSignup ? 'auth.signIn' : 'auth.createAccount')}</RawText>
              </Pressable>
            </>
          )}
        </View>

        {/* Real, tappable legal links — App Store review checks that the privacy
            policy is reachable, and "agree to our Terms" is only meaningful if
            the user can actually read them. */}
        <View style={styles.legalRow}>
          <IconStar size={12} color={theme.color.textFaint} />
          <RawText style={styles.legal}>
            {t('auth.legalPrefix')}
            <RawText style={styles.legalLink} onPress={() => void Linking.openURL(LEGAL_URLS.terms)}>
              {t('auth.legalTerms')}
            </RawText>
            {t('auth.legalAnd')}
            <RawText style={styles.legalLink} onPress={() => void Linking.openURL(LEGAL_URLS.privacy)}>
              {t('auth.legalPrivacy')}
            </RawText>
            {t('auth.legalSuffix')}
          </RawText>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts } = theme;
  return {
    scroll: { paddingHorizontal: 24, paddingTop: 40, paddingBottom: 24 },
    wordmarkWrap: { alignItems: 'center', marginBottom: 26 },
    title: { fontFamily: fonts.serif.semibold, fontSize: 26, letterSpacing: -0.5, color: color.brandStrong, textAlign: 'center', marginBottom: 6 },
    sub: { fontFamily: fonts.sans.regular, fontSize: 14, color: color.textMuted, textAlign: 'center', marginBottom: 26 },

    appleButton: { width: '100%', height: 50 },
    social: { gap: 10 },
    divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 22 },
    line: { flex: 1, height: theme.borderWidth.thin, backgroundColor: color.border },
    or: { fontFamily: fonts.sans.medium, fontSize: 12, color: color.textMuted },

    gap: { height: 16 },
    error: { fontFamily: fonts.sans.medium, fontSize: 13, color: color.danger, textAlign: 'center', marginTop: 14 },
    forgot: { alignSelf: 'flex-end', marginTop: 14 },
    forgotText: { fontFamily: fonts.sans.semibold, fontSize: 13, color: color.brand },
    cta: { marginTop: 24 },

    switchRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 20 },
    switchLabel: { fontFamily: fonts.sans.regular, fontSize: 14, color: color.textMuted },
    switchLink: { fontFamily: fonts.sans.bold, fontSize: 14, color: color.brand },

    legalRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 24 },
    legal: { fontFamily: fonts.sans.regular, fontSize: 11, color: color.textFaint, textAlign: 'center' },
    legalLink: { fontFamily: fonts.sans.semibold, fontSize: 11, color: color.textLink, textDecorationLine: 'underline' },
  };
});

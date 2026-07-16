// AuthScreen (O-10 / O-11) — account creation + sign-in, assembled against the auth
// beats in onboarding/Onboarding.html. One screen with a sign-up ↔ sign-in toggle:
// social continue buttons, email/password, and the mode switch. Email auth is REAL
// when the Supabase source is active (USE_SUPABASE); mock mode keeps the old
// route-straight-in behavior so dev flows need no network. Social buttons stay
// decorative until native OAuth config lands (see src/auth/session.ts).
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { signInWithEmail, signUpWithEmail } from '@/auth/session';
import { dataSource, USE_SUPABASE } from '@/data';
import { defaultDisplayName } from '@/domain/derive';
import { useTranslation } from '@/i18n';
import { registerForPush } from '@/notifications/push';
import { useOnboardingStore } from '@/store/onboardingStore';
import { Button, IconStar, Input, RawText, Screen } from '@/ui';

type Mode = 'signup' | 'signin';

export function AuthScreen() {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === 'signup';
  const enter = () => router.replace('/');

  const submit = async () => {
    if (!USE_SUPABASE) return enter(); // mock mode: no network
    setBusy(true);
    setError(null);
    try {
      if (isSignup) await signUpWithEmail(email.trim(), password);
      else await signInWithEmail(email.trim(), password);
      // Materialize the onboarding buffer (03 flow). The RPC is idempotent and
      // never overwrites, so calling after sign-IN is safe too — it only fills
      // the gap for accounts that somehow lack a profile.
      const ob = useOnboardingStore.getState();
      await dataSource.completeOnboarding({
        nativeLang: ob.nativeLang,
        targetLang: ob.targetLang ?? 'es', // O-05 default if the buffer is cold (direct sign-in path)
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
        notificationsEnabled: ob.notificationsEnabled,
        // 18 §A7 (D1): seed a default name so profiles are never blank — Apple/
        // Google provider names slot in here when those auth flows land.
        displayName: defaultDisplayName(email.trim()),
      });
      // O-06 opt-in → OS permission prompt + device token registration (2.5).
      // Fire-and-forget: a denied prompt must not block entry into the app.
      if (ob.notificationsEnabled) void registerForPush().catch(() => {});
      ob.reset();
      enter();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('auth.genericError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <RawText style={styles.wordmark}>Lexicamp</RawText>
        <RawText style={styles.title}>{t(isSignup ? 'auth.createTitle' : 'auth.welcomeBack')}</RawText>
        <RawText style={styles.sub}>{t(isSignup ? 'auth.createSub' : 'auth.welcomeBackSub')}</RawText>

        <View style={styles.social}>
          <Button title={t('auth.continueApple')} variant="secondary" onPress={enter} />
          <Button title={t('auth.continueGoogle')} variant="secondary" onPress={enter} />
        </View>

        <View style={styles.divider}>
          <View style={styles.line} />
          <RawText style={styles.or}>{t('auth.or')}</RawText>
          <View style={styles.line} />
        </View>

        <Input label={t('auth.email')} placeholder={t('auth.emailPlaceholder')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
        <View style={styles.gap} />
        <Input label={t('auth.password')} placeholder={t(isSignup ? 'auth.passwordCreate' : 'auth.passwordEnter')} value={password} onChangeText={setPassword} secureTextEntry />

        {!isSignup && (
          <Pressable onPress={enter} hitSlop={8} style={({ pressed }) => [styles.forgot, pressed && { opacity: 0.6 }]} accessibilityRole="button">
            <RawText style={styles.forgotText}>{t('auth.forgot')}</RawText>
          </Pressable>
        )}

        {error != null && <RawText style={styles.error}>{error}</RawText>}

        <View style={styles.cta}>
          <Button
            title={busy ? t('auth.working') : t(isSignup ? 'auth.createAccount' : 'auth.signIn')}
            variant="primary"
            onPress={busy ? undefined : submit}
          />
        </View>

        <View style={styles.switchRow}>
          <RawText style={styles.switchLabel}>{t(isSignup ? 'auth.haveAccount' : 'auth.noAccount')} </RawText>
          <Pressable onPress={() => setMode(isSignup ? 'signin' : 'signup')} hitSlop={6} accessibilityRole="button">
            <RawText style={styles.switchLink}>{t(isSignup ? 'auth.signIn' : 'auth.createAccount')}</RawText>
          </Pressable>
        </View>

        <View style={styles.legalRow}>
          <IconStar size={12} color={theme.color.textFaint} />
          <RawText style={styles.legal}>{t('auth.legal')}</RawText>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts } = theme;
  return {
    scroll: { paddingHorizontal: 24, paddingTop: 40, paddingBottom: 24 },
    wordmark: { fontFamily: fonts.sans.extra, fontSize: 26, letterSpacing: -0.5, color: color.brandStrong, textAlign: 'center', marginBottom: 22 },
    title: { fontFamily: fonts.serif.semibold, fontSize: 26, letterSpacing: -0.5, color: color.brandStrong, textAlign: 'center', marginBottom: 6 },
    sub: { fontFamily: fonts.sans.regular, fontSize: 14, color: color.textMuted, textAlign: 'center', marginBottom: 26 },

    social: { gap: 10 },
    divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 20 },
    line: { flex: 1, height: theme.borderWidth.thin, backgroundColor: color.border },
    or: { fontFamily: fonts.sans.medium, fontSize: 12, color: color.textMuted },

    gap: { height: 14 },
    error: { fontFamily: fonts.sans.medium, fontSize: 13, color: color.danger, textAlign: 'center', marginTop: 14 },
    forgot: { alignSelf: 'flex-end', marginTop: 10 },
    forgotText: { fontFamily: fonts.sans.semibold, fontSize: 13, color: color.brand },
    cta: { marginTop: 20 },

    switchRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 20 },
    switchLabel: { fontFamily: fonts.sans.regular, fontSize: 14, color: color.textMuted },
    switchLink: { fontFamily: fonts.sans.bold, fontSize: 14, color: color.brand },

    legalRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 24 },
    legal: { fontFamily: fonts.sans.regular, fontSize: 11, color: color.textFaint, textAlign: 'center' },
  };
});

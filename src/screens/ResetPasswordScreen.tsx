// ResetPasswordScreen (DF-3) — the set-a-new-password step of the recovery
// flow. Reached ONLY via the emailed deep link (useRecoveryLink routes here
// after minting the recovery session). With no session (cold open, expired
// link) it shows the expired state instead of a form that would 401.
// Mock mode: form works and simply routes home (no backend to update).
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { authErrorKey } from '@/auth/errorMessages';
import { updatePassword, useSession } from '@/auth/session';
import { USE_SUPABASE } from '@/data';
import { useTranslation } from '@/i18n';
import { useUiStore } from '@/store/uiStore';
import { Button, EmptyState, Input, RawText, Screen } from '@/ui';

export function ResetPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { session, isLoading } = useSession();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (USE_SUPABASE && isLoading) return <Screen edges={['top', 'bottom']}>{null}</Screen>;
  if (USE_SUPABASE && session == null) {
    // No recovery session — the link was expired/used, or the route was opened
    // directly. Only a fresh emailed link can mint the session this screen needs.
    return (
      <Screen edges={['top', 'bottom']}>
        <EmptyState
          title={t('auth.resetExpiredTitle')}
          body={t('auth.resetExpiredBody')}
          cta={t('auth.resetRequestNew')}
          onCta={() => router.replace('/auth')}
        />
      </Screen>
    );
  }

  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length > 0 && password === confirm && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (USE_SUPABASE) await updatePassword(password);
      useUiStore.getState().showToast({ variant: 'success', message: t('auth.resetSuccess') });
      // The recovery session IS a signed-in session — straight into the app.
      router.replace('/');
    } catch (e) {
      // Route through the same mapper AuthScreen uses: GoTrue's raw English
      // ("Password should be at least 6 characters") must never reach the UI,
      // least of all a Spanish user's.
      setError(t(authErrorKey(e instanceof Error ? e.message : null)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <RawText style={styles.wordmark}>Lexicamp</RawText>
        <RawText style={styles.title}>{t('auth.resetTitle')}</RawText>
        <RawText style={styles.sub}>{t('auth.resetSub')}</RawText>

        <Input
          label={t('auth.newPassword')}
          placeholder={t('auth.newPasswordPlaceholder')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
        />
        <View style={styles.gap} />
        <Input
          label={t('auth.confirmPassword')}
          placeholder={t('auth.confirmPasswordPlaceholder')}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoCapitalize="none"
          error={mismatch ? t('auth.passwordMismatch') : undefined}
        />

        {error != null && <RawText style={styles.error}>{error}</RawText>}

        <View style={styles.gapLarge} />
        <Button
          title={busy ? t('auth.working') : t('auth.resetSave')}
          variant="primary"
          onPress={canSubmit ? submit : undefined}
        />
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
    gap: { height: 14 },
    gapLarge: { height: 20 },
    error: { fontFamily: fonts.sans.medium, fontSize: 13, color: color.danger, textAlign: 'center', marginTop: 14 },
  };
});

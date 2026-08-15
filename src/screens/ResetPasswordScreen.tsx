// ResetPasswordScreen (DF-3) — the set-a-new-password step of the recovery
// flow. Reached ONLY via the emailed deep link (useRecoveryLink routes here
// after minting the recovery session). With no session (cold open, expired
// link) it shows the expired state instead of a form that would 401.
// Mock mode: form works and simply routes home (no backend to update).
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { authErrorKey, localPasswordErrorKey, MIN_PASSWORD_LENGTH } from '@/auth/errorMessages';
import { signOut, updatePassword, useSession } from '@/auth/session';
import { USE_SUPABASE } from '@/data';
import { useTranslation } from '@/i18n';
import { useUiStore } from '@/store/uiStore';
import { Button, EmptyState, IconX, Input, RawText, Screen, Wordmark } from '@/ui';

export function ResetPasswordScreen() {
  const { theme } = useUnistyles();
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

  // Abandoning the reset must ALSO drop the recovery session, not just navigate.
  // That session is a real signed-in one (it is what authenticates
  // updatePassword), so leaving it alive behind an exit would turn the emailed
  // link into a way into the account WITHOUT setting a password — open link,
  // tap X, walk into the app. Until this screen had an exit, finishing the form
  // was the only way off it, so the session was always earned; the exit is what
  // makes the sign-out load-bearing rather than tidy.
  const cancel = () => {
    if (busy) return;
    // Best-effort: a failed sign-out must not trap the user on this screen — the
    // whole point of the control is that it always gets them out.
    if (USE_SUPABASE) void signOut().catch(() => {});
    router.replace('/auth');
  };

  const submit = async () => {
    if (busy) return;
    // Pre-flight FIRST, exactly as AuthScreen does. The Save button used to go
    // inert until the form was valid, which left the two commonest mistakes —
    // an empty field and a too-short password — with nothing to say for
    // themselves: the button simply didn't respond.
    const localKey = localPasswordErrorKey({ password, confirm });
    if (localKey != null) return setError(t(localKey));
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
      {/* The only way off this screen that isn't "set a password". The route is
          registered with gestureEnabled:false and no header, so without this
          control the emailed link is a one-way door (reported by Casey). */}
      <View style={styles.header}>
        <Pressable
          onPress={cancel}
          hitSlop={10}
          style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel={t('auth.backToSignIn')}
          testID="resetCancel"
        >
          <IconX size={18} color={theme.color.textMuted} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {/* The real lockup, as on AuthScreen — this was the word "Lexicamp" set
            in sans ExtraBold, which is not the wordmark in any weight. */}
        <View style={styles.wordmarkWrap}>
          <Wordmark width={196} />
        </View>
        <RawText style={styles.title}>{t('auth.resetTitle')}</RawText>
        <RawText style={styles.sub}>{t('auth.resetSub')}</RawText>

        <Input
          label={t('auth.newPassword')}
          placeholder={t('auth.newPasswordPlaceholder')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          testID="resetPassword"
          // State the rule up front rather than letting GoTrue deliver it as a
          // refusal after a round trip.
          hint={t('auth.passwordHint', { min: MIN_PASSWORD_LENGTH })}
        />
        <View style={styles.gap} />
        <Input
          label={t('auth.confirmPassword')}
          placeholder={t('auth.confirmPasswordPlaceholder')}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoCapitalize="none"
          testID="resetConfirm"
          error={mismatch ? t('auth.passwordMismatch') : undefined}
        />

        {error != null && <RawText style={styles.error}>{error}</RawText>}

        <View style={styles.cta}>
          <Button
            title={busy ? t('auth.working') : t('auth.resetSave')}
            variant="primary"
            testID="resetSubmit"
            onPress={busy ? undefined : submit}
          />
        </View>

        {/* Second exit, in the place AuthScreen's forgot mode puts the same
            link — the X is fast, this one is legible. */}
        <View style={styles.switchRow}>
          <Pressable onPress={cancel} hitSlop={6} accessibilityRole="button">
            <RawText style={styles.switchLink}>{t('auth.backToSignIn')}</RawText>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create((theme) => {
  const { color, fonts } = theme;
  return {
    // Header sits OUTSIDE the ScrollView, so the exit stays put while the form
    // scrolls under the keyboard.
    //
    // RIGHT-anchored, like every other close × in the app (Paywall, Quiz). Not a
    // style preference: DevBadge is a zIndex:9999 pill pinned to left:8 on the
    // reasoning that "top-left only overlaps non-interactive header text". A
    // left-anchored × sits underneath it, and the only exit from this screen is
    // unreachable in every dev build — which is where this flow gets tested.
    header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 6 },
    closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surfaceSunken },

    // Everything below matches AuthScreen — same screen, same step of the flow.
    // The exception is paddingTop: AuthScreen's 40 measures from the safe area,
    // and here the 38pt header already covers most of that.
    scroll: { paddingHorizontal: 24, paddingTop: 14, paddingBottom: 24 },
    wordmarkWrap: { alignItems: 'center', marginBottom: 26 },
    title: { fontFamily: fonts.serif.semibold, fontSize: 26, letterSpacing: -0.5, color: color.brandStrong, textAlign: 'center', marginBottom: 6 },
    sub: { fontFamily: fonts.sans.regular, fontSize: 14, color: color.textMuted, textAlign: 'center', marginBottom: 26 },
    gap: { height: 16 },
    error: { fontFamily: fonts.sans.medium, fontSize: 13, color: color.danger, textAlign: 'center', marginTop: 14 },
    cta: { marginTop: 24 },
    switchRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 20 },
    switchLink: { fontFamily: fonts.sans.bold, fontSize: 14, color: color.brand },
  };
});

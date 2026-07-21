// useRecoveryLink (DF-3) — mounts once at the root; turns a password-recovery
// deep link into a session + the /reset-password screen. Two signals, either
// may fire first:
//  1. The URL itself (Linking.useURL covers cold start AND warm foreground):
//     parse tokens → supabase.auth.setSession → route. This is the working
//     path because the client sets `detectSessionInUrl: false`.
//  2. supabase-js's PASSWORD_RECOVERY auth event — defensive: if a future
//     config change lets the SDK consume the URL itself, we still route.
// Stale/used links arrive as error params → toast, and the user stays wherever
// they were (the Auth screen's forgot flow can issue a fresh link).
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect, useRef } from 'react';

import { supabase } from '@/data/supabase/client';
import { USE_SUPABASE } from '@/data';
import { useTranslation } from '@/i18n';
import { useUiStore } from '@/store/uiStore';

import { parseRecoveryUrl } from './recovery';

export function useRecoveryLink(): void {
  const router = useRouter();
  const { t } = useTranslation();
  const url = Linking.useURL();
  // A URL object is stable per delivery, but guard against effect re-runs
  // (e.g. theme/locale re-renders) re-consuming the same one-shot tokens.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!USE_SUPABASE) return; // mock mode: no auth backend to recover against
    if (url == null || handled.current === url) return;
    const parsed = parseRecoveryUrl(url);
    if (parsed.status === 'none') return;
    handled.current = url;

    if (parsed.status === 'error') {
      useUiStore.getState().showToast({ variant: 'warning', message: t('auth.recoveryLinkError') });
      return;
    }
    void supabase.auth
      .setSession({ access_token: parsed.tokens.accessToken, refresh_token: parsed.tokens.refreshToken })
      .then(({ error }) => {
        if (error) {
          useUiStore.getState().showToast({ variant: 'warning', message: t('auth.recoveryLinkError') });
          return;
        }
        router.replace('/reset-password');
      });
  }, [url, router, t]);

  useEffect(() => {
    if (!USE_SUPABASE) return;
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') router.replace('/reset-password');
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);
}

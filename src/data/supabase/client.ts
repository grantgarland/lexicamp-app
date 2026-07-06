// Supabase client — one instance app-wide. Session persists via AsyncStorage
// (auto-refresh on). URL + anon key are PUBLISHABLE values (RLS is the security
// boundary, 03/16), so committed defaults are safe; env vars override for other
// environments (e.g. a future staging project).
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://wtscflpwxqwpciwtsdid.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_geZHp6NdZZUfx_t55mStfg_CxN3EaX-';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No web URL callbacks in a native app; deep-link flows handle their own codes.
    detectSessionInUrl: false,
  },
});

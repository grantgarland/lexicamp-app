// The active data source. USE_SUPABASE flips the whole app to the real backend
// (auth + PostgREST + Edge Functions); default stays the scenario-driven mock so
// dev flows and the DevBadge keep working offline. Set in .env.local:
//   EXPO_PUBLIC_USE_SUPABASE=1
// Nothing else changes — query hooks depend only on the DataSource interface.
import type { DataSource } from './DataSource';
import { mockDataSource } from './mock';
import { supabaseDataSource } from './supabase/SupabaseDataSource';

export const USE_SUPABASE = process.env.EXPO_PUBLIC_USE_SUPABASE === '1';

export const dataSource: DataSource = USE_SUPABASE ? supabaseDataSource : mockDataSource;
export type { DataSource, DeckCards, Engagement } from './DataSource';

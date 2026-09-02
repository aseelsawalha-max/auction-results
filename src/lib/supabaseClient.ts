import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Null when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY aren't set (e.g. a
 * fresh checkout before the Supabase project has been created). Callers must
 * check `isSupabaseConfigured` and show a setup message instead of using this
 * — there is no local fallback store, by design (see README).
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

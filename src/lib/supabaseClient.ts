import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export type AuthLinkType = 'invite' | 'recovery';

/**
 * Supabase invite/recovery email links redirect back to the app with the new
 * session's tokens *and* a `type` marker (`invite` | `recovery` | ...) in the
 * URL — as a `#...&type=invite` fragment for the implicit flow, or a
 * `?...&type=invite` query string for PKCE. Pure/exported for testing.
 */
export function parseAuthLinkType(hash: string, search: string): AuthLinkType | null {
  const fromHash = new URLSearchParams(hash.replace(/^#/, '')).get('type');
  const fromSearch = new URLSearchParams(search.replace(/^\?/, '')).get('type');
  const type = fromHash ?? fromSearch;
  return type === 'invite' || type === 'recovery' ? type : null;
}

/**
 * Captured at module load time, synchronously — before the `createClient`
 * call below kicks off `detectSessionInUrl`'s async handling, which strips
 * these params from the URL. If we read it any later (e.g. inside a React
 * effect), the signal is gone and an invited user lands straight in the
 * dashboard with no password ever set. See useAuth.tsx.
 */
export const pendingAuthLinkType: AuthLinkType | null =
  typeof window === 'undefined'
    ? null
    : parseAuthLinkType(window.location.hash, window.location.search);

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

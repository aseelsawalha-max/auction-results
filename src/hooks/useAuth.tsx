import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, pendingAuthLinkType } from '../lib/supabaseClient';

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  isAdmin: boolean;
  /** True once an invite/recovery link has produced a session but the user
   * hasn't chosen a password yet — the app must show the Create Password
   * screen and nothing else until this clears. */
  needsPasswordSetup: boolean;
  linkInvalid: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  setPassword: (password: string) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);

  // Arms when the page was loaded from an invite/recovery link; disarms
  // permanently once a password has been saved, so later token refreshes or
  // the USER_UPDATED event that setPassword itself triggers never re-show
  // the Create Password screen for the rest of this session.
  const awaitingLinkPassword = useRef(pendingAuthLinkType !== null);

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;

    async function checkAdmin(sess: Session | null) {
      if (!sess) {
        if (!cancelled) setIsAdmin(false);
        return;
      }
      // is_admin() is SECURITY DEFINER and reads a table the caller has no
      // direct RLS access to — this is the real authorization check, not a
      // client-side convenience. The backend also re-checks it on every
      // write, so this only controls what the Admin UI *offers to try*.
      const { data, error } = await supabase!.rpc('is_admin');
      if (!cancelled) setIsAdmin(!error && data === true);
    }

    function handleSession(sess: Session | null) {
      setSession(sess);
      if (sess && awaitingLinkPassword.current) setNeedsPasswordSetup(true);
    }

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      handleSession(data.session);
      checkAdmin(data.session).finally(() => {
        if (!cancelled) setLoading(false);
      });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      handleSession(sess);
      checkAdmin(sess);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: AuthContextValue = {
    configured: isSupabaseConfigured,
    loading,
    session,
    isAdmin,
    needsPasswordSetup,
    // Loading has finished, the page was opened from an invite/recovery
    // link, but no session ever materialized from it — expired or
    // already-used link.
    linkInvalid: !loading && !session && pendingAuthLinkType !== null,
    async signIn(email, password) {
      if (!supabase) return { error: 'Supabase is not configured.' };
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error ? error.message : null };
    },
    async signOut() {
      await supabase?.auth.signOut();
    },
    async setPassword(password) {
      if (!supabase) return { error: 'Supabase is not configured.' };
      const { error } = await supabase.auth.updateUser({ password });
      if (!error) {
        awaitingLinkPassword.current = false;
        setNeedsPasswordSetup(false);
        if (typeof window !== 'undefined') {
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
      return { error: error ? error.message : null };
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
